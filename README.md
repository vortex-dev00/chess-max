# Chess Club v2

A clean-slate rebuild of the chess club platform — **Cloudflare, vanilla, but structured**.
No framework: modular Worker backend, a small esbuild build step, and shared
frontend components.

## Project layout

```
chess-club-v2/
├─ wrangler.toml            Cloudflare config (Worker + D1 + Durable Object)
├─ build.mjs               esbuild: bundles web/entries → public/assets, copies static
├─ schema/                 numbered SQL migrations (one system, in order)
│  └─ 0001_init.sql
├─ src/                    Worker backend
│  ├─ index.js             router only
│  ├─ lib/{response,auth}.js
│  ├─ routes/groups.js
│  └─ durable/GameRoom.js  live game (websockets, server-validated moves)
└─ web/                    frontend SOURCE (built into public/, which is gitignored)
   ├─ components/          shared modules: api, dom, session, nav
   ├─ entries/             one JS bundle per page
   └─ static/             html + styles (copied verbatim)
```

The build output `public/` is what Cloudflare serves — it is generated, never edited by hand.

## Run locally

```sh
npm install
npm run build           # produce public/
npm run db:migrate      # apply every schema/ migration to local D1 (in order)
npm run db:seed         # load the verified puzzle library (optional)
npx wrangler dev        # http://127.0.0.1:8787
```

`db:migrate` applies all numbered migrations in `schema/` and records them in a
`_migrations` table, so re-running only applies what's new. Apply the whole set,
not just `0001` — the app needs tasks, arena, tournaments, and events too.

`npm run dev` runs the esbuild watcher alongside `wrangler dev`.

> On this machine prefix wrangler commands with `NODE_OPTIONS=--use-system-ca`
> (local TLS proxy), and test live URLs with `curl -k`.

## What's built (milestone 1)
- **Auth** — signup/login/sessions; first account becomes admin. Roles: admin / coach / kid.
- **Groups** — admins/coaches create groups and add kids; kids see their groups.
- **Online play** — rebuilt board UI; two players over a Durable Object with
  server-validated moves, legal-move hints, move list, chat, resign, rematch, spectators.

## Deploy (when ready)
```sh
npx wrangler login
npx wrangler d1 create chess-club-v2-db   # paste id into wrangler.toml
npm run db:migrate:remote                 # apply all migrations to remote D1
npm run db:seed:remote                    # load the puzzle library (optional)
npm run deploy
```

## Next milestones (planned)
Lessons & attendance · tournaments + live bracket · interactive puzzles + board
editor · coach "go live" · events calendar — re-added deliberately, clean.
