-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0012_auth_throttle — per-IP login/signup attempt log, used to rate-    ║
-- ║  limit auth endpoints against brute-force and signup spam. Rows are     ║
-- ║  pruned as they age out of the throttle window (see src/lib/auth.js).   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS auth_attempts (
  ip TEXT    NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip ON auth_attempts(ip, at);
