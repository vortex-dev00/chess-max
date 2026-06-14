-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  0009_game_moves — store each finished game's moves (PGN) so games can  ║
-- ║  be replayed move-by-move from the Arena and tournament pages.          ║
-- ║  Apply remote: wrangler d1 execute chess-club-v2-db --remote --file schema/0009_game_moves.sql
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE games ADD COLUMN pgn TEXT;
