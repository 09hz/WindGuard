"""FastAPI application exposing the WindGuard Twin simulated-data API."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from backend.models import (
    DATA_STATUS,
    DISCLAIMER,
    FarmOverviewResponse,
    ForecastResponse,
    GridStatusResponse,
    HealthResponse,
    Recommendation,
    RecommendationsResponse,
    ScenarioRequest,
    ScenarioResponse,
    TurbineDetailResponse,
    TurbinesResponse,
    TwinResult,
    WindToolkitResponse,
)
from backend.services.data_loader import DataLoadError, get_simulated_data
from backend.services.twin_engine import run_twin
from backend.services.weather_provider import (
    FARM_LATITUDE,
    FARM_LONGITUDE,
    WeatherProviderError,
    fetch_nws_hourly_forecast,
    fetch_wind_toolkit_day,
)

app = FastAPI(
    title="WindGuard Twin API",
    description=(
        "Prototype API using simulated wind-farm data. Results are not safety "
        "or dispatch instructions."
    ),
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _calculate(
    *,
    weather_source: Literal["demo", "nws"] = "demo",
    wind_multiplier: float = 1.0,
    export_capacity_mw: float | None = None,
    battery_enabled: bool | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Load fresh fixture copies and calculate a transient scenario result."""
    try:
        turbines, fixture_forecast, grid, battery = get_simulated_data()
        turbines = deepcopy(turbines)
        forecast = (
            fetch_nws_hourly_forecast()
            if weather_source == "nws"
            else deepcopy(fixture_forecast)
        )
        grid = deepcopy(grid)
        battery = deepcopy(battery)

        for hour in forecast:
            hour["wind_speed_m_s"] *= wind_multiplier
            hour["gust_speed_m_s"] *= wind_multiplier
        if export_capacity_mw is not None:
            grid["export_limit_mw"] = export_capacity_mw
        if battery_enabled is not None:
            battery["enabled"] = battery_enabled

        capacity = grid.get("export_limit_mw")
        result = run_twin(turbines, forecast, capacity, battery)
        result["weather_source"] = weather_source
    except DataLoadError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except WeatherProviderError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to calculate results from the local demo fixtures: {error}",
        ) from error

    by_id = {turbine["id"]: turbine for turbine in turbines}
    for calculated in result["turbines"]:
        source = by_id[calculated["id"]]
        for field in (
            "latitude",
            "longitude",
            "vibration_mm_s",
            "bearing_temperature_c",
            "days_since_maintenance",
            "baseline_health_status",
        ):
            calculated[field] = source[field]
    return result, forecast, turbines, grid, battery


