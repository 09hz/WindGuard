"""Load and validate the local simulated JSON fixture files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_STATUS = "SIMULATED DEMO DATA"
REQUIRED_FIXTURES = (
    "turbines.json",
    "hourly_forecast.json",
    "grid_config.json",
    "battery_config.json",
)


class DataLoadError(RuntimeError):
    """Raised when a local fixture is missing, unreadable, or malformed."""


def _read_json(filename: str) -> dict[str, Any]:
    """Read a JSON object from the fixture directory with a useful error."""
    path = DATA_DIR / filename
    try:
        with path.open(encoding="utf-8") as fixture:
            payload = json.load(fixture)
    except FileNotFoundError as error:
        raise DataLoadError(f"Required demo data file is missing: {path}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise DataLoadError(f"Unable to read valid JSON from {path}: {error}") from error
    if not isinstance(payload, dict):
        raise DataLoadError(f"Expected a JSON object in {path}.")
    if payload.get("data_status") != DATA_STATUS:
        raise DataLoadError(f"{path} must be labeled {DATA_STATUS!r}.")
    return payload


def load_data() -> dict[str, Any]:
    """Load the four fixtures and validate their top-level data shapes."""
    data = {filename: _read_json(filename) for filename in REQUIRED_FIXTURES}

    turbines = data["turbines.json"].get("turbines")
    forecast = data["hourly_forecast.json"].get("hours")
    grid = data["grid_config.json"].get("grid_interconnection")
    battery = data["battery_config.json"].get("battery")
    if not isinstance(turbines, list) or not turbines:
        raise DataLoadError("turbines.json must contain a non-empty 'turbines' array.")
    if not all(isinstance(turbine, dict) for turbine in turbines):
        raise DataLoadError("Every turbine fixture entry must be a JSON object.")
    if not isinstance(forecast, list) or not forecast:
        raise DataLoadError("hourly_forecast.json must contain a non-empty 'hours' array.")
    if not all(isinstance(hour, dict) for hour in forecast):
        raise DataLoadError("Every forecast fixture entry must be a JSON object.")
    if not isinstance(grid, dict) or not isinstance(battery, dict):
        raise DataLoadError("Grid and battery fixture sections must be JSON objects.")
    return data


def get_simulated_data() -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Return turbines, forecast hours, grid settings, and battery settings."""
    data = load_data()
    return (
        data["turbines.json"]["turbines"],
        data["hourly_forecast.json"]["hours"],
        data["grid_config.json"]["grid_interconnection"],
        data["battery_config.json"]["battery"],
    )

