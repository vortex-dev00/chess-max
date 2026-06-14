// User administration: list everyone with roles + group memberships; set roles.
// (Group add/remove is handled by routes/groups.js.)

import { json, ok, error, forbidden, notFound } from "../lib/response.js";
import { requireRole } from "../lib/auth.js";

export async function listUsers(request, env) {
  if (!(await requireRole(request, env, ["admin"]))) return forbidden();
  const rows = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.created_at,
            (SELECT group_concat(g.id || ':' || g.name, '|')
               FROM group_members m JOIN groups g ON g.id = m.group_id
              WHERE m.user_id = u.id) AS groups
       FROM users u ORDER BY
         CASE u.role WHEN 'admin' THEN 0 WHEN 'coach' THEN 1 ELSE 2 END, u.name`,
  ).all();
  // parse "id:name|id:name" -> [{id,name}]
  const users = rows.results.map((u) => ({
    ...u,
    groups: (u.groups || "").split("|").filter(Boolean).map((s) => {
      const i = s.indexOf(":");
      return { id: Number(s.slice(0, i)), name: s.slice(i + 1) };
    }),
  }));
  return json({ users });
}

// Pending signups awaiting staff approval (oldest first).
export async function listPending(request, env) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const rows = await env.DB.prepare(
    "SELECT id, name, email, role, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC",
  ).all();
  return json({ pending: rows.results });
}

export async function approveUser(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  const res = await env.DB.prepare("UPDATE users SET status = 'approved' WHERE id = ?").bind(id).run();
  if (!res.meta.changes) return notFound();
  return ok();
}

// Rejecting removes the account entirely (cascades sessions/memberships).
export async function rejectUser(request, env, id) {
  const me = await requireRole(request, env, ["admin", "coach"]);
  if (!me) return forbidden();
  if (me.id === id) return error("You can't reject your own account.");
  await env.DB.prepare("DELETE FROM users WHERE id = ? AND status = 'pending'").bind(id).run();
  return ok();
}

export async function setRole(request, env, id) {
  const me = await requireRole(request, env, ["admin"]);
  if (!me) return forbidden();
  const { role } = await request.json().catch(() => ({}));
  if (!["admin", "coach", "kid"].includes(role)) return error("Invalid role.");
  if (me.id === id && role !== "admin") return error("You can't remove your own admin role.");
  const res = await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  if (!res.meta.changes) return notFound();
  return ok();
}
