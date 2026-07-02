import { api } from "../components/api.js";
import { $, el, fmtDate } from "../components/dom.js";
import { mountNav } from "../components/nav.js";
import { requireRole } from "../components/session.js";

await mountNav("arena");
const me = await requireRole();   // any signed-in user
if (me) main();

const ROLE_LABEL = { kid: "dítě", coach: "trenér", admin: "administrátor" };

async function main() {
  $("[data-app]").hidden = false;
  // host-tournament form
  $("[data-host]").onclick = () => { $("[data-host-form]").hidden = false; $("[data-host]").hidden = true; openHostForm(); };
  $("[data-host-cancel]").onclick = () => { $("[data-host-form]").hidden = true; $("[data-host]").hidden = false; };
  $("[data-t-format]").onchange = (e) => { $("[data-t-rounds-wrap]").hidden = e.target.value !== "swiss"; };
  $("[data-t-audience]").onchange = (e) => {
    $("[data-t-group-wrap]").hidden = e.target.value !== "group";
    $("[data-t-kids-wrap]").hidden = e.target.value !== "kids";
  };
  $("[data-t-create]").onclick = createTournament;
  await load();
  setInterval(load, 5000);        // keep challenges + tournaments fresh
}

async function load() {
  const [players, challenges, history, tourneys] = await Promise.all([
    api.get("/api/players"),
    api.get("/api/challenges"),
    api.get("/api/games/mine"),
    api.get("/api/tournaments"),
  ]);
  renderRating(players.players || []);
  renderLeaderboard(players.players || []);
  renderChallenges(challenges);
  renderHistory(history.games || []);
  renderTournaments(tourneys);
}

const FORMAT_LABEL = { knockout: "Pavouk", roundrobin: "Kruhový systém", swiss: "Švýcarský systém" };
function renderTournaments(data) {
  $("[data-host]").hidden = !data.canManage || !$("[data-host-form]").hidden;
  const list = data.tournaments || [];
  $("[data-tournaments]").replaceChildren(...(list.length ? list.map((t) =>
    el("li", {},
      el("span", {},
        el("strong", {}, t.name),
        el("span.tag", { style: "margin-left:8px" }, FORMAT_LABEL[t.format] || t.format),
        el("span.subtle", { style: "margin-left:8px" },
          t.status === "finished" ? `vyhrál ${t.winner_name || "—"}`
          : t.status === "active" ? `kolo ${t.current_round}/${t.rounds_total} · ${t.players} hráčů`
          : `přihlášeno ${t.players}`)),
      el("div.row", { style: "gap:8px" },
        t.status !== "finished" && t.joined ? el("span.tag.good", {}, "přihlášen") : "",
        el("a.btn.sm", { class: t.status === "open" && !t.joined ? "btn primary sm" : "btn sm", href: `/tournament.html?id=${t.id}` },
          t.status === "open" ? (t.joined ? "Zobrazit" : "Přidat se") : "Zobrazit"))),
  ) : [el("li.muted", {}, "Zatím žádné turnaje.")]));
}

// Load the group + kid pickers the first time the host form opens.
let hostListsLoaded = false;
async function openHostForm() {
  if (hostListsLoaded) return;
  hostListsLoaded = true;
  const [groups, kids] = await Promise.all([api.get("/api/groups"), api.get("/api/kids")]);
  $("[data-t-group]").replaceChildren(...((groups.groups || []).length
    ? groups.groups.map((g) => el("option", { value: g.id }, g.name))
    : [el("option", { value: "" }, "Zatím žádné skupiny")]));
  $("[data-t-kids]").replaceChildren(...((kids.kids || []).length
    ? kids.kids.map((k) => el("option", { value: k.id }, k.name))
    : [el("option", { value: "" }, "Zatím žádné děti")]));
}

async function createTournament() {
  const name = $("[data-t-name]").value.trim();
  const format = $("[data-t-format]").value;
  if (!name) { alert("Zadej název."); return; }
  const body = { name, format, audience_type: $("[data-t-audience]").value };
  if (format === "swiss" && $("[data-t-rounds]").value) body.rounds = Number($("[data-t-rounds]").value);
  if (body.audience_type === "group") {
    body.group_id = Number($("[data-t-group]").value);
    if (!body.group_id) { alert("Vyber skupinu (nebo ji nejdřív založ)."); return; }
  }
  if (body.audience_type === "kids") {
    body.kid_ids = [...$("[data-t-kids]").selectedOptions].map((o) => Number(o.value)).filter(Boolean);
    if (!body.kid_ids.length) { alert("Vyber alespoň jedno dítě."); return; }
  }
  const { ok, data } = await api.post("/api/tournaments", body);
  if (!ok) { alert(data.error || "Nepodařilo se vytvořit."); return; }
  location.href = `/tournament.html?id=${data.id}`;
}

