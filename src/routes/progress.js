// Gamified homework: XP, chess-themed ranks, and collectible badges — all
// derived on the server from completed assignments (single source of truth, so
// the client can only render what we compute). Nothing extra to store: a kid's
// progress is a pure function of which puzzles they've solved.

import { json, forbidden, notFound } from "../lib/response.js";
import { currentUser, requireRole } from "../lib/auth.js";

const XP_PER_STAR = 10;            // a solved puzzle is worth difficulty × 10 XP

// Cumulative XP needed for each rank. Level number = index + 1.
const RANKS = [
  { min: 0,    name: "Pawn" },
  { min: 50,   name: "Knight" },
  { min: 150,  name: "Bishop" },
  { min: 300,  name: "Rook" },
  { min: 550,  name: "Queen" },
  { min: 900,  name: "King" },
  { min: 1400, name: "Grandmaster" },
];

// Collectibles. `stat` picks the number that counts toward each badge.
const BADGES = [
  { key: "first", icon: "🎯", name: "First Blood",  desc: "Solve your first puzzle",   target: 1,  stat: (s) => s.solved },
  { key: "five",  icon: "⭐", name: "Rising Star",   desc: "Solve 5 puzzles",           target: 5,  stat: (s) => s.solved },
  { key: "ten",   icon: "🏅", name: "Sharpshooter",  desc: "Solve 10 puzzles",          target: 10, stat: (s) => s.solved },
  { key: "tf",    icon: "🏆", name: "Puzzle Master", desc: "Solve 25 puzzles",          target: 25, stat: (s) => s.solved },
  { key: "fifty", icon: "👑", name: "Legend",        desc: "Solve 50 puzzles",          target: 50, stat: (s) => s.solved },
  { key: "tough", icon: "💎", name: "Diamond Mind",  desc: "Solve a 5★ puzzle",         target: 5,  stat: (s) => s.maxDifficulty },
  { key: "fire",  icon: "🔥", name: "On Fire",       desc: "Solve 3 puzzles in one day", target: 3,  stat: (s) => s.bestDay },
  { key: "dedi",  icon: "📅", name: "Dedicated",     desc: "Play on 5 different days",  target: 5,  stat: (s) => s.distinctDays },
];

// rows: [{ difficulty, completed_at }] for one kid's completed assignments.
function computeProgress(rows) {
  let points = 0, maxDifficulty = 0;
  const byDay = {};
  for (const r of rows) {
    const d = Math.max(1, Math.min(5, Number(r.difficulty) || 1));
    points += d * XP_PER_STAR;
    if (d > maxDifficulty) maxDifficulty = d;
    const day = new Date(r.completed_at || 0).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const stats = {
    solved: rows.length,
    points,
    maxDifficulty,
    bestDay: Object.values(byDay).reduce((a, b) => Math.max(a, b), 0),
    distinctDays: Object.keys(byDay).length,
  };

  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (points >= RANKS[i].min) idx = i;
  const next = RANKS[idx + 1] || null;
  const level = {
    num: idx + 1,
    name: RANKS[idx].name,
    points,
    floor: RANKS[idx].min,
    next: next ? next.min : null,
    nextName: next ? next.name : null,
  };

  const badges = BADGES.map((b) => {
    const cur = b.stat(stats);
    return { key: b.key, icon: b.icon, name: b.name, desc: b.desc,
             earned: cur >= b.target, cur: Math.min(cur, b.target), target: b.target };
  });

  return { ...stats, level, badges };
}

// A kid's own progress (any signed-in user can read their own).
export async function myProgress(request, env) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  const rows = (await env.DB.prepare(
    `SELECT t.difficulty, a.completed_at
       FROM assignments a JOIN tasks t ON t.id = a.task_id
      WHERE a.user_id = ? AND a.status = 'completed'`,
  ).bind(user.id).all()).results;
  return json({ name: user.name, ...computeProgress(rows) });
}

