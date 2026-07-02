// Renders the gamified-progress UI from /api/me/progress: a rank + XP bar and a
// grid of collectible badges (earned ones lit, locked ones show progress).

import { el } from "./dom.js";

export function progressCard(p) {
  const lvl = p.level;
  const pct = lvl.next ? Math.max(4, Math.round(((lvl.points - lvl.floor) / (lvl.next - lvl.floor)) * 100)) : 100;
  const nextLine = lvl.next
    ? el("div.subtle", { style: "margin-top:6px" }, `${lvl.points} XP · ${lvl.next - lvl.points} XP do úrovně ${lvl.nextName}`)
    : el("div.subtle", { style: "margin-top:6px" }, `${lvl.points} XP · nejvyšší úroveň dosažena! 👑`);

  return el("div", {},
    el("div.spread", {},
      el("div", { style: "display:flex; align-items:center; gap:10px" },
        el("span.rank", {}, `Úr. ${lvl.num}`),
        el("strong", { style: "font-size:19px" }, lvl.name)),
      el("span.tag.good", {}, `vyřešeno ${p.solved}`)),
    el("div.xp-bar", { style: "margin-top:10px" }, el("div.xp-fill", { style: `width:${pct}%` })),
    nextLine,
    el("div.badge-grid", { style: "margin-top:16px" }, ...p.badges.map(badgeTile)),
  );
}

export function badgeTile(b) {
  return el("div", { class: `badge${b.earned ? " earned" : " locked"}`, title: b.desc },
    el("div.badge-icon", {}, b.icon),
    el("div.badge-name", {}, b.name),
    el("div.badge-prog", {}, b.earned ? "✓ získáno" : `${b.cur}/${b.target}`));
}
