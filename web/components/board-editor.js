// Reusable task board editor, structured as a clear 3-step wizard:
//   1 · Position — build by hand OR import a PGN
//   2 · Solution — play the winning line
//   3 · Save     — title, description, difficulty
// Only the active step is shown, with a stepper across the top. Mount into a
// container element.

import { Chess } from "chess.js";
import { el } from "./dom.js";
import { api } from "./api.js";

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function mountEditor(container, { onSaved } = {}) {
  let step = 1;                 // 1 position · 2 solution · 3 save
  let phase = "setup";          // "setup" | "solution" (board interaction mode)
  let turn = "w";
  let board = boardFromFen(START);
  let pick = "K";
  let setupFen = null;
  let chess = null;
  let solution = [];
  let selected = null;
  let dragData = null;          // { place } from palette, or { from } from a square

  // ── elements (declared before use) ──
  const boardEl = el("div.board");
  const palette = el("div.palette");
  const msg = el("div.subtle", { style: "margin-top:8px" });
  const moveList = el("div.moves", { style: "margin-top:8px" }, "Zatím žádné tahy.");
  const pgnInput = el("textarea", { class: "pgn-drop", style: "min-height:64px", placeholder: 'Vlož PGN, nebo sem přetáhni .pgn soubor.\n[FEN "..."] 1. Qh5+ Ke7 2. Qxe5#' });
  pgnInput.addEventListener("dragover", (e) => { e.preventDefault(); pgnInput.classList.add("drop-hover"); });
  pgnInput.addEventListener("dragleave", () => pgnInput.classList.remove("drop-hover"));
  pgnInput.addEventListener("drop", (e) => {
    e.preventDefault(); pgnInput.classList.remove("drop-hover");
    const file = e.dataTransfer.files[0];
    if (file) file.text().then((txt) => { pgnInput.value = txt; importPgn(txt); });
  });
  const titleIn = el("input", { placeholder: "Mat ve dvou tazích" });
  const descIn = el("textarea", { style: "min-height:54px", placeholder: "Bílý táhne a vyhrává." });
  const diffIn = el("input", { type: "number", min: "1", max: "5", value: "2" });
  const sideSeg = el("div.row", { style: "gap:4px" });

  // ── stepper header ──
  const STEPS = ["Pozice", "Řešení", "Uložit"];
  const stepper = el("div.stepper");
  function buildStepper() {
    stepper.replaceChildren(...STEPS.map((label, i) => {
      const n = i + 1;
      const cls = n === step ? " is-active" : n < step ? " is-done" : "";
      return el("button", {
        class: `stepper-step${cls}`,
        onclick: () => goStep(n),
      }, el("span.stepper-num", {}, n < step ? "✓" : String(n)), el("span", {}, label));
    }));
  }

  // ── step 1 · position ──
  const step1 = el("div.editor-step",
    el("p.subtle", {}, "Sestav pozici pomocí palety, nebo níže importuj PGN."),
    el("h4.editor-sub", {}, "Sestavit ručně"),
    palette,
    el("div.row", { style: "margin-top:10px" },
      el("button.btn.sm", { onclick: () => { board = boardFromFen(START); render(); } }, "Výchozí pozice"),
      el("button.btn.sm", { onclick: () => { board = {}; render(); } }, "Vymazat"),
      sideSeg,
    ),
    el("div.divider", {}, "nebo"),
    el("h4.editor-sub", {}, "Importovat PGN"),
    pgnInput,
    el("button.btn.sm", { style: "margin-top:6px", onclick: () => importPgn(pgnInput.value) }, "Načíst PGN"),
    el("div.editor-nav", {},
      el("span", {}),
      el("button.btn.primary", { onclick: toSolution }, "Zaznamenat řešení →"),
    ),
  );

  // ── step 2 · solution ──
  const step2 = el("div.editor-step", { style: "display:none" },
    el("p.subtle", {}, "Zahraj vítěznou linii na šachovnici. Dítě hraje 1., 3., 5. tah; zbytek jsou odpovědi soupeře."),
    moveList,
    el("div.row", { style: "margin-top:10px" },
      el("button.btn.sm", { onclick: undo }, "Zpět"),
      el("button.btn.sm", { onclick: clearMoves }, "Vymazat tahy"),
    ),
    el("div.editor-nav", {},
      el("button.btn", { onclick: () => goStep(1) }, "← Upravit pozici"),
      el("button.btn.primary", { onclick: () => goStep(3) }, "Pokračovat na uložení →"),
    ),
  );

  // ── step 3 · save ──
  const step3 = el("div.editor-step", { style: "display:none" },
    el("label.field", {}, el("span", {}, "Název"), titleIn),
    el("label.field", {}, el("span", {}, "Popis"), descIn),
    el("label.field", {}, el("span", {}, "Obtížnost (1–5)"), diffIn),
    el("div.editor-nav", {},
      el("button.btn", { onclick: () => goStep(2) }, "← Zpět na řešení"),
      el("button.btn.primary", { onclick: save }, "Uložit úkol"),
    ),
  );

  container.replaceChildren(
    el("div.editor-grid", {},
      el("div.board-wrap", {}, boardEl),
      // `msg` sits above the steps so validation errors / "Saved!" are always
      // visible, whichever step you're on.
      el("div", {}, stepper, msg, step1, step2, step3),
    ),
  );

  buildStepper();
  buildSide();
  buildPalette();
  render();

  /* ── navigation ── */
  function goStep(n) {
    // Step 1 → 2 must go through validation (toSolution); guard direct jumps.
    if (n >= 2 && !chess) { toSolution(); if (!chess) return; n = Math.max(n, 2); }
    step = n;
    phase = n === 1 ? "setup" : "solution";
    selected = null;
    step1.style.display = n === 1 ? "block" : "none";
    step2.style.display = n === 2 ? "block" : "none";
    step3.style.display = n === 3 ? "block" : "none";
    buildStepper();
    if (n === 2) renderMoves();
    render();
  }

  /* ── side-to-move segmented control ── */
  function buildSide() {
    sideSeg.replaceChildren(
      el("span.subtle", {}, "Strana:"),
      ...["w", "b"].map((v) => el("button", {
        class: `btn sm${turn === v ? " primary" : ""}`,
        onclick: () => { turn = v; buildSide(); },
      }, v === "w" ? "Bílý" : "Černý")),
    );
  }

  function buildPalette() {
    const items = ["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"];
    palette.replaceChildren(
      ...items.map((p) => el("button", {
        class: `pal ${p === p.toUpperCase() ? "w" : "b"}${pick === p ? " sel" : ""}`,
        draggable: "true",
        ondragstart: () => (dragData = { place: p }),
        onclick: () => { pick = p; buildPalette(); },
      }, GLYPH[p.toLowerCase()])),
      el("button", { class: `pal erase${pick === "" ? " sel" : ""}`, onclick: () => { pick = ""; buildPalette(); } }, "⌫"),
    );
  }

  function importPgn(text) {
    if (!text.trim()) return;
    try {
      const tmp = new Chess();
      tmp.loadPgn(text);
      const moves = tmp.history({ verbose: true });
      const fenMatch = text.match(/\[FEN\s+"([^"]+)"\]/i);
      const start = fenMatch ? fenMatch[1] : START;
      const c = new Chess(start);
      const uci = [];
      for (const m of moves) { c.move(m.san); uci.push(m.from + m.to + (m.promotion || "")); }
      setupFen = start;
      chess = new Chess(setupFen);
      solution = uci;
      board = boardFromFen(setupFen);
      turn = setupFen.split(" ")[1] || "w";
      msg.innerHTML = `<span style="color:var(--good)">Importováno ${uci.length} tahů.</span>`;
      goStep(2);
    } catch {
      msg.innerHTML = `<span style="color:var(--bad)">Toto PGN se nepodařilo přečíst.</span>`;
    }
  }

  function orderedSquares() {
    const out = [];
    for (let r = 8; r >= 1; r--) for (const f of FILES) out.push(f + r);
    return out;
  }

  function render() {
    boardEl.replaceChildren();
    const legal = (phase === "solution" && selected)
      ? new Set(chess.moves({ square: selected, verbose: true }).map((m) => m.to)) : new Set();
    for (const sq of orderedSquares()) {
      const file = sq.charCodeAt(0) - 97, rank = Number(sq[1]);
      const cell = el("div", { class: `sq ${(file + rank) % 2 === 0 ? "light" : "dark"}`, onclick: () => onSquare(sq) });
      if (sq === selected) cell.classList.add("sel");
      let piece = null;
      if (phase === "setup") { const p = board[sq]; if (p) piece = { t: p.toLowerCase(), c: p === p.toUpperCase() ? "w" : "b" }; }
      else { const p = chess.get(sq); if (p) piece = { t: p.type, c: p.color }; }
      if (piece) {
        const span = el("span", { class: `piece ${piece.c}` }, GLYPH[piece.t]);
        const canDrag = phase === "setup" || (phase === "solution" && piece.c === chess.turn());
        if (canDrag) { span.draggable = true; span.addEventListener("dragstart", () => (dragData = { from: sq })); }
        cell.append(span);
      }
      if (legal.has(sq)) { if (piece) cell.classList.add("occupied"); cell.append(el("span.dot")); }
      cell.addEventListener("dragover", (e) => e.preventDefault());
      cell.addEventListener("drop", (e) => { e.preventDefault(); handleDrop(sq); });
      boardEl.append(cell);
    }
  }

  function handleDrop(sq) {
    if (!dragData) return;
    if (step === 3) { dragData = null; return; }   // board is read-only on the Save step
    if (phase === "setup") {
      if (dragData.place != null) board[sq] = dragData.place;
      else if (dragData.from && dragData.from !== sq) { board[sq] = board[dragData.from]; delete board[dragData.from]; }
      render();
    } else if (dragData.from) {
      const mv = chess.moves({ square: dragData.from, verbose: true }).find((m) => m.to === sq);
      if (mv) {
        chess.move({ from: dragData.from, to: sq, promotion: mv.promotion ? "q" : undefined });
        solution.push(dragData.from + sq + (mv.promotion ? "q" : ""));
        selected = null; renderMoves();
      }
      render();
    }
    dragData = null;
  }

  function onSquare(sq) {
    if (step === 3) return;   // board is read-only on the Save step
    if (phase === "setup") {
      if (pick === "") delete board[sq]; else board[sq] = pick;
      return render();
    }
    if (selected) {
      const mv = chess.moves({ square: selected, verbose: true }).find((m) => m.to === sq);
      if (mv) {
        chess.move({ from: selected, to: sq, promotion: mv.promotion ? "q" : undefined });
        solution.push(selected + sq + (mv.promotion ? "q" : ""));
        selected = null; renderMoves(); return render();
      }
    }
    const p = chess.get(sq);
    selected = (p && p.color === chess.turn()) ? sq : null;
    render();
  }

  function toSolution() {
    msg.innerHTML = "";
    setupFen = fenFromBoard(board, turn);
    try { chess = new Chess(setupFen); }
    catch (e) {
      chess = null;
      msg.innerHTML = `<span style="color:var(--bad)">Řešení zatím nelze zaznamenat — ${friendly(e)}. `
        + `Každá strana potřebuje přesně jednoho krále a strana, která netáhne, nesmí být v šachu.</span>`;
      return;
    }
    solution = [];
    goStep(2);
  }
  function friendly(e) {
    const m = String(e?.message || "").replace(/^Invalid FEN:\s*/i, "").trim();
    return m || "pozice je neplatná";
  }

  function undo() {
    if (!solution.length) return;
    solution.pop(); chess = new Chess(setupFen);
    for (const u of solution) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
    selected = null; renderMoves(); render();
  }
  function clearMoves() { solution = []; chess = new Chess(setupFen); selected = null; renderMoves(); render(); }
  function renderMoves() { moveList.textContent = solution.length ? solution.join("  ") : "Zatím žádné tahy."; }

  async function save() {
    const title = titleIn.value.trim();
    const fen = setupFen || fenFromBoard(board, turn);
    if (!title) { msg.innerHTML = `<span style="color:var(--bad)">Název je povinný.</span>`; return; }
    try { new Chess(fen); } catch { msg.innerHTML = `<span style="color:var(--bad)">Před uložením oprav pozici.</span>`; return; }
    const { ok, data } = await api.post("/api/tasks", {
      title, description: descIn.value.trim(), difficulty: Number(diffIn.value) || 2, fen, solution: solution.join(" "),
    });
    if (ok) { msg.innerHTML = `<span style="color:var(--good)">Uloženo!</span>`; reset(); onSaved?.(data.id); }
    else msg.innerHTML = `<span style="color:var(--bad)">${data.error || "Chyba při ukládání."}</span>`;
  }

  function reset() {
    phase = "setup"; board = boardFromFen(START); turn = "w"; setupFen = null; chess = null; solution = []; selected = null;
    titleIn.value = ""; descIn.value = ""; diffIn.value = "2"; pgnInput.value = "";
    buildSide(); goStep(1);
  }
}

/* ── pure helpers ── */
function boardFromFen(fen) {
  const out = {};
  const rows = fen.split(" ")[0].split("/");
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) file += Number(ch);
      else { out[FILES[file] + (8 - r)] = ch; file++; }
    }
  }
  return out;
}
function fenFromBoard(board, turn) {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = "", empty = 0;
    for (const f of FILES) {
      const p = board[f + r];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${turn} - - 0 1`;
}
