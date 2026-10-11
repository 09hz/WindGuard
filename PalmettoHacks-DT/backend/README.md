# Twind backend

FastAPI service for the Twind prototype. It reads the JSON fixtures in
the repository's top-level `data\` directory and computes illustrative turbine
risk, energy, maintenance, and grid results. All values are **SIMULATED DEMO
DATA**; this service is not safety-grade and does not connect to or control a
utility grid.

## Run locally (Windows PowerShell)

Run these commands from `PalmettoHacks-DT`:

```powershell
py -m venv ..\.venv
..\.venv\Scripts\Activate.ps1
python .\generate_data.py
python -m pip install -r .\backend\requirements.txt
python -m uvicorn backend.main:app --reload
```

Copy the repository-root `.env.example` to `.env` and put any local API keys
there. `.env` is ignored by Git and loaded automatically for local runs. For
Vercel deployments, add secrets such as `NREL_API_KEY` under the project's
Environment Variables settings; Vercel does not receive the local `.env` file.

The API is available at `http://127.0.0.1:8000`; interactive OpenAPI docs are
at `http://127.0.0.1:8000/docs`. If PowerShell blocks virtual-environment
activation, run the install and server commands using
`.venv\Scripts\python.exe -m pip ...` and
`.venv\Scripts\python.exe -m uvicorn ...`.

React development origins `localhost` and `127.0.0.1` on ports `5173` and
`3000` are allowed by CORS.

## Weather sources

All endpoints that calculate forecast-dependent values accept
`?source=demo|nws`; the default is the local demo fixture. For example:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/forecast?source=nws"
```

NWS forecast mode gets the farm's 24 hourly wind speeds and gusts from the free
National Weather Service API and identifies the response as `weather_source:
"nws"`. The browser labels this as **LIVE NWS FORECAST**, separately from the
simulated turbine condition data. NWS requests use the configured
`NWS_USER_AGENT` (the default identifies the local demo), and successful
responses are cached for 15 minutes. If NWS is unavailable or returns malformed
weather, the API reports a 502; it does not silently substitute demo weather.
When NWS has no gust value for an hour, the adapter supplies an explicitly
flagged illustrative estimate at 1.25 times the reported wind speed.

The farm location defaults to the fixture centroid near `34.054, -81.063`.
Override it with `WEATHER_LATITUDE` and `WEATHER_LONGITUDE` before starting the
backend. NWS point coverage is US-only.

NREL WIND Toolkit is a **historical resource archive, not a current forecast**.
`GET /api/weather/wind-toolkit?year=2012&day_of_year=1` returns 24 hourly
historical wind samples for side-by-side demo context. It uses the South
Atlantic yearly WIND Toolkit dataset, which supports years 2000–2020, through
its [documented synchronous one-point/year CSV download endpoint](https://developer.nlr.gov/docs/wind/wind-toolkit/wtk-south-atlantic-yearly-5min-v1-0-0-download/).
Register for an API key
at [developer.nlr.gov](https://developer.nlr.gov/) and set it in the backend
process, along with the email associated with the API request, without
committing either value:

```powershell
$env:NREL_API_KEY = "your-NREL-key"
$env:NREL_API_EMAIL = "you@example.com"
python -m uvicorn backend.main:app --reload
```

Local runs load the repository-root `.env` regardless of the backend working
directory; shell variables take precedence. NLR credentials are read when a
request is made, so editing the ignored root `.env` takes effect without
depending on Uvicorn noticing a file change above its reload directory. The
endpoint must return CSV directly; a queued/in-progress JSON acknowledgement
is reported as unavailable data and is never presented as a 24-hour result.
The API key is sent as a query parameter and email and dataset options as
form-encoded POST data to the NLR HTTPS endpoint. Neither credential is
included in API responses. Missing credentials, provider errors (including
actionable DNS diagnostics), and invalid archive dates are reported explicitly.

## OpenDSS demo

The demonstration feeder is in `simulation/opendss/wind_farm_demo.dss`. Its
Python runner connects the 24-hour fixture or selected weather profile to ten
turbine generators, a 30 MVA substation transformer, local loads, and the
calculated battery-charge shape:

```powershell
python -m pip install -r .\simulation\opendss\requirements.txt
python .\simulation\opendss\run_opendss_demo.py --source demo
python .\simulation\opendss\run_opendss_demo.py --source nws
python .\simulation\opendss\run_opendss_demo.py --source wind-toolkit --year 2012 --day-of-year 1
```

The OpenDSS model is an illustrative radial feeder for software demonstration,
not a validated interconnection, protection, safety, or utility dispatch study.
The NREL runner requires `NREL_API_KEY` and `NREL_API_EMAIL`. The independent
`.dss` file also contains a representative 24-hour profile and can be opened
directly in OpenDSS.

## Endpoints

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | Service status and simulated-data disclaimer |
| `GET` | `/api/farm/overview` | Farm generation, energy-at-risk, overload, and maintenance summary |
| `GET` | `/api/turbines` | All turbines and ranking by energy at risk |
| `GET` | `/api/turbines/{turbine_id}` | One turbine's health and calculated results; 404 for an unknown ID |
| `GET` | `/api/forecast` | 24 hourly wind, generation, export, battery, and curtailment values |
| `GET` | `/api/grid/status` | Export limit, battery state, and hourly dispatch |
| `GET` | `/api/recommendations` | Maintenance, inspection, storage, and curtailment recommendations |
| `GET` | `/api/weather/wind-toolkit?year=2012&day_of_year=1` | Historical South Atlantic WIND Toolkit wind profile (2000–2020); needs `NREL_API_KEY` and `NREL_API_EMAIL` |
| `POST` | `/api/scenarios` | Recomputed scenario; never writes fixture files |

The forecast-dependent GET routes accept `?source=demo|nws`. `demo` is the
local fixture and default; `nws` requests live NWS hourly weather.

Scenario request:

```json
{
  "wind_multiplier": 1.2,
  "export_capacity_mw": 28,
  "battery_enabled": false,
  "weather_source": "nws"
}
```

`wind_multiplier` must be greater than `0` and no more than `3`; export
capacity must be greater than `0` and no more than `1000 MW`. Unspecified
scenario fields use demo weather, the fixture grid limit, and the enabled
fixture battery. `weather_source` can be `demo` or `nws`. The response contains the
scenario settings and recalculated turbine, forecast-dispatch, ranking, and
maintenance-window results.

## Data and calculations

The service reads `data\turbines.json`, `data\hourly_forecast.json`,
`data\grid_config.json`, and `data\battery_config.json` from the repository
root. Forecast entries require both `wind_speed_m_s` and `gust_speed_m_s`.
Calculations and risk normalization are documented in
`services\twin_engine.py`; scenario overrides are in-memory only.

Every response identifies its source as **SIMULATED DEMO DATA** and includes:

> Prototype results use simulated operational data and are not safety or dispatch instructions.
