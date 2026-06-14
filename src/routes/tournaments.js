// Coach-hosted online tournaments. Each match is a rated game played in the
// GameRoom DO (which records the result + ELO). The tournament reconciles those
// game results on read and auto-advances rounds, format-by-format.

import { json, ok, error, forbidden, notFound } from "../lib/response.js";
import { currentUser, requireRole } from "../lib/auth.js";
import {
  shuffle, pairKey, knockoutRound1, knockoutNext, roundRobinSchedule, swissPairing, recommendedSwissRounds,
} from "../lib/pairing.js";

const code6 = () => Array.from({ length: 6 }, () =>
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[(Math.random() * 31) | 0]).join("");
const FORMATS = new Set(["knockout", "roundrobin", "swiss"]);

/* ── list / create ── */

export async function listTournaments(request, env) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();

  // Kids only see tournaments aimed at them (everyone / their group / named) or
  // ones they're already in. Staff see all.
  const binds = [me.id];
  let visibility = "";
  if (me.role === "kid") {
    visibility = `WHERE (
        t.audience_type = 'all'
        OR (t.audience_type = 'group' AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = t.audience_group_id AND gm.user_id = ?))
        OR (t.audience_type = 'kids'  AND EXISTS (SELECT 1 FROM tournament_audience ta WHERE ta.tournament_id = t.id AND ta.user_id = ?))
        OR EXISTS (SELECT 1 FROM tournament_players tp WHERE tp.tournament_id = t.id AND tp.user_id = ?)
      )`;
    binds.push(me.id, me.id, me.id);
  }

  const rows = (await env.DB.prepare(
    `SELECT t.*, u.name AS winner_name,
            (SELECT COUNT(*) FROM tournament_players p WHERE p.tournament_id = t.id) AS players,
            (SELECT COUNT(*) FROM tournament_players p WHERE p.tournament_id = t.id AND p.user_id = ?) AS joined
       FROM tournaments t LEFT JOIN users u ON u.id = t.winner_id
      ${visibility}
      ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, t.created_at DESC`,
  ).bind(...binds).all()).results;
  return json({
    tournaments: rows.map((t) => ({ ...t, joined: !!t.joined })),
    canManage: me.role === "admin" || me.role === "coach",
  });
}

export async function createTournament(request, env) {
  const me = await requireRole(request, env, ["admin", "coach"]);
  if (!me) return forbidden();
  const { name, format, rounds, audience_type, group_id, kid_ids } = await request.json().catch(() => ({}));
  if (!name || !FORMATS.has(format)) return error("Name and a valid format are required.");

  // Who will this tournament show up for?
  const at = ["all", "group", "kids"].includes(audience_type) ? audience_type : "all";
  let gid = null, kids = [];
  if (at === "group") { gid = Number(group_id); if (!gid) return error("Pick a group."); }
  if (at === "kids") {
    kids = Array.isArray(kid_ids) ? [...new Set(kid_ids.map(Number).filter(Boolean))] : [];
    if (!kids.length) return error("Pick at least one kid.");
  }

  const res = await env.DB.prepare(
    `INSERT INTO tournaments (name, format, status, rounds_total, audience_type, audience_group_id, created_by, created_at)
     VALUES (?,?, 'open', ?, ?, ?, ?, ?)`,
  ).bind(name.slice(0, 80), format, Number(rounds) || 0, at, gid, me.id, Date.now()).run();
  const id = res.meta.last_row_id;

  if (at === "kids") {
    for (const uid of kids) {
      await env.DB.prepare("INSERT INTO tournament_audience (tournament_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING")
        .bind(id, uid).run();
    }
  }
  return json({ id });
}

// Can a kid see / join this tournament? (Staff always can.)
async function kidEligible(env, t, uid) {
  if (t.audience_type === "all") return true;
  if (t.audience_type === "group") {
    return !!(await env.DB.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind(t.audience_group_id, uid).first());
  }
  if (t.audience_type === "kids") {
    return !!(await env.DB.prepare("SELECT 1 FROM tournament_audience WHERE tournament_id = ? AND user_id = ?")
      .bind(t.id, uid).first());
  }
  return false;
}

export async function deleteTournament(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  await env.DB.prepare("DELETE FROM tournaments WHERE id = ?").bind(id).run();
  return ok();
}

/* ── join / leave ── */

export async function joinTournament(request, env, id) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const t = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first();
  if (!t) return notFound();
  if (t.status !== "open") return error("This tournament has already started.");
  if (me.role === "kid" && !(await kidEligible(env, t, me.id))) return error("This tournament isn't open to you.", 403);
  await env.DB.prepare(
    "INSERT INTO tournament_players (tournament_id, user_id, joined_at) VALUES (?,?,?) ON CONFLICT DO NOTHING",
  ).bind(id, me.id, Date.now()).run();
  return ok();
}

