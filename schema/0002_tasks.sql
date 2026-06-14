-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0002_tasks — chess tasks (from PGN or the board editor) + assignments.║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  fen         TEXT    NOT NULL,
  solution    TEXT    NOT NULL DEFAULT '',     -- space-separated UCI line
  difficulty  INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  status       TEXT    NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','completed')),
  assigned_at  INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_assign_user ON assignments(user_id);
