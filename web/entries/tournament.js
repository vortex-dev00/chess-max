import { api } from "../components/api.js";
import { $, el } from "../components/dom.js";
import { mountNav } from "../components/nav.js";
import { requireRole } from "../components/session.js";

await mountNav("arena");
const me = await requireRole();
const tid = new URLSearchParams(location.search).get("id");
if (me && tid) main();

const FORMAT_LABEL = { knockout: "Vyřazovací", roundrobin: "Kruhový systém", swiss: "Švýcarský systém" };

// Watch a live match / replay a finished one. Returns null for byes or
// not-yet-started pairings (no game to open).
function matchLink(m) {
  if (!m.game_id) return null;
  if (m.status === "finished" && m.result !== "bye")
    return el("a.btn.sm.ghost", { href: `/play.html?replay=${m.game_id}` }, "↺ Přehrát");
  if (m.status !== "finished" && m.game_status === "active")
    return el("a.btn.sm", { href: `/play.html?watch=${m.game_id}` }, "👁 Sledovat");
  return null;
}

async function main() {
  $("[data-app]").hidden = false;
  await load();
  setInterval(load, 4000);   // live updates as games finish
}

async function load() {
  const d = await api.get(`/api/tournaments/${tid}`);
  if (d.error) { $("[data-t-name]").textContent = "Turnaj nenalezen"; return; }
  render(d);
}

function render(d) {
  const t = d.tournament;
  $("[data-t-name]").textContent = t.name;
  $("[data-t-meta]").textContent = `${FORMAT_LABEL[t.format] || t.format} · `
    + (t.status === "open" ? `otevřeno pro přihlášky · přihlášeno ${d.players.length}`
       : t.status === "active" ? `kolo ${t.current_round} z ${t.rounds_total}`
       : "ukončeno");

  renderControls(d);
  renderChampion(d);
  renderMyMatch(d);

  // open: player list; active/finished: bracket or standings
  $("[data-open-card]").hidden = t.status !== "open";
  if (t.status === "open") renderPlayers(d);

  const isKnockout = t.format === "knockout";
  $("[data-bracket-wrap]").hidden = !(t.status !== "open" && isKnockout);
  $("[data-standings-wrap]").hidden = !(t.status !== "open" && !isKnockout);
  $("[data-rounds-wrap]").hidden = !(t.status !== "open" && !isKnockout);
  if (t.status !== "open") {
    if (isKnockout) renderBracket(d);
    else { renderStandings(d); renderRounds(d); }
  }
}

function renderControls(d) {
  const t = d.tournament;
  const host = $("[data-t-controls]");
  const btns = [];
  if (t.status === "open") {
    btns.push(d.players.some((p) => p.id === d.meId)
      ? el("button.btn.sm", { onclick: () => act("leave") }, "Opustit")
      : el("button.btn.primary.sm", { onclick: () => act("join") }, "Přidat se"));
    if (d.canManage) {
      btns.push(el("button.btn.primary.sm", { onclick: () => act("start") }, "Zahájit turnaj"));
      btns.push(el("button.btn.danger.sm", { onclick: del }, "Smazat"));
    }
  } else if (d.canManage) {
    btns.push(el("button.btn.danger.sm", { onclick: del }, "Smazat"));
  }
  host.replaceChildren(...btns);
}

function renderChampion(d) {
  const box = $("[data-champion]");
  if (d.tournament.status === "finished" && d.winnerName) {
    box.hidden = false;
    box.replaceChildren(el("div.champion", {},
      el("span", { style: "font-size:32px" }, "🏆"),
      el("div", {}, el("div.subtle", {}, "Vítěz"), el("strong", { style: "font-size:22px" }, d.winnerName))));
  } else box.hidden = true;
}

function renderMyMatch(d) {
  const box = $("[data-my-match]");
  if (d.myMatch) {
    box.hidden = false;
    box.replaceChildren(el("div.my-match", {},
      el("span", {}, "♟ Tvůj zápas je připraven — kolo " + d.myMatch.round),
      el("a.btn.primary.sm", { href: `/play.html?game=${d.myMatch.game_id}` }, "Hrát nyní")));
  } else box.hidden = true;
}

function renderPlayers(d) {
  $("[data-players]").replaceChildren(...(d.players.length ? d.players.map((p) =>
    el("li", {}, el("span", {}, el("strong", {}, p.id === d.meId ? `${p.name} (ty)` : p.name)),
      el("span.elo-pill", {}, `${p.elo}`))) : [el("li.muted", {}, "Zatím se nikdo nepřipojil.")]));
}

