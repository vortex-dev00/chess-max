// Worker entry — routes API + websockets; static assets serve the built frontend.

import { signup, login, logout, me } from "./lib/auth.js";
import {
  listGroups, createGroup, deleteGroup, getGroup,
  addMember, removeMember, listKids, myGroups,
} from "./routes/groups.js";
import { listUsers, setRole, listPending, approveUser, rejectUser } from "./routes/users.js";
import {
  addLesson, deleteLesson, getAttendance, setAttendance, addReview, deleteReview,
} from "./routes/lessons.js";
import {
  listTasks, createTask, deleteTask, assignTask, myAssignments, getPuzzle, checkMove,
} from "./routes/tasks.js";
import { myProgress, allProgress, groupedProgress, kidProgress } from "./routes/progress.js";
import { listEvents, createEvent, deleteEvent, rsvp, unrsvp } from "./routes/events.js";
import {
  listPlayers, createChallenge, listChallenges, acceptChallenge, declineChallenge, getGame, getGameReplay, myGames,
} from "./routes/arena.js";
import {
  listTournaments, createTournament, deleteTournament, joinTournament, leaveTournament,
  startTournament, getTournament,
} from "./routes/tournaments.js";
import { notFound, error } from "./lib/response.js";
import { currentUser } from "./lib/auth.js";

export { GameRoom } from "./durable/GameRoom.js";
export { GroupChat } from "./durable/GroupChat.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Live game websocket → GameRoom Durable Object (by room code).
    if (pathname === "/ws") {
      const code = (url.searchParams.get("code") || "LOBBY").toUpperCase().slice(0, 32);
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));

      // Rated game: authenticate the player and pass their identity + colour to
      // the DO so it can seat them correctly and record the ELO result. Anyone
      // who isn't one of the two players (or who asks with ?spectate=1) watches
      // read-only.
      const gameParam = url.searchParams.get("game");
      if (gameParam) {
        const user = await currentUser(request, env);
        if (!user) return new Response("unauthorized", { status: 401 });
        if (user.status === "pending") return new Response("forbidden", { status: 403 });
        const game = await env.DB.prepare("SELECT id, white_id, black_id FROM games WHERE id = ?")
          .bind(Number(gameParam)).first();
        if (!game) return new Response("no such game", { status: 404 });
        const color = game.white_id === user.id ? "w" : game.black_id === user.id ? "b" : null;
        const headers = new Headers(request.headers);
        headers.set("X-User-Name", encodeURIComponent(user.name));
        if (color && url.searchParams.get("spectate") !== "1") {
          headers.set("X-User-Id", String(user.id));
          headers.set("X-Color", color);
          headers.set("X-Game-Id", String(game.id));
        } else {
          headers.set("X-Spectator", "1");
        }
        return stub.fetch(new Request(request, { headers }));
      }
      return stub.fetch(request);
    }

    // Group chat websocket → GroupChat Durable Object (one per group).
    // Authenticate + check membership HERE so the DO can trust the identity.
    if (pathname === "/chat") {
      const user = await currentUser(request, env);
      if (!user) return new Response("unauthorized", { status: 401 });
      const groupId = Number(url.searchParams.get("group"));
      if (!groupId) return new Response("bad group", { status: 400 });

      if (user.role === "kid") {
        const member = await env.DB.prepare(
          "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?",
        ).bind(groupId, user.id).first();
        if (!member) return new Response("forbidden", { status: 403 });
      }

      const stub = env.GROUP_CHAT.get(env.GROUP_CHAT.idFromName(`group-${groupId}`));
      const headers = new Headers(request.headers);
      headers.set("X-User-Id", String(user.id));
      headers.set("X-User-Name", encodeURIComponent(user.name));
      headers.set("X-User-Role", user.role);
      return stub.fetch(new Request(request, { headers }));
    }

    if (pathname.startsWith("/api/")) {
      // Approval gate: a signed-in but unapproved user can only touch auth
      // endpoints (to see their status / log out). Everything else is locked.
      if (!pathname.startsWith("/api/auth/")) {
        const u = await currentUser(request, env);
        if (u && u.status === "pending") return error("Your account is awaiting approval.", 403);
      }
      return (await route(pathname, request.method, request, env)) || notFound();
    }

    return env.ASSETS.fetch(request);
  },
};

