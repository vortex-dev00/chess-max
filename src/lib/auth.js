// Authentication: PBKDF2 password hashing (Web Crypto) + revocable D1 sessions.

import { json, ok, error } from "./response.js";

const SESSION_DAYS = 30;
const COOKIE = "sid";
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(saltHex), iterations: 100_000, hash: "SHA-256" },
    key, 256,
  );
  return toHex(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookie(token, maxAgeSec) {
  return [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`, "Secure"].join("; ");
}

function readCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

export async function currentUser(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status };
}

// Gate helper: returns the user if their role is allowed, else null.
export async function requireRole(request, env, roles) {
  const user = await currentUser(request, env);
  return user && roles.includes(user.role) ? user : null;
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)")
    .bind(token, userId, expires).run();
  return token;
}

export async function signup(request, env) {
  const { email, name, password } = await request.json().catch(() => ({}));
  if (!email || !name || !password || password.length < 6) {
    return error("Email, name, and a 6+ character password are required.");
  }
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase()).first();
  if (exists) return error("That email is already registered.", 409);

  // First account created becomes the club admin (and is auto-approved).
  // Everyone after that signs up "pending" until staff approve them.
  const { count } = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
  const role = count === 0 ? "admin" : "kid";
  const status = count === 0 ? "approved" : "pending";

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const res = await env.DB.prepare(
    "INSERT INTO users (email, name, password_hash, salt, role, status, created_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(email.toLowerCase(), name.slice(0, 60), hash, salt, role, status, Date.now()).run();

  const token = await createSession(env, res.meta.last_row_id);
  return json({ user: { id: res.meta.last_row_id, email: email.toLowerCase(), name, role, status } },
    { headers: { "Set-Cookie": cookie(token, SESSION_DAYS * 86400) } });
}

export async function login(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return error("Email and password required.");
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email.toLowerCase()).first();
  if (!u) return error("Invalid email or password.", 401);
  const hash = await hashPassword(password, u.salt);
  if (!safeEqual(hash, u.password_hash)) return error("Invalid email or password.", 401);
  const token = await createSession(env, u.id);
  return json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status } },
    { headers: { "Set-Cookie": cookie(token, SESSION_DAYS * 86400) } });
}

export async function logout(request, env) {
  const token = readCookie(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, { headers: { "Set-Cookie": cookie("", 0) } });
}

export async function me(request, env) {
  return json({ user: await currentUser(request, env) });
}