/* ── knockout bracket ── */
function renderBracket(d) {
  const byRound = groupRounds(d.matches);
  const cols = [...byRound.keys()].sort((a, b) => a - b).map((r) => {
    const label = roundLabel(r, d.tournament.rounds_total);
    return el("div.bracket-col", {},
      el("div.bracket-round", {}, label),
      ...byRound.get(r).map((m) => matchBox(m, d.meId)));
  });
  $("[data-bracket]").replaceChildren(...cols);
}

function matchBox(m, meId) {
  const row = (id, name, isWinner) => el("div", { class: `bm-row${isWinner ? " win" : ""}${id === meId ? " me" : ""}` },
    el("span", {}, name || "—"),
    el("span.bm-res", {}, m.status === "finished" ? (isWinner ? "✓" : "") : ""));
  const wWin = m.result === "white" || m.result === "bye" || m.winner_id === m.white_id;
  const bWin = m.result === "black" || m.winner_id === m.black_id;
  const link = matchLink(m);
  return el("div", { class: `bm${m.status === "finished" ? " done" : ""}` },
    row(m.white_id, m.white_name, m.status === "finished" && wWin),
    el("div.bm-div"),
    row(m.black_id, m.result === "bye" ? "(volný los)" : m.black_name, m.status === "finished" && bWin && m.result !== "bye"),
    link ? el("div.bm-actions", {}, link) : "");
}

/* ── round-robin / swiss ── */
function renderStandings(d) {
  $("[data-standings]").replaceChildren(...d.players.map((p, i) =>
    el("li", { class: i === 0 && d.tournament.status === "finished" ? "lead-top" : "" },
      el("span", {}, el("span.lead-rank", {}, `#${i + 1}`),
        el("strong", { style: "margin-left:8px" }, p.id === d.meId ? `${p.name} (ty)` : p.name)),
      el("span.tag.good", {}, `${p.score} b.`))));
}

function renderRounds(d) {
  const byRound = groupRounds(d.matches);
  const blocks = [...byRound.keys()].sort((a, b) => a - b).map((r) =>
    el("div.card", { style: "margin-bottom:10px" },
      el("div.subtle", { style: "margin-bottom:8px" }, `Kolo ${r}`),
      ...byRound.get(r).map((m) => el("div.spread", { style: "padding:5px 0" },
        el("span", {}, pairLabel(m, d.meId)),
        el("span", { style: "display:flex; align-items:center; gap:8px" },
          el("span.subtle", {}, resultLabel(m)),
          matchLink(m) || "")))));
  $("[data-rounds]").replaceChildren(...blocks);
}

function pairLabel(m, meId) {
  if (m.result === "bye") return el("span", {}, el("strong", {}, m.white_name), " — volný los");
  const a = el(m.white_id === meId ? "strong" : "span", {}, m.white_name || "—");
  const b = el(m.black_id === meId ? "strong" : "span", {}, m.black_name || "—");
  return el("span", {}, a, " vs ", b);
}
function resultLabel(m) {
  if (m.status !== "finished") return m.game_status === "active" ? "probíhá" : "nezahájeno";
  if (m.result === "bye") return "volný los";
  if (m.result === "draw") return "½–½";
  return m.winner_id === m.white_id ? "1–0" : "0–1";
}

/* ── helpers ── */
function groupRounds(matches) {
  const map = new Map();
  for (const m of matches) { if (!map.has(m.round)) map.set(m.round, []); map.get(m.round).push(m); }
  for (const arr of map.values()) arr.sort((a, b) => a.slot - b.slot);
  return map;
}
function roundLabel(r, total) {
  const fromEnd = total - r;
  if (fromEnd === 0) return "Finále";
  if (fromEnd === 1) return "Semifinále";
  if (fromEnd === 2) return "Čtvrtfinále";
  return `Kolo ${r}`;
}

async function act(action) {
  const { ok, data } = await api.post(`/api/tournaments/${tid}/${action}`);
  if (!ok) alert(data.error || "Něco se pokazilo.");
  load();
}
async function del() {
  if (!confirm("Smazat tento turnaj?")) return;
  await api.del(`/api/tournaments/${tid}`);
  location.href = "/arena.html";
}