export async function leaveTournament(request, env, id) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const t = await env.DB.prepare("SELECT status FROM tournaments WHERE id = ?").bind(id).first();
  if (!t) return notFound();
  if (t.status !== "open") return error("Can't leave once it has started.");
  await env.DB.prepare("DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?")
    .bind(id, me.id).run();
  return ok();
}

/* ── start ── */

export async function startTournament(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const t = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first();
  if (!t) return notFound();
  if (t.status !== "open") return error("Already started.");

  const players = (await env.DB.prepare(
    `SELECT p.user_id, u.elo FROM tournament_players p JOIN users u ON u.id = p.user_id
      WHERE p.tournament_id = ? ORDER BY u.elo DESC`,
  ).bind(id).all()).results;
  if (players.length < 2) return error("Need at least 2 players.");

  // Seed by rating (ties broken randomly within the list order is fine).
  const ids = players.map((p) => p.user_id);
  for (let i = 0; i < ids.length; i++) {
    await env.DB.prepare("UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?")
      .bind(i, id, ids[i]).run();
  }

  let pairs, roundsTotal;
  if (t.format === "knockout") {
    let size = 1; while (size < ids.length) size *= 2;
    roundsTotal = Math.log2(size);
    pairs = knockoutRound1(ids);
  } else if (t.format === "roundrobin") {
    const sched = roundRobinSchedule(ids);
    roundsTotal = sched.length;
    pairs = sched[0];
  } else { // swiss
    roundsTotal = t.rounds_total > 0 ? t.rounds_total : recommendedSwissRounds(ids.length);
    pairs = swissPairing(ids.map((u) => ({ id: u, score: 0 })), new Set());
  }

  await env.DB.prepare("UPDATE tournaments SET status = 'active', rounds_total = ?, current_round = 1 WHERE id = ?")
    .bind(roundsTotal, id).run();
  await createRound(env, id, 1, pairs);
  return ok();
}

/* ── detail (reconciles + advances, then returns everything to render) ── */

export async function getTournament(request, env, id) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  let t = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first();
  if (!t) return notFound();

  // Kids can only open a tournament they're allowed to see (eligible or already in).
  if (me.role === "kid") {
    const isPlayer = await env.DB.prepare("SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?")
      .bind(id, me.id).first();
    if (!isPlayer && !(await kidEligible(env, t, me.id))) return notFound();
  }

  if (t.status === "active") { await reconcile(env, t); t = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(id).first(); }

  const players = (await env.DB.prepare(
    `SELECT p.user_id AS id, u.name, u.elo, p.seed, p.score, p.active
       FROM tournament_players p JOIN users u ON u.id = p.user_id
      WHERE p.tournament_id = ? ORDER BY p.score DESC, u.elo DESC, u.name`,
  ).bind(id).all()).results;

  const matches = (await env.DB.prepare(
    `SELECT m.*, uw.name AS white_name, ub.name AS black_name, g.status AS game_status
       FROM tournament_matches m
       LEFT JOIN users uw ON uw.id = m.white_id
       LEFT JOIN users ub ON ub.id = m.black_id
       LEFT JOIN games g ON g.id = m.game_id
      WHERE m.tournament_id = ? ORDER BY m.round, m.slot`,
  ).bind(id).all()).results;

  // The signed-in player's live match (a game they still need to play).
  const mine = matches.find((m) => m.status === "active" && m.game_id &&
    (m.white_id === me.id || m.black_id === me.id));

  const winner = t.winner_id ? players.find((p) => p.id === t.winner_id) : null;
  return json({
    tournament: t,
    canManage: me.role === "admin" || me.role === "coach",
    meId: me.id,
    players,
    matches,
    myMatch: mine ? { game_id: mine.game_id, round: mine.round } : null,
    winnerName: winner ? winner.name : (t.winner_id ? "—" : null),
  });
}

/* ── internals ── */

async function createRound(env, tid, round, pairs) {
  const now = Date.now();
  for (let slot = 0; slot < pairs.length; slot++) {
    let [a, b] = pairs[slot];
    if (a == null && b != null) { a = b; b = null; }   // normalise: bye always sits in `b`
    if (a == null) continue;                            // empty pair (shouldn't happen)
    if (b == null) {
      // Bye: player auto-advances and (for scored formats) gets a point.
      await env.DB.prepare(
        `INSERT INTO tournament_matches (tournament_id, round, slot, white_id, black_id, winner_id, result, status, created_at)
         VALUES (?,?,?,?,?,?, 'bye', 'finished', ?)`,
      ).bind(tid, round, slot, a, null, a, now).run();
      await env.DB.prepare("UPDATE tournament_players SET score = score + 1 WHERE tournament_id = ? AND user_id = ?")
        .bind(tid, a).run();
      continue;
    }
    // Randomise colours, then spin up a rated game for the pairing.
    const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
    const g = await env.DB.prepare(
      "INSERT INTO games (code, white_id, black_id, rated, status, created_at) VALUES (?,?,?,1,'active',?)",
    ).bind(code6(), white, black, now).run();
    await env.DB.prepare(
      `INSERT INTO tournament_matches (tournament_id, round, slot, white_id, black_id, game_id, status, created_at)
       VALUES (?,?,?,?,?,?, 'active', ?)`,
    ).bind(tid, round, slot, white, black, g.meta.last_row_id, now).run();
  }
}

