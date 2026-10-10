// In-browser replacement for the FastAPI routes in backend/main.py. Each method
// returns the same JSON shape as the matching /api endpoint.

import turbinesFixture from "../../../data/turbines.json";
import forecastFixture from "../../../data/hourly_forecast.json";
import gridFixture from "../../../data/grid_config.json";
import batteryFixture from "../../../data/battery_config.json";
import { DATA_STATUS, DISCLAIMER, runTwin } from "./twinEngine.js";
import {
  FARM_LATITUDE,
  FARM_LONGITUDE,
  fetchNwsHourlyForecast,
  fetchWindToolkitDay,
} from "./weather.js";

const labels = { data_status: DATA_STATUS, disclaimer: DISCLAIMER };
const clone = (value) => structuredClone(value);
const percent = (value) => `${Math.round(value * 100)}%`;

async function calculate({
  weatherSource = "demo",
  windMultiplier = 1,
  exportCapacityMw,
  batteryEnabled,
} = {}) {
  const turbines = clone(turbinesFixture.turbines);
  const forecast =
    weatherSource === "nws" ? await fetchNwsHourlyForecast() : clone(forecastFixture.hours);
  const grid = clone(gridFixture.grid_interconnection);
  const battery = clone(batteryFixture.battery);

  for (const hour of forecast) {
    hour.wind_speed_m_s *= windMultiplier;
    hour.gust_speed_m_s *= windMultiplier;
  }
  if (exportCapacityMw != null) grid.export_limit_mw = exportCapacityMw;
  if (batteryEnabled != null) battery.enabled = batteryEnabled;

  const result = runTwin(turbines, forecast, grid.export_limit_mw, battery);
  result.weather_source = weatherSource;
  const byId = Object.fromEntries(turbines.map((turbine) => [turbine.id, turbine]));
  for (const calculated of result.turbines) {
    const source = byId[calculated.id];
    for (const field of [
      "latitude",
      "longitude",
      "vibration_mm_s",
      "bearing_temperature_c",
      "days_since_maintenance",
      "baseline_health_status",
    ]) {
      calculated[field] = source[field];
    }
  }
  return { result, forecast, turbines, grid, battery };
}

const peakGeneration = (dispatch) => Math.max(...dispatch.map((hour) => hour.gross_generation_mw));
const overloadHours = (dispatch, capacity) =>
  dispatch.filter((hour) => hour.gross_generation_mw > capacity).length;

function recommendations(result) {
  const items = result.turbines.map((turbine) => ({
    action: turbine.recommendation,
    turbine_id: turbine.id,
    timestamp_utc: null,
    reason:
      turbine.recommendation === "inspect now"
        ? `Illustrative failure risk is ${percent(turbine.failure_risk)}, at or above the inspect-now threshold.`
        : `Risk is below the inspect-now threshold; use the lowest-generation window at ${result.maintenance_window.timestamp_utc}.`,
    details: {
      failure_risk: turbine.failure_risk,
      energy_at_risk_mwh: turbine.energy_at_risk_mwh,
      energy_at_risk_rank: turbine.energy_at_risk_rank,
    },
  }));
  for (const hour of result.dispatch) {
    if (hour.battery_charge_mw > 0) {
      items.push({
        action: "use battery storage",
        turbine_id: null,
        timestamp_utc: hour.timestamp_utc,
        reason: "Charge the enabled battery to absorb grid export overload first.",
        details: { charge_mw: hour.battery_charge_mw },
      });
    }
    for (const curtailed of hour.curtailed_turbines) {
      items.push({
        action: "curtail low-priority turbine",
        turbine_id: curtailed.turbine_id,
        timestamp_utc: hour.timestamp_utc,
        reason: curtailed.reason,
        details: { curtailed_mw: curtailed.curtailed_mw },
      });
    }
  }
  return items;
}

export const localApi = {
  async overview(source = "demo") {
    const { result, turbines, grid } = await calculate({ weatherSource: source });
    return {
      ...labels,
      weather_source: source,
      turbine_count: turbines.length,
      expected_energy_mwh: result.expected_energy_mwh,
      energy_at_risk_mwh: result.energy_at_risk_mwh,
      grid_export_capacity_mw: grid.export_limit_mw,
      peak_generation_mw: peakGeneration(result.dispatch),
      overload_hours: overloadHours(result.dispatch, grid.export_limit_mw),
      turbines_requiring_inspection: result.turbines.filter(
        (turbine) => turbine.recommendation === "inspect now",
      ).length,
      maintenance_window: result.maintenance_window,
    };
  },

  async turbines(source = "demo") {
    const { result } = await calculate({ weatherSource: source });
    return {
      ...labels,
      weather_source: source,
      turbines: result.turbines,
      ranking_by_energy_at_risk: result.turbine_ranking_by_energy_at_risk,
    };
  },

  async turbine(id, source = "demo") {
    const { result } = await calculate({ weatherSource: source });
    const turbine = result.turbines.find((item) => item.id === id);
    if (!turbine) throw new Error(`Unknown turbine ID: ${id}`);
    return { ...labels, weather_source: source, turbine };
  },

  async forecast(source = "demo") {
    const { result, forecast } = await calculate({ weatherSource: source });
    return {
      ...labels,
      weather_source: source,
      hours: forecast.map((weather, index) => {
        const dispatch = result.dispatch[index];
        return {
          timestamp_utc: weather.timestamp_utc,
          wind_speed_m_s: weather.wind_speed_m_s,
          gust_speed_m_s: weather.gust_speed_m_s,
          gust_estimated: weather.gust_estimated ?? false,
          gross_generation_mw: dispatch.gross_generation_mw,
          grid_export_mw: dispatch.grid_export_mw,
          battery_charge_mw: dispatch.battery_charge_mw,
          curtailed_generation_mw: dispatch.curtailed_generation_mw,
        };
      }),
    };
  },

  async grid(source = "demo") {
    const { result, grid, battery } = await calculate({ weatherSource: source });
    return {
      ...labels,
      weather_source: source,
      export_capacity_mw: grid.export_limit_mw,
      peak_generation_mw: peakGeneration(result.dispatch),
      overload_hours: overloadHours(result.dispatch, grid.export_limit_mw),
      battery_enabled: battery.enabled,
      battery_capacity_mwh: battery.capacity_mwh,
      battery_initial_state_of_charge_mwh: battery.state_of_charge_mwh,
      battery_final_state_of_charge_mwh: result.battery_final_state_of_charge_mwh,
      dispatch: result.dispatch,
    };
  },

  async recommendations(source = "demo") {
    const { result } = await calculate({ weatherSource: source });
    return { ...labels, weather_source: source, recommendations: recommendations(result) };
  },

  async scenario(scenario) {
    const { result } = await calculate({
      weatherSource: scenario.weather_source,
      windMultiplier: scenario.wind_multiplier,
      exportCapacityMw: scenario.export_capacity_mw,
      batteryEnabled: scenario.battery_enabled,
    });
    return { ...result, scenario };
  },

  async windToolkit(year, dayOfYear) {
    return {
      data_status: "HISTORICAL WIND TOOLKIT DATA",
      disclaimer:
        "Historical WIND Toolkit resource data; not a current forecast or dispatch instruction.",
      year,
      day_of_year: dayOfYear,
      latitude: FARM_LATITUDE,
      longitude: FARM_LONGITUDE,
      hours: await fetchWindToolkitDay(year, dayOfYear),
    };
  },
};
