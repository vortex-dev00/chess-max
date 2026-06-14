-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0006_arena — ELO ratings, recorded games, and kid-vs-kid challenges.  ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0006_arena.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE users ADD COLUMN elo INTEGER NOT NULL DEFAULT 1200;

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  white_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  black_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rated       INTEGER NOT NULL DEFAULT 1,
  status      TEXT    NOT NULL DEFAULT 'active',   -- active | finished
  winner      TEXT,                                -- white | black | draw
  reason      TEXT,                                -- checkmate | resigned | stalemate | draw | ...
  white_delta INTEGER,
  black_delta INTEGER,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS challenges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending',   -- pending | accepted | declined
  game_id    INTEGER REFERENCES games(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_players ON games(white_id, black_id);
CREATE INDEX IF NOT EXISTS idx_challenges_to ON challenges(to_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_from ON challenges(from_id, status);
