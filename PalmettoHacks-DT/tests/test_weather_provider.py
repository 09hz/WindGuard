"""Tests for the NWS and WIND Toolkit weather provider adapters."""

import csv
import io

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from backend.services import weather_provider
from backend.services.weather_provider import (
    WeatherProviderError,
    _parse_wind_toolkit_csv,
    _wind_speed_to_m_s,
    fetch_nws_hourly_forecast,
)


def test_wind_speed_conversion_handles_units_and_ranges() -> None:
    assert _wind_speed_to_m_s("Calm") == 0.0
    assert _wind_speed_to_m_s("10 mph") == pytest.approx(4.47)
    assert _wind_speed_to_m_s("10 to 20 mph") == pytest.approx(6.71)
    assert _wind_speed_to_m_s("18 km/h") == pytest.approx(5.0)
    assert _wind_speed_to_m_s("10 knots") == pytest.approx(5.14)


def test_wind_toolkit_parser_returns_requested_historical_day() -> None:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["WIND Toolkit sample"])
    writer.writerow(["Year", "Month", "Day", "Hour", "Minute", "wind speed at 100m"])
    for hour in range(24):
        writer.writerow([2012, 1, 1, hour, 0, 7.5 + hour / 10])
    result = _parse_wind_toolkit_csv(output.getvalue(), year=2012, day_of_year=1)
    assert len(result) == 24
    assert result[0]["timestamp_utc"] == "2012-01-01T00:00:00+00:00"
    assert result[0]["wind_speed_m_s"] == 7.5
    assert result[0]["data_status"] == "HISTORICAL WIND TOOLKIT DATA"


def test_wind_toolkit_parser_rejects_incomplete_day() -> None:
    csv_text = "Year,Month,Day,Hour,Minute,wind speed at 100m\n2012,1,1,0,0,7.5\n"
    with pytest.raises(WeatherProviderError, match="expected 24"):
        _parse_wind_toolkit_csv(csv_text, year=2012, day_of_year=1)


def test_nws_fetch_normalizes_wind_and_uses_estimated_gust(monkeypatch) -> None:
    start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    periods = [
        {
            "startTime": (start + timedelta(hours=index)).isoformat(),
            "windSpeed": "10 to 20 mph",
            "windGust": None,
        }
        for index in range(24)
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/points/"):
            payload = {
                "properties": {
                    "forecastHourly": "https://api.weather.gov/gridpoints/CAE/1,2/forecast/hourly"
                }
            }
        else:
            payload = {"properties": {"periods": periods}}
        return httpx.Response(200, json=payload, request=request)

    monkeypatch.setattr(
        weather_provider,
        "_provider_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )
    result = fetch_nws_hourly_forecast(35.12345, -80.54321)
    assert len(result) == 24
    assert result[0]["wind_speed_m_s"] == pytest.approx(6.71)
    assert result[0]["gust_speed_m_s"] == pytest.approx(8.39)
    assert result[0]["data_status"] == "LIVE NWS FORECAST"


def test_wind_toolkit_requires_api_key(monkeypatch) -> None:
    monkeypatch.delenv("NREL_API_KEY", raising=False)
    with pytest.raises(WeatherProviderError, match="NREL_API_KEY"):
        weather_provider.fetch_wind_toolkit_day(2012, 1)


def test_wind_toolkit_request_uses_key_privately_and_normalizes_data(monkeypatch) -> None:
    monkeypatch.setenv("NREL_API_KEY", "test-only-api-key")
    csv_rows = ["Year,Month,Day,Hour,Minute,wind speed at 100m"]
    csv_rows.extend(f"2012,1,1,{hour},0,8.0" for hour in range(24))
    requested = {}

    def handler(request: httpx.Request) -> httpx.Response:
        requested.update(dict(request.url.params))
        return httpx.Response(200, text="\n".join(csv_rows), request=request)

    monkeypatch.setattr(
        weather_provider,
        "_provider_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )
    result = weather_provider.fetch_wind_toolkit_day(
        2012,
        1,
        latitude=35.2468,
        longitude=-80.1357,
    )
    assert requested["api_key"] == "test-only-api-key"
    assert "api_key" not in str(result)
    assert requested["wkt"] == "POINT(-80.13570 35.24680)"
    assert len(result) == 24
