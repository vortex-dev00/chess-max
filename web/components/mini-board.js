// A small, static (non-interactive) chess board rendered from a FEN — used for
// task previews in the database gallery and a kid's solved-puzzle history.

import { el } from "./dom.js";

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// Parse the piece-placement field of a FEN into a { square: pieceChar } map.
function boardFromFen(fen) {
  const out = {};
  const rows = String(fen || "").split(" ")[0].split("/");
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r] || "") {
      if (/\d/.test(ch)) file += Number(ch);
      else { out[FILES[file] + (8 - r)] = ch; file++; }
    }
  }
  return out;
}

// orient: "w" (default) puts white at the bottom, "b" flips it.
export function miniBoard(fen, { orient = "w" } = {}) {
  const board = boardFromFen(fen);
  const grid = el("div.mini-board");
  const ranks = orient === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orient === "w" ? FILES : [...FILES].reverse();
  for (const r of ranks) for (const f of files) {
    const fileIdx = f.charCodeAt(0) - 97;
    const cell = el("div", { class: `ms ${(fileIdx + r) % 2 === 0 ? "light" : "dark"}` });
    const p = board[f + r];
    if (p) cell.append(el("span", { class: `mp ${p === p.toUpperCase() ? "w" : "b"}` }, GLYPH[p.toLowerCase()]));
    grid.append(cell);
  }
  return grid;
}
