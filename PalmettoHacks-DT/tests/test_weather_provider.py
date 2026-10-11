"""Tests for the NWS and WIND Toolkit weather provider adapters."""

import csv
import io
from pathlib import Path

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


def test_wind_toolkit_parser_accepts_nrel_compact_speed_header() -> None:
    csv_rows = ["Year,Month,Day,Hour,Minute,windspeed_100m"]
    csv_rows.extend(f"2012,1,1,{hour},0,8.0" for hour in range(24))

    result = _parse_wind_toolkit_csv("\n".join(csv_rows), year=2012, day_of_year=1)

    assert len(result) == 24
    assert result[0]["wind_speed_m_s"] == 8.0


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
    _ignore_local_env(monkeypatch)
    monkeypatch.delenv("NREL_API_KEY", raising=False)
    monkeypatch.setenv("NREL_API_EMAIL", "test@example.com")
    with pytest.raises(WeatherProviderError, match="NREL_API_KEY") as error:
        weather_provider.fetch_wind_toolkit_day(2012, 1)
    assert "NREL_API_EMAIL" not in str(error.value)


def test_wind_toolkit_requires_api_email(monkeypatch) -> None:
    _ignore_local_env(monkeypatch)
    monkeypatch.setenv("NREL_API_KEY", "test-only-api-key")
    monkeypatch.delenv("NREL_API_EMAIL", raising=False)
    with pytest.raises(WeatherProviderError, match="NREL_API_EMAIL"):
        weather_provider.fetch_wind_toolkit_day(2012, 1)


def _ignore_local_env(monkeypatch) -> None:
    monkeypatch.setattr(
        weather_provider,
        "LOCAL_ENV_FILE",
        Path(__file__).with_name(".missing-test-env"),
    )


def test_wind_toolkit_request_uses_key_privately_and_normalizes_data(monkeypatch) -> None:
    _ignore_local_env(monkeypatch)
    monkeypatch.setenv("NREL_API_KEY", "test-only-api-key")
    monkeypatch.setenv("NREL_API_EMAIL", "test@example.com")
    csv_rows = ["Year,Month,Day,Hour,Minute,windspeed_100m"]
    csv_rows.extend(f"2012,1,1,{hour},0,8.0" for hour in range(24))
    requested = {}

    def handler(request: httpx.Request) -> httpx.Response:
        requested["method"] = request.method
        requested["url"] = str(request.url).split("?", maxsplit=1)[0]
        requested["query"] = dict(request.url.params)
        requested["body"] = dict(
            httpx.QueryParams(request.content.decode("ascii"))
        )
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
    assert requested["method"] == "POST"
    assert requested["query"] == {"api_key": "test-only-api-key"}
    assert requested["body"] == {
        "email": "test@example.com",
        "wkt": "POINT(-80.13570 35.24680)",
        "names": "2012",
        "utc": "true",
        "leap_day": "true",
        "interval": "60",
        "attributes": "windspeed_100m",
    }
    assert "api_key" not in str(result)
    assert "test@example.com" not in str(result)
    assert requested["url"] == (
        "https://developer.nlr.gov/api/wind-toolkit/v2/wind/"
        "wtk-south-atlantic-yearly-5min-v1-0-0-download.csv"
    )
    assert "api_key" not in requested["body"]
    assert "email" not in requested["query"]
    assert len(result) == 24


