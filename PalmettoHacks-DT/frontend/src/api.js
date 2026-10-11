import { localApi } from "./standalone/localApi.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

// Production builds without VITE_API_BASE_URL (for example a static Vercel
// deploy) run the twin model in the browser instead of calling FastAPI.
export const STANDALONE =
  import.meta.env.VITE_STANDALONE === "true" ||
  (import.meta.env.PROD && !import.meta.env.VITE_API_BASE_URL);

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    throw new Error(
      `Cannot reach the Twind API at ${API_BASE}. Start the FastAPI server and try again.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      detail = payload.detail ?? detail;
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(detail);
  }
  return response.json();
}

const remoteApi = {
  overview: (source = "demo") => request(`/farm/overview?source=${source}`),
  turbines: (source = "demo") => request(`/turbines?source=${source}`),
  turbine: (id, source = "demo") =>
    request(`/turbines/${encodeURIComponent(id)}?source=${source}`),
  forecast: (source = "demo") => request(`/forecast?source=${source}`),
  grid: (source = "demo") => request(`/grid/status?source=${source}`),
  recommendations: (source = "demo") =>
    request(`/recommendations?source=${source}`),
  scenario: (scenario) =>
    request("/scenarios", {
      method: "POST",
      body: JSON.stringify(scenario),
    }),
  windToolkit: (year, dayOfYear) =>
    request(`/weather/wind-toolkit?year=${year}&day_of_year=${dayOfYear}`),
};

export const api = STANDALONE ? localApi : remoteApi;
