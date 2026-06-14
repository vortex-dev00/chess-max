// Waiting screen for users whose account isn't approved yet. Polls their status
// and lets them straight in the moment a coach/admin approves them.

import { api } from "../components/api.js";
import { $ } from "../components/dom.js";
import { mountNav } from "../components/nav.js";
import { logout } from "../components/session.js";

await mountNav("");

function landing(user) {
  return user.role === "kid" ? "/dashboard.html" : "/admin.html";
}

async function check() {
  const user = (await api.get("/api/auth/me")).user;
  if (!user) { location.href = "/login.html"; return; }
  if (user.status !== "pending") { location.href = landing(user); return; }
}

$("[data-refresh]").onclick = check;
$("[data-logout]").onclick = logout;

await check();
setInterval(check, 5000);   // auto-enter once approved
