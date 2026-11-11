// Many players at once: ramps up to VUS pairs of friends, holds, and checks
// that nothing fails and answers stay quick. See lib.js for how to run it.
import { createPlayers, visit } from "./lib.js";

const VUS = Number(__ENV.VUS || 10);
const HOLD = __ENV.HOLD || "1m";

export const options = {
  setupTimeout: "5m",
  scenarios: {
    concurrency: {
      executor: "ramping-vus",
      exec: "run",
      stages: [{ duration: "20s", target: VUS }, { duration: HOLD, target: VUS }, { duration: "10s", target: 0 }],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    "http_req_duration{name:online:create}": ["p(95)<2000"],
    "http_req_duration{name:online:heartbeat}": ["p(95)<1500"],
    "http_req_duration{name:history:merge}": ["p(95)<2000"],
  },
};

export const setup = () => ({ players: createPlayers(VUS * 2) });
export const run = ({ players }) => visit(players);
