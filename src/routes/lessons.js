// Lessons (schedule + attendance) and group reviews.

import { json, ok, error, forbidden, notFound } from "../lib/response.js";
import { currentUser, requireRole } from "../lib/auth.js";

const staff = (request, env) => requireRole(request, env, ["admin", "coach"]);

/* ── Lessons ── */
export async function addLesson(request, env, groupId) {
  if (!(await staff(request, env))) return forbidden();
  const { starts_at, location = "", note = "" } = await request.json().catch(() => ({}));
  if (!starts_at) return error("starts_at required.");
  await env.DB.prepare("INSERT INTO lessons (group_id, starts_at, location, note) VALUES (?,?,?,?)")
    .bind(groupId, starts_at, location.slice(0, 80), note.slice(0, 200)).run();
  return ok();
}

export async function deleteLesson(request, env, lessonId) {
  if (!(await staff(request, env))) return forbidden();
  await env.DB.prepare("DELETE FROM lessons WHERE id = ?").bind(lessonId).run();
  return ok();
}

/* ── Attendance ── */
export async function getAttendance(request, env, lessonId) {
  if (!(await staff(request, env))) return forbidden();
  const lesson = await env.DB.prepare("SELECT group_id FROM lessons WHERE id = ?").bind(lessonId).first();
  if (!lesson) return notFound();
  const rows = await env.DB.prepare(
    `SELECT u.id AS user_id, u.name, COALESCE(la.attended, 0) AS attended
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       LEFT JOIN lesson_attendance la ON la.user_id = u.id AND la.lesson_id = ?
      WHERE gm.group_id = ? ORDER BY u.name`,
  ).bind(lessonId, lesson.group_id).all();
  return json({ attendance: rows.results });
}

export async function setAttendance(request, env, lessonId) {
  if (!(await staff(request, env))) return forbidden();
  const { user_id, attended } = await request.json().catch(() => ({}));
  if (user_id == null || attended == null) return error("user_id and attended required.");
  await env.DB.prepare(
    `INSERT INTO lesson_attendance (lesson_id, user_id, attended) VALUES (?,?,?)
       ON CONFLICT(lesson_id, user_id) DO UPDATE SET attended = excluded.attended`,
  ).bind(lessonId, user_id, attended ? 1 : 0).run();
  return ok();
}

/* ── Reviews ── */
export async function addReview(request, env, groupId) {
  if (!(await staff(request, env))) return forbidden();
  const { text, review_date } = await request.json().catch(() => ({}));
  if (!text) return error("Review text required.");
  await env.DB.prepare("INSERT INTO group_reviews (group_id, review_date, text, created_at) VALUES (?,?,?,?)")
    .bind(groupId, review_date || new Date().toISOString().slice(0, 10), text.slice(0, 1000), Date.now()).run();
  return ok();
}

export async function deleteReview(request, env, reviewId) {
  if (!(await staff(request, env))) return forbidden();
  await env.DB.prepare("DELETE FROM group_reviews WHERE id = ?").bind(reviewId).run();
  return ok();
}
