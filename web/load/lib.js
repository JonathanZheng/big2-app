// Shared workload for the k6 load tests in this folder. Each run needs a
// running app and the Supabase it uses (a local Supabase is fine):
//
//   APP=http://localhost:3123 SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... \
//   SUPABASE_SECRET_KEY=... k6 run load/spike.js
//
// setup() creates test players through the Supabase admin API, so never point
// this at the live project.
import http from "k6/http";
import { check, sleep } from "k6";

const APP = __ENV.APP || "http://localhost:3123";
const SUPABASE_URL = __ENV.SUPABASE_URL;
const PUBLISHABLE = __ENV.SUPABASE_PUBLISHABLE_KEY;
const SECRET = __ENV.SUPABASE_SECRET_KEY;

// 409 is the server correctly refusing a race or an early timeout, not a failure.
http.setResponseCallback(http.expectedStatuses(200, 409));

const json = { "Content-Type": "application/json" };

/** Create `count` signed-in players with display names. Runs once, in setup(). */
export function createPlayers(count) {
  if (!SUPABASE_URL || !PUBLISHABLE || !SECRET) throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.");
  const run = `${Date.now()}`;
  const players = [];
  for (let start = 0; start < count; start += 25) {
    const batch = [];
    for (let i = start; i < Math.min(start + 25, count); i++) {
      batch.push({ email: `load-${run}-${i}@example.test`, password: `pw-${run}-${i}` });
    }
    const created = http.batch(batch.map((p) => ["POST", `${SUPABASE_URL}/auth/v1/admin/users`,
      JSON.stringify({ ...p, email_confirm: true }),
      { headers: { ...json, apikey: SECRET, Authorization: `Bearer ${SECRET}` }, tags: { name: "setup" } }]));
    created.forEach((r) => { if (r.status !== 200) throw new Error(`Could not create a player: ${r.status} ${r.body}`); });
    const signed = http.batch(batch.map((p) => ["POST", `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      JSON.stringify(p), { headers: { ...json, apikey: PUBLISHABLE }, tags: { name: "setup" } }]));
    signed.forEach((r, i) => {
      if (r.status !== 200) throw new Error(`Could not sign in a player: ${r.status} ${r.body}`);
      players.push({ token: r.json("access_token"), name: `Load ${start + i}` });
    });
  }
  const named = http.batch(players.map((p) => ["POST", `${APP}/api/online`, JSON.stringify({ action: "name", name: p.name }),
    { headers: { ...json, Authorization: `Bearer ${p.token}` }, tags: { name: "setup" } }]));
  named.forEach((r) => { if (r.status !== 200) throw new Error(`Could not name a player: ${r.status} ${r.body}`); });
  return players;
}

function post(path, player, body) {
  const res = http.post(`${APP}${path}`, JSON.stringify(body), {
    headers: { ...json, Authorization: `Bearer ${player.token}` },
    tags: { name: `${path.split("/").pop()}:${body.action}` },
  });
  check(res, { [`${body.action} answered`]: (r) => r.status === 200 || r.status === 409 });
  return res;
}

const game = (at) => ({ at, difficulty: "easy", won: at % 2 === 0, cardsLeft: at % 13, plays: [1, 2], suits: [1, 0, 0, 1], hints: 0 });

/**
 * One visit by two friends: they sync their history, open a room, play with
 * bots in the empty seats, and keep checking in, as the online screen does.
 */
export function visit(players) {
  const pair = (__VU - 1) % Math.floor(players.length / 2);
  const host = players[pair * 2];
  const guest = players[pair * 2 + 1];

  post("/api/history", host, { action: "load" });
  post("/api/history", host, { action: "merge", bundle: { games: [game(Date.now())] } });

  const created = post("/api/online", host, {
    action: "create", difficulty: __ITER % 2 ? "medium" : "easy", games: 1, hints: false, turnSeconds: 30,
  });
  if (created.status !== 200) return;
  const { id, code } = created.json();
  post("/api/online", guest, { action: "join", code });
  post("/api/online", host, { action: "start", roomId: id });
  for (let beat = 0; beat < 3; beat++) {
    sleep(0.5);
    post("/api/online", host, { action: "heartbeat", roomId: id });
    post("/api/online", guest, { action: "heartbeat", roomId: id });
  }
  post("/api/online", guest, { action: "timeout", roomId: id }); // too early: expect 409
  post("/api/history", guest, { action: "load" });
  sleep(1);
}
