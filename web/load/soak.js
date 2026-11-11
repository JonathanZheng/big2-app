// Steady load for a long time, then a short check that the app is still as
// quick as when it was fresh: catches leaks, growing tables and connection
// pile-ups. Keep SOAK under an hour, the life of a test player's sign-in.
// See lib.js for how to run it.
import { createPlayers, visit } from "./lib.js";

const VUS = Number(__ENV.SOAK_VUS || 8);
const SOAK = __ENV.SOAK || "30m";

export const options = {
  setupTimeout: "5m",
  scenarios: {
    fresh: { executor: "constant-vus", vus: 5, duration: "1m", exec: "run" },
    soak: { executor: "constant-vus", vus: VUS, duration: SOAK, startTime: "1m", exec: "run" },
    // Starts after the soak, once its last visits have finished.
    after: { executor: "constant-vus", vus: 5, duration: "1m", startTime: `${minutes(SOAK) + 2}m`, exec: "run" },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{scenario:fresh}": ["p(95)<1500"],
    "http_req_duration{scenario:soak}": ["p(95)<2000"],
    "http_req_duration{scenario:after}": ["p(95)<1500"],
    "checks{scenario:after}": ["rate>0.99"],
  },
};

function minutes(duration) {
  const m = /^(\d+)m$/.exec(duration);
  if (!m) throw new Error("Give SOAK in whole minutes, like 30m.");
  return Number(m[1]);
}

export const setup = () => ({ players: createPlayers(VUS * 2) });
export const run = ({ players }) => visit(players);
