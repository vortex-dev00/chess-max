import { api } from "../components/api.js";
import { $, el } from "../components/dom.js";
import { mountNav } from "../components/nav.js";
import { requireRole } from "../components/session.js";

await mountNav("events");
const me = await requireRole();   // any signed-in user
if (me) main();

const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const MONTHS = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];

let canManage = false;
let events = [];
let selectedId = null;
const view = new Date(); view.setDate(1);   // first of the displayed month

async function main() {
  $("[data-app]").hidden = false;
  $("[data-prev]").onclick = () => { view.setMonth(view.getMonth() - 1); render(); };
  $("[data-next]").onclick = () => { view.setMonth(view.getMonth() + 1); render(); };
  $("[data-today]").onclick = () => { const t = new Date(); view.setFullYear(t.getFullYear(), t.getMonth(), 1); render(); };
  $("[data-new]").onclick = () => openCreate();
  $("[data-cancel]").onclick = () => { $("[data-create]").hidden = true; };
  $("[data-ev-create]").onclick = createEvent;
  await load();
}

async function load() {
  const res = await api.get("/api/events");
  canManage = !!res.canManage;
  events = res.events || [];
  $("[data-new]").hidden = !canManage;
  render();
}

/* ── date helpers (local time) ── */
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const keyOfMs = (ms) => dayKey(new Date(ms));
const fmtTime = (ms) => new Date(ms).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
const fmtFull = (ms) => new Date(ms).toLocaleString("cs-CZ", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/* ── calendar grid ── */
function render() {
  $("[data-month]").textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;

  // group events by local day key
  const byDay = new Map();
  for (const e of events) {
    const k = keyOfMs(e.starts_at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }

  const todayKey = dayKey(new Date());
  const month = view.getMonth();
  const first = new Date(view.getFullYear(), month, 1);
  const lead = (first.getDay() + 6) % 7;                 // Monday-first offset
  const start = new Date(view.getFullYear(), month, 1 - lead);
  const daysInMonth = new Date(view.getFullYear(), month + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const grid = el("div.cal-grid", {},
    ...WEEKDAYS.map((w) => el("div.cal-weekday", {}, w)));

  for (let i = 0; i < cells; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = dayKey(d);
    const dayEvents = (byDay.get(k) || []).sort((a, b) => a.starts_at - b.starts_at);
    const cls = "cal-day"
      + (d.getMonth() !== month ? " other" : "")
      + (k === todayKey ? " today" : "");
    const cell = el("div", { class: cls, onclick: () => canManage && openCreate(d) },
      el("div.cal-daynum", {}, String(d.getDate())),
      ...dayEvents.map((e) => el("button", {
        class: `cal-pill${e.starts_at < Date.now() ? " past" : ""}`
          + (e.myStatus === "going" ? " going" : e.myStatus === "maybe" ? " maybe" : "")
          + (e.id === selectedId ? " sel" : ""),
        onclick: (ev) => { ev.stopPropagation(); selectedId = e.id; render(); detailIntoView(); },
        title: e.title,
      }, el("span.cal-pill-time", {}, fmtTime(e.starts_at)), e.title)));
    grid.append(cell);
  }

  $("[data-cal]").replaceChildren(grid);
  renderDetail();
}

function renderDetail() {
  const host = $("[data-detail]");
  const e = events.find((x) => x.id === selectedId);
  if (!e) { host.replaceChildren(); return; }

  const past = e.starts_at < Date.now();

  // Set my RSVP to a status, or clear it if I tap the one I'm already on.
  const setStatus = async (status) => {
    if (e.myStatus === status) await api.del(`/api/events/${e.id}/rsvp`);
    else await api.post(`/api/events/${e.id}/rsvp`, { status });
    await load();
  };
  const goingBtn = el("button", {
    class: `btn${e.myStatus === "going" ? " primary" : ""}`,
    onclick: () => setStatus("going"),
  }, e.myStatus === "going" ? "Jdu ✓" : "Jdu");
  const maybeBtn = el("button", {
    class: `btn${e.myStatus === "maybe" ? " warn" : ""}`,
    onclick: () => setStatus("maybe"),
  }, e.myStatus === "maybe" ? "Možná ✓" : "Možná");

  // Two attendee rows: firm yeses, and people still thinking about it.
  const nameTags = (people) => people.map((a) => el(a.id === me.id ? "span.tag.good" : "span.tag", {}, a.name));
  const goingRow = e.going.length
    ? el("div.row", { style: "gap:6px; margin-top:10px; flex-wrap:wrap" },
        el("span.subtle", {}, `${e.going.length} jde:`), ...nameTags(e.going))
    : el("div.subtle", { style: "margin-top:10px" }, "Zatím se nikdo nepotvrdil — buď první!");
  const maybeRow = e.maybe.length
    ? el("div.row", { style: "gap:6px; margin-top:8px; flex-wrap:wrap" },
        el("span.subtle", {}, `${e.maybe.length} to zvažuje:`),
        ...e.maybe.map((a) => el("span.tag", { class: a.id === me.id ? "tag warn" : "tag" }, a.name)))
    : "";

  host.replaceChildren(el("section.card", { style: `margin-top:16px${past ? "; opacity:.75" : ""}` },
    el("div.spread", {},
      el("div", {},
        el("h2", { style: "margin:0; font-size:20px" }, e.title),
        el("div.subtle", { style: "margin-top:2px" }, `${fmtFull(e.starts_at)}${e.location ? " · " + e.location : ""}`)),
      el("div.row", { style: "gap:8px" },
        past ? el("span.tag", {}, "proběhlo") : el("div.row", { style: "gap:8px" }, goingBtn, maybeBtn),
        canManage ? el("button.btn.danger.sm", {
          onclick: async () => { if (confirm(`Smazat „${e.title}“?`)) { await api.del(`/api/events/${e.id}`); selectedId = null; await load(); } },
        }, "Smazat") : "")),
    e.description ? el("p", { style: "white-space:pre-wrap; margin:12px 0 0" }, e.description) : "",
    goingRow, maybeRow));
}

function detailIntoView() {
  const d = $("[data-detail]");
  if (d.firstChild) d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── create ── */
function openCreate(day) {
  $("[data-create]").hidden = false;
  if (day instanceof Date) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0);
    const pad = (n) => String(n).padStart(2, "0");
    $("[data-ev-time]").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  $("[data-ev-title]").focus();
  $("[data-create]").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function createEvent() {
  const title = $("[data-ev-title]").value.trim();
  const time = $("[data-ev-time]").value;
  if (!title || !time) { alert("Název a datum/čas jsou povinné."); return; }
  const { ok, data } = await api.post("/api/events", {
    title,
    starts_at: new Date(time).getTime(),
    location: $("[data-ev-loc]").value.trim(),
    description: $("[data-ev-desc]").value.trim(),
  });
  if (!ok) { alert(data.error || "Akci se nepodařilo vytvořit."); return; }
  $("[data-ev-title]").value = $("[data-ev-time]").value = $("[data-ev-loc]").value = $("[data-ev-desc]").value = "";
  $("[data-create]").hidden = true;
  // Jump the calendar to the new event's month and select it.
  const created = new Date(time);
  view.setFullYear(created.getFullYear(), created.getMonth(), 1);
  selectedId = data.id;
  await load();
}
