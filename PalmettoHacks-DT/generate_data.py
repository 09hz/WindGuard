"""Generate deterministic, clearly labeled demo fixtures for Twind."""

from __future__ import annotations

import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SEED = 20261010
DATA_LABEL = "SIMULATED DEMO DATA"
OUTPUT_DIR = Path(__file__).resolve().parent / "data"


def build_data() -> dict[str, dict[str, Any]]:
    rng = random.Random(SEED)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0)

    turbines = []
    for index in range(10):
        turbine_number = index + 1
        # WT-03 and WT-07 have intentionally elevated indicators; WT-09 is overdue.
        if turbine_number == 3:
            vibration, temperature, days_since_maintenance, health = 8.7, 91.5, 145, "Alert"
        elif turbine_number == 7:
            vibration, temperature, days_since_maintenance, health = 7.4, 86.2, 410, "Alert"
        elif turbine_number == 9:
            vibration, temperature, days_since_maintenance, health = 3.1, 68.4, 390, "Watch"
        else:
            vibration = round(rng.uniform(1.1, 3.2), 1)
            temperature = round(rng.uniform(54.0, 74.0), 1)
            days_since_maintenance = rng.randint(20, 240)
            health = "Healthy"

        turbines.append(
            {
                "id": f"WT-{turbine_number:02d}",
                "name": f"Turbine {turbine_number:02d}",
                "latitude": round(34.0 + index * 0.012, 6),
                "longitude": round(-81.0 - index * 0.014, 6),
                "rated_power_mw": 4.2,
                "vibration_mm_s": vibration,
                "bearing_temperature_c": temperature,
                "rotor_rpm": round(rng.uniform(8.0, 15.0), 1),
                "days_since_maintenance": days_since_maintenance,
                "baseline_health_status": health,
                "data_status": DATA_LABEL,
            }
        )

    forecast_start = generated_at.replace(minute=0, second=0) + timedelta(hours=1)
    hourly_forecast = []
    wind_center = rng.uniform(8.0, 10.5)
    for hour in range(24):
        # A broad daily swing plus seeded variation makes a readable demo forecast.
        daily_swing = 2.1 * math.sin((hour - 5) * 2 * math.pi / 24)
        wind_speed = max(3.0, min(18.0, wind_center + daily_swing + rng.uniform(-1.0, 1.0)))
        hourly_forecast.append(
            {
                "timestamp_utc": (forecast_start + timedelta(hours=hour)).isoformat(),
                "wind_speed_m_s": round(wind_speed, 1),
                "gust_speed_m_s": round(wind_speed + rng.uniform(0.2, 3.0), 1),
                "data_status": DATA_LABEL,
            }
        )

    return {
        "turbines.json": {
            "data_status": DATA_LABEL,
            "generated_at_utc": generated_at.isoformat(),
            "random_seed": SEED,
            "turbines": turbines,
        },
        "hourly_forecast.json": {
            "data_status": DATA_LABEL,
            "generated_at_utc": generated_at.isoformat(),
            "random_seed": SEED,
            "hours": hourly_forecast,
        },
        "grid_config.json": {
            "data_status": DATA_LABEL,
            "grid_interconnection": {
                "export_limit_mw": 30.0,
                "unit": "MW",
            },
        },
        "battery_config.json": {
            "data_status": DATA_LABEL,
            "battery": {
                "enabled": True,
                "capacity_mwh": 20.0,
                "state_of_charge_mwh": 10.0,
                "max_charge_rate_mw": 5.0,
                "max_discharge_rate_mw": 5.0,
                "round_trip_efficiency": 0.9,
            },
        },
    }


def validate_data(files: dict[str, dict[str, Any]]) -> None:
    turbines = files["turbines.json"]["turbines"]
    forecast = files["hourly_forecast.json"]["hours"]
    grid = files["grid_config.json"]["grid_interconnection"]
    battery = files["battery_config.json"]["battery"]

    if len(turbines) != 10 or len({t["id"] for t in turbines}) != 10:
        raise ValueError("Expected exactly 10 turbines with unique IDs.")
    required_turbine_fields = {
        "id",
        "name",
        "latitude",
        "longitude",
        "rated_power_mw",
        "vibration_mm_s",
        "bearing_temperature_c",
        "rotor_rpm",
        "days_since_maintenance",
        "baseline_health_status",
    }
    for turbine in turbines:
        missing = required_turbine_fields.difference(turbine)
        if missing:
            raise ValueError(f"{turbine.get('id', 'Turbine')} missing fields: {sorted(missing)}")
        if turbine["data_status"] != DATA_LABEL:
            raise ValueError(f"{turbine['id']} is missing the simulated-data label.")

    if len(forecast) != 24:
        raise ValueError("Expected exactly 24 hourly forecast entries.")
    if any(
        row["data_status"] != DATA_LABEL
        or row["wind_speed_m_s"] < 0
        or row["gust_speed_m_s"] < row["wind_speed_m_s"]
        for row in forecast
    ):
        raise ValueError("Forecast rows must be labeled and have non-negative wind speeds.")

    if not 25 <= grid["export_limit_mw"] <= 35:
        raise ValueError("Grid export limit must be between 25 and 35 MW.")
    if not 0 <= battery["state_of_charge_mwh"] <= battery["capacity_mwh"]:
        raise ValueError("Battery state of charge must be within its capacity.")
    if not 0 < battery["round_trip_efficiency"] <= 1:
        raise ValueError("Battery efficiency must be greater than zero and at most one.")
    for rate in ("max_charge_rate_mw", "max_discharge_rate_mw"):
        if battery[rate] <= 0:
            raise ValueError(f"Battery {rate} must be positive.")


def main() -> None:
    files = build_data()
    validate_data(files)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, contents in files.items():
        output_path = OUTPUT_DIR / filename
        output_path.write_text(json.dumps(contents, indent=2) + "\n", encoding="utf-8")
    serialized_files = {
        filename: json.loads((OUTPUT_DIR / filename).read_text(encoding="utf-8"))
        for filename in files
    }
    validate_data(serialized_files)

    print(f"Generated {len(files)} files in {OUTPUT_DIR}")
    print(f"Label: {DATA_LABEL}")
    print(f"Turbines: {len(files['turbines.json']['turbines'])}; forecast hours: 24")
    print(f"Grid export limit: {files['grid_config.json']['grid_interconnection']['export_limit_mw']} MW")
    print("Notable turbines: WT-03 (high vibration/temperature), WT-07 (elevated indicators), WT-09 (overdue maintenance)")


if __name__ == "__main__":
    main()
