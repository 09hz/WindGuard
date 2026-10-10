"""Pydantic request and response models for the WindGuard Twin API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

DATA_STATUS = "SIMULATED DEMO DATA"
DISCLAIMER = (
    "Prototype results use simulated operational data and are not safety or dispatch instructions."
)


class StrictModel(BaseModel):
    """Base model rejecting unrecognized request or response fields."""

    model_config = ConfigDict(extra="forbid")


class ScenarioRequest(StrictModel):
    """Temporary scenario overrides; they are never persisted."""

    wind_multiplier: float = Field(default=1.0, gt=0.0, le=3.0)
    export_capacity_mw: float = Field(default=30.0, gt=0.0, le=1000.0)
    battery_enabled: bool = True
    weather_source: Literal["demo", "nws"] = "demo"


class WindToolkitResponse(BaseModel):
    data_status: Literal["HISTORICAL WIND TOOLKIT DATA"] = "HISTORICAL WIND TOOLKIT DATA"
    disclaimer: str = (
        "Historical WIND Toolkit resource data; not a current forecast or dispatch instruction."
    )
    year: int
    day_of_year: int
    latitude: float
    longitude: float
    hours: list[dict[str, Any]]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER


class RiskMethod(BaseModel):
    weights: dict[str, float]
    normalization: dict[str, str]
    inspect_now_threshold: float


class TurbineResult(BaseModel):
    id: str
    name: str
    rated_power_mw: float
    rotor_rpm: float
    failure_risk: float
    risk_components: dict[str, float]
    weighted_risk_components: dict[str, float]
    risk_explanation: str
    expected_energy_mwh: float
    energy_at_risk_mwh: float
    hourly_generation_mw: list[float]
    recommendation: str
    energy_at_risk_rank: int
    latitude: float | None = None
    longitude: float | None = None
    vibration_mm_s: float | None = None
    bearing_temperature_c: float | None = None
    days_since_maintenance: float | None = None
    baseline_health_status: str | None = None


class RankingEntry(BaseModel):
    rank: int
    turbine_id: str
    energy_at_risk_mwh: float


class MaintenanceWindow(BaseModel):
    hour_index: int
    timestamp_utc: str | None
    predicted_farm_generation_mw: float
    explanation: str


class Curtailment(BaseModel):
    turbine_id: str
    curtailed_mw: float
    reason: str


class DispatchHour(BaseModel):
    timestamp_utc: str | None
    hour_index: int
    gross_generation_mw: float
    grid_export_capacity_mw: float
    battery_charge_mw: float
    battery_state_of_charge_mwh: float
    curtailed_generation_mw: float
    curtailed_turbines: list[Curtailment]
    grid_export_mw: float
    explanation: str


class ForecastHour(BaseModel):
    timestamp_utc: str
    wind_speed_m_s: float
    gust_speed_m_s: float
    gust_estimated: bool = False
    gross_generation_mw: float
    grid_export_mw: float
    battery_charge_mw: float
    curtailed_generation_mw: float


class Recommendation(BaseModel):
    action: str
    turbine_id: str | None = None
    timestamp_utc: str | None = None
    reason: str
    details: dict[str, Any] = Field(default_factory=dict)


class TwinResult(BaseModel):
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER
    risk_method: RiskMethod
    energy_assumption: str
    expected_energy_mwh: float
    energy_at_risk_mwh: float
    maintenance_window: MaintenanceWindow
    turbines: list[TurbineResult]
    turbine_ranking_by_energy_at_risk: list[RankingEntry]
    dispatch: list[DispatchHour]
    battery_final_state_of_charge_mwh: float


class FarmOverviewResponse(BaseModel):
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER
    weather_source: Literal["demo", "nws"] = "demo"
    turbine_count: int
    expected_energy_mwh: float
    energy_at_risk_mwh: float
    grid_export_capacity_mw: float
    peak_generation_mw: float
    overload_hours: int
    turbines_requiring_inspection: int
    maintenance_window: MaintenanceWindow


class TurbinesResponse(BaseModel):
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER
    weather_source: Literal["demo", "nws"] = "demo"
    turbines: list[TurbineResult]
    ranking_by_energy_at_risk: list[RankingEntry]


class TurbineDetailResponse(BaseModel):
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER
    weather_source: Literal["demo", "nws"] = "demo"
    turbine: TurbineResult


class ForecastResponse(BaseModel):
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER
    weather_source: Literal["demo", "nws"] = "demo"
    hours: list[ForecastHour]


class GridStatusResponse(BaseModel):
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER
    weather_source: Literal["demo", "nws"] = "demo"
    export_capacity_mw: float
    peak_generation_mw: float
    overload_hours: int
    battery_enabled: bool
    battery_capacity_mwh: float
    battery_initial_state_of_charge_mwh: float
    battery_final_state_of_charge_mwh: float
    dispatch: list[DispatchHour]


class RecommendationsResponse(BaseModel):
    data_status: Literal["SIMULATED DEMO DATA"] = DATA_STATUS
    disclaimer: str = DISCLAIMER
    weather_source: Literal["demo", "nws"] = "demo"
    recommendations: list[Recommendation]


class ScenarioResponse(TwinResult):
    scenario: ScenarioRequest
    weather_source: Literal["demo", "nws"] = "demo"