def test_wind_toolkit_http_error_includes_sanitized_upstream_detail(monkeypatch) -> None:
    _ignore_local_env(monkeypatch)
    api_key = "test-only-api-key"
    monkeypatch.setenv("NREL_API_KEY", api_key)
    monkeypatch.setenv("NREL_API_EMAIL", "test@example.com")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "errors": [
                    f"Invalid key {api_key}; requested api_key={api_key}; "
                    "email=test@example.com; "
                    "https://example.invalid/download?api_key=test-only-api-key"
                ]
            },
            request=request,
        )

    monkeypatch.setattr(
        weather_provider,
        "_provider_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(WeatherProviderError) as error:
        weather_provider.fetch_wind_toolkit_day(2013, 1)

    message = str(error.value)
    assert "HTTP 403" in message
    assert "Invalid key" in message
    assert api_key not in message
    assert "api_key=[redacted]" in message
    assert "test@example.com" not in message
    assert "https://example.invalid/" not in message
    assert "wtk-south-atlantic-yearly-5min-v1-0-0-download.csv" in (
        weather_provider.NREL_WIND_TOOLKIT_URL
    )


def test_wind_toolkit_dns_error_is_actionable_and_does_not_expose_key(monkeypatch) -> None:
    _ignore_local_env(monkeypatch)
    api_key = "test-only-api-key"
    monkeypatch.setenv("NREL_API_KEY", api_key)
    monkeypatch.setenv("NREL_API_EMAIL", "test@example.com")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("[Errno 11001] getaddrinfo failed", request=request)

    monkeypatch.setattr(
        weather_provider,
        "_provider_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )
    with pytest.raises(WeatherProviderError) as error:
        weather_provider.fetch_wind_toolkit_day(2013, 1)

    message = str(error.value)
    assert "DNS lookup failed" in message
    assert "developer.nlr.gov" in message
    assert "Check DNS/network access" in message
    assert api_key not in message
    assert "test@example.com" not in message


def test_wind_toolkit_reads_root_env_at_request_time(monkeypatch) -> None:
    monkeypatch.setenv("NREL_API_KEY", "test-key-from-shell")
    monkeypatch.delenv("NREL_API_EMAIL", raising=False)
    loaded_env = {
        "NREL_API_KEY": "test-key-from-root-env",
        "NREL_API_EMAIL": "test@example.com",
    }
    requested = {}

    def read_env(path):
        assert path == weather_provider.REPOSITORY_ROOT / ".env"
        return loaded_env.copy()

    def handler(request: httpx.Request) -> httpx.Response:
        requested["api_key"] = request.url.params["api_key"]
        requested["email"] = httpx.QueryParams(
            request.content.decode("ascii")
        )["email"]
        return httpx.Response(
            200,
            text="\n".join(
                ["Year,Month,Day,Hour,Minute,windspeed_100m"]
                + [f"2012,1,1,{hour},0,8.0" for hour in range(24)]
            ),
            request=request,
        )

    monkeypatch.setattr(weather_provider, "dotenv_values", read_env)
    monkeypatch.setattr(
        weather_provider,
        "_provider_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )

    weather_provider.fetch_wind_toolkit_day(2012, 1)
    assert requested == {
        "api_key": "test-key-from-shell",
        "email": "test@example.com",
    }


def test_wind_toolkit_reloads_credentials_from_local_env(monkeypatch) -> None:
    _ignore_local_env(monkeypatch)
    monkeypatch.delenv("NREL_API_KEY", raising=False)
    monkeypatch.delenv("NREL_API_EMAIL", raising=False)
    local_env = {
        "NREL_API_KEY": "first-test-key",
        "NREL_API_EMAIL": "first@example.com",
    }

    monkeypatch.setattr(
        weather_provider,
        "dotenv_values",
        lambda _path: local_env.copy(),
    )
    first = weather_provider._local_environment()
    local_env.update(
        NREL_API_KEY="updated-test-key",
        NREL_API_EMAIL="updated@example.com",
    )
    second = weather_provider._local_environment()

    assert first["NREL_API_KEY"] == "first-test-key"
    assert second["NREL_API_KEY"] == "updated-test-key"


def test_wind_toolkit_does_not_treat_queued_json_as_hourly_data(monkeypatch) -> None:
    _ignore_local_env(monkeypatch)
    monkeypatch.setenv("NREL_API_KEY", "test-only-api-key")
    monkeypatch.setenv("NREL_API_EMAIL", "test@example.com")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "status": "download generation in progress",
                "message": "The result will be emailed when it is ready.",
                "download_url": (
                    "https://example.invalid/download?api_key=test-only-api-key"
                    "&email=test@example.com"
                ),
            },
            request=request,
        )

    monkeypatch.setattr(
        weather_provider,
        "_provider_client",
        lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(WeatherProviderError) as error:
        weather_provider.fetch_wind_toolkit_day(
            2012,
            1,
            latitude=36.12345,
            longitude=-82.12345,
        )

    message = str(error.value)
    assert "still processing" in message
    assert "no hourly CSV data" in message
    assert "example.invalid" not in message
    assert "test-only-api-key" not in message
    assert "test@example.com" not in message
