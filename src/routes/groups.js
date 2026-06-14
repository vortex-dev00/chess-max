// Groups: admins/coaches create groups and add kids; kids see their groups.

import { json, ok, error, forbidden, notFound } from "../lib/response.js";
import { currentUser, requireRole } from "../lib/auth.js";

export async function listGroups(request, env) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const rows = await env.DB.prepare(
    `SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
       FROM groups g ORDER BY g.name`,
  ).all();
  return json({ groups: rows.results });
}

export async function createGroup(request, env) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const { name } = await request.json().catch(() => ({}));
  if (!name) return error("Group name required.");
  const res = await env.DB.prepare("INSERT INTO groups (name, created_at) VALUES (?,?)")
    .bind(name.slice(0, 80), Date.now()).run();
  return json({ id: res.meta.last_row_id });
}

export async function deleteGroup(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  await env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(id).run();
  return ok();
}

export async function getGroup(request, env, id) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  const group = await env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first();
  if (!group) return notFound();

  // Members may view their own group; staff may view any.
  const isMember = await env.DB.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(id, user.id).first();
  if (user.role === "kid" && !isMember) return forbidden();

  const members = await env.DB.prepare(
    `SELECT u.id, u.name, u.email FROM group_members m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? ORDER BY u.name`,
  ).bind(id).all();
  const lessons = await env.DB.prepare("SELECT * FROM lessons WHERE group_id = ? ORDER BY starts_at").bind(id).all();
  const reviews = await env.DB.prepare(
    "SELECT * FROM group_reviews WHERE group_id = ? ORDER BY review_date DESC, id DESC LIMIT 12",
  ).bind(id).all();
  return json({ group, members: members.results, lessons: lessons.results, reviews: reviews.results });
}

export async function addMember(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const { user_id } = await request.json().catch(() => ({}));
  if (!user_id) return error("user_id required.");
  await env.DB.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING")
    .bind(id, user_id).run();
  return ok();
}

export async function removeMember(request, env, id, userId) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  await env.DB.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").bind(id, userId).run();
  return ok();
}

// Kids: list of kids (for the "add member" picker).
export async function listKids(request, env) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const rows = await env.DB.prepare("SELECT id, name, email FROM users WHERE role = 'kid' ORDER BY name").all();
  return json({ kids: rows.results });
}

// The groups the signed-in user belongs to, each with the next lesson and the
// latest coach review (what a kid needs at a glance).
export async function myGroups(request, env) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  const groups = (await env.DB.prepare(
    `SELECT g.* FROM group_members m JOIN groups g ON g.id = m.group_id
      WHERE m.user_id = ? ORDER BY g.name`,
  ).bind(user.id).all()).results;

  const out = [];
  for (const g of groups) {
    const nextLesson = await env.DB.prepare(
      "SELECT * FROM lessons WHERE group_id = ? AND starts_at >= ? ORDER BY starts_at ASC LIMIT 1",
    ).bind(g.id, Date.now()).first();
    const review = await env.DB.prepare(
      "SELECT * FROM group_reviews WHERE group_id = ? ORDER BY review_date DESC, id DESC LIMIT 1",
    ).bind(g.id).first();
    out.push({ ...g, nextLesson, review });
  }
  return json({ groups: out });
}
