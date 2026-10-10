"""Run the WindGuard Twin 24-hour demo through the OpenDSS engine."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.data_loader import get_simulated_data  # noqa: E402
from backend.services.twin_engine import run_twin  # noqa: E402
from backend.services.weather_provider import (  # noqa: E402
    FARM_LATITUDE,
    FARM_LONGITUDE,
    WeatherProviderError,
    fetch_nws_hourly_forecast,
    fetch_wind_toolkit_day,
)

DSS_FILE = Path(__file__).with_name("wind_farm_demo.dss")


def _get_forecast(source: str, year: int, day_of_year: int) -> list[dict[str, Any]]:
    """Load demo or provider weather rows and give historical rows a gust estimate."""
    if source == "demo":
        return get_simulated_data()[1]
    if source == "nws":
        return fetch_nws_hourly_forecast()
    archive = fetch_wind_toolkit_day(
        year,
        day_of_year,
        latitude=FARM_LATITUDE,
        longitude=FARM_LONGITUDE,
    )
    return [
        {
            **hour,
            "gust_speed_m_s": round(hour["wind_speed_m_s"] * 1.25, 2),
            "gust_estimated": True,
        }
        for hour in archive
    ]


def _number_list(values: list[float]) -> str:
    """Format a profile as an OpenDSS multiplier tuple."""
    return "(" + " ".join(f"{value:.6f}" for value in values) + ")"


def _dynamic_profile_commands(
    turbines: list[dict[str, Any]],
    forecast: list[dict[str, Any]],
    grid: dict[str, Any],
    battery: dict[str, Any],
    result: dict[str, Any],
) -> str:
    """Inject calculated hourly turbine and storage profiles into the feeder model."""
    if len(forecast) != 24:
        raise ValueError(f"OpenDSS demo requires 24 hourly values; received {len(forecast)}.")
    dispatch = result["dispatch"]
    if len(dispatch) != 24:
        raise ValueError(f"OpenDSS demo requires 24 dispatch values; received {len(dispatch)}.")

    curtailments_by_hour = [
        {entry["turbine_id"]: entry["curtailed_mw"] for entry in hour["curtailed_turbines"]}
        for hour in dispatch
    ]
    profile_lines = []
    for turbine in turbines:
        turbine_result = next(
            item for item in result["turbines"] if item["id"] == turbine["id"]
        )
        profile = []
        for hour_index, gross_power in enumerate(turbine_result["hourly_generation_mw"]):
            curtailed = curtailments_by_hour[hour_index].get(turbine["id"], 0.0)
            profile.append(
                max(0.0, gross_power - curtailed) / turbine["rated_power_mw"]
            )
        shape_id = turbine["id"].replace("-", "")
        profile_lines.append(
            f"New LoadShape.{shape_id}Shape npts=24 interval=1 mult={_number_list(profile)}"
        )

    charge_limit_mw = battery["max_charge_rate_mw"] if battery["enabled"] else 1.0
    battery_profile = [
        min(1.0, hour["battery_charge_mw"] / charge_limit_mw)
        if battery["enabled"] and charge_limit_mw > 0
        else 0.0
        for hour in dispatch
    ]
    profile_lines.append(
        "New LoadShape.BatteryChargeShape npts=24 interval=1 "
        f"mult={_number_list(battery_profile)}"
    )

    return [
        line.replace("New LoadShape.", "Edit LoadShape.", 1)
        for line in profile_lines
    ]


def run_demo(source: str, year: int, day_of_year: int) -> dict[str, Any]:
    """Run a 24-hour power-flow time series and return a JSON-ready summary."""
    try:
        import py_dss_interface
    except ImportError as error:
        raise RuntimeError(
            "OpenDSS runner dependency is missing. Install it with "
            "python -m pip install -r simulation/opendss/requirements.txt"
        ) from error

    turbines, _, grid, battery = get_simulated_data()
    forecast = _get_forecast(source, year, day_of_year)
    if source != "demo" and len(forecast) > 24:
        forecast = forecast[:24]
    if len(forecast) != 24:
        raise ValueError(f"Selected weather source returned {len(forecast)} hours; expected 24.")
    result = run_twin(turbines, forecast, grid["export_limit_mw"], battery)
    profile_commands = _dynamic_profile_commands(
        turbines, forecast, grid, battery, result
    )

    engine = py_dss_interface.DSS()
    try:
        engine.text(f'compile "{DSS_FILE}"')
        for command in profile_commands:
            engine.text(command)
        engine.text("set mode=daily stepsize=1h number=24")
        engine.text("solve")
        if not engine.solution.converged:
            raise RuntimeError(
                "OpenDSS did not converge on the final hourly step. "
                "Inspect the feeder model and selected input data."
            )

        return {
            "data_status": (
                "SIMULATED DEMO DATA"
                if source == "demo"
                else "SIMULATED GRID MODEL WITH EXTERNAL WEATHER DATA"
            ),
            "weather_source": source,
            "hours_solved": len(result["dispatch"]),
            "converged": bool(engine.solution.converged),
            "bus_count": int(engine.circuit.num_buses),
            "grid_export_capacity_mw": grid["export_limit_mw"],
            "gross_expected_energy_mwh": result["expected_energy_mwh"],
            "energy_at_risk_mwh": result["energy_at_risk_mwh"],
            "battery_final_state_of_charge_mwh": result[
                "battery_final_state_of_charge_mwh"
            ],
            "curtailed_energy_mwh": round(
                sum(hour["curtailed_generation_mw"] for hour in result["dispatch"]), 6
            ),
            "disclaimer": (
                "Illustrative OpenDSS feeder and forecast; not an engineering "
                "interconnection study or a safety/dispatch instruction."
            ),
        }
    finally:
        engine.text("clear")
        del engine


def main() -> None:
    """Parse demo options, run the feeder, and print a readable result."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        choices=("demo", "nws", "wind-toolkit"),
        default="demo",
        help="Use the local forecast, NWS current forecast, or historical WIND Toolkit.",
    )
    parser.add_argument("--year", type=int, default=2012, help="WIND Toolkit archive year.")
    parser.add_argument(
        "--day-of-year",
        type=int,
        default=1,
        help="WIND Toolkit archive day (1-based).",
    )
    arguments = parser.parse_args()
    try:
        summary = run_demo(arguments.source, arguments.year, arguments.day_of_year)
    except (ValueError, RuntimeError, WeatherProviderError) as error:
        parser.exit(1, f"OpenDSS demo failed: {error}\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
