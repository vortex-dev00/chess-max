import { Chess } from "chess.js";
import { api } from "../components/api.js";
import { $, $$, el, fmtDate } from "../components/dom.js";
import { mountNav } from "../components/nav.js";
import { requireRole } from "../components/session.js";
import { mountEditor } from "../components/board-editor.js";
import { mountGroupChat } from "../components/group-chat.js";
import { miniBoard } from "../components/mini-board.js";

await mountNav("dash");
const me = await requireRole(["admin", "coach"]);
if (me) main();

const ROLE_LABEL = { kid: "dítě", coach: "trenér", admin: "administrátor" };

let kids = [];
let chat = null;   // active group-chat connection, if the Chat sub-tab is open

async function main() {
  $("[data-app]").hidden = false;
  $("[data-who]").textContent = `${me.name} · ${ROLE_LABEL[me.role] || me.role}`;

  // tab switching
  $$(".tab").forEach((tab) => (tab.onclick = () => {
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    if (tab.dataset.tab === "approvals") loadPending();
    if (tab.dataset.tab === "users") loadUsers();
    if (tab.dataset.tab === "tasks") loadTasks();
    if (tab.dataset.tab === "progress") loadProgress();
  }));

  $("[data-create-group]").onclick = createGroup;
  $("[data-add-member]").onclick = addMember;
  $("[data-add-lesson]").onclick = addLesson;
  $("[data-add-review]").onclick = addReview;

  // group-detail sub-tabs (Members / Lessons / Reviews / Chat)
  $$("[data-sub]").forEach((t) => (t.onclick = () => {
    $$("[data-sub]").forEach((x) => x.classList.toggle("is-active", x === t));
    $$("[data-sub-panel]").forEach((p) => (p.hidden = p.dataset.subPanel !== t.dataset.sub));
    if (t.dataset.sub === "chat") openChat(); else closeChat();
  }));

  kids = (await api.get("/api/kids")).kids || [];
  fillKidPicker();
  loadGroups();
  refreshPendingBadge();

  // tasks editor
  mountEditor($("[data-editor]"), { onSaved: () => loadTasks() });
  $("[data-task-search]").addEventListener("input", renderTasks);
}

/* ── Groups ── */
let selectedGroup = null;

async function loadGroups() {
  const groups = (await api.get("/api/groups")).groups || [];
  $("[data-groups]").replaceChildren(...(groups.length ? groups.map((g) =>
    el("li", { style: `cursor:pointer;${selectedGroup === g.id ? "border-color:var(--accent)" : ""}`, onclick: () => selectGroup(g.id) },
      el("span", {}, el("strong", {}, g.name)), el("span.tag", {}, `${g.member_count}`))) : [el("li.muted", {}, "Zatím žádné skupiny.")]));
}
function fillKidPicker() {
  $("[data-kid-picker]").replaceChildren(...(kids.length
    ? kids.map((k) => el("option", { value: k.id }, k.name)) : [el("option", { value: "" }, "Zatím žádné děti")]));
}
async function createGroup() {
  const input = $("[data-new-group]");
  if (!input.value.trim()) return;
  const { ok, data } = await api.post("/api/groups", { name: input.value.trim() });
  if (ok) { input.value = ""; await loadGroups(); selectGroup(data.id); }
}
async function selectGroup(id) {
  selectedGroup = id;
  await loadGroups();
  const res = await api.get(`/api/groups/${id}`);
  if (res.error) return;
  $("[data-group-empty]").hidden = true;
  $("[data-group-detail]").hidden = false;
  $("[data-group-name]").textContent = res.group.name;
  $("[data-delete-group]").onclick = async () => {
    if (!confirm(`Smazat skupinu „${res.group.name}“?`)) return;
    await api.del(`/api/groups/${id}`); selectedGroup = null;
    $("[data-group-detail]").hidden = true; $("[data-group-empty]").hidden = false; loadGroups();
  };
  $("[data-members]").replaceChildren(...(res.members.length ? res.members.map((m) =>
    el("li", {}, el("span", {}, el("strong", {}, m.name), el("span.subtle", {}, ` ${m.email}`)),
      el("button.btn.danger.sm", { onclick: async () => { await api.del(`/api/groups/${id}/members/${m.id}`); selectGroup(id); } }, "Odebrat"))
  ) : [el("li.muted", {}, "Zatím žádní členové.")]));

  renderLessons(id, res.lessons || []);
  renderReviews(id, res.reviews || []);

  // If the Chat sub-tab is the open one, (re)connect it to this group.
  if ($('[data-sub="chat"]').classList.contains("is-active")) openChat(); else closeChat();
}

