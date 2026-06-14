// Pure pairing helpers for the three tournament formats. Each returns a list of
// pairs [whiteOrPlayerId, opponentId | null]; a null opponent means a bye.

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join("-");

/* ── Single-elimination ── */

// Standard bracket seed order for a power-of-two size (1-indexed seeds → 0-indexed).
function seedOrder(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const len = seeds.length * 2 + 1;
    const round = [];
    for (const s of seeds) { round.push(s); round.push(len - s); }
    seeds = round;
  }
  return seeds.map((s) => s - 1);
}

// ids ordered by seed (index 0 = top seed). Pads to a power of two with byes.
export function knockoutRound1(ids) {
  let size = 1;
  while (size < ids.length) size *= 2;
  const padded = ids.slice();
  while (padded.length < size) padded.push(null);
  const order = seedOrder(size).map((i) => padded[i]);
  const pairs = [];
  for (let i = 0; i < order.length; i += 2) {
    // Put the real player on white when the other side is a bye.
    const [a, b] = [order[i], order[i + 1]];
    if (a == null && b != null) pairs.push([b, null]);
    else pairs.push([a, b]);
  }
  return pairs;
}

// winnerIds in slot order → next-round pairs.
export function knockoutNext(winnerIds) {
  const pairs = [];
  for (let i = 0; i < winnerIds.length; i += 2) {
    pairs.push([winnerIds[i], winnerIds[i + 1] ?? null]);
  }
  return pairs;
}

/* ── Round-robin (circle method) ── */

// Returns an array of rounds; each round is an array of [a, b] pairs.
export function roundRobinSchedule(ids) {
  const arr = ids.slice();
  if (arr.length % 2) arr.push(null);                 // odd → a bye floats around
  const n = arr.length;
  const fixed = arr[0];
  let rest = arr.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const row = [fixed, ...rest];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([row[i], row[n - 1 - i]]);
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, -1)];   // rotate
  }
  return rounds;
}

/* ── Swiss ── */

// players: [{ id, score }] sorted by score desc. playedSet: Set of pairKey()s.
// Greedy: highest scorer pairs with the next available unplayed opponent.
export function swissPairing(players, playedSet) {
  const ids = players.map((p) => p.id);
  const used = new Set();
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    if (used.has(ids[i])) continue;
    used.add(ids[i]);
    let opp = null;
    for (let j = i + 1; j < ids.length; j++) {
      if (used.has(ids[j])) continue;
      if (!playedSet.has(pairKey(ids[i], ids[j]))) { opp = ids[j]; break; }
    }
    if (opp == null) {                                  // everyone left already played → allow rematch
      for (let j = i + 1; j < ids.length; j++) if (!used.has(ids[j])) { opp = ids[j]; break; }
    }
    if (opp == null) pairs.push([ids[i], null]);        // bye
    else { used.add(opp); pairs.push([ids[i], opp]); }
  }
  return pairs;
}

export const recommendedSwissRounds = (n) => Math.max(3, Math.ceil(Math.log2(Math.max(2, n))));