async function route(pathname, method, request, env) {
  const p = pathname.split("/").filter(Boolean).slice(1); // drop "api"
  const is = (m, ...parts) =>
    method === m && p.length === parts.length && parts.every((x, i) => x === "*" || x === p[i]);
  const id = (i) => Number(p[i]);

  // auth
  if (is("POST", "auth", "signup")) return signup(request, env);
  if (is("POST", "auth", "login")) return login(request, env);
  if (is("POST", "auth", "logout")) return logout(request, env);
  if (is("GET", "auth", "me")) return me(request, env);

  // groups
  if (is("GET", "groups")) return listGroups(request, env);
  if (is("POST", "groups")) return createGroup(request, env);
  if (is("GET", "groups", "mine")) return myGroups(request, env);
  if (is("GET", "kids")) return listKids(request, env);
  if (is("GET", "groups", "*")) return getGroup(request, env, id(1));
  if (is("DELETE", "groups", "*")) return deleteGroup(request, env, id(1));
  if (is("POST", "groups", "*", "members")) return addMember(request, env, id(1));
  if (is("DELETE", "groups", "*", "members", "*")) return removeMember(request, env, id(1), id(3));

  // lessons, attendance, reviews
  if (is("POST", "groups", "*", "lessons")) return addLesson(request, env, id(1));
  if (is("DELETE", "lessons", "*")) return deleteLesson(request, env, id(1));
  if (is("GET", "lessons", "*", "attendance")) return getAttendance(request, env, id(1));
  if (is("POST", "lessons", "*", "attendance")) return setAttendance(request, env, id(1));
  if (is("POST", "groups", "*", "reviews")) return addReview(request, env, id(1));
  if (is("DELETE", "reviews", "*")) return deleteReview(request, env, id(1));

  // users & roles (admin)
  if (is("GET", "users")) return listUsers(request, env);
  if (is("POST", "users", "*", "role")) return setRole(request, env, id(1));

  // approvals (admin/coach)
  if (is("GET", "pending")) return listPending(request, env);
  if (is("POST", "users", "*", "approve")) return approveUser(request, env, id(1));
  if (is("POST", "users", "*", "reject")) return rejectUser(request, env, id(1));

  // tasks
  if (is("GET", "tasks")) return listTasks(request, env);
  if (is("POST", "tasks")) return createTask(request, env);
  if (is("DELETE", "tasks", "*")) return deleteTask(request, env, id(1));
  if (is("POST", "tasks", "assign")) return assignTask(request, env);
  if (is("GET", "tasks", "mine")) return myAssignments(request, env);
  if (is("GET", "tasks", "*", "puzzle")) return getPuzzle(request, env, id(1));
  if (is("POST", "tasks", "*", "check")) return checkMove(request, env, id(1));

  // gamification (XP, ranks, badges)
  if (is("GET", "me", "progress")) return myProgress(request, env);
  if (is("GET", "progress")) return allProgress(request, env);
  if (is("GET", "progress", "groups")) return groupedProgress(request, env);
  if (is("GET", "progress", "*")) return kidProgress(request, env, id(1));

  // events calendar
  if (is("GET", "events")) return listEvents(request, env);
  if (is("POST", "events")) return createEvent(request, env);
  if (is("DELETE", "events", "*")) return deleteEvent(request, env, id(1));
  if (is("POST", "events", "*", "rsvp")) return rsvp(request, env, id(1));
  if (is("DELETE", "events", "*", "rsvp")) return unrsvp(request, env, id(1));

  // arena: ratings, challenges, games
  if (is("GET", "players")) return listPlayers(request, env);
  if (is("GET", "challenges")) return listChallenges(request, env);
  if (is("POST", "challenges")) return createChallenge(request, env);
  if (is("POST", "challenges", "*", "accept")) return acceptChallenge(request, env, id(1));
  if (is("POST", "challenges", "*", "decline")) return declineChallenge(request, env, id(1));
  if (is("GET", "games", "mine")) return myGames(request, env);
  if (is("GET", "games", "*", "replay")) return getGameReplay(request, env, id(1));
  if (is("GET", "games", "*")) return getGame(request, env, id(1));

  // tournaments
  if (is("GET", "tournaments")) return listTournaments(request, env);
  if (is("POST", "tournaments")) return createTournament(request, env);
  if (is("GET", "tournaments", "*")) return getTournament(request, env, id(1));
  if (is("DELETE", "tournaments", "*")) return deleteTournament(request, env, id(1));
  if (is("POST", "tournaments", "*", "join")) return joinTournament(request, env, id(1));
  if (is("POST", "tournaments", "*", "leave")) return leaveTournament(request, env, id(1));
  if (is("POST", "tournaments", "*", "start")) return startTournament(request, env, id(1));

  return null;
}
