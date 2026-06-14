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
  $("[data-greeting]").textContent = `Hi, ${me.name}!`;

  const progress = await api.get("/api/me/progress");
  if (progress && progress.level) $("[data-progress]").replaceChildren(progressCard(progress));

  const tasks = (await api.get("/api/tasks/mine")).assignments || [];
  $("[data-tasks]").replaceChildren(...(tasks.length ? tasks.map((a) =>
    el("li", {},
      el("span", {}, el("strong", {}, a.title), " ", el("span.tag", {}, `★${a.difficulty}`),
        a.description ? el("div.subtle", {}, a.description) : ""),
      a.status === "completed"
        ? el("span.tag.good", {}, "✓ done")
        : a.has_solution
          ? el("a.btn.primary.sm", { href: `/puzzle.html?task=${a.task_id}` }, "Solve")
          : el("span.subtle", {}, "no puzzle"),
    )) : [el("li.muted", {}, "No tasks assigned yet.")]));

  const groups = (await api.get("/api/groups/mine")).groups || [];
  $("[data-groups]").replaceChildren(...(groups.length
    ? groups.map(groupCard)
    : [el("li.muted", {}, "You're not in any groups yet. Ask your coach to add you.")]));
}

function groupCard(g) {
  const lesson = g.nextLesson
    ? el("div.subtle", {}, `Next lesson: ${fmtDate(g.nextLesson.starts_at)}`
        + (g.nextLesson.location ? ` · ${g.nextLesson.location}` : "")
        + (g.nextLesson.note ? ` — ${g.nextLesson.note}` : ""))
    : el("div.subtle", {}, "No upcoming lessons.");
  const review = g.review
    ? el("div.subtle", { style: "margin-top:2px" }, `Coach's review (${g.review.review_date}): ${g.review.text}`)
    : "";

  // Chat panel, opened on demand so we only hold a socket while it's in use.
  const chatBox = el("div", { style: "margin-top:8px", hidden: "" });
  let chat = null;
  const chatBtn = el("button.btn.sm", { onclick: () => {
    if (chatBox.hidden) {
      chatBox.hidden = false; chatBtn.textContent = "Hide chat";
      chat = mountGroupChat(chatBox, g.id, me);
    } else {
      chatBox.hidden = true; chatBtn.textContent = "Chat";
      chat?.close(); chat = null;
    }
  } }, "Chat");

  return el("li", { style: "flex-direction:column; align-items:stretch; gap:4px" },
    el("div.spread", {}, el("strong", {}, g.name),
      el("div.row", {}, el("span.tag", {}, "group"), chatBtn)),
    lesson, review, chatBox);
}
