// Chess tasks: created from a PGN import or the board editor (client derives
// fen + UCI solution), saved here, assigned to kids, and solved interactively.

import { json, ok, error, forbidden, notFound } from "../lib/response.js";
import { currentUser, requireRole } from "../lib/auth.js";

export async function listTasks(request, env) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const rows = await env.DB.prepare(
    `SELECT t.*, u.name AS author FROM tasks t LEFT JOIN users u ON u.id = t.created_by
      ORDER BY t.created_at DESC`,
  ).all();
  return json({ tasks: rows.results });
}

export async function createTask(request, env) {
  const user = await requireRole(request, env, ["admin", "coach"]);
  if (!user) return forbidden();
  const { title, description = "", fen, solution = "", difficulty = 1 } = await request.json().catch(() => ({}));
  if (!title || !fen) return error("Title and a position (fen) are required.");
  const res = await env.DB.prepare(
    "INSERT INTO tasks (title, description, fen, solution, difficulty, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(title.slice(0, 120), description, fen, String(solution).trim().toLowerCase(),
        Math.max(1, Math.min(5, Number(difficulty) || 1)), user.id, Date.now()).run();
  return json({ id: res.meta.last_row_id });
}

export async function deleteTask(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  return ok();
}

export async function assignTask(request, env) {
  const user = await requireRole(request, env, ["admin", "coach"]);
  if (!user) return forbidden();
  const { task_id, user_id } = await request.json().catch(() => ({}));
  if (!task_id || !user_id) return error("task_id and user_id required.");
  await env.DB.prepare(
    "INSERT INTO assignments (task_id, user_id, assigned_at) VALUES (?,?,?) ON CONFLICT DO NOTHING",
  ).bind(task_id, user_id, Date.now()).run();
  return ok();
}

export async function myAssignments(request, env) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  const rows = await env.DB.prepare(
    `SELECT a.id, a.status, a.assigned_at, a.completed_at,
            t.id AS task_id, t.title, t.description, t.difficulty,
            (t.solution != '') AS has_solution
       FROM assignments a JOIN tasks t ON t.id = a.task_id
      WHERE a.user_id = ? ORDER BY a.assigned_at DESC`,
  ).bind(user.id).all();
  return json({ assignments: rows.results });
}

/* ── Interactive solving (solution never sent to the client) ── */

export async function getPuzzle(request, env, id) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  const t = await env.DB.prepare("SELECT id, title, description, fen, difficulty, solution FROM tasks WHERE id = ?")
    .bind(id).first();
  if (!t) return notFound();
  return json({ id: t.id, title: t.title, description: t.description, fen: t.fen,
                difficulty: t.difficulty, hasSolution: !!(t.solution && t.solution.length) });
}

export async function checkMove(request, env, id) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  const t = await env.DB.prepare("SELECT solution FROM tasks WHERE id = ?").bind(id).first();
  if (!t) return notFound();
  const line = (t.solution || "").split(/\s+/).filter(Boolean);
  const { ply, move } = await request.json().catch(() => ({}));
  if (typeof ply !== "number" || !move) return error("ply and move required.");
  if (ply >= line.length || String(move).toLowerCase() !== line[ply]) return json({ correct: false });
  const reply = line[ply + 1] || null;
  const done = ply + (reply ? 2 : 1) >= line.length;
  if (done) {
    await env.DB.prepare(
      "UPDATE assignments SET status='completed', completed_at=? WHERE task_id=? AND user_id=? AND status!='completed'",
    ).bind(Date.now(), id, user.id).run();
  }
  return json({ correct: true, reply, done });
}
