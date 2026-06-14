import { Chess } from "chess.js";
import { $, el, esc } from "../components/dom.js";
import { mountNav } from "../components/nav.js";
import { getMe } from "../components/session.js";

mountNav("play");

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

const chess = new Chess();        // local mirror for rendering + legal hints
let ws = null, myColor = null, orient = "w";
let selected = null, lastMove = null, status = "active";
let isRated = false, ratedResult = null, ratedInfo = null;
let spectating = false, replaying = false;

// ── mode from the URL ──
//   ?game=<id>     play your rated game (from a challenge / tournament match)
//   ?watch=<id>    watch a live game read-only
//   ?replay=<id>   step through a finished game move-by-move
const params = new URLSearchParams(location.search);
const ratedGameId = params.get("game");
const watchId = params.get("watch");
const replayId = params.get("replay");
if (replayId) initReplay(replayId);
else if (watchId) initSpectate(watchId);
else if (ratedGameId) initRated();

async function initRated() {
  const res = await fetch(`/api/games/${ratedGameId}`);
  if (!res.ok) { $("[data-lobby-err]").textContent = "Couldn't open that game — it may not be yours."; return; }
  ratedInfo = await res.json();
  isRated = true;
  connect(ratedInfo.code, () => send({ type: "join", name: null }), ratedGameId);
}

// Live read-only view of someone else's game.
async function initSpectate(id) {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) { $("[data-lobby-err]").textContent = "Couldn't open that game."; return; }
  ratedInfo = await res.json();
  isRated = true;
  spectating = true;
  connect(ratedInfo.code, () => send({ type: "join", name: null }), id, true);
}

// ── lobby ──
const nameInput = $("[data-name]");
getMe().then((me) => { if (me && !nameInput.value) nameInput.value = me.name; });

const makeCode = () => Array.from({ length: 4 }, () =>
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[(Math.random() * 31) | 0]).join("");
const nameVal = () => nameInput.value.trim() || null;

$("[data-create]").onclick = () => connect(makeCode(), (code) => send({ type: "create", name: nameVal() }));
$("[data-join]").onclick = () => {
  const code = $("[data-code]").value.toUpperCase().trim();
  if (code.length !== 4) return ($("[data-lobby-err]").textContent = "Enter the 4-letter code.");
  connect(code, () => send({ type: "join", name: nameVal() }));
};

// ── socket ──
function connect(code, onOpen, game, spectate) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = `?code=${encodeURIComponent(code)}${game ? `&game=${encodeURIComponent(game)}` : ""}${spectate ? "&spectate=1" : ""}`;
  ws = new WebSocket(`${proto}://${location.host}/ws${q}`);
  ws.onopen = () => onOpen(code);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => setStatus("Disconnected — refresh to reconnect.");
  ws.onerror = () => ($("[data-lobby-err]").textContent = "Could not reach the server.");
}
const send = (obj) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

function handle(msg) {
  switch (msg.type) {
    case "joined":
      myColor = msg.color;
      orient = msg.color === "b" ? "b" : "w";
      enterGame(msg.code);
      break;
    case "state": applyState(msg); break;
    case "info": addChat({ sys: true, text: msg.message }); break;
    case "chat": addChat(msg); break;
    case "illegal": selected = null; render(); break;
    case "rated": ratedResult = msg; showRatedElo(); break;
  }
}

// ── game view ──
function enterGame(code) {
  $("[data-lobby]").classList.add("hidden");
  $("[data-game]").classList.remove("hidden");
  const roomEl = $("[data-room]");
  roomEl.textContent = code;
  roomEl.onclick = () => navigator.clipboard?.writeText(code);
  buildBoard();
}

const boardEl = $("[data-board]");
let cells = {};
function buildBoard() {
  boardEl.replaceChildren();
  cells = {};
  for (const sq of orderedSquares()) {
    const file = sq.charCodeAt(0) - 97, rank = Number(sq[1]);
    const c = el("div", { class: `sq ${(file + rank) % 2 === 0 ? "light" : "dark"}`, onclick: () => clickSquare(sq) });
    cells[sq] = c;
    boardEl.append(c);
  }
  render();
}

function orderedSquares() {
  const ranks = orient === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orient === "w" ? FILES : [...FILES].reverse();
  const out = [];
  for (const r of ranks) for (const f of files) out.push(f + r);
  return out;
}

function clickSquare(sq) {
  if (replaying || myColor === "spectator" || status !== "active" || chess.turn() !== myColor) return;
  if (selected) {
    const mv = chess.moves({ square: selected, verbose: true }).find((m) => m.to === sq);
    if (mv) { send({ type: "move", from: selected, to: sq, promotion: "q" }); selected = null; return render(); }
  }
  const p = chess.get(sq);
  selected = (p && p.color === myColor) ? sq : null;
  render();
}

