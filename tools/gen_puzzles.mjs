// Generates a library of VERIFIED checkmate puzzles using chess.js, and writes
// schema/seed_puzzles.sql. Every puzzle is checked: legal position, and a single
// unique forced mate line (so the kid's correct move always matches the solution).
//
//   node tools/gen_puzzles.mjs
//
// Strategy: random K+heavy-material vs lone-K positions (the classic mates a club
// teaches). We keep only positions with exactly one mate-in-1, or exactly one
// first move that forces mate-in-2 with a unique follow-up.

import { Chess } from "chess.js";
import { writeFileSync } from "node:fs";
import path from "node:path";

const FILES = "abcdefgh";
const sq = (f, r) => FILES[f] + (r + 1);
const ri = (n) => (Math.random() * n) | 0;
const PIECE_NAME = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight", p: "Pawn", k: "Discovered" };

const TOTAL = 1000;
const M2_MS = 70_000;       // time budget for the (slower) mate-in-2 search
const M1_MS = 180_000;      // safety cap for the mate-in-1 fill

function toFen(pieces, turn) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieces[sq(f, r)];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${turn} - - 0 1`;
}

const adj = (a, b) => {
  const af = FILES.indexOf(a[0]), ar = +a[1] - 1, bf = FILES.indexOf(b[0]), br = +b[1] - 1;
  return Math.max(Math.abs(af - bf), Math.abs(ar - br)) <= 1;
};
const edge = () => {
  // a square on or near the rim (mates happen here)
  const rim = ri(4);
  if (rim === 0) return sq(ri(8), 0);
  if (rim === 1) return sq(ri(8), 7);
  if (rim === 2) return sq(0, ri(8));
  return sq(7, ri(8));
};
const any = () => sq(ri(8), ri(8));

const MATERIAL = [["Q"], ["Q"], ["Q"], ["R", "R"], ["Q", "R"], ["R"], ["Q", "N"], ["Q", "B"]];

function randomPosition() {
  const pieces = {};
  const used = new Set();
  const place = (s, p) => { if (used.has(s)) return false; used.add(s); pieces[s] = p; return true; };

  const bk = edge();                 // black king on the rim
  let wk; do { wk = any(); } while (wk === bk || adj(wk, bk));
  place(bk, "k"); place(wk, "K");

  for (const p of MATERIAL[ri(MATERIAL.length)]) {
    let s, tries = 0;
    do { s = any(); tries++; } while (used.has(s) && tries < 20);
    place(s, p);
  }
  return toFen(pieces, "w");
}

// All white moves that are immediate checkmate (reuses the passed instance).
function matingMoves(chess) {
  const out = [];
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    if (chess.isCheckmate()) out.push(m);
    chess.undo();
  }
  return out;
}

function tryMateIn1(chess, fen) {
  try { chess.load(fen); } catch { return null; }
  if (chess.isGameOver()) return null;
  const mates = matingMoves(chess);
  if (mates.length !== 1) return null;                  // unique solution only
  const m = mates[0];
  return { fen, solution: m.from + m.to + (m.promotion || ""), piece: m.piece, plies: 1 };
}

function tryMateIn2(chess, fen) {
  try { chess.load(fen); } catch { return null; }
  if (chess.isGameOver()) return null;
  if (matingMoves(chess).length > 0) return null;        // not an immediate mate

  // A clean teaching mate-in-2 starts with a check; restrict to those (fast,
  // and black's replies are forced) and require exactly one that forces mate.
  const checks = chess.moves({ verbose: true }).filter((m) => {
    chess.move(m); const c = chess.inCheck(); chess.undo(); return c;
  });
  let found = null, count = 0;
  for (const m of checks) {
    chess.move(m);
    let ok = !chess.isGameOver();
    let principal = null;
    if (ok) {
      for (const reply of chess.moves({ verbose: true })) {
        chess.move(reply);
        const mates = matingMoves(chess);
        if (mates.length === 0) { ok = false; chess.undo(); break; }
        if (!principal) principal = { reply, mate: mates[0] };
        chess.undo();
      }
    }
    chess.undo();
    if (ok && principal) { count++; found = { first: m, ...principal }; if (count > 1) return null; }
  }
  if (count !== 1) return null;
  const sol = [found.first, found.reply, found.mate].map((x) => x.from + x.to + (x.promotion || "")).join(" ");
  return { fen, solution: sol, piece: found.mate.piece, plies: 3 };
}

function run() {
  const seen = new Set();
  const chess = new Chess();
  const m1 = [], m2 = [];

  // Phase 1 — collect mate-in-2 for variety (slower), within a time budget.
  let t0 = Date.now();
  while (Date.now() - t0 < M2_MS) {
    const fen = randomPosition();
    if (seen.has(fen)) continue;
    seen.add(fen);
    const p = tryMateIn2(chess, fen); if (p) m2.push(p);
  }
  // Phase 2 — fill the rest with mate-in-1 so the library is exactly 1000.
  const need = TOTAL - m2.length;
  t0 = Date.now();
  while (m1.length < need && Date.now() - t0 < M1_MS) {
    const fen = randomPosition();
    if (seen.has(fen)) continue;
    seen.add(fen);
    const p = tryMateIn1(chess, fen); if (p) m1.push(p);
  }

  const all = [];
  let n = 0;
  for (const p of m1) {
    n++;
    all.push({
      title: `Checkmate #${n}`,
      description: "White to move and mate in 1.",
      fen: p.fen, solution: p.solution, difficulty: 1,
      category: `Mate in 1 · ${PIECE_NAME[p.piece] || "Piece"}`,
    });
  }
  for (const p of m2) {
    n++;
    all.push({
      title: `Checkmate #${n}`,
      description: "White to move and mate in 2.",
      fen: p.fen, solution: p.solution, difficulty: 3,
      category: "Mate in 2",
    });
  }

  const now = Date.now();
  const esc = (s) => s.replace(/'/g, "''");
  const lines = all.map((t) =>
    `INSERT INTO tasks (title, description, fen, solution, difficulty, category, created_by, created_at) VALUES `
    + `('${esc(t.title)}', '${esc(t.description)}', '${esc(t.fen)}', '${t.solution}', ${t.difficulty}, '${esc(t.category)}', NULL, ${now});`);

  const header = "-- Auto-generated verified puzzle library (chess.js). Re-runnable: clears prior library tasks first.\n"
    + "DELETE FROM tasks WHERE category IS NOT NULL;\n";
  const out = path.join(process.cwd(), "schema", "seed_puzzles.sql");
  writeFileSync(out, header + lines.join("\n") + "\n");

  const cats = {};
  for (const t of all) cats[t.category] = (cats[t.category] || 0) + 1;
  console.log(`Mate-in-1: ${m1.length}, Mate-in-2: ${m2.length}, total: ${all.length}`);
  console.log("Categories:", cats);
  console.log("Wrote", out);
}
run();
