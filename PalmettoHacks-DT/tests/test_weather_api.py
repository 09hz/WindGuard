"""Weather source API integration tests."""

from copy import deepcopy

from backend import main
from backend.models import ScenarioRequest
from backend.services.data_loader import get_simulated_data


def test_forecast_endpoint_identifies_nws_weather_source(monkeypatch) -> None:
    fixture_forecast = get_simulated_data()[1]
    monkeypatch.setattr(
        main,
        "fetch_nws_hourly_forecast",
        lambda: deepcopy(fixture_forecast),
    )

    response = main.get_forecast(source="nws")
    assert response.weather_source == "nws"
    assert len(response.hours) == 24


def test_scenario_uses_selected_weather_source_without_persisting(monkeypatch) -> None:
    fixture_forecast = get_simulated_data()[1]
    monkeypatch.setattr(
        main,
        "fetch_nws_hourly_forecast",
        lambda: deepcopy(fixture_forecast),
    )

    baseline_before = main.farm_overview(source="demo").model_dump()
    scenario = main.run_scenario(
        ScenarioRequest(
            wind_multiplier=1.2,
            export_capacity_mw=27,
            battery_enabled=False,
            weather_source="nws",
        )
    )
    baseline_after = main.farm_overview(source="demo").model_dump()

    assert scenario.weather_source == "nws"
    assert scenario.scenario.weather_source == "nws"
    assert baseline_after == baseline_before
