// Shared top navigation. Renders into <header data-nav>, adapting to session.

import { el, $ } from "./dom.js";
import { getMe, logout } from "./session.js";
import { mountAnnounce } from "./announce.js";

export async function mountNav(active = "") {
  const host = $("[data-nav]");
  if (!host) return;
  const me = await getMe();

  const link = (href, label, key) =>
    el("a", { href, class: `nav-link${active === key ? " is-active" : ""}` }, label);

  const links = [link("/play.html", "Hrát", "play")];
  if (me) {
    const dash = me.role === "kid" ? "/dashboard.html" : "/admin.html";
    links.push(link(dash, me.role === "kid" ? "Přehled" : "Administrace", "dash"));
    links.push(link("/arena.html", "Aréna", "arena"));
    links.push(link("/events.html", "Akce", "events"));
    links.push(el("button.nav-link.as-link", { onclick: logout }, "Odhlásit se"));
  } else {
    links.push(link("/login.html", "Přihlásit se", "login"));
  }

  host.replaceChildren(
    el("a.brand", { href: "/" }, el("span.brand-mark", {}, "♞"), el("span", {}, "Šachy na Smetance")),
    el("nav.nav-links", {}, ...links),
  );

  if (me) mountAnnounce();   // kid tournament invite banner (no-op for staff)
}
