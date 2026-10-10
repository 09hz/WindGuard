// Browser port of backend/services/twin_engine.py so the dashboard can run
// without the FastAPI server. Keep the two implementations in sync.

const CUT_IN_WIND_SPEED_M_S = 3.0;
const RATED_WIND_SPEED_M_S = 12.0;
const CUT_OUT_WIND_SPEED_M_S = 25.0;
const INSPECT_NOW_RISK_THRESHOLD = 0.7;
export const DATA_STATUS = "SIMULATED DEMO DATA";
export const DISCLAIMER =
  "Prototype results use simulated operational data and are not safety or dispatch instructions.";

const RISK_WEIGHTS = {
  vibration: 0.4,
  bearing_temperature: 0.3,
  maintenance_age: 0.2,
  gust_severity: 0.1,
};

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const clamp = (value) => Math.min(1, Math.max(0, value));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const percent = (value) => `${Math.round(value * 100)}%`;

function number(value, field, minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${field} must be finite and at least ${minimum}.`);
  }
  return value;
}

function requiredNumber(record, field, minimum = 0) {
  if (!(field in record)) throw new Error(`Missing required field: ${field}.`);
  return number(record[field], field, minimum);
}

export function powerFromWind(windSpeed, ratedPower) {
  if (windSpeed < CUT_IN_WIND_SPEED_M_S || windSpeed >= CUT_OUT_WIND_SPEED_M_S) return 0;
  if (windSpeed >= RATED_WIND_SPEED_M_S) return ratedPower;
  const cutInCubed = CUT_IN_WIND_SPEED_M_S ** 3;
  const ratedCubed = RATED_WIND_SPEED_M_S ** 3;
  return ratedPower * ((windSpeed ** 3 - cutInCubed) / (ratedCubed - cutInCubed));
}

function failureRisk(turbine, forecast) {
  const vibration = requiredNumber(turbine, "vibration_mm_s");
  const temperature = requiredNumber(turbine, "bearing_temperature_c");
  const rotorRpm = requiredNumber(turbine, "rotor_rpm");
  const maintenanceAge = requiredNumber(turbine, "days_since_maintenance");
  const maximumGust = Math.max(...forecast.map((hour) => hour.gust_speed_m_s));
  const severity = {
    vibration: clamp(vibration / 10),
    bearing_temperature: clamp((temperature - 60) / 40),
    maintenance_age: clamp(maintenanceAge / 365),
    gust_severity: clamp(maximumGust / CUT_OUT_WIND_SPEED_M_S),
  };
  const weighted = Object.fromEntries(
    Object.entries(severity).map(([name, score]) => [name, round6(score * RISK_WEIGHTS[name])]),
  );
  return {
    failure_risk: round6(clamp(sum(Object.values(weighted)))),
    risk_components: severity,
    weighted_risk_components: weighted,
    rotor_rpm: rotorRpm,
    explanation:
      `Illustrative weighted score: vibration ${percent(severity.vibration)}, ` +
      `bearing temperature ${percent(severity.bearing_temperature)}, ` +
      `maintenance age ${percent(severity.maintenance_age)}, and ` +
      `maximum forecast gust ${percent(severity.gust_severity)}. ` +
      "Rotor RPM is shown as context and is not weighted.",
  };
}

export function runTwin(turbines, hourlyForecast, gridExportCapacity, battery) {
  if (!turbines.length) throw new Error("turbines must contain at least one turbine.");
  if (!hourlyForecast.length) throw new Error("hourly_forecast must contain at least one hour.");
  const forecast = hourlyForecast.map((hour) => ({
    ...hour,
    wind_speed_m_s: requiredNumber(hour, "wind_speed_m_s"),
    gust_speed_m_s: requiredNumber(hour, "gust_speed_m_s"),
  }));
  const gridCapacity = number(gridExportCapacity, "grid_export_capacity_mw");
  if (gridCapacity <= 0) throw new Error("grid_export_capacity_mw must be greater than zero.");

  const turbineResults = [];
  const hourlyTurbinePower = forecast.map(() => []);
  turbines.forEach((turbine, index) => {
    const turbineId = turbine.id ?? `WT-${String(index + 1).padStart(2, "0")}`;
    const ratedPower = requiredNumber(turbine, "rated_power_mw");
    const risk = failureRisk(turbine, forecast);
    const hourlyPower = forecast.map((hour) => powerFromWind(hour.wind_speed_m_s, ratedPower));
    hourlyPower.forEach((power, hourIndex) => hourlyTurbinePower[hourIndex].push(power));
    const expectedEnergy = sum(hourlyPower);
    turbineResults.push({
      id: turbineId,
      name: turbine.name ?? turbineId,
      rated_power_mw: ratedPower,
      rotor_rpm: risk.rotor_rpm,
      failure_risk: risk.failure_risk,
      risk_components: risk.risk_components,
      weighted_risk_components: risk.weighted_risk_components,
      risk_explanation: risk.explanation,
      expected_energy_mwh: round6(expectedEnergy),
      energy_at_risk_mwh: round6(risk.failure_risk * expectedEnergy),
      hourly_generation_mw: hourlyPower.map(round6),
      recommendation:
        risk.failure_risk >= INSPECT_NOW_RISK_THRESHOLD
          ? "inspect now"
          : "schedule maintenance during the lowest-generation window",
    });
  });

  const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const ranked = [...turbineResults].sort(
    (left, right) => right.energy_at_risk_mwh - left.energy_at_risk_mwh || byId(left, right),
  );
  ranked.forEach((result, index) => {
    result.energy_at_risk_rank = index + 1;
  });

  const farmGeneration = hourlyTurbinePower.map(sum);
  let maintenanceIndex = 0;
  farmGeneration.forEach((generation, index) => {
    if (generation < farmGeneration[maintenanceIndex]) maintenanceIndex = index;
  });

  const batteryEnabled = Boolean(battery?.enabled);
  const capacity = battery?.capacity_mwh ?? 0;
  let stateOfCharge = battery?.state_of_charge_mwh ?? 0;
  const maxChargeRate = battery?.max_charge_rate_mw ?? 0;
  const chargeEfficiency = Math.sqrt(battery?.round_trip_efficiency ?? 1);
  const curtailmentOrder = [...turbineResults.keys()].sort(
    (left, right) =>
      turbineResults[left].energy_at_risk_mwh - turbineResults[right].energy_at_risk_mwh ||
      byId(turbineResults[left], turbineResults[right]),
  );

  const dispatch = forecast.map((hour, hourIndex) => {
    const turbinePowers = hourlyTurbinePower[hourIndex];
    const grossGeneration = farmGeneration[hourIndex];
    const overload = Math.max(0, grossGeneration - gridCapacity);
    let chargePower = 0;
    if (batteryEnabled && overload > 0) {
      const roomForChargeInput = (capacity - stateOfCharge) / chargeEfficiency;
      chargePower = Math.min(overload, maxChargeRate, roomForChargeInput);
      stateOfCharge += chargePower * chargeEfficiency;
    }

    let remainingOverload = Math.max(0, overload - chargePower);
    const curtailed = [];
    if (remainingOverload > 0) {
      for (const turbineIndex of curtailmentOrder) {
        const curtailedPower = Math.min(turbinePowers[turbineIndex], remainingOverload);
        if (curtailedPower > 0) {
          curtailed.push({
            turbine_id: turbineResults[turbineIndex].id,
            curtailed_mw: round6(curtailedPower),
            reason: "lowest energy-at-risk priority curtailed first",
          });
          remainingOverload -= curtailedPower;
        }
        if (remainingOverload <= 1e-9) break;
      }
    }

    const curtailedTotal = sum(curtailed.map((item) => item.curtailed_mw));
    return {
      timestamp_utc: hour.timestamp_utc ?? null,
      hour_index: hourIndex,
      gross_generation_mw: round6(grossGeneration),
      grid_export_capacity_mw: gridCapacity,
      battery_charge_mw: round6(chargePower),
      battery_state_of_charge_mwh: round6(stateOfCharge),
      curtailed_generation_mw: round6(curtailedTotal),
      curtailed_turbines: curtailed,
      grid_export_mw: round6(Math.max(0, grossGeneration - chargePower - curtailedTotal)),
      explanation:
        overload > 0
          ? "Battery charging absorbed overload before curtailment; remaining overload was " +
            "curtailed from lowest energy-at-risk priority turbines first."
          : "Generation is within the grid export capacity.",
    };
  });

  return {
    data_status: DATA_STATUS,
    disclaimer: DISCLAIMER,
    risk_method: {
      weights: RISK_WEIGHTS,
      normalization: {
        vibration: "clamp(vibration_mm_s / 10)",
        bearing_temperature: "clamp((bearing_temperature_c - 60) / 40)",
        maintenance_age: "clamp(days_since_maintenance / 365)",
        gust_severity: "clamp(max_forecast_gust_speed_m_s / 25)",
      },
      inspect_now_threshold: INSPECT_NOW_RISK_THRESHOLD,
    },
    energy_assumption: "Each forecast entry represents one hour; hourly MW is summed as MWh.",
    expected_energy_mwh: round6(sum(turbineResults.map((result) => result.expected_energy_mwh))),
    energy_at_risk_mwh: round6(sum(turbineResults.map((result) => result.energy_at_risk_mwh))),
    maintenance_window: {
      hour_index: maintenanceIndex,
      timestamp_utc: forecast[maintenanceIndex].timestamp_utc ?? null,
      predicted_farm_generation_mw: round6(farmGeneration[maintenanceIndex]),
      explanation: "Lowest predicted gross farm generation in the forecast.",
    },
    turbines: [...turbineResults].sort(byId),
    turbine_ranking_by_energy_at_risk: ranked.map((result) => ({
      rank: result.energy_at_risk_rank,
      turbine_id: result.id,
      energy_at_risk_mwh: result.energy_at_risk_mwh,
    })),
    dispatch,
    battery_final_state_of_charge_mwh: round6(stateOfCharge),
  };
}
