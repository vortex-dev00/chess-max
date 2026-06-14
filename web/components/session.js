// Session helpers shared across pages.

import { api } from "./api.js";

let cached;
export async function getMe() {
  if (cached === undefined) cached = (await api.get("/api/auth/me")).user || null;
  return cached;
}

export async function logout() {
  await api.post("/api/auth/logout");
  cached = null;
  location.href = "/";
}

// Redirect to /login unless the signed-in user has one of `roles`.
// Unapproved (pending) users are sent to the waiting screen.
export async function requireRole(roles) {
  const user = await getMe();
  if (!user) { location.href = "/login.html"; return null; }
  if (user.status === "pending") { location.href = "/pending.html"; return null; }
  if (roles && !roles.includes(user.role)) { location.href = "/dashboard.html"; return null; }
  return user;
}