// Leaderboard for staff: every kid with their level, points, and earned badges.
export async function allProgress(request, env) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();

  const kids = (await env.DB.prepare("SELECT id, name FROM users WHERE role = 'kid'").all()).results;
  const rows = (await env.DB.prepare(
    `SELECT a.user_id, t.difficulty, a.completed_at
       FROM assignments a JOIN tasks t ON t.id = a.task_id
       JOIN users u ON u.id = a.user_id
      WHERE u.role = 'kid' AND a.status = 'completed'`,
  ).all()).results;

  const byKid = new Map();
  for (const r of rows) {
    if (!byKid.has(r.user_id)) byKid.set(r.user_id, []);
    byKid.get(r.user_id).push(r);
  }

  const list = kids.map((k) => {
    const p = computeProgress(byKid.get(k.id) || []);
    return {
      id: k.id, name: k.name,
      points: p.points, solved: p.solved, level: { num: p.level.num, name: p.level.name },
      earned: p.badges.filter((b) => b.earned).map((b) => ({ icon: b.icon, name: b.name })),
      badgeCount: p.badges.filter((b) => b.earned).length,
    };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  return json({ kids: list });
}

// A compact progress summary per kid — what the leaderboard rows need.
function summarize(name, id, rows) {
  const p = computeProgress(rows || []);
  return {
    id, name,
    points: p.points, solved: p.solved,
    level: { num: p.level.num, name: p.level.name },
    earned: p.badges.filter((b) => b.earned).map((b) => ({ icon: b.icon, name: b.name })),
    badgeCount: p.badges.filter((b) => b.earned).length,
  };
}

// Progress organised by group, so staff drill in group-first instead of one flat
// leaderboard. Kids in no group are returned under `ungrouped`.
export async function groupedProgress(request, env) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();

  const kids = (await env.DB.prepare("SELECT id, name FROM users WHERE role = 'kid'").all()).results;
  const rows = (await env.DB.prepare(
    `SELECT a.user_id, t.difficulty, a.completed_at
       FROM assignments a JOIN tasks t ON t.id = a.task_id
       JOIN users u ON u.id = a.user_id
      WHERE u.role = 'kid' AND a.status = 'completed'`,
  ).all()).results;

  const byKid = new Map();
  for (const r of rows) {
    if (!byKid.has(r.user_id)) byKid.set(r.user_id, []);
    byKid.get(r.user_id).push(r);
  }
  const kidMap = new Map(kids.map((k) => [k.id, summarize(k.name, k.id, byKid.get(k.id))]));

  const groups = (await env.DB.prepare("SELECT id, name FROM groups ORDER BY name").all()).results;
  const links = (await env.DB.prepare("SELECT group_id, user_id FROM group_members").all()).results;
  const grouped = new Map(groups.map((g) => [g.id, []]));
  const placed = new Set();
  for (const m of links) {
    if (grouped.has(m.group_id) && kidMap.has(m.user_id)) {
      grouped.get(m.group_id).push(kidMap.get(m.user_id));
      placed.add(m.user_id);
    }
  }
  const sortKids = (arr) => arr.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  return json({
    groups: groups.map((g) => ({ id: g.id, name: g.name, kids: sortKids(grouped.get(g.id)) })),
    ungrouped: sortKids(kids.filter((k) => !placed.has(k.id)).map((k) => kidMap.get(k.id))),
    total: kids.length,
  });
}

// One kid's full progress + the puzzles they've solved (board, solution line,
// and when), plus what's still assigned. Staff only.
export async function kidProgress(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const kid = await env.DB.prepare("SELECT id, name FROM users WHERE id = ?").bind(id).first();
  if (!kid) return notFound();

  const solved = (await env.DB.prepare(
    `SELECT t.id AS task_id, t.title, t.fen, t.solution, t.difficulty, a.assigned_at, a.completed_at
       FROM assignments a JOIN tasks t ON t.id = a.task_id
      WHERE a.user_id = ? AND a.status = 'completed'
      ORDER BY a.completed_at DESC`,
  ).bind(id).all()).results;

  const pending = (await env.DB.prepare(
    `SELECT t.id AS task_id, t.title, t.fen, t.difficulty, a.assigned_at
       FROM assignments a JOIN tasks t ON t.id = a.task_id
      WHERE a.user_id = ? AND a.status = 'assigned'
      ORDER BY a.assigned_at DESC`,
  ).bind(id).all()).results;

  const p = computeProgress(solved.map((r) => ({ difficulty: r.difficulty, completed_at: r.completed_at })));
  return json({ id: kid.id, name: kid.name, ...p, solved, pending });
}