function render() {
  const legal = selected ? new Set(chess.moves({ square: selected, verbose: true }).map((m) => m.to)) : new Set();
  const kingSq = status === "active" && chess.inCheck()
    ? Object.keys(cells).find((s) => { const p = chess.get(s); return p && p.type === "k" && p.color === chess.turn(); })
    : null;

  for (const [sq, cell] of Object.entries(cells)) {
    cell.className = `sq ${(sq.charCodeAt(0) - 97 + Number(sq[1])) % 2 === 0 ? "light" : "dark"}`;
    if (lastMove && (sq === lastMove.from || sq === lastMove.to)) cell.classList.add("last");
    if (sq === selected) cell.classList.add("sel");
    if (sq === kingSq) cell.classList.add("check");
    cell.replaceChildren();

    const p = chess.get(sq);
    if (p) cell.append(el("span", { class: `piece ${p.color}` }, GLYPH[p.type]));
    if (legal.has(sq)) { if (p) cell.classList.add("occupied"); cell.append(el("span.dot")); }
  }
}

function applyState(s) {
  chess.load(s.fen);
  lastMove = s.lastMove;
  status = s.status;
  render();

  // players (bottom = me / white by default)
  const top = orient === "w" ? "b" : "w", bottom = orient === "w" ? "w" : "b";
  $("[data-top-name]").textContent = s.players[top] || (top === "w" ? "White" : "Black");
  $("[data-bottom-name]").textContent = s.players[bottom] || (bottom === "w" ? "White" : "Black");
  $("[data-top-color]").textContent = top === "w" ? "White" : "Black";
  $("[data-bottom-color]").textContent = bottom === "w" ? "White" : "Black";
  if (isRated && ratedInfo) {
    const baseElo = (c) => (c === "w" ? ratedInfo.white.elo : ratedInfo.black.elo);
    const liveElo = (c) => (ratedResult ? (c === "w" ? ratedResult.white.elo : ratedResult.black.elo) : baseElo(c));
    $("[data-top-name]").textContent += ` · ${liveElo(top)}`;
    $("[data-bottom-name]").textContent += ` · ${liveElo(bottom)}`;
  }
  $("[data-pcard-top]").classList.toggle("turn", s.turn === top && status === "active");
  $("[data-pcard-bottom]").classList.toggle("turn", s.turn === bottom && status === "active");

  setStatus(statusText(s));
  $("[data-turn-label]").textContent = spectating
    ? (status === "active" ? `👁 Spectating · ${s.turn === "w" ? "White" : "Black"} to move` : "👁 Spectating")
    : status === "active" ? (s.turn === myColor ? "Your move" : "Opponent's move") : "";
  renderMoves(s.history);

  $("[data-resign]").classList.toggle("hidden", myColor === "spectator" || status !== "active");
  $("[data-rematch]").classList.toggle("hidden", isRated || myColor === "spectator" || status === "active");

  if (status !== "active") showOverlay(s); else $("[data-overlay]").classList.add("hidden");
}

function statusText(s) {
  if (s.status === "active") return s.inCheck ? "Check!" : "Game in progress";
  if (s.status === "checkmate") return "Checkmate";
  if (s.status === "resigned") return "Resignation";
  if (s.status === "stalemate") return "Stalemate — draw";
  return "Draw";
}
const setStatus = (t) => ($("[data-status]").textContent = t);

function renderMoves(history) {
  const box = $("[data-moves]");
  box.replaceChildren();
  for (let i = 0; i < history.length; i += 2) {
    box.append(el("span.mv", {}, `${i / 2 + 1}. ${history[i].san}${history[i + 1] ? " " + history[i + 1].san : ""}`));
  }
  box.scrollTop = box.scrollHeight;
}

function showOverlay(s) {
  const won = s.winner && s.winner === myColor;
  $("[data-over-title]").textContent = statusText(s);
  $("[data-over-sub]").textContent = myColor === "spectator"
    ? (s.winner ? `${s.players[s.winner] || (s.winner === "w" ? "White" : "Black")} wins.` : "It's a draw.")
    : s.winner ? (won ? "You win!" : "You lost.") : "It's a draw.";
  $("[data-over-rematch]").classList.toggle("hidden", isRated || myColor === "spectator");
  $("[data-overlay]").classList.remove("hidden");
  showRatedElo();
}

function showRatedElo() {
  const box = $("[data-over-elo]");
  if (!box) return;
  const mine = ratedResult && (myColor === "w" ? ratedResult.white : myColor === "b" ? ratedResult.black : null);
  if (!mine) { box.hidden = true; return; }
  const sign = mine.delta >= 0 ? "+" : "";
  box.textContent = `Rating ${sign}${mine.delta} → ${mine.elo}`;
  box.classList.toggle("up", mine.delta >= 0);
  box.classList.toggle("down", mine.delta < 0);
  box.hidden = false;
}