async function reconcile(env, t) {
  const matches = (await env.DB.prepare(
    "SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ?",
  ).bind(t.id, t.current_round).all()).results;
  if (!matches.length) return;

  let allDone = true;
  for (const m of matches) {
    if (m.status === "finished") continue;
    if (!m.game_id) { allDone = false; continue; }
    const g = await env.DB.prepare("SELECT status, winner FROM games WHERE id = ?").bind(m.game_id).first();
    if (!g || g.status !== "finished") { allDone = false; continue; }

    let winnerId = null, result = g.winner;
    if (g.winner === "white") winnerId = m.white_id;
    else if (g.winner === "black") winnerId = m.black_id;
    else if (t.format === "knockout") winnerId = await higherElo(env, m.white_id, m.black_id);  // draws can't advance

    await env.DB.prepare("UPDATE tournament_matches SET status='finished', winner_id=?, result=? WHERE id=?")
      .bind(winnerId, result, m.id).run();

    if (result === "draw" && t.format !== "knockout") {
      await bumpScore(env, t.id, m.white_id, 0.5);
      await bumpScore(env, t.id, m.black_id, 0.5);
    } else if (winnerId) {
      await bumpScore(env, t.id, winnerId, 1);
    }
    if (t.format === "knockout" && winnerId) {
      const loser = winnerId === m.white_id ? m.black_id : m.white_id;
      await env.DB.prepare("UPDATE tournament_players SET active=0 WHERE tournament_id=? AND user_id=?")
        .bind(t.id, loser).run();
    }
  }
  if (allDone) await advance(env, t);
}

async function advance(env, t) {
  const round = t.current_round;
  if (t.format === "knockout") {
    const ms = (await env.DB.prepare(
      "SELECT winner_id FROM tournament_matches WHERE tournament_id=? AND round=? ORDER BY slot",
    ).bind(t.id, round).all()).results;
    const winners = ms.map((m) => m.winner_id).filter(Boolean);
    if (winners.length <= 1) return finishTournament(env, t.id, winners[0] || null);
    await createRound(env, t.id, round + 1, knockoutNext(winners));
    await env.DB.prepare("UPDATE tournaments SET current_round=? WHERE id=?").bind(round + 1, t.id).run();
    return;
  }
  // roundrobin & swiss: stop at rounds_total, else build the next round
  if (round >= t.rounds_total) return finishByScore(env, t.id);

  if (t.format === "roundrobin") {
    const ids = await seededIds(env, t.id);
    const sched = roundRobinSchedule(ids);
    await createRound(env, t.id, round + 1, sched[round] || []);
  } else { // swiss
    const standings = (await env.DB.prepare(
      "SELECT user_id AS id, score FROM tournament_players WHERE tournament_id=? ORDER BY score DESC",
    ).bind(t.id).all()).results;
    const played = new Set((await env.DB.prepare(
      "SELECT white_id, black_id FROM tournament_matches WHERE tournament_id=? AND black_id IS NOT NULL",
    ).bind(t.id).all()).results.map((r) => pairKey(r.white_id, r.black_id)));
    await createRound(env, t.id, round + 1, swissPairing(standings, played));
  }
  await env.DB.prepare("UPDATE tournaments SET current_round=? WHERE id=?").bind(round + 1, t.id).run();
}

async function finishByScore(env, tid) {
  const top = await env.DB.prepare(
    `SELECT p.user_id FROM tournament_players p JOIN users u ON u.id = p.user_id
      WHERE p.tournament_id=? ORDER BY p.score DESC, u.elo DESC LIMIT 1`,
  ).bind(tid).first();
  return finishTournament(env, tid, top ? top.user_id : null);
}

async function finishTournament(env, tid, winnerId) {
  await env.DB.prepare("UPDATE tournaments SET status='finished', winner_id=? WHERE id=?").bind(winnerId, tid).run();
}

async function bumpScore(env, tid, uid, n) {
  await env.DB.prepare("UPDATE tournament_players SET score = score + ? WHERE tournament_id=? AND user_id=?")
    .bind(n, tid, uid).run();
}
async function higherElo(env, a, b) {
  const ra = await env.DB.prepare("SELECT elo FROM users WHERE id=?").bind(a).first();
  const rb = await env.DB.prepare("SELECT elo FROM users WHERE id=?").bind(b).first();
  const ea = ra ? ra.elo : 0, eb = rb ? rb.elo : 0;
  if (ea === eb) return Math.random() < 0.5 ? a : b;
  return ea > eb ? a : b;
}
async function seededIds(env, tid) {
  return (await env.DB.prepare(
    "SELECT user_id FROM tournament_players WHERE tournament_id=? ORDER BY seed",
  ).bind(tid).all()).results.map((r) => r.user_id);
}
