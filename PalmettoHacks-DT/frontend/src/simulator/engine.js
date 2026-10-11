// Pure simulation step for the turbine simulator tab. Power and risk come from
// the same model as the dashboard (src/standalone/twinEngine.js); this file adds
// time stepping, turbulence, a Jensen wake model, and live grid dispatch.

import { failureRisk, powerFromWind } from "../standalone/twinEngine.js";
import { QNX_ZONE } from "./qnx/hardware.js";
import { readQnxTelemetry } from "./qnx/telemetry.js";

export const FIELD = { width: 3200, height: 1400 }; // metres
export const FARM_WIDTH = 2400; // the QNX hardware zone fills the rest
export const ROTOR_DIAMETER_M = 120;
const ROTOR_RADIUS_M = ROTOR_DIAMETER_M / 2;
const WAKE_DECAY = 0.075; // Jensen wake expansion constant for onshore sites
const RATED_WIND_M_S = 12;
const TRIP_RISK = 0.9; // protective shutdown threshold
const ICING_DERATE = 0.75;
const HISTORY_LENGTH = 144;

export const WEATHER_PRESETS = {
  calm: { label: "Calm", windSpeed: 4, gustFactor: 1.1, turbulence: 0.05 },
  breezy: { label: "Breezy", windSpeed: 9, gustFactor: 1.25, turbulence: 0.1 },
  strong: { label: "Strong", windSpeed: 14, gustFactor: 1.3, turbulence: 0.15 },
  storm: { label: "Storm", windSpeed: 22, gustFactor: 1.45, turbulence: 0.25 },
  hurricane: { label: "Hurricane", windSpeed: 33, gustFactor: 1.6, turbulence: 0.35 },
};

export const DEFAULT_WEATHER = {
  ...WEATHER_PRESETS.breezy,
  direction: 270, // degrees the wind blows FROM (270 = westerly)
  temperature: 18,
};

export const DEFAULT_GRID = {
  exportLimit: 20,
  batteryEnabled: true,
  batteryCapacity: 20,
  batteryRate: 5,
  batteryEfficiency: 0.9,
};

export function makeTurbine(x, y, existing = [], overrides = {}) {
  const used = new Set(existing.map((turbine) => turbine.id));
  let number = 1;
  while (used.has(`T-${String(number).padStart(2, "0")}`)) number += 1;
  const id = `T-${String(number).padStart(2, "0")}`;
  return {
    id,
    x,
    y,
    ratedPower: 4.2,
    vibration: 2.5,
    bearingTemp: 64,
    daysSinceMaintenance: 90,
    fault: false,
    tripped: false,
    kind: "farm",
    ...overrides,
  };
}

export function defaultLayout() {
  // Two staggered rows about 5 rotor diameters apart along the westerly wind.
  const positions = [
    [350, 420], [1000, 470], [1650, 420], [2200, 470],
    [350, 980], [1000, 930], [1650, 980],
  ];
  const layout = [];
  for (const [x, y] of positions) layout.push(makeTurbine(x, y, layout));
  layout[2].vibration = 6.8;
  layout[2].bearingTemp = 84;
  layout[2].daysSinceMaintenance = 300;
  layout[5].daysSinceMaintenance = 240;
  return layout;
}

// The three physical bench turbines wired to the QNX base. They never respond to
// the weather, wakes or grid; their readings come from qnx/telemetry.js.
export function qnxLayout() {
  return [330, 700, 1070].map((y, index) => ({
    id: `Q-0${index + 1}`,
    kind: "qnx",
    x: QNX_ZONE.x + 210,
    y,
  }));
}

export const isQnx = (turbine) => turbine.kind === "qnx";

export function initialState(turbines = [...defaultLayout(), ...qnxLayout()]) {
  return {
    simHours: 0,
    gustNoise: 0,
    turbulenceNoise: 0,
    batterySoc: 10,
    energyMwh: 0,
    curtailedMwh: 0,
    wakeLossMwh: 0,
    energyAtRiskMwh: 0,
    turbines,
    readings: {},
    farm: { gross: 0, export: 0, charge: 0, curtailed: 0, freeStream: 0, wind: 0, gust: 0 },
    history: [],
    events: [],
  };
}

