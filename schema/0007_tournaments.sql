-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0007_tournaments — coach-hosted online tournaments (knockout /         ║
-- ║  round-robin / swiss). Matches reuse the rated `games` engine.          ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0007_tournaments.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS tournaments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  format        TEXT    NOT NULL,                  -- knockout | roundrobin | swiss
  status        TEXT    NOT NULL DEFAULT 'open',   -- open | active | finished
  rounds_total  INTEGER NOT NULL DEFAULT 0,
  current_round INTEGER NOT NULL DEFAULT 0,
  winner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed          INTEGER NOT NULL DEFAULT 0,
  score         REAL    NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,        -- knockout: 0 once eliminated
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round         INTEGER NOT NULL,
  slot          INTEGER NOT NULL,
  white_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  black_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  game_id       INTEGER REFERENCES games(id) ON DELETE SET NULL,
  winner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  result        TEXT,                              -- white | black | draw | bye
  status        TEXT    NOT NULL DEFAULT 'active', -- active | finished
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tplayers_t ON tournament_players(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tmatch_tr  ON tournament_matches(tournament_id, round);