def _recommendations(result: dict[str, Any]) -> list[Recommendation]:
    """Build concise health, maintenance, and grid recommendations."""
    recommendations = []
    for turbine in result["turbines"]:
        action = turbine["recommendation"]
        if action == "inspect now":
            reason = (
                f"Illustrative failure risk is {turbine['failure_risk']:.0%}, "
                f"at or above the inspect-now threshold."
            )
        else:
            reason = (
                f"Risk is below the inspect-now threshold; use the lowest-generation "
                f"window at {result['maintenance_window']['timestamp_utc']}."
            )
        recommendations.append(
            Recommendation(
                action=action,
                turbine_id=turbine["id"],
                reason=reason,
                details={
                    "failure_risk": turbine["failure_risk"],
                    "energy_at_risk_mwh": turbine["energy_at_risk_mwh"],
                    "energy_at_risk_rank": turbine["energy_at_risk_rank"],
                },
            )
        )

    for hour in result["dispatch"]:
        if hour["battery_charge_mw"] > 0:
            recommendations.append(
                Recommendation(
                    action="use battery storage",
                    timestamp_utc=hour["timestamp_utc"],
                    reason="Charge the enabled battery to absorb grid export overload first.",
                    details={"charge_mw": hour["battery_charge_mw"]},
                )
            )
        for curtailed in hour["curtailed_turbines"]:
            recommendations.append(
                Recommendation(
                    action="curtail low-priority turbine",
                    turbine_id=curtailed["turbine_id"],
                    timestamp_utc=hour["timestamp_utc"],
                    reason=curtailed["reason"],
                    details={"curtailed_mw": curtailed["curtailed_mw"]},
                )
            )
    return recommendations


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report API status and the simulated-data limitation."""
    return HealthResponse()


@app.get("/api/farm/overview", response_model=FarmOverviewResponse)
def farm_overview(
    source: Literal["demo", "nws"] = Query(default="demo"),
) -> FarmOverviewResponse:
    """Return the farm-wide generation, energy-risk, and grid summary."""
    result, _, turbines, grid, _ = _calculate(weather_source=source)
    dispatch = result["dispatch"]
    return FarmOverviewResponse(
        turbine_count=len(turbines),
        weather_source=source,
        expected_energy_mwh=result["expected_energy_mwh"],
        energy_at_risk_mwh=result["energy_at_risk_mwh"],
        grid_export_capacity_mw=grid["export_limit_mw"],
        peak_generation_mw=max(hour["gross_generation_mw"] for hour in dispatch),
        overload_hours=sum(
            hour["gross_generation_mw"] > grid["export_limit_mw"] for hour in dispatch
        ),
        turbines_requiring_inspection=sum(
            turbine["recommendation"] == "inspect now" for turbine in result["turbines"]
        ),
        maintenance_window=result["maintenance_window"],
    )


@app.get("/api/turbines", response_model=TurbinesResponse)
def list_turbines(
    source: Literal["demo", "nws"] = Query(default="demo"),
) -> TurbinesResponse:
    """Return health, risk, and expected energy for every simulated turbine."""
    result, _, _, _, _ = _calculate(weather_source=source)
    return TurbinesResponse(
        weather_source=source,
        turbines=result["turbines"],
        ranking_by_energy_at_risk=result["turbine_ranking_by_energy_at_risk"],
    )


@app.get("/api/turbines/{turbine_id}", response_model=TurbineDetailResponse)
def get_turbine(
    turbine_id: str,
    source: Literal["demo", "nws"] = Query(default="demo"),
) -> TurbineDetailResponse:
    """Return detailed calculated information for one turbine."""
    result, _, _, _, _ = _calculate(weather_source=source)
    turbine = next((item for item in result["turbines"] if item["id"] == turbine_id), None)
    if turbine is None:
        raise HTTPException(status_code=404, detail=f"Unknown turbine ID: {turbine_id}")
    return TurbineDetailResponse(weather_source=source, turbine=turbine)


@app.get("/api/forecast", response_model=ForecastResponse)
def get_forecast(
    source: Literal["demo", "nws"] = Query(default="demo"),
) -> ForecastResponse:
    """Return the hourly weather and generation/export forecast."""
    result, forecast, _, _, _ = _calculate(weather_source=source)
    hours = []
    for weather, dispatch in zip(forecast, result["dispatch"]):
        hours.append(
            {
                "timestamp_utc": weather["timestamp_utc"],
                "wind_speed_m_s": weather["wind_speed_m_s"],
                "gust_speed_m_s": weather["gust_speed_m_s"],
                "gust_estimated": weather.get("gust_estimated", False),
                "gross_generation_mw": dispatch["gross_generation_mw"],
                "grid_export_mw": dispatch["grid_export_mw"],
                "battery_charge_mw": dispatch["battery_charge_mw"],
                "curtailed_generation_mw": dispatch["curtailed_generation_mw"],
            }
        )
    return ForecastResponse(weather_source=source, hours=hours)


@app.get("/api/grid/status", response_model=GridStatusResponse)
def grid_status(
    source: Literal["demo", "nws"] = Query(default="demo"),
) -> GridStatusResponse:
    """Return configured export capacity and hourly dispatch outcomes."""
    result, _, _, grid, battery = _calculate(weather_source=source)
    return GridStatusResponse(
        weather_source=source,
        export_capacity_mw=grid["export_limit_mw"],
        peak_generation_mw=max(hour["gross_generation_mw"] for hour in result["dispatch"]),
        overload_hours=sum(
            hour["gross_generation_mw"] > grid["export_limit_mw"]
            for hour in result["dispatch"]
        ),
        battery_enabled=battery["enabled"],
        battery_capacity_mwh=battery["capacity_mwh"],
        battery_initial_state_of_charge_mwh=battery["state_of_charge_mwh"],
        battery_final_state_of_charge_mwh=result["battery_final_state_of_charge_mwh"],
        dispatch=result["dispatch"],
    )


@app.get("/api/recommendations", response_model=RecommendationsResponse)
def get_recommendations(
    source: Literal["demo", "nws"] = Query(default="demo"),
) -> RecommendationsResponse:
    """Return turbine maintenance and hourly grid-overload recommendations."""
    result, _, _, _, _ = _calculate(weather_source=source)
    return RecommendationsResponse(
        weather_source=source,
        recommendations=_recommendations(result),
    )


@app.get("/api/weather/wind-toolkit", response_model=WindToolkitResponse)
def get_wind_toolkit_day(
    year: int = Query(default=2012, ge=2000, le=2020),
    day_of_year: int = Query(default=1, ge=1, le=366),
) -> WindToolkitResponse:
    """Return a historical NREL WIND Toolkit day for contextual comparison."""
    try:
        hours = fetch_wind_toolkit_day(
            year,
            day_of_year,
            latitude=FARM_LATITUDE,
            longitude=FARM_LONGITUDE,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except WeatherProviderError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return WindToolkitResponse(
        year=year,
        day_of_year=day_of_year,
        latitude=FARM_LATITUDE,
        longitude=FARM_LONGITUDE,
        hours=hours,
    )


@app.post("/api/scenarios", response_model=ScenarioResponse)
def run_scenario(scenario: ScenarioRequest) -> ScenarioResponse:
    """Recompute the complete forecast for temporary scenario overrides."""
    result, _, _, _, _ = _calculate(
        weather_source=scenario.weather_source,
        wind_multiplier=scenario.wind_multiplier,
        export_capacity_mw=scenario.export_capacity_mw,
        battery_enabled=scenario.battery_enabled,
    )
    return ScenarioResponse(**result, scenario=scenario)
