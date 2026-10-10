"""Transparent heuristic calculations for the WindGuard Twin backend demo."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

CUT_IN_WIND_SPEED_M_S = 3.0
RATED_WIND_SPEED_M_S = 12.0
CUT_OUT_WIND_SPEED_M_S = 25.0
INSPECT_NOW_RISK_THRESHOLD = 0.7
DISCLAIMER = (
    "Prototype results use simulated operational data and are not safety or dispatch instructions."
)

RISK_WEIGHTS = {
    "vibration": 0.40,
    "bearing_temperature": 0.30,
    "maintenance_age": 0.20,
    "gust_severity": 0.10,
}


def _number(value: Any, field: str, *, minimum: float = 0.0) -> float:
    """Return a finite numeric input or raise a field-specific ValueError."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number.")
    number = float(value)
    if not math.isfinite(number) or number < minimum:
        raise ValueError(f"{field} must be finite and at least {minimum}.")
    return number


def _required_number(record: Mapping[str, Any], field: str, *, minimum: float = 0.0) -> float:
    """Read and validate a required numeric record field."""
    if field not in record:
        raise ValueError(f"Missing required field: {field}.")
    return _number(record[field], field, minimum=minimum)


def _clamp(value: float) -> float:
    """Clamp a normalized component to the inclusive [0, 1] range."""
    return min(1.0, max(0.0, value))


def power_from_wind(wind_speed_m_s: float, rated_power_mw: float) -> float:
    """Estimate turbine output in MW using a cubic, idealized power curve."""
    wind = _number(wind_speed_m_s, "wind_speed_m_s")
    rated_power = _number(rated_power_mw, "rated_power_mw")
    if rated_power <= 0:
        raise ValueError("rated_power_mw must be greater than zero.")
    if wind < CUT_IN_WIND_SPEED_M_S or wind >= CUT_OUT_WIND_SPEED_M_S:
        return 0.0
    if wind >= RATED_WIND_SPEED_M_S:
        return rated_power
    cut_in_cubed = CUT_IN_WIND_SPEED_M_S**3
    rated_cubed = RATED_WIND_SPEED_M_S**3
    fraction = (wind**3 - cut_in_cubed) / (rated_cubed - cut_in_cubed)
    return rated_power * fraction