// ── controls ──
$("[data-resign]").onclick = () => confirm("Resign this game?") && send({ type: "resign" });
$("[data-rematch]").onclick = () => send({ type: "rematch" });
$("[data-over-rematch]").onclick = () => { $("[data-overlay]").classList.add("hidden"); send({ type: "rematch" }); };

const chatLog = $("[data-chat]");
function addChat(m) {
  const line = m.sys
    ? el("div.sys", {}, m.text)
    : el("div", {}, el("b", {}, `${m.name}: `), m.text);
  chatLog.append(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}
const sendChat = () => {
  const input = $("[data-chat-input]");
  if (input.value.trim()) { send({ type: "chat", text: input.value }); input.value = ""; }
};
$("[data-chat-send]").onclick = sendChat;
$("[data-chat-input]").addEventListener("keydown", (e) => e.key === "Enter" && sendChat());
$("[data-code]").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase()));

// ── replay: step through a finished game ──
let rpFens = [], rpMoves = [], rpPly = 0, rpTimer = null;

async function initReplay(id) {
  const res = await fetch(`/api/games/${id}/replay`);
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    $("[data-lobby-err]").textContent = d.error || "Couldn't open that replay.";
    return;
  }
  const g = await res.json();
  replaying = true;

  // Rebuild every position from the stored PGN.
  const game = new Chess();
  try { game.loadPgn(g.pgn || ""); } catch {}
  rpMoves = game.history({ verbose: true });
  const walk = new Chess();
  rpFens = [walk.fen()];
  for (const m of rpMoves) { walk.move(m); rpFens.push(walk.fen()); }

  // Enter the board view (no socket, no room code).
  $("[data-lobby]").classList.add("hidden");
  $("[data-game]").classList.remove("hidden");
  $("[data-room]").textContent = "Replay";
  buildBoard();

  // Names + result, hide the live controls, reveal the scrubber.
  $("[data-bottom-name]").textContent = g.white.name || "White";
  $("[data-top-name]").textContent = g.black.name || "Black";
  $("[data-bottom-color]").textContent = "White";
  $("[data-top-color]").textContent = "Black";
  const result = g.winner === "draw" ? "Draw"
    : g.winner === "white" ? `${g.white.name || "White"} won`
    : `${g.black.name || "Black"} won`;
  setStatus(`Replay · ${result}${g.reason ? ` (${g.reason})` : ""}`);
  $("[data-turn-label]").textContent = "⏪ Replay";
  $("[data-resign]").classList.add("hidden");
  $("[data-rematch]").classList.add("hidden");
  const chatWrap = $("[data-chat-input]")?.closest(".chat");
  if (chatWrap) chatWrap.classList.add("hidden");
  $("[data-replay-bar]").classList.remove("hidden");

  rpGoto(rpMoves.length);   // start at the final position
}

function rpRender() {
  chess.load(rpFens[rpPly]);
  lastMove = rpPly > 0 ? { from: rpMoves[rpPly - 1].from, to: rpMoves[rpPly - 1].to } : null;
  render();
  $("[data-rp-counter]").textContent = `${rpPly} / ${rpMoves.length}`;
  $("[data-rp-play]").textContent = rpTimer ? "⏸" : "▶";
  rpRenderMoves();
}

function rpRenderMoves() {
  const box = $("[data-moves]");
  box.replaceChildren();
  for (let i = 0; i < rpMoves.length; i += 2) {
    const span = el("span.mv", {}, `${i / 2 + 1}. `);
    const w = el("b.mv-ply", { onclick: () => rpGoto(i + 1) }, rpMoves[i].san);
    if (rpPly === i + 1) w.classList.add("now");
    span.append(w);
    if (rpMoves[i + 1]) {
      span.append(" ");
      const b = el("b.mv-ply", { onclick: () => rpGoto(i + 2) }, rpMoves[i + 1].san);
      if (rpPly === i + 2) b.classList.add("now");
      span.append(b);
    }
    box.append(span);
  }
  const cur = box.querySelector(".now");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

function rpGoto(ply) {
  rpPly = Math.max(0, Math.min(ply, rpMoves.length));
  rpRender();
  if (rpTimer && rpPly >= rpMoves.length) rpStop();   // reached the end while autoplaying
}

function rpStop() { clearInterval(rpTimer); rpTimer = null; $("[data-rp-play]").textContent = "▶"; }
function rpToggle() {
  if (rpTimer) return rpStop();
  if (rpPly >= rpMoves.length) rpPly = 0;             // restart if at the end
  rpTimer = setInterval(() => rpGoto(rpPly + 1), 900);
  rpRender();
}

$("[data-rp-first]").onclick = () => { rpStop(); rpGoto(0); };
$("[data-rp-prev]").onclick = () => { rpStop(); rpGoto(rpPly - 1); };
$("[data-rp-next]").onclick = () => { rpStop(); rpGoto(rpPly + 1); };
$("[data-rp-last]").onclick = () => { rpStop(); rpGoto(rpMoves.length); };
$("[data-rp-play]").onclick = rpToggle;
