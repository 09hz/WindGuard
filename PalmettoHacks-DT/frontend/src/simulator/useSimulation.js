import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_GRID,
  DEFAULT_WEATHER,
  defaultLayout,
  initialState,
  step,
} from "./engine.js";

export const SPEEDS = [
  { label: "1 min/s", hoursPerSecond: 1 / 60 },
  { label: "10 min/s", hoursPerSecond: 1 / 6 },
  { label: "1 hr/s", hoursPerSecond: 1 },
];

// Drives the engine from requestAnimationFrame. The simulation state lives in a
// ref so edits made while it runs (drags, sliders) apply on the very next frame.
export function useSimulation() {
  const [snapshot, setSnapshot] = useState(() => initialState());
  const [weather, setWeather] = useState(DEFAULT_WEATHER);
  const [grid, setGrid] = useState(DEFAULT_GRID);
  const [running, setRunning] = useState(true);
  const [speedIndex, setSpeedIndex] = useState(1);

  const stateRef = useRef(snapshot);
  const weatherRef = useRef(weather);
  const gridRef = useRef(grid);
  weatherRef.current = weather;
  gridRef.current = grid;

  const commit = useCallback((next) => {
    stateRef.current = next;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    let frame;
    let last = performance.now();
    const tick = (now) => {
      // Cap the frame gap so a backgrounded tab doesn't jump hours ahead.
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      const dtHours = seconds * SPEEDS[speedIndex].hoursPerSecond;
      if (dtHours > 0) commit(step(stateRef.current, weatherRef.current, gridRef.current, dtHours));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, speedIndex, commit]);

  const updateTurbines = useCallback(
    (update) => {
      const current = stateRef.current;
      const turbines = update(current.turbines);
      // Recompute readings immediately so a paused sim still reflects edits.
      commit(step({ ...current, turbines }, weatherRef.current, gridRef.current, 1e-6));
    },
    [commit],
  );

  const moveTurbine = useCallback(
    (id, x, y) => updateTurbines((turbines) => turbines.map((t) => (t.id === id ? { ...t, x, y } : t))),
    [updateTurbines],
  );

  const editTurbine = useCallback(
    (id, changes) =>
      updateTurbines((turbines) => turbines.map((t) => (t.id === id ? { ...t, ...changes } : t))),
    [updateTurbines],
  );

  const reset = useCallback(
    (turbines = defaultLayout()) => commit(step(initialState(turbines), weatherRef.current, gridRef.current, 1e-6)),
    [commit],
  );

  return {
    snapshot,
    weather,
    setWeather,
    grid,
    setGrid,
    running,
    setRunning,
    speedIndex,
    setSpeedIndex,
    moveTurbine,
    editTurbine,
    reset,
  };
}