/* ── Group chat ── */
function openChat() {
  closeChat();
  if (!selectedGroup) return;
  chat = mountGroupChat($("[data-chat]"), selectedGroup, me);
}
function closeChat() {
  chat?.close(); chat = null;
}

/* ── Lessons + attendance ── */
function renderLessons(gid, lessons) {
  $("[data-lessons]").replaceChildren(...(lessons.length ? lessons.map((l) => {
    const box = el("div", { style: "display:none; width:100%; margin-top:8px" });
    const attBtn = el("button.btn.sm", { onclick: () => toggleAttendance(l.id, box, attBtn) }, "Docházka");
    return el("li", { style: "flex-direction:column; align-items:stretch; gap:6px" },
      el("div.spread", {},
        el("span", {}, el("strong", {}, fmtDate(l.starts_at)), el("span.subtle", {}, ` ${l.location || ""}`),
          l.note ? el("div.subtle", {}, l.note) : ""),
        el("div.row", {}, attBtn, el("button.btn.danger.sm", { onclick: async () => { await api.del(`/api/lessons/${l.id}`); selectGroup(gid); } }, "Smazat"))),
      box);
  }) : [el("li.muted", {}, "Zatím žádné naplánované lekce.")]));
}

async function toggleAttendance(lessonId, box, btn) {
  if (box.style.display === "block") { box.style.display = "none"; btn.textContent = "Docházka"; return; }
  box.style.display = "block"; btn.textContent = "Skrýt";
  const rows = (await api.get(`/api/lessons/${lessonId}/attendance`)).attendance || [];
  box.replaceChildren(...(rows.length ? rows.map((a) => {
    const cb = el("input", { type: "checkbox", style: "width:auto", ...(a.attended ? { checked: "" } : {}) });
    cb.checked = !!a.attended;
    cb.onchange = () => api.post(`/api/lessons/${lessonId}/attendance`, { user_id: a.user_id, attended: cb.checked });
    return el("label.row", { style: "justify-content:space-between; padding:5px 0" }, el("span", {}, a.name), cb);
  }) : [el("div.subtle", {}, "Zatím žádní členové v této skupině.")]));
}

async function addLesson() {
  if (!selectedGroup) return;
  const t = $("[data-lesson-time]").value;
  if (!t) return;
  await api.post(`/api/groups/${selectedGroup}/lessons`, {
    starts_at: new Date(t).getTime(),
    location: $("[data-lesson-loc]").value.trim(),
    note: $("[data-lesson-note]").value.trim(),
  });
  $("[data-lesson-time]").value = $("[data-lesson-loc]").value = $("[data-lesson-note]").value = "";
  selectGroup(selectedGroup);
}

/* ── Reviews ── */
function renderReviews(gid, reviews) {
  $("[data-reviews]").replaceChildren(...(reviews.length ? reviews.map((r) =>
    el("li", { style: "flex-direction:column; align-items:stretch; gap:4px" },
      el("div.spread", {}, el("span.tag", {}, r.review_date),
        el("button.btn.danger.sm", { onclick: async () => { await api.del(`/api/reviews/${r.id}`); selectGroup(gid); } }, "Smazat")),
      el("div", { style: "white-space:pre-wrap" }, r.text))
  ) : [el("li.muted", {}, "Zatím žádná hodnocení.")]));
}

async function addReview() {
  if (!selectedGroup) return;
  const text = $("[data-review-text]").value.trim();
  if (!text) return;
  await api.post(`/api/groups/${selectedGroup}/reviews`, { text, review_date: $("[data-review-date]").value || null });
  $("[data-review-text]").value = $("[data-review-date]").value = "";
  selectGroup(selectedGroup);
}

async function addMember() {
  const uid = $("[data-kid-picker]").value;
  if (!uid || !selectedGroup) return;
  await api.post(`/api/groups/${selectedGroup}/members`, { user_id: Number(uid) });
  selectGroup(selectedGroup);
}

