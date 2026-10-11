# WindGuard Twin frontend

React, Vite, Tailwind CSS, and Recharts dashboard for the WindGuard Twin
simulated wind-farm demo.

## Run locally

From the repository root, install the backend dependencies once:

```powershell
Set-Location .\PalmettoHacks-DT
..\.venv\Scripts\Activate.ps1
python -m pip install -r .\backend\requirements.txt
```

Then start the backend and frontend together from the frontend directory:

```powershell
Set-Location .\PalmettoHacks-DT\frontend
npm install
npm run dev
```

The `npm run dev` command starts the FastAPI backend, waits for its health
endpoint, then starts Vite. It uses the repository `.venv` Python when present;
set `PYTHON` to another interpreter if needed. Vite forwards `/api` requests to
`http://127.0.0.1:8000`. If startup reports that port 8000 is occupied, stop the
other process using it before retrying.

Open `http://localhost:5173`. Vite proxies `/api` requests to
`http://127.0.0.1:8000`. To use a different API origin, define
`VITE_API_BASE_URL`, for example `http://localhost:8000/api`.

Use the header source selector to switch between the local demo forecast and
the live NWS hourly forecast. Turbine-condition fixtures remain simulated in
both modes, and the header distinguishes them from live weather. The NREL WIND
Toolkit button requests one historical 2012 day for contextual comparison;
historical archive data is not used as a current forecast and requires
`NREL_API_KEY` and `NREL_API_EMAIL` to be set in the backend environment.

Build and preview the production bundle:

```powershell
npm run build
npm run preview
```

The dashboard is for demo use only. It labels fixture-backed values as
**SIMULATED DEMO DATA** and does not provide safety or dispatch instructions.

## Deploy without the backend (Vercel)

Production builds run the twin model in the browser when `VITE_API_BASE_URL`
is not set. `src/standalone/` is a JavaScript port of the FastAPI routes and
`backend/services/twin_engine.py`, reads the same `data/*.json` fixtures, and
calls the public NWS API directly for the live forecast. No server is needed.

1. In Vercel, choose **Add New → Project** and import this repository.
2. Set **Root Directory** to `PalmettoHacks-DT/frontend`. Leave "Include files
   outside the root directory" enabled, since the build imports `../data`.
3. Keep the detected Vite settings (`npm run build`, output `dist`) and deploy.

Optional environment variables:

- `VITE_NREL_API_KEY` enables the WIND Toolkit button. The key is embedded in
  the public bundle, so only use a free, rate-limited key.
- `VITE_WEATHER_LATITUDE` and `VITE_WEATHER_LONGITUDE` move the NWS point.
- `VITE_API_BASE_URL` switches back to a hosted FastAPI backend.

To try standalone mode locally, run `npm run build && npm run preview`, or
start the dev server with `VITE_STANDALONE=true npm run dev`.

The Python model and the JavaScript port must be kept in sync by hand.
