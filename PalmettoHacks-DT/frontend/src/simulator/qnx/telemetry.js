// Readings for the QNX bench turbines. These are synthetic for now: steady,
// fan-driven values with a little drift so the display looks live. To show the
// real rig, replace readQnxTelemetry with values streamed from the QNX base
// (for example over a WebSocket) and keep the same return shape.

import { CONTROL_LOOP_HZ } from "./hardware.js";

// Per-turbine personality so the three rigs don't read identically.
const PROFILES = [
  { wind: 5.8, rpm: 420, vibration: 1.6, temp: 31, watts: 3.1 },
  { wind: 5.5, rpm: 395, vibration: 2.3, temp: 34, watts: 2.7 },
  { wind: 5.9, rpm: 410, vibration: 3.6, temp: 39, watts: 2.9 },
];

const wobble = (t, rate, phase) => Math.sin(t * rate + phase);

export function readQnxTelemetry(index, simHours) {
  const profile = PROFILES[index % PROFILES.length];
  const t = simHours * 60; // drift on a minutes timescale
  const phase = index * 1.7;
  const wind = profile.wind + 0.25 * wobble(t, 0.9, phase);
  const rpm = profile.rpm + 12 * wobble(t, 1.3, phase + 0.4);
  return {
    sensors: {
      vibration: profile.vibration + 0.2 * wobble(t, 2.1, phase + 1),
      bearingTemp: profile.temp + 0.6 * wobble(t, 0.3, phase + 2),
      rpm,
      wind,
    },
    watts: profile.watts * (rpm / profile.rpm) ** 3,
    latencyMs: 1.8 + 0.4 * index + 0.15 * wobble(t, 3.7, phase),
  };
}

// Real-time loop health reported by the base controller.
export function readBaseStatus(simHours, nodeCount) {
  const t = simHours * 60;
  return {
    deadlineMs: 1000 / CONTROL_LOOP_HZ,
    jitterUs: 42 + 9 * Math.abs(wobble(t, 2.9, 0.3)),
    worstCaseMs: 2.9 + 0.2 * Math.abs(wobble(t, 1.1, 1.2)),
    missedDeadlines: 0,
    nodesOnline: nodeCount,
    cycles: Math.floor(simHours * 3600 * CONTROL_LOOP_HZ),
  };
}
