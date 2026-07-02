// Top-of-screen announcement for kids: if there's an open tournament they can
// join (and haven't dismissed), show a banner inviting them to sign up.

import { api } from "./api.js";
import { el } from "./dom.js";
import { getMe } from "./session.js";

const DISMISS_KEY = "dismissedTournaments";
const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); } catch { return new Set(); } };
const dismiss = (id) => {
  const s = dismissed(); s.add(id);
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch {}
};

export async function mountAnnounce() {
  const me = await getMe();
  if (!me || me.role !== "kid") return;          // announcements are for kids

  const data = await api.get("/api/tournaments").catch(() => null);
  if (!data || !Array.isArray(data.tournaments)) return;

  const seen = dismissed();
  const open = data.tournaments.find((t) => t.status === "open" && !t.joined && !seen.has(t.id));
  if (!open) return;

  const bar = el("div.announce", {},
    el("span.announce-text", {}, `🏆 Nový turnaj: `, el("strong", {}, open.name), ` — přihlas se!`),
    el("a.btn.primary.sm", { href: `/tournament.html?id=${open.id}` }, "Přidat se"),
    el("button.announce-x", { "aria-label": "Zavřít", onclick: () => { dismiss(open.id); bar.remove(); } }, "×"));
  document.body.insertBefore(bar, document.body.firstChild);
}
