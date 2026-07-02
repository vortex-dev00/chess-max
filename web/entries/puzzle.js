import { Chess } from "chess.js";
import { $, el } from "../components/dom.js";
import { mountNav } from "../components/nav.js";

mountNav("");

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const taskId = new URLSearchParams(location.search).get("task");

let chess, startFen, solverColor, ply = 0, selected = null, solved = false;
let difficulty = 1;
let badgesBefore = new Set();   // earned badges at load → diff after solving

const fail = (m) => { $("[data-err]").hidden = false; $("[data-errmsg]").textContent = m; };
const feedback = (t, cls) => { const f = $("[data-feedback]"); f.textContent = t; f.style.color = cls === "ok" ? "var(--good)" : cls === "no" ? "var(--bad)" : ""; };

(async () => {
  if (!taskId) return fail("Není zadaná žádná úloha.");
  const res = await fetch(`/api/tasks/${taskId}/puzzle`);
  if (!res.ok) return fail("Musíš být přihlášen, nebo tato úloha neexistuje.");
  const t = await res.json();
  if (!t.hasSolution) return fail("K této úloze zatím není nastavené řešení.");
  $("[data-card]").hidden = false;
  $("[data-title]").textContent = t.title;
  $("[data-desc]").textContent = t.description || "";
  difficulty = Number(t.difficulty) || 1;
  startFen = t.fen;
  chess = new Chess(startFen);
  solverColor = chess.turn();
  $("[data-tomove]").textContent = `Na tahu je ${solverColor === "w" ? "bílý" : "černý"} — najdi nejlepší pokračování.`;
  render();
  // Snapshot which badges are already earned so we can celebrate new ones.
  const p = await fetch("/api/me/progress").then((r) => r.ok ? r.json() : null).catch(() => null);
  if (p?.badges) badgesBefore = new Set(p.badges.filter((b) => b.earned).map((b) => b.key));
})();

function orderedSquares() {
  const ranks = solverColor === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = solverColor === "w" ? FILES : [...FILES].reverse();
  const out = [];
  for (const r of ranks) for (const f of files) out.push(f + r);
  return out;
}

function render() {
  const boardEl = $("[data-board]");
  boardEl.replaceChildren();
  const legal = selected ? new Set(chess.moves({ square: selected, verbose: true }).map((m) => m.to)) : new Set();
  for (const sq of orderedSquares()) {
    const file = sq.charCodeAt(0) - 97, rank = Number(sq[1]);
    const cell = el("div", { class: `sq ${(file + rank) % 2 === 0 ? "light" : "dark"}`, onclick: () => onClick(sq) });
    if (sq === selected) cell.classList.add("sel");
    const p = chess.get(sq);
    if (p) cell.append(el("span", { class: `piece ${p.color}` }, GLYPH[p.type]));
    if (legal.has(sq)) { if (p) cell.classList.add("occupied"); cell.append(el("span.dot")); }
    boardEl.append(cell);
  }
}

function onClick(sq) {
  if (solved || chess.turn() !== solverColor) return;
  if (selected) {
    const mv = chess.moves({ square: selected, verbose: true }).find((m) => m.to === sq);
    if (mv) { const from = selected; selected = null; return tryMove(from, sq); }
  }
  const p = chess.get(sq);
  selected = (p && p.color === solverColor) ? sq : null;
  render();
}

async function tryMove(from, to) {
  const moving = chess.get(from);
  const promo = moving.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : undefined;
  const res = await fetch(`/api/tasks/${taskId}/check`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ply, move: from + to + (promo || "") }),
  });
  const out = await res.json();
  if (!out.correct) { feedback("To není ten tah — zkus to znovu.", "no"); render(); return; }
  chess.move({ from, to, promotion: promo }); ply++; render();
  if (out.reply) {
    await new Promise((r) => setTimeout(r, 350));
    chess.move({ from: out.reply.slice(0, 2), to: out.reply.slice(2, 4), promotion: out.reply.slice(4) || undefined });
    ply++; render();
  }
  if (out.done) { solved = true; feedback("✓ Vyřešeno! Skvělá práce.", "ok"); reward(); }
  else feedback("Správně — pokračuj.", "ok");
}

// Celebrate: show XP gained, the kid's rank, and any newly unlocked badge.
async function reward() {
  const box = $("[data-reward]");
  box.hidden = false;
  box.replaceChildren(el("div.reward-xp", {}, `+${difficulty * 10} XP`));
  const p = await fetch("/api/me/progress").then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!p?.level) return;
  box.append(el("div.reward-rank", {}, `Úroveň ${p.level.num} · ${p.level.name}`));
  const fresh = (p.badges || []).filter((b) => b.earned && !badgesBefore.has(b.key));
  for (const b of fresh) {
    box.append(el("div.reward-badge", {}, el("span.reward-badge-icon", {}, b.icon),
      el("span", {}, el("strong", {}, "Nový odznak: "), b.name)));
    badgesBefore.add(b.key);
  }
}

$("[data-reset]").onclick = () => { chess = new Chess(startFen); ply = 0; selected = null; solved = false; feedback("Zahraj svůj tah."); $("[data-reward]").hidden = true; render(); };
