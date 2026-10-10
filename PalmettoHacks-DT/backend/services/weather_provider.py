"""Adapters for the public NWS forecast and NREL WIND Toolkit APIs."""

from __future__ import annotations

import csv
import io
import math
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

NWS_API_BASE = "https://api.weather.gov"
NREL_WIND_TOOLKIT_URL = (
    "https://developer.nrel.gov/api/wind-toolkit/v2/wind/wtk-download.csv"
)
FARM_LATITUDE = float(os.getenv("WEATHER_LATITUDE", "34.054"))
FARM_LONGITUDE = float(os.getenv("WEATHER_LONGITUDE", "-81.063"))
NWS_USER_AGENT = os.getenv(
    "NWS_USER_AGENT", "WindGuardTwin/0.1 (local hackathon demo)"
)


class WeatherProviderError(RuntimeError):
    """Raised when a weather provider cannot return usable data."""


class _TTLCache:
    """Small, thread-safe in-process cache for provider responses."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= time.monotonic():
                del self._entries[key]
                return None
            return value

    def put(self, key: str, value: Any, ttl_seconds: int) -> None:
        with self._lock:
            self._entries[key] = (time.monotonic() + ttl_seconds, value)


_CACHE = _TTLCache()
_NWS_REQUEST_LOCK = threading.Lock()


def _provider_client() -> httpx.Client:
    """Create a provider client with a descriptive user agent and timeout."""
    return httpx.Client(
        timeout=httpx.Timeout(12.0, connect=5.0),
        headers={
            "User-Agent": NWS_USER_AGENT,
            "Accept": "application/geo+json, application/json, text/csv",
        },
        follow_redirects=True,
    )


def _wind_speed_to_m_s(value: Any, *, default_unit: str = "mph") -> float:
    """Convert NWS human-readable wind speed values to meters per second."""
    if isinstance(value, str) and value.strip().lower() in {"calm", "calm winds"}:
        return 0.0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        values = [float(value)]
        unit = default_unit
    elif isinstance(value, str):
        matches = re.findall(r"\d+(?:\.\d+)?", value)
        if not matches:
            raise WeatherProviderError(f"Unrecognized wind speed value: {value!r}")
        values = [float(match) for match in matches]
        lowered = value.lower()
        unit = (
            "km/h" if "km/h" in lowered or "kph" in lowered else
            "knots" if "knot" in lowered or re.search(r"\bkt\b", lowered) else
            "m/s" if "m/s" in lowered else
            "mph"
        )
    else:
        raise WeatherProviderError(f"Unrecognized wind speed value: {value!r}")

    factors = {"mph": 0.44704, "km/h": 1 / 3.6, "knots": 0.514444, "m/s": 1.0}
    factor = factors[unit]
    speed = sum(values) / len(values) * factor
    if not math.isfinite(speed) or speed < 0:
        raise WeatherProviderError("Wind speed must be a finite non-negative value.")
    return round(speed, 2)


def _fetch_nws_hourly_forecast_uncached(
    latitude: float = FARM_LATITUDE,
    longitude: float = FARM_LONGITUDE,
    *,
    hours: int = 24,
) -> list[dict[str, Any]]:
    """Fetch and normalize an NWS point forecast into hourly wind and gust rows.

    Results are cached for 15 minutes to respect NWS rate limits. Missing gust
    values use a documented illustrative 1.25x wind-speed estimate.
    """
    if not math.isfinite(latitude) or not -90 <= latitude <= 90:
        raise ValueError("latitude must be between -90 and 90.")
    if not math.isfinite(longitude) or not -180 <= longitude <= 180:
        raise ValueError("longitude must be between -180 and 180.")
    if not 1 <= hours <= 156:
        raise ValueError("hours must be between 1 and 156.")

    cache_key = f"nws:{latitude:.5f}:{longitude:.5f}:{hours}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return [dict(row) for row in cached]

    try:
        with _provider_client() as client:
            point_response = client.get(
                f"{NWS_API_BASE}/points/{latitude:.4f},{longitude:.4f}"
            )
            point_response.raise_for_status()
            point_payload = point_response.json()
            hourly_url = point_payload["properties"]["forecastHourly"]
            if (
                not isinstance(hourly_url, str)
                or urlsplit(hourly_url).scheme != "https"
                or urlsplit(hourly_url).hostname != "api.weather.gov"
            ):
                raise WeatherProviderError("NWS point response contained an invalid hourly URL.")

            forecast_response = client.get(hourly_url)
            forecast_response.raise_for_status()
            forecast_payload = forecast_response.json()
    except WeatherProviderError:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
        raise WeatherProviderError(f"NWS forecast request failed: {error}") from error

    periods = forecast_payload.get("properties", {}).get("periods")
    if not isinstance(periods, list):
        raise WeatherProviderError("NWS hourly response has no forecast periods.")

    cutoff = datetime.now(timezone.utc) + timedelta(hours=hours)
    rows: list[dict[str, Any]] = []
    for period in periods:
        try:
            timestamp = datetime.fromisoformat(
                period["startTime"].replace("Z", "+00:00")
            )
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            if timestamp.astimezone(timezone.utc) > cutoff:
                continue
            wind = _wind_speed_to_m_s(period.get("windSpeed"))
            gust_value = period.get("windGust")
            gust = (
                _wind_speed_to_m_s(gust_value)
                if gust_value is not None
                else round(wind * 1.25, 2)
            )
        except (KeyError, TypeError, ValueError) as error:
            raise WeatherProviderError(
                f"NWS hourly response contains a malformed forecast period: {error}"
            ) from error
        rows.append(
            {
                "timestamp_utc": timestamp.astimezone(timezone.utc).isoformat(),
                "wind_speed_m_s": wind,
                "gust_speed_m_s": max(wind, gust),
                "gust_estimated": gust_value is None,
                "data_status": "LIVE NWS FORECAST",
            }
        )
        if len(rows) == hours:
            break

    if not rows:
        raise WeatherProviderError("NWS returned no usable hourly wind forecast.")
    _CACHE.put(cache_key, rows, ttl_seconds=900)
    return [dict(row) for row in rows]


def fetch_nws_hourly_forecast(
    latitude: float = FARM_LATITUDE,
    longitude: float = FARM_LONGITUDE,
    *,
    hours: int = 24,
) -> list[dict[str, Any]]:
    """Fetch a cached NWS forecast, coalescing simultaneous requests."""
    cache_key = f"nws:{latitude:.5f}:{longitude:.5f}:{hours}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return [dict(row) for row in cached]

    with _NWS_REQUEST_LOCK:
        cached = _CACHE.get(cache_key)
        if cached is not None:
            return [dict(row) for row in cached]
        return _fetch_nws_hourly_forecast_uncached(
            latitude,
            longitude,
            hours=hours,
        )


def _find_wind_column(headers: list[str]) -> str:
    """Find the hourly wind-speed column in a WIND Toolkit CSV."""
    for header in headers:
        normalized = header.strip().lower().replace("_", " ")
        if "wind speed" in normalized and "direction" not in normalized:
            return header
    raise WeatherProviderError(
        "WIND Toolkit CSV did not include a recognizable wind speed column."
    )


def _parse_wind_toolkit_csv(
    csv_text: str,
    *,
    year: int,
    day_of_year: int,
) -> list[dict[str, Any]]:
    """Extract one UTC day of hourly wind speed from WIND Toolkit CSV text."""
    rows = csv.reader(io.StringIO(csv_text))
    header: list[str] | None = None
    for row in rows:
        lowered = {cell.strip().lower() for cell in row}
        if {"year", "month", "day", "hour"}.issubset(lowered):
            header = [cell.strip() for cell in row]
            break
    if header is None:
        raise WeatherProviderError("WIND Toolkit response did not contain a CSV data header.")

    wind_column = _find_wind_column(header)
    indices = {name.strip().lower(): index for index, name in enumerate(header)}
    wind_index = header.index(wind_column)
    target_date = date(year, 1, 1) + timedelta(days=day_of_year - 1)

    buffered_rows: list[dict[str, Any]] = []
    for row in rows:
        if len(row) < len(header):
            continue
        try:
            year_value = int(row[indices["year"]])
            month_value = int(row[indices["month"]])
            day_value = int(row[indices["day"]])
            hour_value = int(row[indices["hour"]])
            speed = float(row[wind_index])
            timestamp = datetime(
                year_value,
                month_value,
                day_value,
                hour_value % 24,
                tzinfo=timezone.utc,
            )
        except (ValueError, IndexError):
            continue
        if timestamp.date() == target_date:
            buffered_rows.append(
                {
                    "timestamp_utc": timestamp.isoformat(),
                    "wind_speed_m_s": round(speed, 2),
                    "data_status": "HISTORICAL WIND TOOLKIT DATA",
                }
            )
    if len(buffered_rows) != 24:
        raise WeatherProviderError(
            f"WIND Toolkit returned {len(buffered_rows)} hourly values for "
            f"{target_date.isoformat()}, expected 24."
        )
    return buffered_rows


def fetch_wind_toolkit_day(
    year: int,
    day_of_year: int,
    *,
    latitude: float = FARM_LATITUDE,
    longitude: float = FARM_LONGITUDE,
) -> list[dict[str, Any]]:
    """Fetch a historical hourly day from the NREL WIND Toolkit API.

    WIND Toolkit is archival resource data, not a current weather forecast.
    Set ``NREL_API_KEY`` in the environment; the key is never returned to callers.
    """
    if not 2007 <= year <= 2013:
        raise ValueError("WIND Toolkit year must be between 2007 and 2013.")
    maximum_day = 366 if year % 4 == 0 else 365
    if not 1 <= day_of_year <= maximum_day:
        raise ValueError(f"day_of_year must be between 1 and {maximum_day} for {year}.")
    if not math.isfinite(latitude) or not -90 <= latitude <= 90:
        raise ValueError("latitude must be between -90 and 90.")
    if not math.isfinite(longitude) or not -180 <= longitude <= 180:
        raise ValueError("longitude must be between -180 and 180.")
    api_key = os.getenv("NREL_API_KEY")
    if not api_key:
        raise WeatherProviderError(
            "NREL_API_KEY is not configured. Set it in the backend environment "
            "to access the historical WIND Toolkit API."
        )

    cache_key = f"nrel:{year}:{day_of_year}:{latitude:.5f}:{longitude:.5f}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return [dict(row) for row in cached]

    params = {
        "api_key": api_key,
        "wkt": f"POINT({longitude:.5f} {latitude:.5f})",
        "names": str(year),
        "utc": "true",
        "leap_day": "true",
        "interval": "60",
        "attributes": "wind_speed",
    }
    try:
        with _provider_client() as client:
            response = client.get(NREL_WIND_TOOLKIT_URL, params=params)
            response.raise_for_status()
            day = _parse_wind_toolkit_csv(
                response.text,
                year=year,
                day_of_year=day_of_year,
            )
    except WeatherProviderError:
        raise
    except httpx.HTTPStatusError as error:
        raise WeatherProviderError(
            f"NREL WIND Toolkit returned HTTP {error.response.status_code}. "
            "Check the API key, query limits, and requested site/year."
        ) from error
    except httpx.RequestError as error:
        raise WeatherProviderError(
            f"NREL WIND Toolkit network request failed ({type(error).__name__})."
        ) from error
    except ValueError as error:
        raise WeatherProviderError(f"NREL WIND Toolkit request failed: {error}") from error

    _CACHE.put(cache_key, day, ttl_seconds=86400)
    return [dict(row) for row in day]