/* ── Approvals ── */
async function loadPending() {
  const pending = (await api.get("/api/pending")).pending || [];
  setPendingCount(pending.length);
  $("[data-pending]").replaceChildren(...(pending.length ? pending.map((u) =>
    el("li", {},
      el("span", {}, el("strong", {}, u.name), el("span.subtle", {}, ` ${u.email}`)),
      el("div.row", { style: "gap:8px" },
        el("button.btn.primary.sm", { onclick: async () => {
          await api.post(`/api/users/${u.id}/approve`); kids = (await api.get("/api/kids")).kids || []; fillKidPicker(); loadPending();
        } }, "Schválit"),
        el("button.btn.danger.sm", { onclick: async () => {
          if (confirm(`Zamítnout a smazat registraci uživatele ${u.name}?`)) { await api.post(`/api/users/${u.id}/reject`); loadPending(); }
        } }, "Zamítnout"))),
  ) : [el("li.muted", {}, "Nikdo nečeká — vše vyřízeno. ✓")]));
}

async function refreshPendingBadge() {
  const pending = (await api.get("/api/pending")).pending || [];
  setPendingCount(pending.length);
}
function setPendingCount(n) {
  const badge = $("[data-pending-count]");
  if (!badge) return;
  badge.textContent = n;
  badge.hidden = n === 0;
}

/* ── Users & Roles ── */
async function loadUsers() {
  const users = (await api.get("/api/users")).users || [];
  $("[data-users]").replaceChildren(...users.map((u) => {
    const select = el("select", {},
      ...["kid", "coach", "admin"].map((r) => el("option", { value: r, ...(u.role === r ? { selected: "" } : {}) }, ROLE_LABEL[r])));
    select.value = u.role;
    select.onchange = async () => {
      const { ok, data } = await api.post(`/api/users/${u.id}/role`, { role: select.value });
      if (!ok) { alert(data.error || "Roli se nepodařilo změnit."); loadUsers(); }
    };
    const groups = u.groups.length
      ? u.groups.map((g) => el("span.tag", { style: "margin-right:4px" }, g.name))
      : [el("span.subtle", {}, "bez skupiny")];
    return el("li", { style: "flex-direction:column; align-items:stretch; gap:8px" },
      el("div.spread", {},
        el("span", {}, el("strong", {}, u.name), el("span.subtle", {}, ` ${u.email}`)),
        select),
      el("div.row", {}, ...groups),
    );
  }));
}

/* ── Tasks: a searchable database with board previews ── */
let allTasks = [];
async function loadTasks() {
  allTasks = (await api.get("/api/tasks")).tasks || [];
  renderTasks();
}
const TASK_CAP = 120;   // the library has ~1000 puzzles — cap the DOM, search to narrow
function renderTasks() {
  const q = ($("[data-task-search]").value || "").trim().toLowerCase();
  const shown = q
    ? allTasks.filter((t) => `${t.title} ${t.description || ""} ${t.category || ""}`.toLowerCase().includes(q))
    : allTasks;
  $("[data-task-count]").textContent = allTasks.length
    ? `${q ? `${shown.length} nalezeno` : `${allTasks.length} úloh`}${shown.length > TASK_CAP ? ` · zobrazeno ${TASK_CAP}` : ""}`
    : "";
  if (!shown.length) {
    $("[data-tasks]").replaceChildren(el("div.gallery-empty", {},
      allTasks.length ? "Hledání nic nenašlo." : "Zatím žádné úlohy — vytvoř první výše."));
    return;
  }
  const nodes = shown.slice(0, TASK_CAP).map(taskCard);
  if (shown.length > TASK_CAP) nodes.push(el("div.gallery-empty", {},
    `+${shown.length - TASK_CAP} dalších — zpřesni hledání podle názvu nebo kategorie (např. „mat ve 2“, „věž“).`));
  $("[data-tasks]").replaceChildren(...nodes);
}
function taskCard(t) {
  const orient = (t.fen || "").split(" ")[1] === "b" ? "b" : "w";
  const kidSel = el("select",
    ...(kids.length ? kids.map((k) => el("option", { value: k.id }, k.name)) : [el("option", { value: "" }, "Žádné děti")]));
  const assignBtn = el("button.btn.sm.primary", { onclick: async () => {
    if (!kidSel.value) return;
    const { ok } = await api.post("/api/tasks/assign", { task_id: t.id, user_id: Number(kidSel.value) });
    assignBtn.textContent = ok ? "✓" : "!";
    setTimeout(() => (assignBtn.textContent = "Přiřadit"), 1400);
  } }, "Přiřadit");
  return el("div.task-card", {},
    el("div.tc-board", {}, miniBoard(t.fen, { orient })),
    el("div.tc-title", {}, t.title),
    el("div.tc-meta", {},
      el("span.tag", {}, `★${t.difficulty}`),
      t.category ? el("span.tag", {}, t.category) : el("span.subtle", {}, orient === "w" ? "Táhnou bílí" : "Táhnou černí"),
      t.solution ? el("span.tag.good", {}, "úloha") : ""),
    t.description ? el("div.subtle", { style: "font-size:13px" }, t.description) : "",
    el("div.tc-assign", {}, kidSel, assignBtn,
      el("button.btn.sm.danger", { title: "Smazat", onclick: async () => {
        if (confirm(`Smazat „${t.title}“?`)) { await api.del(`/api/tasks/${t.id}`); loadTasks(); }
      } }, "✕")),
  );
}