// Unit vector the air flows toward, for a meteorological "from" direction.
export function flowVector(directionDeg) {
  const radians = ((directionDeg + 180) * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

function thrustCoefficient(wind) {
  if (wind <= RATED_WIND_M_S) return 0.8;
  return Math.max(0.1, 0.8 * (RATED_WIND_M_S / wind) ** 2);
}

// Jensen (Park) wake model with root-sum-square superposition. Returns the
// fractional velocity deficit at each turbine.
export function wakeDeficits(turbines, wind, directionDeg) {
  const flow = flowVector(directionDeg);
  const ct = thrustCoefficient(wind);
  const initialDeficit = 1 - Math.sqrt(1 - ct);
  return turbines.map((target) => {
    let sumSquares = 0;
    for (const source of turbines) {
      if (source === target || source.fault || source.tripped) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const downstream = dx * flow.x + dy * flow.y;
      if (downstream <= 0) continue;
      const crosswind = Math.abs(dx * flow.y - dy * flow.x);
      const wakeRadius = ROTOR_RADIUS_M + WAKE_DECAY * downstream;
      const overlap = Math.min(
        1,
        Math.max(0, (wakeRadius + ROTOR_RADIUS_M - crosswind) / (2 * ROTOR_RADIUS_M)),
      );
      if (overlap === 0) continue;
      const deficit = initialDeficit * (ROTOR_RADIUS_M / wakeRadius) ** 2 * overlap;
      sumSquares += deficit ** 2;
    }
    return Math.min(1, Math.sqrt(sumSquares));
  });
}

// Mean-reverting noise so wind wanders smoothly instead of jittering.
function wander(value, dtHours, random) {
  const reversion = Math.exp(-dtHours * 6);
  const shock = (random() * 2 - 1) * Math.sqrt(1 - reversion ** 2);
  return value * reversion + shock;
}

export function rotorRpm(power, ratedPower) {
  if (power <= 0) return 0;
  return 6 + 8 * Math.min(1, power / ratedPower);
}

export function step(state, weather, grid, dtHours, random = Math.random) {
  const turbulenceNoise = wander(state.turbulenceNoise, dtHours, random);
  const gustNoise = wander(state.gustNoise, dtHours, random);
  const wind = Math.max(0, weather.windSpeed * (1 + weather.turbulence * turbulenceNoise));
  const gust = Math.max(wind, weather.windSpeed * weather.gustFactor * (1 + 0.5 * weather.turbulence * gustNoise));
  const icing = weather.temperature <= 0;
  const farmTurbines = state.turbines.filter((turbine) => !isQnx(turbine));
  const deficits = wakeDeficits(farmTurbines, wind, weather.direction);
  const deficitById = Object.fromEntries(farmTurbines.map((turbine, index) => [turbine.id, deficits[index]]));

  const events = [];
  const readings = {};
  let gross = 0;
  let freeStream = 0;
  let atRisk = 0;
  let qnxIndex = 0;
  const turbines = state.turbines.map((turbine) => {
    if (isQnx(turbine)) {
      readings[turbine.id] = readQnxTelemetry(qnxIndex++, state.simHours);
      return turbine;
    }
    const effectiveWind = wind * (1 - deficitById[turbine.id]);
    const derate = icing ? ICING_DERATE : 1;
    const offline = turbine.fault || turbine.tripped;
    const power = offline ? 0 : powerFromWind(effectiveWind, turbine.ratedPower) * derate;
    const unwaked = offline ? 0 : powerFromWind(wind, turbine.ratedPower) * derate;
    const load = power / turbine.ratedPower;

    // Live condition: turbulence and gusts shake the drivetrain, load heats bearings.
    const liveVibration =
      turbine.vibration * (1 + 1.5 * weather.turbulence + 0.4 * Math.max(0, gust - 20) / 10);
    const liveBearingTemp = turbine.bearingTemp + 10 * load + (icing ? -4 : 0);
    const risk = turbine.fault
      ? 1
      : failureRisk(
          {
            vibration_mm_s: liveVibration,
            bearing_temperature_c: liveBearingTemp,
            rotor_rpm: rotorRpm(power, turbine.ratedPower),
            days_since_maintenance: turbine.daysSinceMaintenance,
          },
          [{ gust_speed_m_s: gust }],
        ).failure_risk;

    let tripped = turbine.tripped;
    if (!tripped && !turbine.fault && risk >= TRIP_RISK) {
      tripped = true;
      events.push({ at: state.simHours, turbineId: turbine.id, text: `${turbine.id} tripped offline at ${Math.round(risk * 100)}% risk` });
    }

    gross += power;
    freeStream += unwaked;
    atRisk += risk * power;
    readings[turbine.id] = {
      effectiveWind,
      wakeDeficit: deficitById[turbine.id],
      power,
      risk,
      liveVibration,
      liveBearingTemp,
      rpm: rotorRpm(power, turbine.ratedPower),
    };
    return tripped === turbine.tripped ? turbine : { ...turbine, tripped };
  });

  // Same dispatch order as the dashboard: charge the battery, then curtail.
  const overload = Math.max(0, gross - grid.exportLimit);
  let charge = 0;
  let batterySoc = state.batterySoc;
  if (grid.batteryEnabled && overload > 0) {
    const efficiency = Math.sqrt(grid.batteryEfficiency);
    const room = (grid.batteryCapacity - batterySoc) / efficiency / dtHours;
    charge = Math.max(0, Math.min(overload, grid.batteryRate, room));
    batterySoc = Math.min(grid.batteryCapacity, batterySoc + charge * efficiency * dtHours);
  }
  const curtailed = Math.max(0, overload - charge);
  const exported = gross - charge - curtailed;
  const simHours = state.simHours + dtHours;

  const farm = { gross, export: exported, charge, curtailed, freeStream, wind, gust };
  // Zero-length steps only refresh readings after an edit; keep them off the chart.
  const history =
    dtHours < 1e-4
      ? state.history
      : [...state.history, { t: simHours, gross, export: exported, limit: grid.exportLimit, wind }].slice(
          -HISTORY_LENGTH,
        );

  return {
    ...state,
    simHours,
    turbulenceNoise,
    gustNoise,
    batterySoc,
    energyMwh: state.energyMwh + exported * dtHours,
    curtailedMwh: state.curtailedMwh + curtailed * dtHours,
    wakeLossMwh: state.wakeLossMwh + Math.max(0, freeStream - gross) * dtHours,
    energyAtRiskMwh: state.energyAtRiskMwh + atRisk * dtHours,
    turbines,
    readings,
    farm,
    history,
    events: [...events, ...state.events].slice(0, 6),
  };
}
