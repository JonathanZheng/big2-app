// A sudden rush, then recovery. A steady baseline runs first, then a spike of
// SPIKE_VUS pairs, well past what the local stack can serve, hits for a
// minute. The spike may fail requests but must not hang. Within 90 seconds of
// the spike ending, the same steady load must be as healthy as the baseline.
// See lib.js for how to run it.
import { createPlayers, visit } from "./lib.js";

const BASE_VUS = Number(__ENV.BASE_VUS || 5);
const SPIKE_VUS = Number(__ENV.SPIKE_VUS || 40);
const steady = (startTime, duration) => ({ executor: "constant-vus", vus: BASE_VUS, startTime, duration, exec: "run" });

export const options = {
  setupTimeout: "5m",
  scenarios: {
    baseline: steady("0s", "1m"),
    spike: {
      executor: "ramping-vus",
      startTime: "1m",
      stages: [{ duration: "10s", target: SPIKE_VUS }, { duration: "1m", target: SPIKE_VUS }, { duration: "10s", target: 0 }],
      gracefulRampDown: "10s",
      exec: "run",
    },
    // The spike ends at 2m20s. Recovery is judged from 90 seconds later.
    recovery: steady("3m50s", "2m"),
  },
  thresholds: {
    "http_req_failed{scenario:baseline}": ["rate<0.01"],
    "http_req_duration{scenario:baseline}": ["p(95)<1500"],
    "http_req_duration{scenario:spike}": ["max<10000"],
    "http_req_failed{scenario:recovery}": ["rate<0.01"],
    "http_req_duration{scenario:recovery}": ["p(95)<1500"],
    "checks{scenario:recovery}": ["rate>0.99"],
  },
};

export const setup = () => ({ players: createPlayers(SPIKE_VUS * 2) });
export const run = ({ players }) => visit(players);
