// GroupChat — one Durable Object instance per group, for that group's live chat.
// The Worker authenticates the user and verifies group membership BEFORE routing
// here, then passes the trusted identity via X-User-* headers. Recent messages
// are kept in durable storage so members see history when they open the chat.
//   client → { type: "chat", text }
//   server → { type: "history", messages } | { type: "chat", message }

const HISTORY_LIMIT = 100;

export class GroupChat {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Set();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const user = {
      id: Number(request.headers.get("X-User-Id")) || 0,
      name: decodeURIComponent(request.headers.get("X-User-Name") || "Someone"),
      role: request.headers.get("X-User-Role") || "kid",
    };

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.user = user;
    this.sockets.add(server);
    this.attach(server);

    const messages = (await this.state.storage.get("messages")) || [];
    this.send(server, { type: "history", messages });
    return new Response(null, { status: 101, webSocket: client });
  }

  attach(ws) {
    ws.addEventListener("message", (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === "chat") this.onChat(ws, msg);
    });
    const drop = () => this.sockets.delete(ws);
    ws.addEventListener("close", drop);
    ws.addEventListener("error", drop);
  }

  async onChat(ws, msg) {
    const text = String(msg.text || "").slice(0, 500).trim();
    if (!text) return;
    const entry = {
      id: crypto.randomUUID(),
      user_id: ws.user.id,
      name: ws.user.name,
      role: ws.user.role,        // "admin" | "coach" | "kid" — lets the UI flag staff
      text,
      at: Date.now(),
    };
    const messages = (await this.state.storage.get("messages")) || [];
    messages.push(entry);
    while (messages.length > HISTORY_LIMIT) messages.shift();
    await this.state.storage.put("messages", messages);
    this.broadcast({ type: "chat", message: entry });
  }

  send(ws, obj) {
    try { if (ws && ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(JSON.stringify(obj)); } catch {}
  }
  broadcast(obj) {
    for (const ws of this.sockets) this.send(ws, obj);
  }
}
