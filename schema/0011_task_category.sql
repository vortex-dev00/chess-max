-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0011_task_category — tag tasks with a category (e.g. "Mate in 1 ·      ║
-- ║  Rook"). Hand-made tasks stay NULL; the seeded puzzle library sets it,  ║
-- ║  which also lets the library be re-seeded without touching hand tasks.  ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0011_task_category.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE tasks ADD COLUMN category TEXT;
