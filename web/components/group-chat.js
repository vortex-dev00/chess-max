// Reusable group chat: connects to the GroupChat Durable Object over a WebSocket
// and renders a live message log. Coach/admin messages are flagged so they stand
// out. Mount into a container; call .close() to drop the connection.
//
//   const chat = mountGroupChat(container, groupId, me);
//   chat.close();   // when the panel is hidden / group switched

import { el } from "./dom.js";

const STAFF = new Set(["admin", "coach"]);
const ROLE_LABEL = { kid: "dítě", coach: "trenér", admin: "administrátor" };

export function mountGroupChat(container, groupId, me) {
  const log = el("div.chat-log", {}, el("div.sys", {}, "Připojování…"));
  const input = el("input", { class: "grow", placeholder: "Napiš zprávu své skupině…", maxlength: "500" });
  const sendBtn = el("button.btn.primary.sm", { type: "button" }, "Odeslat");
  let closed = false;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/chat?group=${groupId}`);

  ws.addEventListener("open", () => { if (!closed) log.replaceChildren(el("div.sys", {}, "Zatím žádné zprávy. Pozdrav ostatní!")); });
  ws.addEventListener("close", () => { if (!closed) appendSys("Odpojeno."); });
  ws.addEventListener("error", () => { if (!closed) appendSys("Problém s připojením."); });
  ws.addEventListener("message", (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "history") {
      log.replaceChildren(...(msg.messages.length
        ? msg.messages.map(line) : [el("div.sys", {}, "Zatím žádné zprávy. Pozdrav ostatní!")]));
      scroll();
    } else if (msg.type === "chat") {
      // drop the "no messages yet" placeholder before the first real message
      const only = log.children.length === 1 && log.firstChild.classList?.contains("sys");
      if (only) log.replaceChildren();
      log.append(line(msg.message));
      scroll();
    }
  });

  function line(m) {
    const mine = m.user_id === me?.id;
    const staff = STAFF.has(m.role);
    const time = m.at ? new Date(m.at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }) : "";
    const node = el("div", { class: `chat-msg${staff ? " staff" : ""}${mine ? " mine" : ""}` },
      el("span.chat-who", {},
        el("b", {}, mine ? "Ty" : m.name),
        staff ? el("span.chat-badge", {}, ROLE_LABEL[m.role] || m.role) : "",
        time ? el("span.chat-time", {}, time) : ""),
      el("span.chat-text", {}, m.text));
    return node;
  }
  function appendSys(text) { log.append(el("div.sys", {}, text)); scroll(); }
  function scroll() { log.scrollTop = log.scrollHeight; }

  function send() {
    const text = input.value.trim();
    if (!text || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", text }));
    input.value = "";
    input.focus();
  }
  sendBtn.onclick = send;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });

  container.replaceChildren(
    el("div.chat", {}, log, el("div.row", { style: "flex-wrap:nowrap" }, input, sendBtn)),
  );

  return {
    close() {
      closed = true;
      try { ws.close(); } catch {}
    },
  };
}
