"""Focused tests for WindGuard Twin heuristic calculations."""

import pytest

from services.twin_engine import DISCLAIMER, failure_risk, power_from_wind, run_twin


def make_turbine(
    turbine_id: str = "WT-01",
    *,
    vibration_mm_s: float = 1.0,
    bearing_temperature_c: float = 60.0,
    rotor_rpm: float = 10.0,
    days_since_maintenance: float = 30.0,
    rated_power_mw: float = 4.0,
) -> dict[str, float | str]:
    return {
        "id": turbine_id,
        "name": turbine_id,
        "vibration_mm_s": vibration_mm_s,
        "bearing_temperature_c": bearing_temperature_c,
        "rotor_rpm": rotor_rpm,
        "days_since_maintenance": days_since_maintenance,
        "rated_power_mw": rated_power_mw,
    }


def make_forecast(
    wind_speed_m_s: float, gust_speed_m_s: float = 0.0, hours: int = 1
) -> list[dict[str, float]]:
    return [
        {
            "wind_speed_m_s": wind_speed_m_s,
            "gust_speed_m_s": gust_speed_m_s,
        }
        for _ in range(hours)
    ]


def test_power_curve_cut_in_rated_and_cut_out() -> None:
    assert power_from_wind(2.99, 4.0) == 0.0
    assert power_from_wind(3.0, 4.0) == 0.0
    assert power_from_wind(12.0, 4.0) == 4.0
    assert power_from_wind(24.99, 4.0) == 4.0
    assert power_from_wind(25.0, 4.0) == 0.0


def test_power_curve_interpolates_between_cut_in_and_rated() -> None:
    output = power_from_wind(7.5, 4.0)
    assert 0.0 < output < 4.0
    assert output == pytest.approx(4.0 * (7.5**3 - 3**3) / (12**3 - 3**3))


def test_failure_risk_is_bounded_and_uses_configured_weights() -> None:
    turbine = make_turbine(
        vibration_mm_s=100.0,
        bearing_temperature_c=200.0,
        days_since_maintenance=1000.0,
    )
    result = failure_risk(turbine, make_forecast(10.0, gust_speed_m_s=50.0))
    assert result["failure_risk"] == 1.0
    assert 0.0 <= result["failure_risk"] <= 1.0

    low_risk = failure_risk(make_turbine(), make_forecast(8.0, 0.0))
    assert 0.0 <= low_risk["failure_risk"] <= 1.0
    assert low_risk["weighted_risk_components"]["vibration"] == pytest.approx(0.04)
    assert low_risk["weighted_risk_components"]["bearing_temperature"] == 0.0


def test_energy_at_risk_is_risk_times_expected_energy() -> None:
    turbine = make_turbine(vibration_mm_s=10.0)
    result = run_twin(
        [turbine],
        make_forecast(12.0, gust_speed_m_s=0.0, hours=2),
        grid_export_capacity_mw=10.0,
    )
    result_turbine = result["turbines"][0]
    assert result_turbine["expected_energy_mwh"] == pytest.approx(8.0)
    assert result_turbine["energy_at_risk_mwh"] == pytest.approx(
        result_turbine["failure_risk"] * result_turbine["expected_energy_mwh"]
    )
    assert result["disclaimer"] == DISCLAIMER


def test_severe_risk_recommends_inspecting_now() -> None:
    turbine = make_turbine(
        vibration_mm_s=10.0,
        bearing_temperature_c=100.0,
        days_since_maintenance=365.0,
    )
    result = run_twin(
        [turbine],
        make_forecast(12.0, gust_speed_m_s=25.0),
        grid_export_capacity_mw=10.0,
    )
    assert result["turbines"][0]["failure_risk"] == 1.0
    assert result["turbines"][0]["recommendation"] == "inspect now"


def test_grid_overload_charges_battery_then_curtails_lowest_risk_first() -> None:
    low_priority = make_turbine("WT-low", vibration_mm_s=0.0)
    high_priority = make_turbine("WT-high", vibration_mm_s=10.0)
    result = run_twin(
        [high_priority, low_priority],
        make_forecast(12.0, gust_speed_m_s=0.0),
        grid_export_capacity_mw=6.0,
        battery={
            "enabled": True,
            "capacity_mwh": 10.0,
            "state_of_charge_mwh": 0.0,
            "max_charge_rate_mw": 1.0,
            "max_discharge_rate_mw": 1.0,
            "round_trip_efficiency": 1.0,
        },
    )
    hour = result["dispatch"][0]
    assert hour["battery_charge_mw"] == pytest.approx(1.0)
    assert hour["curtailed_generation_mw"] == pytest.approx(1.0)
    assert hour["curtailed_turbines"][0]["turbine_id"] == "WT-low"
    assert hour["grid_export_mw"] == pytest.approx(6.0)
