-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0003_lessons — lessons, attendance, and group reviews.                ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS lessons (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,                 -- unix ms
  location  TEXT    NOT NULL DEFAULT '',
  note      TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lesson_attendance (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  attended  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lesson_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  review_date TEXT    NOT NULL,               -- YYYY-MM-DD
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lessons_group ON lessons(group_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_reviews_group ON group_reviews(group_id);
