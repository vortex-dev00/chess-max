-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0005_approvals — new signups must be approved by staff before access. ║
-- ║  Existing users default to 'approved' so nobody is locked out.         ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0005_approvals.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
