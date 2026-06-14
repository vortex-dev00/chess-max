-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0010_event_rsvp_status — RSVPs can now be 'going' or 'maybe'           ║
-- ║  (thinking about it), not just a flat "I'm in". Existing rows = going.  ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0010_event_rsvp_status.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE event_rsvps ADD COLUMN status TEXT NOT NULL DEFAULT 'going';
