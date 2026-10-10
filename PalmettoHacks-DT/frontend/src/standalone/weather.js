// Browser versions of backend/services/weather_provider.py. api.weather.gov
// allows cross-origin requests, so the live forecast works without a server.

const NWS_API_BASE = "https://api.weather.gov";
const NREL_WIND_TOOLKIT_URL =
  "https://developer.nrel.gov/api/wind-toolkit/v2/wind/wtk-download.csv";
export const FARM_LATITUDE = Number(import.meta.env.VITE_WEATHER_LATITUDE ?? 34.054);
export const FARM_LONGITUDE = Number(import.meta.env.VITE_WEATHER_LONGITUDE ?? -81.063);
const NWS_CACHE_MS = 15 * 60 * 1000;

let nwsCache = null;

function windSpeedToMS(value) {
  if (typeof value === "string" && ["calm", "calm winds"].includes(value.trim().toLowerCase())) {
    return 0;
  }
  let values;
  let unit = "mph";
  if (typeof value === "number") {
    values = [value];
  } else if (typeof value === "string") {
    values = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const lowered = value.toLowerCase();
    if (lowered.includes("km/h") || lowered.includes("kph")) unit = "km/h";
    else if (lowered.includes("knot") || /\bkt\b/.test(lowered)) unit = "knots";
    else if (lowered.includes("m/s")) unit = "m/s";
  }
  if (!values?.length) throw new Error(`Unrecognized wind speed value: ${value}`);
  const factors = { mph: 0.44704, "km/h": 1 / 3.6, knots: 0.514444, "m/s": 1 };
  const speed = (values.reduce((total, item) => total + item, 0) / values.length) * factors[unit];
  return Math.round(speed * 100) / 100;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/geo+json" } });
  if (!response.ok) throw new Error(`NWS forecast request failed (${response.status}).`);
  return response.json();
}

async function fetchNwsUncached(hours) {
  const point = await getJson(
    `${NWS_API_BASE}/points/${FARM_LATITUDE.toFixed(4)},${FARM_LONGITUDE.toFixed(4)}`,
  );
  const hourlyUrl = point?.properties?.forecastHourly;
  if (typeof hourlyUrl !== "string" || new URL(hourlyUrl).hostname !== "api.weather.gov") {
    throw new Error("NWS point response contained an invalid hourly URL.");
  }
  const forecast = await getJson(hourlyUrl);
  const periods = forecast?.properties?.periods;
  if (!Array.isArray(periods)) throw new Error("NWS hourly response has no forecast periods.");

  const cutoff = Date.now() + hours * 3600 * 1000;
  const rows = [];
  for (const period of periods) {
    const timestamp = new Date(period.startTime);
    if (timestamp.getTime() > cutoff) continue;
    const wind = windSpeedToMS(period.windSpeed);
    const gustValue = period.windGust;
    const gust = gustValue != null ? windSpeedToMS(gustValue) : Math.round(wind * 125) / 100;
    rows.push({
      timestamp_utc: timestamp.toISOString(),
      wind_speed_m_s: wind,
      gust_speed_m_s: Math.max(wind, gust),
      gust_estimated: gustValue == null,
      data_status: "LIVE NWS FORECAST",
    });
    if (rows.length === hours) break;
  }
  if (!rows.length) throw new Error("NWS returned no usable hourly wind forecast.");
  return rows;
}

export async function fetchNwsHourlyForecast(hours = 24) {
  if (!nwsCache || nwsCache.expiresAt <= Date.now()) {
    const promise = fetchNwsUncached(hours);
    nwsCache = { expiresAt: Date.now() + NWS_CACHE_MS, promise };
    promise.catch(() => {
      if (nwsCache?.promise === promise) nwsCache = null;
    });
  }
  const rows = await nwsCache.promise;
  return rows.map((row) => ({ ...row }));
}

function parseWindToolkitCsv(csvText, year, dayOfYear) {
  const lines = csvText.split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim()));
  const headerIndex = lines.findIndex((row) => {
    const lowered = new Set(row.map((cell) => cell.toLowerCase()));
    return ["year", "month", "day", "hour"].every((name) => lowered.has(name));
  });
  if (headerIndex < 0) throw new Error("WIND Toolkit response did not contain a CSV data header.");
  const header = lines[headerIndex];
  const indices = Object.fromEntries(header.map((name, index) => [name.toLowerCase(), index]));
  const windIndex = header.findIndex((name) => {
    const normalized = name.toLowerCase().replaceAll("_", " ");
    return normalized.includes("wind speed") && !normalized.includes("direction");
  });
  if (windIndex < 0) throw new Error("WIND Toolkit CSV did not include a recognizable wind speed column.");

  const target = new Date(Date.UTC(year, 0, dayOfYear));
  const rows = [];
  for (const row of lines.slice(headerIndex + 1)) {
    if (row.length < header.length) continue;
    const [y, m, d, h] = ["year", "month", "day", "hour"].map((name) => Number(row[indices[name]]));
    const speed = Number(row[windIndex]);
    if (![y, m, d, h, speed].every(Number.isFinite)) continue;
    if (y === target.getUTCFullYear() && m === target.getUTCMonth() + 1 && d === target.getUTCDate()) {
      rows.push({
        timestamp_utc: new Date(Date.UTC(y, m - 1, d, h % 24)).toISOString(),
        wind_speed_m_s: Math.round(speed * 100) / 100,
        data_status: "HISTORICAL WIND TOOLKIT DATA",
      });
    }
  }
  if (rows.length !== 24) {
    throw new Error(`WIND Toolkit returned ${rows.length} hourly values, expected 24.`);
  }
  return rows;
}

// The NREL key ships in the browser bundle, so only use a free, rate-limited key.
export async function fetchWindToolkitDay(year, dayOfYear) {
  const apiKey = import.meta.env.VITE_NREL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Historical WIND Toolkit data is unavailable in this deployment. Set VITE_NREL_API_KEY to enable it.",
    );
  }
  const params = new URLSearchParams({
    api_key: apiKey,
    wkt: `POINT(${FARM_LONGITUDE.toFixed(5)} ${FARM_LATITUDE.toFixed(5)})`,
    names: String(year),
    utc: "true",
    leap_day: "true",
    interval: "60",
    attributes: "wind_speed",
  });
  let response;
  try {
    response = await fetch(`${NREL_WIND_TOOLKIT_URL}?${params}`);
  } catch (error) {
    throw new Error("NREL WIND Toolkit network request failed.", { cause: error });
  }
  if (!response.ok) {
    throw new Error(
      `NREL WIND Toolkit returned HTTP ${response.status}. Check the API key and query limits.`,
    );
  }
  return parseWindToolkitCsv(await response.text(), year, dayOfYear);
}
