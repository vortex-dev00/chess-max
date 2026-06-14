-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0008_tournament_audience — who a tournament is visible/open to.        ║
-- ║  audience_type: all | group | kids. Existing tournaments → 'all'.       ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0008_tournament_audience.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE tournaments ADD COLUMN audience_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE tournaments ADD COLUMN audience_group_id INTEGER;

CREATE TABLE IF NOT EXISTS tournament_audience (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, user_id)
);
