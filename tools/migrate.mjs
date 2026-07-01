// Apply every numbered SQL migration in schema/ in order, exactly once.
//   node tools/migrate.mjs            → local D1
//   node tools/migrate.mjs --remote   → remote D1 (may prompt to confirm)
// Applied files are tracked in a _migrations table, so re-running only applies
// what's new (safe against the ALTER TABLE steps that aren't idempotent).
// Puzzle data is seeded separately — see `npm run db:seed`.

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB = "chess-club-v2-db";
const remote = process.argv.includes("--remote");
const scope = remote ? "--remote" : "--local";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const capture = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" });
const exec = (sql) => `npx wrangler d1 execute ${DB} ${scope} --command "${sql}"`;

// Track what's been applied so re-runs are safe.
run(exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"));

let applied = new Set();
try {
  const parsed = JSON.parse(capture(`${exec("SELECT name FROM _migrations")} --json`));
  const rows = (Array.isArray(parsed) ? parsed[0]?.results : parsed?.results) || [];
  applied = new Set(rows.map((r) => r.name));
} catch {
  // Couldn't read the ledger (fresh DB or --json unsupported) — treat as none applied.
}

const files = readdirSync(path.join(ROOT, "schema"))
  .filter((f) => f.endsWith(".sql") && !f.startsWith("seed"))
  .sort();

let count = 0;
for (const f of files) {
  if (applied.has(f)) { console.log(`· ${f} — already applied`); continue; }
  console.log(`→ applying ${f}`);
  run(`npx wrangler d1 execute ${DB} ${scope} --file "schema/${f}"`);
  run(exec(`INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES ('${f}', ${Date.now()})`));
  count++;
}
console.log(count ? `✓ applied ${count} migration(s)` : "✓ database already up to date");
