// Independently re-verifies schema/seed_puzzles.sql: replays each puzzle's
// solution line and confirms the final position is checkmate and that the kid's
// moves (odd plies) are legal in turn. Catches any flaw in the generated data.

import { Chess } from "chess.js";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.join(process.cwd(), "schema", "seed_puzzles.sql"), "utf8");
const rows = [...sql.matchAll(/VALUES \([^)]*?'([^']*\/[^']*)', '([^']+)', (\d+)/g)];

let ok = 0, bad = 0;
const samples = [];
for (const m of rows) {
  const fen = m[1], solution = m[2];
  const moves = solution.split(/\s+/).filter(Boolean);
  const c = new Chess();
  let good = true;
  try {
    c.load(fen);
    for (const u of moves) {
      const res = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
      if (!res) { good = false; break; }
    }
    if (good && !c.isCheckmate()) good = false;
  } catch { good = false; }
  if (good) { ok++; if (samples.length < 3) samples.push({ fen, solution }); }
  else { bad++; if (bad <= 5) console.log("BAD:", fen, solution); }
}
console.log(`Verified ${ok}/${rows.length} puzzles end in checkmate. Bad: ${bad}`);
console.log("Samples:", samples);
