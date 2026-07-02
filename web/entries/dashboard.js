import { api } from "../components/api.js";
import { $, el, fmtDate } from "../components/dom.js";
import { mountNav } from "../components/nav.js";
import { requireRole } from "../components/session.js";
import { mountGroupChat } from "../components/group-chat.js";
import { progressCard } from "../components/progress.js";

await mountNav("dash");
const me = await requireRole();   // any signed-in user
if (me) main();

async function main() {
  $("[data-app]").hidden = false;
  $("[data-greeting]").textContent = `Ahoj, ${me.name}!`;

  const progress = await api.get("/api/me/progress");
  if (progress && progress.level) $("[data-progress]").replaceChildren(progressCard(progress));

  const tasks = (await api.get("/api/tasks/mine")).assignments || [];
  $("[data-tasks]").replaceChildren(...(tasks.length ? tasks.map((a) =>
    el("li", {},
      el("span", {}, el("strong", {}, a.title), " ", el("span.tag", {}, `★${a.difficulty}`),
        a.description ? el("div.subtle", {}, a.description) : ""),
      a.status === "completed"
        ? el("span.tag.good", {}, "✓ hotovo")
        : a.has_solution
          ? el("a.btn.primary.sm", { href: `/puzzle.html?task=${a.task_id}` }, "Řešit")
          : el("span.subtle", {}, "bez úlohy"),
    )) : [el("li.muted", {}, "Zatím nemáš žádné přiřazené úkoly.")]));

  const groups = (await api.get("/api/groups/mine")).groups || [];
  $("[data-groups]").replaceChildren(...(groups.length
    ? groups.map(groupCard)
    : [el("li.muted", {}, "Zatím nejsi v žádné skupině. Popros trenéra, aby tě přidal.")]));
}

function groupCard(g) {
  const lesson = g.nextLesson
    ? el("div.subtle", {}, `Příští lekce: ${fmtDate(g.nextLesson.starts_at)}`
        + (g.nextLesson.location ? ` · ${g.nextLesson.location}` : "")
        + (g.nextLesson.note ? ` — ${g.nextLesson.note}` : ""))
    : el("div.subtle", {}, "Žádné nadcházející lekce.");
  const review = g.review
    ? el("div.subtle", { style: "margin-top:2px" }, `Hodnocení trenéra (${g.review.review_date}): ${g.review.text}`)
    : "";

  // Chat panel, opened on demand so we only hold a socket while it's in use.
  const chatBox = el("div", { style: "margin-top:8px", hidden: "" });
  let chat = null;
  const chatBtn = el("button.btn.sm", { onclick: () => {
    if (chatBox.hidden) {
      chatBox.hidden = false; chatBtn.textContent = "Skrýt chat";
      chat = mountGroupChat(chatBox, g.id, me);
    } else {
      chatBox.hidden = true; chatBtn.textContent = "Chat";
      chat?.close(); chat = null;
    }
  } }, "Chat");

  return el("li", { style: "flex-direction:column; align-items:stretch; gap:4px" },
    el("div.spread", {}, el("strong", {}, g.name),
      el("div.row", {}, el("span.tag", {}, "skupina"), chatBtn)),
    lesson, review, chatBox);
}
