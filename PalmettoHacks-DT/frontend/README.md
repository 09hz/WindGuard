# Twind frontend

React, Vite, Tailwind CSS, and Recharts dashboard for Twind
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

## Deploy on Vercel

Use the repository workspace root as the Vercel project root. Its `vercel.json`
builds the FastAPI and Vite services together and routes `/api/*` to FastAPI.
The frontend uses `/api` by default, so no `VITE_API_BASE_URL` is required.
Do not set `VITE_STANDALONE=true` for this deployment.

Add `NREL_API_KEY` and `NREL_API_EMAIL` in Vercel Project Settings →
Environment Variables for Preview and Production, then redeploy. The backend
reads these server-side variables; do not use `VITE_` names, because Vite
embeds those values in the public browser bundle.

For local standalone development without a backend, run
`VITE_STANDALONE=true npm run dev`. Production builds always use `/api` and
cannot use browser-exposed provider credentials.

The Python model and the JavaScript port must be kept in sync by hand.
