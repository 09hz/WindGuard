# Twind

Twind is a demonstration dashboard and API for exploring simulated
wind-farm generation, turbine condition, maintenance priorities, and grid
dispatch. It includes optional live weather integrations and an illustrative
OpenDSS feeder simulation.

> **Demonstration only:** turbine conditions and grid scenarios use simulated
> data. The application is not safety-grade, is not connected to a utility
> control system, and must not be used as an operating or dispatch instruction.

## Project contents

| Path | Purpose |
|---|---|
| `backend/` | FastAPI API, data validation, weather integrations, and twin calculations |
| `frontend/` | React/Vite dashboard and a browser-based standalone twin |
| `data/` | Labeled simulated turbine, forecast, grid, and battery JSON fixtures |
| `simulation/opendss/` | Example feeder model and Python runner |
| `tests/` | Backend calculation, provider, and API tests |
| `generate_data.py` | Regenerates the seeded demo fixtures |

The FastAPI backend and JavaScript standalone implementation use the same demo
fixtures and provide matching dashboard data. The frontend uses the FastAPI
backend in production so provider credentials remain server-side. Standalone
mode is an opt-in for local development without a backend.

## Requirements

- Python 3.10 or newer
- Node.js and npm
- Optional: OpenDSS Python dependency for the feeder simulation

The commands below use Windows PowerShell and assume the virtual environment
is in the directory above `PalmettoHacks-DT` (the repository workspace root).

## Setup and run locally

From the repository workspace root:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r .\PalmettoHacks-DT\backend\requirements.txt
python .\PalmettoHacks-DT\generate_data.py
Set-Location .\PalmettoHacks-DT\frontend
npm ci
npm run dev
```

`npm run dev` starts the FastAPI backend, waits for its health endpoint, and
then starts Vite. Keep the terminal running while using the app:

- Dashboard: <http://localhost:5173>
- API health: <http://127.0.0.1:8000/api/health>
- Interactive API documentation: <http://127.0.0.1:8000/docs>

The frontend sends `/api` requests through Vite to the backend on port 8000.
If startup reports that the backend cannot use port 8000, stop the other
process using that port and run `npm run dev` again. If using a non-default
Python installation, set `PYTHON` before starting the frontend, for example:

```powershell
$env:PYTHON = "C:\Path\To\python.exe"
npm run dev
```

To run only the API, start it from this project directory in another terminal:

```powershell
Set-Location .\PalmettoHacks-DT
..\.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --reload
```

## Environment configuration

Copy the workspace-root `.env.example` to `.env` and fill in credentials only
when using a provider that requires them. The root `.env` is Git-ignored and
must never be committed. Local backend code reads it at request time; process
environment variables take precedence.

| Variable | Used for |
|---|---|
| `NREL_API_KEY` | NLR WIND Toolkit access |
| `NREL_API_EMAIL` | Required requester email for WIND Toolkit downloads |
| `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` | Backend NWS/WIND Toolkit point |
| `NWS_USER_AGENT` | Descriptive User-Agent for National Weather Service requests |

The NWS demo forecast and simulated farm fixtures do not require an API key.
For Vercel backend deployments, configure required values in the Vercel
project's Environment Variables; Vercel does not receive the local `.env`.
Do not put a private backend key in a `VITE_` variable: frontend variables are
embedded in browser-delivered JavaScript.

## Weather data

The dashboard defaults to the local demo forecast. Its source selector can
request the National Weather Service (NWS) hourly forecast. NWS data is separate
from simulated turbine condition data.

The **Load 2012 sample** button requests historical WIND Toolkit data; it is
not a current forecast. The backend uses NLR's South Atlantic dataset direct
CSV endpoint and returns the selected day's 24 hourly wind-speed samples. This
requires both `NREL_API_KEY` and `NREL_API_EMAIL`. The NLR JSON download
acknowledgment represents an asynchronous archive job and is not hourly data,
so the dashboard requires the direct CSV response.

## API overview

Forecast-dependent endpoints accept `?source=demo|nws` where applicable.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | API health and demo-data disclaimer |
| `GET` | `/api/farm/overview` | Farm generation, risk, overload, and maintenance summary |
| `GET` | `/api/turbines` | Turbine health and energy-at-risk ranking |
| `GET` | `/api/turbines/{turbine_id}` | One turbine's calculated details |
| `GET` | `/api/forecast` | Hourly wind, generation, battery, and curtailment |
| `GET` | `/api/grid/status` | Grid limits, battery settings, and dispatch |
| `GET` | `/api/recommendations` | Maintenance and grid recommendations |
| `GET` | `/api/weather/wind-toolkit?year=2012&day_of_year=1` | Historical WIND Toolkit sample; requires NLR credentials |
| `POST` | `/api/scenarios` | In-memory scenario recalculation |

Example:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/farm/overview?source=demo"
```

## Tests and production build

Run backend tests from the project directory:

```powershell
Set-Location .\PalmettoHacks-DT
..\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = (Resolve-Path .\backend).Path + ';' + (Get-Location).Path
python -m pytest -q
```

To build the frontend:

```powershell
Set-Location .\PalmettoHacks-DT\frontend
npm run build
```

## OpenDSS demo

Install the optional dependency and run the feeder simulation from the project
directory:

```powershell
Set-Location .\PalmettoHacks-DT
python -m pip install -r .\simulation\opendss\requirements.txt
python .\simulation\opendss\run_opendss_demo.py --source demo
```

The runner also accepts `--source nws` or
`--source wind-toolkit --year 2012 --day-of-year 1`. The latter requires both
NLR credentials. The feeder is illustrative and is not a validated
interconnection or protection study.

## Deployment

Use the workspace root as the Vercel project root so Vercel reads the root
`vercel.json`, builds both services, and routes `/api/*` to FastAPI. The
frontend calls `/api` by default; do not set `VITE_STANDALONE=true` for this
deployment. In Vercel Project Settings → Environment Variables, add
`NREL_API_KEY` and `NREL_API_EMAIL` for the Preview and Production deployment
environments. The backend reads these server-side variables; do not use `VITE_`
prefixes or put the credentials in frontend code. Redeploy after saving the
variables so the backend runtime receives them.

Use `vercel dev` from the workspace root to exercise the multi-service
configuration locally. For deployment details and current configuration, see
the Vercel docs and `backend/README.md` / `frontend/README.md`.