/* ── Progress: group → kid → solve-history drill-down ── */
const MEDAL = ["🥇", "🥈", "🥉"];
let progressData = null;                 // { groups, ungrouped, total }
let pView = { level: "groups" };         // groups | kids | kid

async function loadProgress() {
  progressData = await api.get("/api/progress/groups");
  pView = { level: "groups" };
  renderProgress();
}

function renderProgress() {
  renderCrumbs();
  if (pView.level === "kids") return renderKidList();
  if (pView.level === "kid") return renderKidDetail();
  return renderGroupGrid();
}

function renderCrumbs() {
  const host = $("[data-progress-crumbs]");
  const crumb = (label, onClick, here) =>
    el("button", { class: `crumb${here ? " here" : ""}`, ...(onClick ? { onclick: onClick } : {}) }, label);
  const parts = [crumb("Skupiny", () => { pView = { level: "groups" }; renderProgress(); }, pView.level === "groups")];
  if (pView.level !== "groups") {
    parts.push(el("span.crumb-sep", {}, "›"));
    parts.push(crumb(pView.groupName,
      () => { pView = { level: "kids", groupName: pView.groupName, kids: pView.kids }; renderProgress(); },
      pView.level === "kids"));
  }
  if (pView.level === "kid") {
    parts.push(el("span.crumb-sep", {}, "›"), crumb(pView.kidName, null, true));
  }
  host.replaceChildren(...parts);
}

