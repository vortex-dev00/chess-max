-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0004_events — real-life events calendar + RSVPs.                      ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0004_events.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  location    TEXT    NOT NULL DEFAULT '',
  starts_at   INTEGER NOT NULL,                 -- unix ms
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);
