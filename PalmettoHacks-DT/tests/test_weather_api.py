"""Weather source API integration tests."""

from copy import deepcopy

from fastapi.testclient import TestClient
import pytest

from backend import main
from backend.models import ScenarioRequest
from backend.services.data_loader import get_simulated_data
from backend.services.weather_provider import WeatherProviderError


def test_wind_toolkit_get_endpoint_returns_historical_day(monkeypatch) -> None:
    hours = [
        {
            "timestamp_utc": f"2012-01-01T{hour:02d}:00:00+00:00",
            "wind_speed_m_s": 8.0,
            "data_status": "HISTORICAL WIND TOOLKIT DATA",
        }
        for hour in range(24)
    ]
    monkeypatch.setattr(main, "fetch_wind_toolkit_day", lambda *args, **kwargs: hours)

    response = TestClient(main.app).get(
        "/api/weather/wind-toolkit?year=2012&day_of_year=1"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["data_status"] == "HISTORICAL WIND TOOLKIT DATA"
    assert payload["year"] == 2012
    assert payload["day_of_year"] == 1
    assert len(payload["hours"]) == 24


@pytest.mark.parametrize("archive_year", [2000, 2020])
def test_wind_toolkit_get_endpoint_accepts_south_atlantic_archive_years(
    monkeypatch, archive_year: int
) -> None:
    monkeypatch.setattr(
        main,
        "fetch_wind_toolkit_day",
        lambda year, day_of_year, **kwargs: [],
    )

    response = TestClient(main.app).get(
        f"/api/weather/wind-toolkit?year={archive_year}"
    )

    assert response.status_code == 200
    assert response.json()["year"] == archive_year


def test_wind_toolkit_get_endpoint_surfaces_provider_failures(monkeypatch) -> None:
    def fail_fetch(*args, **kwargs):
        raise WeatherProviderError(
            "NREL WIND Toolkit returned HTTP 403. API key rejected."
        )

    monkeypatch.setattr(
        main,
        "fetch_wind_toolkit_day",
        fail_fetch,
    )

    response = TestClient(main.app).get("/api/weather/wind-toolkit")

    assert response.status_code == 502
    assert "HTTP 403" in response.json()["detail"]
    assert "API key rejected" in response.json()["detail"]


def test_wind_toolkit_get_endpoint_surfaces_actionable_dns_diagnostics(
    monkeypatch,
) -> None:
    def fail_fetch(*args, **kwargs):
        raise WeatherProviderError(
            "NREL WIND Toolkit DNS lookup failed for developer.nlr.gov. "
            "Check DNS/network access from the backend environment and try again."
        )

    monkeypatch.setattr(main, "fetch_wind_toolkit_day", fail_fetch)

    response = TestClient(main.app).get("/api/weather/wind-toolkit")

    assert response.status_code == 502
    assert "DNS lookup failed" in response.json()["detail"]
    assert "Check DNS/network access" in response.json()["detail"]


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
