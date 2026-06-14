// Events calendar: staff post real-life events (tournaments, meetups); every
// signed-in user can RSVP and see who else is going.

import { json, ok, error, forbidden, notFound } from "../lib/response.js";
import { currentUser, requireRole } from "../lib/auth.js";

// All upcoming-and-recent events, each with its attendee list and whether the
// caller is going. Ordered soonest-first.
export async function listEvents(request, env) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();

  const events = (await env.DB.prepare(
    "SELECT * FROM events ORDER BY starts_at ASC",
  ).all()).results;

  const rsvps = (await env.DB.prepare(
    `SELECT r.event_id, r.user_id, r.status, u.name
       FROM event_rsvps r JOIN users u ON u.id = r.user_id
      ORDER BY u.name`,
  ).all()).results;

  const byEvent = new Map();
  for (const r of rsvps) {
    if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
    byEvent.get(r.event_id).push({ id: r.user_id, name: r.name, status: r.status });
  }

  const out = events.map((e) => {
    const list = byEvent.get(e.id) || [];
    const mine = list.find((a) => a.id === user.id);
    return {
      ...e,
      going: list.filter((a) => a.status === "going").map(({ id, name }) => ({ id, name })),
      maybe: list.filter((a) => a.status === "maybe").map(({ id, name }) => ({ id, name })),
      myStatus: mine ? mine.status : null,
    };
  });
  return json({ events: out, canManage: user.role === "admin" || user.role === "coach" });
}

export async function createEvent(request, env) {
  const user = await requireRole(request, env, ["admin", "coach"]);
  if (!user) return forbidden();
  const { title, description = "", location = "", starts_at } = await request.json().catch(() => ({}));
  if (!title || !starts_at) return error("Title and date/time are required.");
  const res = await env.DB.prepare(
    "INSERT INTO events (title, description, location, starts_at, created_by, created_at) VALUES (?,?,?,?,?,?)",
  ).bind(title.slice(0, 120), String(description).slice(0, 1000), String(location).slice(0, 120),
        Number(starts_at), user.id, Date.now()).run();
  return json({ id: res.meta.last_row_id });
}

export async function deleteEvent(request, env, id) {
  if (!(await requireRole(request, env, ["admin", "coach"]))) return forbidden();
  await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  return ok();
}

export async function rsvp(request, env, id) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  const ev = await env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(id).first();
  if (!ev) return notFound();
  const { status } = await request.json().catch(() => ({}));
  const st = status === "maybe" ? "maybe" : "going";   // default to a firm yes
  await env.DB.prepare(
    `INSERT INTO event_rsvps (event_id, user_id, status, created_at) VALUES (?,?,?,?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status`,
  ).bind(id, user.id, st, Date.now()).run();
  return ok();
}

export async function unrsvp(request, env, id) {
  const user = await currentUser(request, env);
  if (!user) return forbidden();
  await env.DB.prepare("DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?")
    .bind(id, user.id).run();
  return ok();
}
