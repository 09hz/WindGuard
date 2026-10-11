// Status reported by the QNX base itself. Turbine sensor readings come from the
// simulation engine; these link and loop figures are synthetic for now. To show
// the real rig, replace them with values streamed from the base (for example
// over a WebSocket) and keep the same return shapes.

import { CONTROL_LOOP_HZ } from "./hardware.js";

const wobble = (t, rate, phase) => Math.sin(t * rate + phase);

// Round-trip time on one turbine's sensor cable.
export function linkLatencyMs(index, simHours) {
  return 1.8 + 0.4 * index + 0.15 * wobble(simHours * 60, 3.7, index * 1.7);
}

// Real-time loop health reported by the base controller.
export function readBaseStatus(simHours, nodesOnline) {
  const t = simHours * 60;
  return {
    deadlineMs: 1000 / CONTROL_LOOP_HZ,
    jitterUs: 42 + 9 * Math.abs(wobble(t, 2.9, 0.3)),
    worstCaseMs: 2.9 + 0.2 * Math.abs(wobble(t, 1.1, 1.2)),
    missedDeadlines: 0,
    nodesOnline,
    cycles: Math.floor(simHours * 3600 * CONTROL_LOOP_HZ),
  };
}
