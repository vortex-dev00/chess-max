// Arena: ELO ratings, the challenge flow, and recorded games. The actual rated
// game is played in the GameRoom Durable Object, which authoritatively records
// the result and updates ELO (see durable/GameRoom.js). These routes set up
// challenges and expose ratings/history.

import { json, ok, error, forbidden, notFound } from "../lib/response.js";
import { currentUser } from "../lib/auth.js";

const code6 = () => Array.from({ length: 6 }, () =>
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[(Math.random() * 31) | 0]).join("");

// Everyone's rating (leaderboard + the people you can challenge).
export async function listPlayers(request, env) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const players = (await env.DB.prepare(
    "SELECT id, name, role, elo FROM users WHERE status = 'approved' ORDER BY elo DESC, name",
  ).all()).results;
  return json({ players, meId: me.id });
}

export async function createChallenge(request, env) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const { opponent_id } = await request.json().catch(() => ({}));
  const oppId = Number(opponent_id);
  if (!oppId || oppId === me.id) return error("Pick someone else to challenge.");
  const opp = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'approved'").bind(oppId).first();
  if (!opp) return notFound();

  // One live challenge between the same two people at a time (either direction).
  const dup = await env.DB.prepare(
    `SELECT id FROM challenges WHERE status = 'pending'
       AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))`,
  ).bind(me.id, oppId, oppId, me.id).first();
  if (dup) return error("There's already a pending challenge with that player.");

  const res = await env.DB.prepare(
    "INSERT INTO challenges (from_id, to_id, code, status, created_at) VALUES (?,?,?, 'pending', ?)",
  ).bind(me.id, oppId, code6(), Date.now()).run();
  return json({ id: res.meta.last_row_id });
}

// Incoming (to me) and outgoing (from me) pending challenges, plus any accepted
// ones whose game is still active so a player can re-enter.
export async function listChallenges(request, env) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const rows = (await env.DB.prepare(
    `SELECT c.id, c.from_id, c.to_id, c.code, c.status, c.game_id, c.created_at,
            uf.name AS from_name, uf.elo AS from_elo,
            ut.name AS to_name,   ut.elo AS to_elo,
            g.status AS game_status
       FROM challenges c
       JOIN users uf ON uf.id = c.from_id
       JOIN users ut ON ut.id = c.to_id
       LEFT JOIN games g ON g.id = c.game_id
      WHERE (c.from_id = ? OR c.to_id = ?)
        AND (c.status = 'pending' OR (c.status = 'accepted' AND g.status = 'active'))
      ORDER BY c.created_at DESC`,
  ).bind(me.id, me.id).all()).results;

  const incoming = rows.filter((r) => r.to_id === me.id && r.status === "pending");
  const outgoing = rows.filter((r) => r.from_id === me.id && r.status === "pending");
  const active = rows.filter((r) => r.status === "accepted");
  return json({ incoming, outgoing, active, meId: me.id });
}

export async function acceptChallenge(request, env, id) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const c = await env.DB.prepare("SELECT * FROM challenges WHERE id = ?").bind(id).first();
  if (!c) return notFound();
  if (c.to_id !== me.id) return forbidden();
  if (c.status !== "pending") return error("This challenge is no longer open.");

  // Random colours for fairness.
  const challengerWhite = Math.random() < 0.5;
  const white_id = challengerWhite ? c.from_id : c.to_id;
  const black_id = challengerWhite ? c.to_id : c.from_id;

  const g = await env.DB.prepare(
    "INSERT INTO games (code, white_id, black_id, rated, status, created_at) VALUES (?,?,?,1,'active',?)",
  ).bind(c.code, white_id, black_id, Date.now()).run();
  const gameId = g.meta.last_row_id;
  await env.DB.prepare("UPDATE challenges SET status = 'accepted', game_id = ? WHERE id = ?")
    .bind(gameId, id).run();
  return json({ game_id: gameId, code: c.code });
}

export async function declineChallenge(request, env, id) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const c = await env.DB.prepare("SELECT * FROM challenges WHERE id = ?").bind(id).first();
  if (!c) return notFound();
  if (c.to_id !== me.id && c.from_id !== me.id) return forbidden();   // recipient declines or sender cancels
  if (c.status !== "pending") return error("This challenge is no longer open.");
  await env.DB.prepare("UPDATE challenges SET status = 'declined' WHERE id = ?").bind(id).run();
  return ok();
}

// Game detail for the play page: confirms the caller is a player and gives the
// room code + colour + opponent so it can connect and orient the board.
export async function getGame(request, env, id) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const g = await env.DB.prepare(
    `SELECT g.*, uw.name AS white_name, uw.elo AS white_elo, ub.name AS black_name, ub.elo AS black_elo
       FROM games g
       LEFT JOIN users uw ON uw.id = g.white_id
       LEFT JOIN users ub ON ub.id = g.black_id
      WHERE g.id = ?`,
  ).bind(id).first();
  if (!g) return notFound();
  let yourColor = null;
  if (g.white_id === me.id) yourColor = "w";
  else if (g.black_id === me.id) yourColor = "b";
  // Non-players watch read-only rather than being turned away.
  return json({
    id: g.id, code: g.code, rated: !!g.rated, status: g.status, yourColor,
    spectator: !yourColor,
    winner: g.winner, reason: g.reason, white_delta: g.white_delta, black_delta: g.black_delta,
    white: { name: g.white_name, elo: g.white_elo },
    black: { name: g.black_name, elo: g.black_elo },
  });
}

// Move list of a finished game, for move-by-move replay. Open to any approved
// user (kids replaying tournament games, etc.).
export async function getGameReplay(request, env, id) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const g = await env.DB.prepare(
    `SELECT g.id, g.status, g.winner, g.reason, g.pgn,
            uw.name AS white_name, uw.elo AS white_elo, ub.name AS black_name, ub.elo AS black_elo
       FROM games g
       LEFT JOIN users uw ON uw.id = g.white_id
       LEFT JOIN users ub ON ub.id = g.black_id
      WHERE g.id = ?`,
  ).bind(id).first();
  if (!g) return notFound();
  if (g.status !== "finished") return error("This game isn't finished yet.");
  return json({
    id: g.id, pgn: g.pgn || "", winner: g.winner, reason: g.reason,
    white: { name: g.white_name, elo: g.white_elo },
    black: { name: g.black_name, elo: g.black_elo },
  });
}

// A player's finished games, newest first.
export async function myGames(request, env) {
  const me = await currentUser(request, env);
  if (!me) return forbidden();
  const rows = (await env.DB.prepare(
    `SELECT g.id, g.winner, g.reason, g.finished_at, g.white_id, g.black_id,
            g.white_delta, g.black_delta, uw.name AS white_name, ub.name AS black_name
       FROM games g
       LEFT JOIN users uw ON uw.id = g.white_id
       LEFT JOIN users ub ON ub.id = g.black_id
      WHERE g.status = 'finished' AND (g.white_id = ? OR g.black_id = ?)
      ORDER BY g.finished_at DESC LIMIT 20`,
  ).bind(me.id, me.id).all()).results;

  const games = rows.map((g) => {
    const iAmWhite = g.white_id === me.id;
    const myDelta = iAmWhite ? g.white_delta : g.black_delta;
    const opp = iAmWhite ? g.black_name : g.white_name;
    const result = g.winner === "draw" ? "draw"
      : (g.winner === "white") === iAmWhite ? "win" : "loss";
    return { id: g.id, opponent: opp || "—", result, delta: myDelta, reason: g.reason, at: g.finished_at };
  });
  return json({ games });
}