function renderGroupGrid() {
  const d = progressData || { groups: [], ungrouped: [] };
  // Dedup union for the "All kids" card (a kid can be in several groups).
  const union = new Map();
  for (const g of d.groups) for (const k of g.kids) union.set(k.id, k);
  for (const k of d.ungrouped) union.set(k.id, k);
  const allKids = [...union.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const xpOf = (kids) => kids.reduce((s, k) => s + k.points, 0);
  const card = (name, kids, sub) => el("button.group-card", { onclick: () => enterGroup(name, kids) },
    el("div.gc-name", {}, name),
    el("div.gc-sub", {}, sub || `${kids.length} ${kids.length === 1 ? "dítě" : "dětí"} · ${xpOf(kids)} XP`));

  const cards = [card("Všechny děti", allKids, `${allKids.length} ${allKids.length === 1 ? "dítě" : "dětí"} · ${xpOf(allKids)} XP celkem`)];
  for (const g of d.groups) cards.push(card(g.name, g.kids));
  if (d.ungrouped.length) cards.push(card("Bez skupiny", d.ungrouped));

  $("[data-progress]").replaceChildren(
    el("p.subtle", { style: "margin:0 0 14px" }, "Vyber skupinu, ve které uvidíš její děti, a pak dítě, u kterého uvidíš, jak řešilo jednotlivé úlohy."),
    el("div.group-grid", {}, ...cards));
}

function enterGroup(name, kids) {
  pView = { level: "kids", groupName: name, kids };
  renderProgress();
}

function renderKidList() {
  const kids = pView.kids || [];
  $("[data-progress]").replaceChildren(el("ul.list", {}, ...(kids.length ? kids.map((k, i) =>
    el("li.kid-row", { onclick: () => enterKid(k) },
      el("span", {},
        el("span.lead-rank", {}, i < 3 && k.points > 0 ? MEDAL[i] : `#${i + 1}`),
        el("strong", { style: "margin-left:8px" }, k.name),
        el("span.subtle", { style: "margin-left:8px" }, `Úr. ${k.level.num} ${k.level.name}`)),
      el("div.row", { style: "gap:10px" },
        ...(k.earned || []).slice(0, 6).map((b) => el("span.badge-chip", { title: b.name }, b.icon)),
        el("span.tag.good", {}, `${k.points} XP · vyřešeno ${k.solved}`)))
  ) : [el("li.muted", {}, "V této skupině zatím nejsou žádné děti.")])));
}

async function enterKid(k) {
  pView = { level: "kid", groupName: pView.groupName, kids: pView.kids, kidName: k.name, kidId: k.id };
  renderProgress();
  $("[data-progress]").replaceChildren(el("p.muted", {}, "Načítání…"));
  const detail = await api.get(`/api/progress/${k.id}`);
  if (pView.level === "kid" && pView.kidId === k.id) { pView.detail = detail; renderKidDetail(); }
}

// UCI line → readable SAN, played from the puzzle's starting position.
function movesToSan(fen, line) {
  if (!line) return "";
  try {
    const c = new Chess(fen);
    const sans = [];
    for (const u of line.split(/\s+/).filter(Boolean)) {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
      if (!m) break;
      sans.push(m.san);
    }
    return sans.join("  ");
  } catch { return ""; }
}

function renderKidDetail() {
  const d = pView.detail;
  const host = $("[data-progress]");
  if (!d) { host.replaceChildren(el("p.muted", {}, "Načítání…")); return; }
  if (d.error) { host.replaceChildren(el("p.muted", {}, "Nepodařilo se načíst pokrok tohoto dítěte.")); return; }

  const pct = d.level.next ? Math.round(((d.points - d.level.floor) / (d.level.next - d.level.floor)) * 100) : 100;
  const summary = el("div.card", { style: "margin-bottom:16px" },
    el("div.spread", {},
      el("div", {}, el("strong", { style: "font-size:18px" }, d.name),
        el("div.subtle", {}, `Úr. ${d.level.num} ${d.level.name} · ${d.points} XP · vyřešeno ${d.solved}`)),
      el("div.row", { style: "gap:6px" }, ...(d.badges || []).filter((b) => b.earned).map((b) =>
        el("span.badge-chip", { title: b.name }, b.icon)))),
    el("div.xp-bar", { style: "margin-top:12px" }, el("div", { style: `height:100%; width:${pct}%; background:var(--accent)` })));

  const solveCard = (s, pending) => {
    const orient = (s.fen || "").split(" ")[1] === "b" ? "b" : "w";
    return el("div", { class: `solve-card${pending ? " pending" : ""}` },
      miniBoard(s.fen, { orient }),
      el("div", {}, el("strong", {}, s.title), " ", el("span.tag", {}, `★${s.difficulty}`)),
      pending ? "" : el("div.sc-moves", {}, movesToSan(s.fen, s.solution) || "(žádné zaznamenané tahy)"),
      el("div.sc-when", {}, pending
        ? `Přiřazeno ${fmtDate(s.assigned_at)} · zatím nevyřešeno`
        : `Vyřešeno ${fmtDate(s.completed_at)}`));
  };

  const blocks = [summary];
  blocks.push(el("h3", { style: "font-size:15px; margin:18px 0 10px" }, `Vyřešené úlohy (${d.solved})`));
  blocks.push(d.solved.length
    ? el("div.solve-grid", {}, ...d.solved.map((s) => solveCard(s, false)))
    : el("p.muted", {}, "Zatím nevyřešilo žádnou úlohu."));
  if (d.pending && d.pending.length) {
    blocks.push(el("h3", { style: "font-size:15px; margin:20px 0 10px" }, `Ještě zbývá (${d.pending.length})`));
    blocks.push(el("div.solve-grid", {}, ...d.pending.map((s) => solveCard(s, true))));
  }
  host.replaceChildren(...blocks);
}
