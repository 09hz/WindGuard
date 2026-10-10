# WindGuard Twin frontend

React, Vite, Tailwind CSS, and Recharts dashboard for the WindGuard Twin
simulated wind-farm demo.

## Run locally

In one PowerShell window, from the repository root, start the API:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --reload
```

In a second PowerShell window:

```powershell
Set-Location .\frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to
`http://127.0.0.1:8000`. To use a different API origin, define
`VITE_API_BASE_URL`, for example `http://localhost:8000/api`.

Use the header source selector to switch between the local demo forecast and
the live NWS hourly forecast. Turbine-condition fixtures remain simulated in
both modes, and the header distinguishes them from live weather. The NREL WIND
Toolkit button requests one historical 2012 day for contextual comparison;
historical archive data is not used as a current forecast and requires
`NREL_API_KEY` to be set in the backend environment.

Build and preview the production bundle:

```powershell
npm run build
npm run preview
```

The dashboard is for demo use only. It labels fixture-backed values as
**SIMULATED DEMO DATA** and does not provide safety or dispatch instructions.