def failure_risk(turbine: Mapping[str, Any], hourly_forecast: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Calculate a heuristic 0-1 risk score and its weighted components.

    Component severities are normalized as vibration/10 mm/s, temperature above
    60 C over a 40 C range, maintenance age/365 days, and maximum gust/25 m/s.
    Rotor RPM is validated and reported as context but has no requested risk weight.
    """
    vibration = _required_number(turbine, "vibration_mm_s")
    temperature = _required_number(turbine, "bearing_temperature_c")
    rotor_rpm = _required_number(turbine, "rotor_rpm")
    maintenance_age = _required_number(turbine, "days_since_maintenance")
    if not hourly_forecast:
        raise ValueError("hourly_forecast must contain at least one hour.")

    if any(not isinstance(hour, Mapping) for hour in hourly_forecast):
        raise ValueError("Each hourly_forecast entry must be an object.")
    maximum_gust = max(_required_number(hour, "gust_speed_m_s") for hour in hourly_forecast)
    component_severity = {
        "vibration": _clamp(vibration / 10.0),
        "bearing_temperature": _clamp((temperature - 60.0) / 40.0),
        "maintenance_age": _clamp(maintenance_age / 365.0),
        "gust_severity": _clamp(maximum_gust / CUT_OUT_WIND_SPEED_M_S),
    }
    weighted_components = {
        name: round(score * RISK_WEIGHTS[name], 6)
        for name, score in component_severity.items()
    }
    risk = _clamp(sum(weighted_components.values()))
    return {
        "failure_risk": round(risk, 6),
        "risk_components": component_severity,
        "weighted_risk_components": weighted_components,
        "rotor_rpm": rotor_rpm,
        "explanation": (
            f"Illustrative weighted score: vibration {component_severity['vibration']:.0%}, "
            f"bearing temperature {component_severity['bearing_temperature']:.0%}, "
            f"maintenance age {component_severity['maintenance_age']:.0%}, and "
            f"maximum forecast gust {component_severity['gust_severity']:.0%}. "
            "Rotor RPM is shown as context and is not weighted."
        ),
    }


def _validate_forecast(
    hourly_forecast: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Validate and copy hourly weather rows."""
    if not hourly_forecast:
        raise ValueError("hourly_forecast must contain at least one hour.")
    validated = []
    for index, hour in enumerate(hourly_forecast):
        if not isinstance(hour, Mapping):
            raise ValueError(f"hourly_forecast[{index}] must be an object.")
        validated.append(
            {
                **hour,
                "wind_speed_m_s": _required_number(hour, "wind_speed_m_s"),
                "gust_speed_m_s": _required_number(hour, "gust_speed_m_s"),
            }
        )
    return validated


def _battery_state(battery: Mapping[str, Any] | None) -> dict[str, float | bool]:
    """Validate optional battery settings, accepting the generated config wrapper."""
    if battery is None:
        return {
            "enabled": False,
            "capacity_mwh": 0.0,
            "state_of_charge_mwh": 0.0,
            "max_charge_rate_mw": 0.0,
            "round_trip_efficiency": 1.0,
        }
    if "battery" in battery:
        nested = battery["battery"]
        if not isinstance(nested, Mapping):
            raise ValueError("battery config's 'battery' field must be an object.")
        battery = nested

    enabled = battery.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError("battery.enabled must be a boolean.")
    capacity = _required_number(battery, "capacity_mwh")
    state_of_charge = _required_number(battery, "state_of_charge_mwh")
    charge_rate = _required_number(battery, "max_charge_rate_mw")
    discharge_rate = _required_number(battery, "max_discharge_rate_mw")
    efficiency = _required_number(battery, "round_trip_efficiency")
    if capacity <= 0:
        raise ValueError("battery.capacity_mwh must be greater than zero.")
    if state_of_charge > capacity:
        raise ValueError("battery.state_of_charge_mwh cannot exceed capacity_mwh.")
    if charge_rate <= 0:
        raise ValueError("battery.max_charge_rate_mw must be greater than zero.")
    if discharge_rate <= 0:
        raise ValueError("battery.max_discharge_rate_mw must be greater than zero.")
    if not 0 < efficiency <= 1:
        raise ValueError("battery.round_trip_efficiency must be in (0, 1].")
    return {
        "enabled": enabled,
        "capacity_mwh": capacity,
        "state_of_charge_mwh": state_of_charge,
        "max_charge_rate_mw": charge_rate,
        "round_trip_efficiency": efficiency,
    }


def run_twin(
    turbines: Sequence[Mapping[str, Any]],
    hourly_forecast: Sequence[Mapping[str, Any]],
    grid_export_capacity_mw: float,
    battery: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build JSON-ready turbine risk, energy, maintenance, and dispatch results.

    Hourly forecast rows must include ``wind_speed_m_s`` and ``gust_speed_m_s``.
    Battery ``round_trip_efficiency`` is split evenly between charging and
    discharging; this engine only dispatches charging against grid overload.
    """
    if not turbines:
        raise ValueError("turbines must contain at least one turbine.")
    forecast = _validate_forecast(hourly_forecast)
    grid_capacity = _number(grid_export_capacity_mw, "grid_export_capacity_mw")
    if grid_capacity <= 0:
        raise ValueError("grid_export_capacity_mw must be greater than zero.")
    battery_config = _battery_state(battery)

    turbine_results: list[dict[str, Any]] = []
    hourly_turbine_power: list[list[float]] = [[] for _ in forecast]
    for index, turbine in enumerate(turbines):
        if not isinstance(turbine, Mapping):
            raise ValueError(f"turbines[{index}] must be an object.")
        turbine_id = turbine.get("id", f"WT-{index + 1:02d}")
        if not isinstance(turbine_id, str) or not turbine_id:
            raise ValueError(f"turbines[{index}].id must be a non-empty string.")
        rated_power = _required_number(turbine, "rated_power_mw")
        if rated_power <= 0:
            raise ValueError(f"{turbine_id}.rated_power_mw must be greater than zero.")
        risk_result = failure_risk(turbine, forecast)
        hourly_power = [
            power_from_wind(hour["wind_speed_m_s"], rated_power) for hour in forecast
        ]
        for hour_index, power in enumerate(hourly_power):
            hourly_turbine_power[hour_index].append(power)
        expected_energy = sum(hourly_power)
        energy_at_risk = risk_result["failure_risk"] * expected_energy
        turbine_results.append(
            {
                "id": turbine_id,
                "name": turbine.get("name", turbine_id),
                "rated_power_mw": rated_power,
                "rotor_rpm": risk_result["rotor_rpm"],
                "failure_risk": risk_result["failure_risk"],
                "risk_components": risk_result["risk_components"],
                "weighted_risk_components": risk_result["weighted_risk_components"],
                "risk_explanation": risk_result["explanation"],
                "expected_energy_mwh": round(expected_energy, 6),
                "energy_at_risk_mwh": round(energy_at_risk, 6),
                "hourly_generation_mw": [round(power, 6) for power in hourly_power],
                "recommendation": (
                    "inspect now"
                    if risk_result["failure_risk"] >= INSPECT_NOW_RISK_THRESHOLD
                    else "schedule maintenance during the lowest-generation window"
                ),
            }
        )

    ranked = sorted(
        turbine_results,
        key=lambda result: (-result["energy_at_risk_mwh"], result["id"]),
    )
    for rank, result in enumerate(ranked, start=1):
        result["energy_at_risk_rank"] = rank

    farm_generation_by_hour = [
        sum(powers) for powers in hourly_turbine_power
    ]
    maintenance_index = min(
        range(len(farm_generation_by_hour)),
        key=lambda index: (farm_generation_by_hour[index], index),
    )
    maintenance_hour = forecast[maintenance_index]

    battery_enabled = bool(battery_config["enabled"])
    capacity = float(battery_config["capacity_mwh"])
    state_of_charge = float(battery_config["state_of_charge_mwh"])
    max_charge_rate = float(battery_config["max_charge_rate_mw"])
    charge_efficiency = math.sqrt(float(battery_config["round_trip_efficiency"]))
    dispatch: list[dict[str, Any]] = []

    for hour_index, (hour, turbine_powers, gross_generation) in enumerate(
        zip(forecast, hourly_turbine_power, farm_generation_by_hour)
    ):
        overload = max(0.0, gross_generation - grid_capacity)
        charge_power = 0.0
        if battery_enabled and overload > 0:
            room_for_charge_input = (capacity - state_of_charge) / charge_efficiency
            charge_power = min(overload, max_charge_rate, room_for_charge_input)
            state_of_charge += charge_power * charge_efficiency

        remaining_overload = max(0.0, overload - charge_power)
        curtailed_by_turbine: list[dict[str, Any]] = []
        if remaining_overload > 0:
            candidates = sorted(
                range(len(turbine_results)),
                key=lambda index: (
                    turbine_results[index]["energy_at_risk_mwh"],
                    turbine_results[index]["id"],
                ),
            )
            for turbine_index in candidates:
                curtailed_power = min(
                    turbine_powers[turbine_index], remaining_overload
                )
                if curtailed_power > 0:
                    curtailed_by_turbine.append(
                        {
                            "turbine_id": turbine_results[turbine_index]["id"],
                            "curtailed_mw": round(curtailed_power, 6),
                            "reason": "lowest energy-at-risk priority curtailed first",
                        }
                    )
                    remaining_overload -= curtailed_power
                if remaining_overload <= 1e-9:
                    remaining_overload = 0.0
                    break

        curtailed_total = sum(item["curtailed_mw"] for item in curtailed_by_turbine)
        dispatch.append(
            {
                "timestamp_utc": hour.get("timestamp_utc"),
                "hour_index": hour_index,
                "gross_generation_mw": round(gross_generation, 6),
                "grid_export_capacity_mw": grid_capacity,
                "battery_charge_mw": round(charge_power, 6),
                "battery_state_of_charge_mwh": round(state_of_charge, 6),
                "curtailed_generation_mw": round(curtailed_total, 6),
                "curtailed_turbines": curtailed_by_turbine,
                "grid_export_mw": round(
                    max(0.0, gross_generation - charge_power - curtailed_total), 6
                ),
                "explanation": (
                    "Battery charging absorbed overload before curtailment; "
                    "remaining overload was curtailed from lowest energy-at-risk "
                    "priority turbines first."
                    if overload > 0
                    else "Generation is within the grid export capacity."
                ),
            }
        )

    return {
        "data_status": "SIMULATED DEMO DATA",
        "disclaimer": DISCLAIMER,
        "risk_method": {
            "weights": RISK_WEIGHTS,
            "normalization": {
                "vibration": "clamp(vibration_mm_s / 10)",
                "bearing_temperature": "clamp((bearing_temperature_c - 60) / 40)",
                "maintenance_age": "clamp(days_since_maintenance / 365)",
                "gust_severity": "clamp(max_forecast_gust_speed_m_s / 25)",
            },
            "inspect_now_threshold": INSPECT_NOW_RISK_THRESHOLD,
        },
        "energy_assumption": "Each forecast entry represents one hour; hourly MW is summed as MWh.",
        "expected_energy_mwh": round(
            sum(result["expected_energy_mwh"] for result in turbine_results), 6
        ),
        "energy_at_risk_mwh": round(
            sum(result["energy_at_risk_mwh"] for result in turbine_results), 6
        ),
        "maintenance_window": {
            "hour_index": maintenance_index,
            "timestamp_utc": maintenance_hour.get("timestamp_utc"),
            "predicted_farm_generation_mw": round(
                farm_generation_by_hour[maintenance_index], 6
            ),
            "explanation": "Lowest predicted gross farm generation in the forecast.",
        },
        "turbines": sorted(turbine_results, key=lambda result: result["id"]),
        "turbine_ranking_by_energy_at_risk": [
            {
                "rank": result["energy_at_risk_rank"],
                "turbine_id": result["id"],
                "energy_at_risk_mwh": result["energy_at_risk_mwh"],
            }
            for result in ranked
        ],
        "dispatch": dispatch,
        "battery_final_state_of_charge_mwh": round(state_of_charge, 6),
    }
