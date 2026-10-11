import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BatteryCharging,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Gauge,
  Leaf,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Wind,
  Zap,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import TabNav from "./TabNav.jsx";

const DISCLAIMER =
  "Prototype using simulated operational data; not for real-world safety or dispatch decisions.";
const RISK_COLORS = {
  green: "#78e7a8",
  yellow: "#f1bd67",
  red: "#ff6b70",
};
const NODE_POSITIONS = [
  [14, 24],
  [31, 18],
  [47, 27],
  [67, 17],
  [82, 29],
  [20, 67],
  [39, 73],
  [57, 63],
  [75, 76],
  [89, 62],
];

function riskTone(risk = 0) {
  if (risk >= 0.65) return "red";
  if (risk >= 0.35) return "yellow";
  return "green";
}

function formatEnergy(value = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPower(value = 0) {
  return Number(value).toFixed(1);
}

function formatPercent(value = 0) {
  return `${Math.round(value * 100)}%`;
}

function formatHour(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function buildScenarioOverview(result, capacity) {
  const dispatch = result.dispatch;
  return {
    data_status: result.data_status,
    disclaimer: result.disclaimer,
    turbine_count: result.turbines.length,
    expected_energy_mwh: result.expected_energy_mwh,
    energy_at_risk_mwh: result.energy_at_risk_mwh,
    grid_export_capacity_mw: capacity,
    peak_generation_mw: Math.max(...dispatch.map((hour) => hour.gross_generation_mw)),
    overload_hours: dispatch.filter((hour) => hour.gross_generation_mw > capacity).length,
    turbines_requiring_inspection: result.turbines.filter(
      (turbine) => turbine.recommendation === "inspect now",
    ).length,
    maintenance_window: result.maintenance_window,
  };
}

function buildScenarioRecommendations(result) {
  const maintenance = result.maintenance_window;
  const turbineActions = result.turbines.map((turbine) => ({
    action: turbine.recommendation,
    turbine_id: turbine.id,
    reason:
      turbine.recommendation === "inspect now"
        ? `Illustrative failure risk is ${formatPercent(turbine.failure_risk)}.`
        : `Use the lowest-generation window at ${maintenance.timestamp_utc ?? "the forecast low"}.`,
    details: {
      failure_risk: turbine.failure_risk,
      energy_at_risk_mwh: turbine.energy_at_risk_mwh,
      energy_at_risk_rank: turbine.energy_at_risk_rank,
    },
  }));
  const gridActions = result.dispatch.flatMap((hour) => {
    const actions = [];
    if (hour.battery_charge_mw > 0) {
      actions.push({
        action: "use battery storage",
        timestamp_utc: hour.timestamp_utc,
        reason: "Charge storage first to absorb simulated export overload.",
        details: { charge_mw: hour.battery_charge_mw },
      });
    }
    for (const curtailed of hour.curtailed_turbines) {
      actions.push({
        action: "curtail low-priority turbine",
        turbine_id: curtailed.turbine_id,
        timestamp_utc: hour.timestamp_utc,
        reason: curtailed.reason,
        details: { curtailed_mw: curtailed.curtailed_mw },
      });
    }
    return actions;
  });
  return [...turbineActions, ...gridActions];
}

function MetricCard({ icon: Icon, label, value, unit, detail, tone = "teal", trend }) {
  const toneClass =
    tone === "red"
      ? "text-danger"
      : tone === "amber"
        ? "text-amber"
        : tone === "green"
          ? "text-mint"
          : "text-teal";
  return (
    <article className="panel rounded-2xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="eyebrow">{label}</div>
        <div className={`rounded-xl border border-white/[0.06] bg-white/[0.035] p-2 ${toneClass}`}>
          <Icon size={17} strokeWidth={1.8} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={`metric-value text-[30px] font-semibold text-slate-100 sm:text-[34px]`}>
          {value}
        </span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      <div className="mt-2 flex min-h-5 items-center gap-1.5 text-xs text-slate-400">
        {trend === "up" && <ArrowUpRight size={14} className="text-danger" />}
        <span>{detail}</span>
      </div>
    </article>
  );
}

function PanelHeading({ eyebrow, title, trailing }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-100">{title}</h2>
      </div>
      {trailing}
    </div>
  );
}

function MapPanel({ turbines, selectedId, onSelect }) {
  const connections = [
    [14, 24, 50, 46],
    [31, 18, 50, 46],
    [47, 27, 50, 46],
    [67, 17, 50, 46],
    [82, 29, 50, 46],
    [20, 67, 50, 53],
    [39, 73, 50, 53],
    [57, 63, 50, 53],
    [75, 76, 50, 53],
    [89, 62, 50, 53],
    [50, 46, 50, 53],
    [50, 53, 50, 92],
  ];
  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <PanelHeading
        eyebrow="Live site layout"
        title="Farm overview"
        trailing={
          <div className="hidden items-center gap-3 sm:flex">
            {[
              ["green", "Healthy"],
              ["yellow", "Watch"],
              ["red", "High risk"],
            ].map(([tone, label]) => (
              <span key={tone} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLORS[tone] }} />
                {label}
              </span>
            ))}
          </div>
        }
      />
      <div className="map-grid relative mt-5 h-[255px] overflow-hidden rounded-xl border border-white/[0.055] bg-[#0b171f] sm:h-[292px]">
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-ink/80 px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
          <MapPin size={11} />
          Palmetto wind site · simulated
        </div>
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <defs>
            <linearGradient id="cable" x1="0" x2="1">
              <stop offset="0%" stopColor="#31515a" stopOpacity=".3" />
              <stop offset="100%" stopColor="#4fe0c1" stopOpacity=".8" />
            </linearGradient>
          </defs>
          {connections.map(([x1, y1, x2, y2], index) => (
            <line
              key={index}
              x1={`${x1}%`}
              y1={`${y1}%`}
              x2={`${x2}%`}
              y2={`${y2}%`}
              stroke="url(#cable)"
              strokeDasharray="1.2 1"
              strokeWidth=".35"
            />
          ))}
          <circle cx="50%" cy="50%" r="7%" fill="none" stroke="#4fe0c1" strokeOpacity=".13" strokeWidth=".3" />
        </svg>
        {turbines.map((turbine, index) => {
          const [left, top] = NODE_POSITIONS[index % NODE_POSITIONS.length];
          const tone = riskTone(turbine.failure_risk);
          const color = RISK_COLORS[tone];
          return (
            <button
              key={turbine.id}
              type="button"
              className={`map-node absolute z-10 flex flex-col items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-white/[0.04] ${selectedId === turbine.id ? "bg-white/[0.055]" : ""}`}
              style={{ left: `${left}%`, top: `${top}%`, color }}
              onClick={() => onSelect(turbine.id)}
              aria-label={`${turbine.name}, ${formatPercent(turbine.failure_risk)} risk. Select turbine.`}
              aria-pressed={selectedId === turbine.id}
            >
              <span className="relative flex h-8 w-8 items-center justify-center">
                {tone === "red" && (
                  <span className="absolute inset-0 animate-ping rounded-full opacity-20" style={{ background: color }} />
                )}
                <span
                  className="node-disc relative flex h-7 w-7 items-center justify-center rounded-full border transition"
                  style={{
                    borderColor: `${color}99`,
                    background: `${color}1c`,
                    color,
                  }}
                >
                  <Wind size={14} strokeWidth={2} />
                </span>
              </span>
              <span className="whitespace-nowrap rounded bg-ink/85 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-slate-300">
                {turbine.id}
              </span>
            </button>
          );
        })}
        <div className="absolute left-1/2 top-[92%] z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg border border-teal/25 bg-[#10252b] px-3 py-1.5 shadow-[0_0_24px_rgba(79,224,193,0.1)]">
          <Zap size={13} className="text-teal" />
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-teal">Substation</span>
        </div>
        <div className="absolute bottom-2 left-3 text-[9px] text-slate-600">
          Select a turbine node to inspect its simulated health profile
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500 sm:hidden">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" /> Healthy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" /> Watch
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-danger" /> High risk
        </span>
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip min-w-40">
      <div className="text-[10px] font-medium text-slate-500">{row.fullTime || label}</div>
      <div className="mt-2 flex items-center justify-between gap-5 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-teal" />
          Farm output
        </span>
        <strong className="text-slate-100">{formatPower(row.output)} MW</strong>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-5 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          Grid limit
        </span>
        <strong className="text-slate-100">{formatPower(row.capacity)} MW</strong>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-5 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Grid export
        </span>
        <strong className="text-slate-100">{formatPower(row.export)} MW</strong>
      </div>
    </div>
  );
}