function renderRating(players) {
  const meRow = players.find((p) => p.id === me.id);
  const rank = players.findIndex((p) => p.id === me.id) + 1;
  $("[data-my-elo]").textContent = meRow ? meRow.elo : "1200";
  $("[data-my-rank]").textContent = rank ? `#${rank} z ${players.length}` : "";
}

function renderLeaderboard(players) {
  $("[data-leaderboard]").replaceChildren(...(players.length ? players.map((p, i) =>
    el("li", { class: p.id === me.id ? "lead-top" : "" },
      el("span", {},
        el("span.lead-rank", {}, `#${i + 1}`),
        el("strong", { style: "margin-left:8px" }, p.id === me.id ? `${p.name} (ty)` : p.name),
        el("span.subtle", { style: "margin-left:8px" }, ROLE_LABEL[p.role] || p.role)),
      el("div.row", { style: "gap:10px" },
        el("span.elo-pill", {}, `${p.elo}`),
        p.id === me.id ? "" : el("button.btn.sm", {
          onclick: () => challenge(p.id),
        }, "Vyzvat"))),
  ) : [el("li.muted", {}, "Zatím žádní hráči.")]));
}

function renderChallenges(c) {
  const incoming = c.incoming || [], outgoing = c.outgoing || [], active = c.active || [];
  const card = $("[data-challenges-card]");
  if (!incoming.length && !outgoing.length && !active.length) { card.hidden = true; return; }
  card.hidden = false;

  const blocks = [];

  if (active.length) blocks.push(el("div", {},
    el("div.subtle", { style: "margin:4px 0 6px" }, "Rozehrané partie"),
    ...active.map((a) => {
      const opp = a.from_id === me.id ? a.to_name : a.from_name;
      return el("div.spread", { style: "padding:8px 0; border-bottom:1px solid var(--line-soft)" },
        el("span", {}, el("strong", {}, opp), el("span.subtle", { style: "margin-left:8px" }, "hodnocená partie")),
        el("a.btn.primary.sm", { href: `/play.html?game=${a.game_id}` }, "Pokračovat"));
    })));

  if (incoming.length) blocks.push(el("div", {},
    el("div.subtle", { style: "margin:10px 0 6px" }, "Výzvy tobě"),
    ...incoming.map((ch) => el("div.spread", { style: "padding:8px 0; border-bottom:1px solid var(--line-soft)" },
      el("span", {}, el("strong", {}, ch.from_name), el("span.elo-pill", { style: "margin-left:8px" }, `${ch.from_elo}`)),
      el("div.row", { style: "gap:8px" },
        el("button.btn.primary.sm", { onclick: () => accept(ch.id) }, "Přijmout"),
        el("button.btn.danger.sm", { onclick: () => decline(ch.id) }, "Odmítnout"))))));

  if (outgoing.length) blocks.push(el("div", {},
    el("div.subtle", { style: "margin:10px 0 6px" }, "Tvé výzvy"),
    ...outgoing.map((ch) => el("div.spread", { style: "padding:8px 0; border-bottom:1px solid var(--line-soft)" },
      el("span", {}, el("strong", {}, ch.to_name), el("span.subtle", { style: "margin-left:8px" }, "čeká se…")),
      el("button.btn.sm", { onclick: () => decline(ch.id) }, "Zrušit")))));

  $("[data-challenges]").replaceChildren(...blocks);
}

function renderHistory(games) {
  $("[data-history]").replaceChildren(...(games.length ? games.map((g) => {
    const tag = g.result === "win" ? el("span.tag.good", {}, "Výhra")
      : g.result === "loss" ? el("span.tag", { style: "color:var(--bad); border-color:var(--bad-line)" }, "Prohra")
      : el("span.tag", {}, "Remíza");
    const delta = g.delta == null ? "" : el("span.elo-delta", { class: `elo-delta ${g.delta >= 0 ? "up" : "down"}` },
      `${g.delta >= 0 ? "+" : ""}${g.delta}`);
    return el("li", {},
      el("span", {}, el("strong", {}, `vs ${g.opponent}`), el("span.subtle", { style: "margin-left:8px" }, g.at ? fmtDate(g.at) : "")),
      el("div.row", { style: "gap:10px; align-items:center" }, tag, delta,
        el("a.btn.sm.ghost", { href: `/play.html?replay=${g.id}` }, "↺ Přehrát")));
  }) : [el("li.muted", {}, "Zatím žádné hodnocené partie — vyzvi někoho výše!")]));
}

/* ── actions ── */
async function challenge(opponentId) {
  const { ok, data } = await api.post("/api/challenges", { opponent_id: opponentId });
  if (!ok) alert(data.error || "Výzvu se nepodařilo odeslat.");
  load();
}
async function accept(id) {
  const { ok, data } = await api.post(`/api/challenges/${id}/accept`);
  if (!ok) { alert(data.error || "Nepodařilo se přijmout."); return load(); }
  location.href = `/play.html?game=${data.game_id}`;
}
async function decline(id) {
  await api.post(`/api/challenges/${id}/decline`);
  load();
}
