// GameRoom — one Durable Object instance per live game room.
// Server-authoritative move validation via chess.js. Wire protocol:
//   client → { type: create|join|move|resign|rematch|chat, ... }
//   server → { type: state|joined|info|chat|illegal, ... }

import { Chess } from "chess.js";

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.chess = new Chess();
    this.names = { w: null, b: null };
    this.sockets = { w: null, b: null };
    this.spectators = new Set();
    this.resigned = null;
    this.lastMove = null;
    this.rematch = {};
    this.code = "ROOM";
    // Rated-game state (set when authenticated players connect via ?game=).
    this.rated = false;
    this.gameId = null;
    this.playerIds = { w: null, b: null };
    this.recorded = false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.code = url.searchParams.get("code") || "ROOM";
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    // The Worker has authenticated this connection for a rated game and tells
    // us who they are and which colour they hold — trust it (only we are called).
    const uid = request.headers.get("X-User-Id");
    // A signed-in viewer who isn't one of the two players watches read-only.
    if (request.headers.get("X-Spectator") === "1") {
      server._spectator = { name: decodeURIComponent(request.headers.get("X-User-Name") || "Spectator") };
    } else if (uid) {
      server._identity = {
        userId: Number(uid),
        name: decodeURIComponent(request.headers.get("X-User-Name") || "Player"),
        color: request.headers.get("X-Color") === "b" ? "b" : "w",
        gameId: Number(request.headers.get("X-Game-Id")) || null,
      };
    }
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  attach(ws) {
    ws.color = null;
    ws.addEventListener("message", (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      this.onMessage(ws, msg);
    });
    const drop = () => this.onClose(ws);
    ws.addEventListener("close", drop);
    ws.addEventListener("error", drop);
  }

  send(ws, obj) {
    try { if (ws && ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(JSON.stringify(obj)); } catch {}
  }
  broadcast(obj, except) {
    for (const ws of [this.sockets.w, this.sockets.b, ...this.spectators]) if (ws && ws !== except) this.send(ws, obj);
  }

  publicState() {
    const c = this.chess;
    let status = "active", winner = null;
    if (this.resigned) { status = "resigned"; winner = this.resigned === "w" ? "b" : "w"; }
    else if (c.isCheckmate()) { status = "checkmate"; winner = c.turn() === "w" ? "b" : "w"; }
    else if (c.isStalemate()) status = "stalemate";
    else if (c.isInsufficientMaterial()) status = "insufficient";
    else if (c.isThreefoldRepetition()) status = "threefold";
    else if (c.isDraw()) status = "draw";
    return {
      fen: c.fen(), turn: c.turn(),
      history: c.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, san: m.san, color: m.color })),
      inCheck: c.inCheck(), status, winner,
      players: { w: this.names.w, b: this.names.b }, lastMove: this.lastMove,
    };
  }
  broadcastState() {
    const s = this.publicState();
    if (this.sockets.w) this.send(this.sockets.w, { type: "state", you: "w", code: this.code, ...s });
    if (this.sockets.b) this.send(this.sockets.b, { type: "state", you: "b", code: this.code, ...s });
    for (const ws of this.spectators) this.send(ws, { type: "state", you: "spectator", code: this.code, ...s });
    if (s.status !== "active" && this.rated && !this.recorded) this.recordResult(s);
  }

  // Persist the rated result and update both players' ELO (zero-sum, K = 24).
  // Runs once per game; guarded by `recorded`.
  async recordResult(s) {
    this.recorded = true;
    const wId = this.playerIds.w, bId = this.playerIds.b;
    if (!wId || !bId || !this.gameId) return;
    try {
      const wRow = await this.env.DB.prepare("SELECT elo FROM users WHERE id = ?").bind(wId).first();
      const bRow = await this.env.DB.prepare("SELECT elo FROM users WHERE id = ?").bind(bId).first();
      if (!wRow || !bRow) return;
      const wElo = wRow.elo, bElo = bRow.elo;
      const score = s.winner === "w" ? 1 : s.winner === "b" ? 0 : 0.5;   // white's score
      const expW = 1 / (1 + Math.pow(10, (bElo - wElo) / 400));
      const K = 24;
      const wDelta = Math.round(K * (score - expW));
      const bDelta = -wDelta;                                            // zero-sum
      const wNew = wElo + wDelta, bNew = bElo + bDelta;
      const winnerStr = s.winner === "w" ? "white" : s.winner === "b" ? "black" : "draw";
      const pgn = this.chess.pgn();   // full move list, for later replay

      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE users SET elo = ? WHERE id = ?").bind(wNew, wId),
        this.env.DB.prepare("UPDATE users SET elo = ? WHERE id = ?").bind(bNew, bId),
        this.env.DB.prepare(
          `UPDATE games SET status = 'finished', winner = ?, reason = ?, white_delta = ?, black_delta = ?, pgn = ?, finished_at = ?
             WHERE id = ? AND status != 'finished'`,
        ).bind(winnerStr, s.status, wDelta, bDelta, pgn, Date.now(), this.gameId),
      ]);

      this.broadcast({
        type: "rated", winner: winnerStr,
        white: { name: this.names.w, delta: wDelta, elo: wNew },
        black: { name: this.names.b, delta: bDelta, elo: bNew },
      });
    } catch {
      this.recorded = false;   // allow a retry on the next terminal broadcast
    }
  }

  seat(ws, name) {
    // Authenticated spectator: never gets a seat, just watches and may chat.
    if (ws._spectator) {
      this.spectators.add(ws);
      ws.color = "spectator";
      ws._specName = ws._spectator.name.slice(0, 24);
      this.send(ws, { type: "joined", code: this.code, color: "spectator" });
      return;
    }
    // Rated game: the player's colour is fixed by the Worker. Seat them there
    // (replacing a stale socket on reconnect), never as a spectator.
    if (ws._identity) {
      const color = ws._identity.color;
      this.rated = true;
      this.gameId = ws._identity.gameId;
      this.sockets[color] = ws;
      ws.color = color;
      this.names[color] = ws._identity.name.slice(0, 24);
      this.playerIds[color] = ws._identity.userId;
      this.send(ws, { type: "joined", code: this.code, color, rated: true });
      this.broadcast({ type: "info", message: `${this.names[color]} joined.` }, ws);
      return;
    }
    if (!this.sockets.w) { this.sockets.w = ws; ws.color = "w"; this.names.w = (name || "White").slice(0, 24); }
    else if (!this.sockets.b) { this.sockets.b = ws; ws.color = "b"; this.names.b = (name || "Black").slice(0, 24); }
    else { this.spectators.add(ws); ws.color = "spectator"; }
    this.send(ws, { type: "joined", code: this.code, color: ws.color });
    if (ws.color !== "spectator") this.broadcast({ type: "info", message: `${this.names[ws.color]} joined.` }, ws);
  }

  onMessage(ws, msg) {
    switch (msg.type) {
      case "create":
      case "join":
        this.seat(ws, msg.name);
        this.broadcastState();
        break;
      case "move": {
        if (!ws.color || ws.color === "spectator" || this.resigned) return;
        if (this.chess.turn() !== ws.color) return;
        let r = null;
        try { r = this.chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion || "q" }); } catch {}
        if (!r) return this.send(ws, { type: "illegal", from: msg.from, to: msg.to });
        this.lastMove = { from: r.from, to: r.to };
        this.broadcastState();
        break;
      }
      case "resign":
        if (!ws.color || ws.color === "spectator" || this.resigned) return;
        this.resigned = ws.color;
        this.broadcastState();
        break;
      case "rematch": {
        if (this.rated) return;   // rated games are one-and-done; play a fresh challenge
        if (!ws.color || ws.color === "spectator") return;
        this.rematch[ws.color] = true;
        this.broadcast({ type: "info", message: `${this.names[ws.color]} wants a rematch.` });
        if (this.rematch.w && this.rematch.b) {
          const [ow, ob] = [this.sockets.w, this.sockets.b];
          const [nw, nb] = [this.names.w, this.names.b];
          this.chess = new Chess(); this.resigned = null; this.lastMove = null; this.rematch = {};
          this.sockets = { w: ob, b: ow }; this.names = { w: nb, b: nw };
          if (this.sockets.w) this.sockets.w.color = "w";
          if (this.sockets.b) this.sockets.b.color = "b";
          this.broadcast({ type: "info", message: "Rematch — sides swapped." });
          this.broadcastState();
        }
        break;
      }
      case "chat": {
        if (!ws.color) return;
        const name = ws.color === "spectator" ? (ws._specName || "Spectator") : this.names[ws.color];
        const text = String(msg.text || "").slice(0, 300).trim();
        if (text) this.broadcast({ type: "chat", name, color: ws.color, text });
        break;
      }
    }
  }

  onClose(ws) {
    if (ws.color === "w" || ws.color === "b") {
      this.sockets[ws.color] = null;
      this.broadcast({ type: "info", message: `${this.names[ws.color] || "A player"} disconnected.` });
    } else {
      this.spectators.delete(ws);
    }
  }
}