function GenerationChart({ forecast, capacity }) {
  const chartData = forecast.map((hour) => ({
    ...hour,
    output: hour.gross_generation_mw,
    capacity,
    export: hour.grid_export_mw,
    shortTime: formatHour(hour.timestamp_utc),
    fullTime: new Date(hour.timestamp_utc).toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      timeZone: "UTC",
      timeZoneName: "short",
    }),
  }));
  const maxValue = Math.max(capacity, ...chartData.map((hour) => hour.output), 1);
  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PanelHeading eyebrow="Next 24 hours" title="Farm output forecast" />
        <div className="flex items-center gap-3 pb-0.5 text-[10px] text-slate-400 sm:gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-full bg-teal" /> Generation
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-3 border-t border-dashed border-amber" /> Export limit
          </span>
        </div>
      </div>
      <div className="mt-5 h-[218px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="outputFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4fe0c1" stopOpacity={0.24} />
                <stop offset="95%" stopColor="#4fe0c1" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(145, 166, 174, .09)" vertical={false} />
            <XAxis
              dataKey="shortTime"
              tick={{ fill: "#778994", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 6) - 1)}
              dy={9}
            />
            <YAxis
              domain={[0, Math.ceil(maxValue / 10) * 10]}
              tick={{ fill: "#778994", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${value}`}
              dx={-3}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine
              y={capacity}
              stroke="#f1bd67"
              strokeDasharray="5 5"
              strokeOpacity={0.8}
            />
            <Area
              type="monotone"
              dataKey="output"
              stroke="#4fe0c1"
              strokeWidth={2}
              fill="url(#outputFill)"
              activeDot={{ r: 4, fill: "#4fe0c1", stroke: "#09131b", strokeWidth: 2 }}
              name="Generation"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-white/[0.055] pt-3 text-[10px] text-slate-500">
        <span>Hourly forecast · MW gross generation</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-teal" />
          Export tracked against {formatPower(capacity)} MW capacity
        </span>
      </div>
    </section>
  );
}

function RiskBadge({ risk }) {
  const tone = riskTone(risk);
  const classes = {
    green: "bg-mint/[0.09] text-mint",
    yellow: "bg-amber/[0.1] text-amber",
    red: "bg-danger/[0.1] text-danger",
  };
  return (
    <span className={`inline-flex min-w-[52px] items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums ${classes[tone]}`}>
      <span className="h-1 w-1 rounded-full bg-current" />
      {formatPercent(risk)}
    </span>
  );
}

function RankingTable({ turbines, selectedId, onSelect }) {
  const ranking = [...turbines].sort(
    (left, right) => right.energy_at_risk_mwh - left.energy_at_risk_mwh,
  );
  return (
    <section className="panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between px-5 py-5 sm:px-6">
        <PanelHeading eyebrow="Risk-weighted outlook" title="Turbine ranking" />
        <span className="rounded-md border border-white/[0.07] px-2 py-1 text-[10px] text-slate-500">
          {ranking.length} assets
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[690px] border-collapse text-left">
          <thead>
            <tr className="border-y border-white/[0.055] bg-white/[0.018] text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              <th className="px-5 py-3 sm:px-6">Turbine</th>
              <th className="px-3 py-3">Failure risk</th>
              <th className="px-3 py-3 text-right">Forecast energy</th>
              <th className="px-3 py-3 text-right">Energy at risk</th>
              <th className="px-5 py-3 sm:px-6">Recommended action</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((turbine, index) => (
              <tr
                key={turbine.id}
                className={`cursor-pointer border-b border-white/[0.045] transition last:border-0 hover:bg-white/[0.035] ${selectedId === turbine.id ? "bg-teal/[0.035]" : ""}`}
                onClick={() => onSelect(turbine.id)}
              >
                <td className="px-5 py-3.5 sm:px-6">
                  <div className="flex items-center gap-3">
                    <span className="w-4 text-[10px] tabular-nums text-slate-600">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: RISK_COLORS[riskTone(turbine.failure_risk)] }}
                    />
                    <span className="text-xs font-semibold text-slate-200">{turbine.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  <RiskBadge risk={turbine.failure_risk} />
                </td>
                <td className="px-3 py-3.5 text-right text-xs tabular-nums text-slate-300">
                  {formatEnergy(turbine.expected_energy_mwh)} <span className="text-slate-600">MWh</span>
                </td>
                <td className="px-3 py-3.5 text-right text-xs font-semibold tabular-nums text-slate-200">
                  {turbine.energy_at_risk_mwh.toFixed(1)} <span className="font-normal text-slate-600">MWh</span>
                </td>
                <td className="px-5 py-3.5 sm:px-6">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] ${turbine.recommendation === "inspect now" ? "text-danger" : "text-slate-400"}`}>
                    {turbine.recommendation === "inspect now" ? (
                      <ShieldAlert size={13} />
                    ) : (
                      <Clock3 size={13} />
                    )}
                    {turbine.recommendation === "inspect now" ? "Inspect now" : "Schedule maintenance"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function actionStyle(action) {
  if (action === "inspect now") return { icon: ShieldAlert, tone: "red", label: "Inspect now" };
  if (action === "use battery storage") return { icon: BatteryCharging, tone: "green", label: "Battery dispatch" };
  if (action === "curtail low-priority turbine") return { icon: Zap, tone: "amber", label: "Curtailment" };
  return { icon: Clock3, tone: "amber", label: "Maintenance window" };
}

function RecommendationPanel({ recommendations, onSelect }) {
  const priority = {
    "inspect now": 0,
    "use battery storage": 1,
    "curtail low-priority turbine": 2,
    "schedule maintenance during the lowest-generation window": 3,
  };
  const topRecommendations = [...recommendations]
    .sort((left, right) => {
      const order = (priority[left.action] ?? 4) - (priority[right.action] ?? 4);
      if (order) return order;
      return (
        (left.details?.energy_at_risk_mwh ?? 0) -
        (right.details?.energy_at_risk_mwh ?? 0)
      );
    })
    .slice(0, 3);
  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <PanelHeading
        eyebrow="Next best actions"
        title="Recommendations"
        trailing={<span className="rounded-full bg-teal/[0.08] px-2.5 py-1 text-[10px] font-medium text-teal">Top 3</span>}
      />
      <div className="mt-4 space-y-2.5">
        {topRecommendations.map((recommendation, index) => {
          const style = actionStyle(recommendation.action);
          const Icon = style.icon;
          const toneClass =
            style.tone === "red"
              ? "text-danger bg-danger/[0.08]"
              : style.tone === "green"
                ? "text-mint bg-mint/[0.08]"
                : "text-amber bg-amber/[0.08]";
          return (
            <button
              type="button"
              key={`${recommendation.action}-${recommendation.turbine_id ?? recommendation.timestamp_utc ?? index}`}
              onClick={() => recommendation.turbine_id && onSelect(recommendation.turbine_id)}
              className="flex w-full items-start gap-3 rounded-xl border border-white/[0.055] bg-black/[0.08] p-3 text-left transition hover:border-white/[0.12] hover:bg-white/[0.025]"
            >
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
                <Icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{style.label}</span>
                  {recommendation.turbine_id && (
                    <span className="text-[10px] font-semibold text-slate-500">{recommendation.turbine_id}</span>
                  )}
                </span>
                <span className="mt-1 block line-clamp-2 text-[10px] leading-relaxed text-slate-500">
                  {recommendation.reason}
                </span>
              </span>
              <ChevronRight size={14} className="mt-2 shrink-0 text-slate-600" />
            </button>
          );
        })}
        {!topRecommendations.length && (
          <div className="rounded-xl border border-white/[0.055] p-4 text-xs text-slate-500">
            No recommendations are available for this forecast.
          </div>
        )}
      </div>
    </section>
  );
}

function TurbineDetail({ turbine, maintenanceWindow, selectedForecast }) {
  if (!turbine) {
    return (
      <section className="panel flex min-h-[260px] items-center justify-center rounded-2xl p-6 text-sm text-slate-500">
        Select a turbine on the farm diagram to view its detail.
      </section>
    );
  }
  const tone = riskTone(turbine.failure_risk);
  const toneClass =
    tone === "red" ? "text-danger" : tone === "yellow" ? "text-amber" : "text-mint";
  const components = [
    ["Vibration", turbine.weighted_risk_components?.vibration],
    ["Bearing temperature", turbine.weighted_risk_components?.bearing_temperature],
    ["Maintenance age", turbine.weighted_risk_components?.maintenance_age],
    ["Gust severity", turbine.weighted_risk_components?.gust_severity],
  ];
  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <PanelHeading
        eyebrow="Asset intelligence"
        title="Turbine detail"
        trailing={<span className="rounded-lg border border-white/[0.07] px-2 py-1 text-[10px] font-semibold text-slate-300">{turbine.id}</span>}
      />
      <div className="mt-4 flex items-center justify-between rounded-xl border border-white/[0.055] bg-black/[0.09] p-3.5">
        <div>
          <div className="text-sm font-semibold text-slate-100">{turbine.name}</div>
          <div className="mt-1 text-[10px] text-slate-500">
            {turbine.baseline_health_status ?? "Simulated health"} · {turbine.rated_power_mw} MW rated
          </div>
        </div>
        <div className={`text-right ${toneClass}`}>
          <div className="metric-value text-2xl font-semibold">{formatPercent(turbine.failure_risk)}</div>
          <div className="eyebrow mt-0.5 text-[8px]">Risk estimate</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["Vibration", `${Number(turbine.vibration_mm_s ?? 0).toFixed(1)} mm/s`],
          ["Bearing", `${Number(turbine.bearing_temperature_c ?? 0).toFixed(1)}° C`],
          ["Rotor speed", `${Number(turbine.rotor_rpm ?? 0).toFixed(1)} rpm`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/[0.045] bg-white/[0.018] px-2.5 py-2">
            <div className="eyebrow text-[8px]">{label}</div>
            <div className="mt-1 text-[11px] font-medium tabular-nums text-slate-200">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-[9px]">Risk contribution</span>
          <span className="text-[9px] text-slate-600">Weighted indicators</span>
        </div>
        <div className="mt-2.5 space-y-2">
          {components.map(([label, value]) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="w-[112px] shrink-0 text-[10px] text-slate-400">{label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-teal/80"
                  style={{ width: `${Math.max(2, Math.min(100, (value ?? 0) * 100))}%` }}
                />
              </div>
              <span className="w-8 text-right text-[10px] tabular-nums text-slate-500">{formatPercent(value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-white/[0.055] bg-white/[0.018] p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300">
          <CircleHelp size={12} className="text-teal" />
          Why this score?
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          {turbine.risk_explanation}
        </p>
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber/10 bg-amber/[0.035] p-3">
        <Clock3 size={13} className="mt-0.5 shrink-0 text-amber" />
        <div>
          <div className="text-[10px] font-semibold text-amber">Maintenance window</div>
          <div className="mt-1 text-[10px] leading-relaxed text-slate-400">
            {formatHour(maintenanceWindow?.timestamp_utc)} UTC · farm output dips to{" "}
            {formatPower(maintenanceWindow?.predicted_farm_generation_mw)} MW
            {selectedForecast?.wind_speed_m_s != null && (
              <span> · forecast wind {selectedForecast.wind_speed_m_s.toFixed(1)} m/s</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScenarioPanel({
  windMultiplier,
  setWindMultiplier,
  exportCapacity,
  setExportCapacity,
  batteryEnabled,
  setBatteryEnabled,
  onRun,
  isRunning,
  isScenarioActive,
  onReset,
}) {
  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <PanelHeading
        eyebrow="What-if analysis"
        title="Scenario controls"
        trailing={<SlidersHorizontal size={16} className="text-slate-500" />}
      />
      <div className="mt-5 space-y-5">
        <label className="block">
          <span className="flex items-center justify-between text-[11px] font-medium text-slate-300">
            <span className="flex items-center gap-2"><Wind size={13} className="text-teal" /> Wind intensity</span>
            <span className="tabular-nums text-slate-400">{windMultiplier.toFixed(1)}×</span>
          </span>
          <input
            aria-label="Wind intensity multiplier"
            className="range-input mt-3 w-full cursor-pointer"
            type="range"
            min="0.5"
            max="1.8"
            step="0.1"
            value={windMultiplier}
            onChange={(event) => setWindMultiplier(Number(event.target.value))}
          />
          <span className="mt-1 flex justify-between text-[9px] text-slate-600"><span>Calm</span><span>Intense</span></span>
        </label>
        <label className="block">
          <span className="flex items-center justify-between text-[11px] font-medium text-slate-300">
            <span className="flex items-center gap-2"><Gauge size={13} className="text-amber" /> Export capacity</span>
            <span className="tabular-nums text-slate-400">{exportCapacity} MW</span>
          </span>
          <input
            aria-label="Grid export capacity in megawatts"
            className="range-input mt-3 w-full cursor-pointer"
            type="range"
            min="20"
            max="40"
            step="1"
            value={exportCapacity}
            onChange={(event) => setExportCapacity(Number(event.target.value))}
          />
          <span className="mt-1 flex justify-between text-[9px] text-slate-600"><span>20 MW</span><span>40 MW</span></span>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={batteryEnabled}
          onClick={() => setBatteryEnabled((enabled) => !enabled)}
          className="flex w-full items-center justify-between rounded-xl border border-white/[0.055] bg-black/[0.08] px-3.5 py-3 text-left transition hover:border-white/[0.1]"
        >
          <span className="flex items-center gap-2.5">
            <BatteryCharging size={15} className={batteryEnabled ? "text-teal" : "text-slate-500"} />
            <span>
              <span className="block text-[11px] font-medium text-slate-200">Battery storage</span>
              <span className="mt-0.5 block text-[9px] text-slate-500">Charge before curtailment</span>
            </span>
          </span>
          <span className={`relative h-5 w-9 rounded-full transition ${batteryEnabled ? "bg-teal/70" : "bg-slate-700"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${batteryEnabled ? "left-[18px]" : "left-0.5"}`} />
          </span>
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal px-4 py-3 text-xs font-bold text-[#09201e] shadow-[0_8px_24px_rgba(79,224,193,.12)] transition hover:bg-[#74ecd1] disabled:cursor-wait disabled:opacity-70"
          >
            {isRunning ? <LoaderCircle size={15} className="animate-spin" /> : <Activity size={15} />}
            {isRunning ? "Recalculating…" : "Run scenario"}
          </button>
          {isScenarioActive && (
            <button
              type="button"
              onClick={onReset}
              aria-label="Reset scenario to baseline"
              className="flex w-11 items-center justify-center rounded-xl border border-white/[0.08] text-slate-400 transition hover:border-white/20 hover:text-slate-100"
            >
              <RefreshCw size={15} />
            </button>
          )}
        </div>
        {isScenarioActive && (
          <div className="flex items-center gap-1.5 text-[10px] text-teal">
            <Check size={12} /> Scenario applied to this session only
          </div>
        )}
      </div>
    </section>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-teal/20 bg-teal/[0.08] text-teal">
          <Wind size={24} />
        </div>
        <div className="mt-4 text-sm font-semibold text-slate-200">Starting the twin</div>
        <div className="mt-1 text-xs text-slate-500">Connecting to simulated farm data…</div>
        <LoaderCircle size={15} className="mx-auto mt-4 animate-spin text-teal/60" />
      </div>
    </main>
  );
}

function ErrorScreen({ error, onRetry }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="panel max-w-lg rounded-2xl p-7 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-danger/[0.09] text-danger">
          <AlertTriangle size={20} />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-100">Farm data unavailable</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2.5 text-xs font-bold text-ink hover:bg-[#74ecd1]"
        >
          <RefreshCw size={14} /> Retry connection
        </button>
      </section>
    </main>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [activeScenario, setActiveScenario] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [weatherSource, setWeatherSource] = useState("demo");
  const [windToolkitDay, setWindToolkitDay] = useState(null);
  const [isToolkitLoading, setIsToolkitLoading] = useState(false);
  const [toolkitError, setToolkitError] = useState("");
  const [windMultiplier, setWindMultiplier] = useState(1);
  const [exportCapacity, setExportCapacity] = useState(30);
  const [batteryEnabled, setBatteryEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");

  const loadDashboard = useCallback(async (source = "demo") => {
    setIsLoading(true);
    setError("");
    try {
      const [overview, turbines, forecast, grid, recommendations] = await Promise.all([
        api.overview(source),
        api.turbines(source),
        api.forecast(source),
        api.grid(source),
        api.recommendations(source),
      ]);
      setData({ overview, turbines: turbines.turbines, forecast: forecast.hours, grid, recommendations: recommendations.recommendations });
      setActiveScenario(null);
      setWeatherSource(source);
      setExportCapacity(grid.export_capacity_mw);
      setBatteryEnabled(grid.battery_enabled);
      const highestRisk = [...turbines.turbines].sort(
        (left, right) => right.failure_risk - left.failure_risk,
      )[0];
      setSelectedId(highestRisk?.id ?? null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard("demo");
  }, [loadDashboard]);

  useEffect(() => {
    if (!selectedId || activeScenario) return undefined;
    let isCurrent = true;
    setDetailError("");
    api
      .turbine(selectedId, weatherSource)
      .then((payload) => {
        if (isCurrent) setSelectedDetail(payload.turbine);
      })
      .catch((detailLoadError) => {
        if (isCurrent) setDetailError(detailLoadError.message);
      });
    return () => {
      isCurrent = false;
    };
  }, [selectedId, activeScenario, weatherSource]);

  const current = useMemo(() => {
    if (!data) return null;
    if (!activeScenario) {
      return {
        overview: data.overview,
        turbines: data.turbines,
        forecast: data.forecast,
        grid: data.grid,
        recommendations: data.recommendations,
        maintenanceWindow: data.overview.maintenance_window,
      };
    }
    const scenario = activeScenario;
    const overview = buildScenarioOverview(scenario, scenario.scenario.export_capacity_mw);
    const grid = {
      ...data.grid,
      export_capacity_mw: scenario.scenario.export_capacity_mw,
      battery_enabled: scenario.scenario.battery_enabled,
      battery_final_state_of_charge_mwh: scenario.battery_final_state_of_charge_mwh,
      dispatch: scenario.dispatch,
      overload_hours: overview.overload_hours,
      peak_generation_mw: overview.peak_generation_mw,
    };
    const forecast = data.forecast.map((hour, index) => ({
      ...hour,
      wind_speed_m_s: hour.wind_speed_m_s * scenario.scenario.wind_multiplier,
      gust_speed_m_s: hour.gust_speed_m_s * scenario.scenario.wind_multiplier,
      gross_generation_mw: scenario.dispatch[index].gross_generation_mw,
      grid_export_mw: scenario.dispatch[index].grid_export_mw,
      battery_charge_mw: scenario.dispatch[index].battery_charge_mw,
      curtailed_generation_mw: scenario.dispatch[index].curtailed_generation_mw,
    }));
    return {
      overview,
      turbines: scenario.turbines,
      forecast,
      grid,
      recommendations: buildScenarioRecommendations(scenario),
      maintenanceWindow: scenario.maintenance_window,
    };
  }, [activeScenario, data]);

  const selectedTurbine =
    current?.turbines.find((turbine) => turbine.id === selectedId) ??
    selectedDetail ??
    current?.turbines[0];
  const selectedForecast =
    current?.forecast[current.maintenanceWindow?.hour_index] ?? null;
  const historicalWindAverage = windToolkitDay
    ? windToolkitDay.hours.reduce((total, hour) => total + hour.wind_speed_m_s, 0) /
      windToolkitDay.hours.length
    : null;

  const selectTurbine = useCallback((id) => {
    setSelectedId(id);
    setSelectedDetail(null);
  }, []);

  const runScenario = async () => {
    setIsRunning(true);
    setError("");
    try {
      const result = await api.scenario({
        wind_multiplier: windMultiplier,
        export_capacity_mw: exportCapacity,
        battery_enabled: batteryEnabled,
        weather_source: weatherSource,
      });
      setActiveScenario(result);
      setSelectedDetail(null);
    } catch (scenarioError) {
      setError(scenarioError.message);
    } finally {
      setIsRunning(false);
    }
  };

  const resetScenario = () => {
    setActiveScenario(null);
    if (data) {
      setExportCapacity(data.grid.export_capacity_mw);
      setBatteryEnabled(data.grid.battery_enabled);
      setWindMultiplier(1);
    }
  };

  const loadWindToolkitDay = async () => {
    setIsToolkitLoading(true);
    setToolkitError("");
    try {
      setWindToolkitDay(await api.windToolkit(2012, 1));
    } catch (toolkitLoadError) {
      setToolkitError(toolkitLoadError.message);
    } finally {
      setIsToolkitLoading(false);
    }
  };

  if (isLoading) return <LoadingScreen />;
  if (error && !data) return <ErrorScreen error={error} onRetry={loadDashboard} />;
  if (!current) return <ErrorScreen error="No farm data was returned by the API." onRetry={loadDashboard} />;

  const overview = current.overview;
  const gridOverloaded = overview.overload_hours > 0;
  const severeCount = overview.turbines_requiring_inspection;
  const selectedDetailForPanel =
    activeScenario || !selectedDetail ? selectedTurbine : selectedDetail;
  const recommendations = current.recommendations;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/[0.06] bg-ink/75">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-7 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal/20 bg-teal/[0.075] text-teal shadow-[0_0_22px_rgba(79,224,193,.07)]">
              <Wind size={22} strokeWidth={1.7} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="text-sm font-semibold tracking-tight text-slate-100 sm:text-base">WindGuard Twin</h1>
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-teal/15 bg-teal/[0.06] px-2 py-1 text-[8px] font-bold tracking-[0.11em] text-teal sm:text-[9px]">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-teal" />
                    SIMULATED DEMO DATA
                  </span>
                  {weatherSource === "nws" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-mint/15 bg-mint/[0.045] px-2 py-1 text-[8px] font-bold tracking-[0.11em] text-mint sm:text-[9px]">
                      LIVE NWS FORECAST
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 hidden text-[10px] text-slate-500 sm:block">Wind farm operations intelligence · Palmetto site</div>
            </div>
          </div>
          <div className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
            <TabNav active="dashboard" />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="weather-source">Forecast weather source</label>
              <select
                id="weather-source"
                value={weatherSource}
                onChange={(event) => loadDashboard(event.target.value)}
                disabled={isLoading}
                className="max-w-[150px] rounded-lg border border-white/[0.08] bg-panel px-2.5 py-2 text-[10px] text-slate-300 outline-none transition hover:border-white/20 disabled:opacity-50 sm:max-w-none"
              >
                <option value="demo">Demo forecast</option>
                <option value="nws">Live NWS forecast</option>
              </select>
              <div className="hidden items-center gap-2 text-[10px] text-slate-500 md:flex">
                <Cloud size={13} className="text-teal/80" />
                <span>{current.forecast[0]?.wind_speed_m_s?.toFixed(1) ?? "—"} m/s wind</span>
              </div>
            </div>
            <div className="h-5 w-px bg-white/[0.08] md:block" />
            <div className="flex items-center gap-1.5 rounded-lg border border-mint/10 bg-mint/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-mint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_8px_rgba(120,231,168,.5)]" />
              Twin online
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-8 pt-6 sm:px-7 sm:pt-8 lg:px-10">
        <div className="fade-in mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Operations overview <span className="mx-1 text-slate-700">/</span> Forecast horizon 24h</div>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">Good afternoon, operator</h2>
            <p className="mt-1 text-xs text-slate-500">A live-look at simulated asset health, wind, and grid conditions.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${gridOverloaded ? "bg-amber" : "bg-mint"}`} />
            Forecast horizon · 24 hourly intervals
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger/[0.06] px-4 py-3 text-xs text-danger">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} className="shrink-0 underline underline-offset-2">Dismiss</button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.055] bg-white/[0.018] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Clock3 size={15} className="mt-0.5 shrink-0 text-amber" />
            <div>
              <div className="text-[11px] font-semibold text-slate-300">
                NREL WIND Toolkit <span className="font-normal text-amber">· historical resource data</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                Archive comparison only—not current weather or a future forecast.
                {windToolkitDay &&
                  ` Loaded ${windToolkitDay.year}, day ${windToolkitDay.day_of_year} · ${windToolkitDay.hours.length} hourly samples · ${historicalWindAverage.toFixed(1)} m/s average.`}
                {current.forecast.some((hour) => hour.gust_estimated) &&
                  " NWS gust values unavailable; displayed gusts are illustrative estimates."}
              </div>
              {toolkitError && <div role="alert" className="mt-1 text-[10px] text-danger">{toolkitError}</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={loadWindToolkitDay}
            disabled={isToolkitLoading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber/15 bg-amber/[0.04] px-3 py-2 text-[10px] font-semibold text-amber transition hover:bg-amber/[0.09] disabled:opacity-60"
          >
            {isToolkitLoading ? <LoaderCircle size={12} className="animate-spin" /> : <Cloud size={12} />}
            {isToolkitLoading ? "Loading archive…" : "Load 2012 sample"}
          </button>
        </div>

        <section aria-label="Farm key metrics" className="fade-in grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            icon={Leaf}
            label="Forecasted energy"
            value={formatEnergy(overview.expected_energy_mwh)}
            unit="MWh"
            detail={`${overview.turbine_count} turbines · next 24 hours`}
            tone="green"
          />
          <MetricCard
            icon={Activity}
            label="Energy at risk"
            value={formatEnergy(overview.energy_at_risk_mwh)}
            unit="MWh"
            detail="Risk-weighted forecast exposure"
            tone={overview.energy_at_risk_mwh > 100 ? "amber" : "teal"}
            trend={overview.energy_at_risk_mwh > 100 ? "up" : undefined}
          />
          <MetricCard
            icon={ShieldAlert}
            label="Turbines needing attention"
            value={String(severeCount).padStart(2, "0")}
            unit={`/ ${overview.turbine_count}`}
            detail={severeCount ? "High-risk assets · inspect now" : "No severe risk flags"}
            tone={severeCount ? "red" : "green"}
          />
          <MetricCard
            icon={Zap}
            label="Grid status"
            value={gridOverloaded ? `${overview.overload_hours}h` : "Within"}
            unit={gridOverloaded ? "over limit" : "capacity"}
            detail={`${formatPower(overview.grid_export_capacity_mw)} MW export capacity`}
            tone={gridOverloaded ? "amber" : "green"}
          />
        </section>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,1.42fr)]">
          <MapPanel turbines={current.turbines} selectedId={selectedId} onSelect={selectTurbine} />
          <GenerationChart forecast={current.forecast} capacity={overview.grid_export_capacity_mw} />
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(330px,.8fr)]">
          <RankingTable
            turbines={current.turbines}
            selectedId={selectedId}
            onSelect={selectTurbine}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-1">
            <RecommendationPanel recommendations={recommendations} onSelect={selectTurbine} />
            <TurbineDetail
              turbine={selectedDetailForPanel}
              maintenanceWindow={current.maintenanceWindow}
              selectedForecast={selectedForecast}
            />
            {detailError && <p role="alert" className="text-xs text-danger">{detailError}</p>}
            <ScenarioPanel
              windMultiplier={windMultiplier}
              setWindMultiplier={setWindMultiplier}
              exportCapacity={exportCapacity}
              setExportCapacity={setExportCapacity}
              batteryEnabled={batteryEnabled}
              setBatteryEnabled={setBatteryEnabled}
              onRun={runScenario}
              isRunning={isRunning}
              isScenarioActive={Boolean(activeScenario)}
              onReset={resetScenario}
            />
          </div>
        </div>

        <footer className="mt-7 flex flex-col justify-between gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-slate-600 sm:flex-row sm:items-center">
          <span>{DISCLAIMER}</span>
          <span className="flex items-center gap-1.5"><Activity size={11} /> WindGuard Twin · prototype interface</span>
        </footer>
      </main>
    </div>
  );
}
