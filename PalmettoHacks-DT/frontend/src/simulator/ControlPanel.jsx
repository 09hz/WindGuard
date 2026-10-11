import { Pause, Play, RotateCcw, Trash2, Wrench } from "lucide-react";
import { WEATHER_PRESETS } from "./engine.js";
import { SPEEDS } from "./useSimulation.js";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function compassLabel(degrees) {
  return COMPASS[Math.round(degrees / 45) % 8];
}

function Slider({ id, label, value, display, min, max, step = 1, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <label htmlFor={id} className="text-slate-400">{label}</label>
        <span className="font-semibold tabular-nums text-slate-200">{display ?? value}</span>
      </div>
      <input
        id={id}
        type="range"
        className="range-input mt-2 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Section({ title, children, trailing }) {
  return (
    <section className="panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">{title}</div>
        {trailing}
      </div>
      <div className="mt-3 space-y-3.5">{children}</div>
    </section>
  );
}

function Toggle({ id, label, checked, onChange, tone = "teal" }) {
  const on = tone === "danger" ? "bg-danger" : "bg-teal";
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between text-[11px] text-slate-400">
      {label}
      <span className="relative inline-flex">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className={`h-5 w-9 rounded-full transition ${checked ? on : "bg-white/10"}`} />
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

export function SimulationControls({ sim }) {
  const { running, setRunning, speedIndex, setSpeedIndex, reset, snapshot } = sim;
  const days = Math.floor(snapshot.simHours / 24);
  const hours = Math.floor(snapshot.simHours % 24);
  const minutes = Math.floor((snapshot.simHours * 60) % 60);
  return (
    <Section
      title="Simulation"
      trailing={
        <span className="text-[11px] tabular-nums text-slate-400">
          Day {days + 1} · {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}
        </span>
      }
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRunning(!running)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal px-3 py-2 text-xs font-bold text-ink transition hover:bg-teal/90"
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
          {running ? "Pause" : "Run"}
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:border-white/25"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1" role="radiogroup" aria-label="Simulation speed">
        {SPEEDS.map((speed, index) => (
          <button
            key={speed.label}
            type="button"
            role="radio"
            aria-checked={speedIndex === index}
            onClick={() => setSpeedIndex(index)}
            className={`rounded-lg px-2 py-1.5 text-[10px] font-semibold transition ${speedIndex === index ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
          >
            {speed.label}
          </button>
        ))}
      </div>
    </Section>
  );
}

export function WeatherControls({ weather, setWeather }) {
  const update = (changes) => setWeather((current) => ({ ...current, ...changes }));
  const activePreset = Object.entries(WEATHER_PRESETS).find(
    ([, preset]) => preset.windSpeed === weather.windSpeed && preset.gustFactor === weather.gustFactor,
  )?.[0];
  return (
    <Section title="Weather">
      <div className="grid grid-cols-5 gap-1">
        {Object.entries(WEATHER_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={() => update(preset)}
            aria-pressed={activePreset === key}
            className={`rounded-lg border px-1 py-1.5 text-[10px] font-semibold transition ${activePreset === key ? "border-teal/40 bg-teal/10 text-teal" : "border-white/[0.06] text-slate-400 hover:border-white/20"}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Slider id="wind-speed" label="Wind speed" value={weather.windSpeed} display={`${weather.windSpeed} m/s`} min={0} max={35} step={0.5} onChange={(windSpeed) => update({ windSpeed })} />
      <Slider
        id="wind-direction"
        label="Wind from"
        value={weather.direction}
        display={`${compassLabel(weather.direction)} · ${weather.direction}°`}
        min={0}
        max={355}
        step={5}
        onChange={(direction) => update({ direction })}
      />
      <Slider id="gust-factor" label="Gust factor" value={weather.gustFactor} display={`×${weather.gustFactor.toFixed(2)}`} min={1} max={2} step={0.05} onChange={(gustFactor) => update({ gustFactor })} />
      <Slider id="turbulence" label="Turbulence" value={weather.turbulence} display={`${Math.round(weather.turbulence * 100)}%`} min={0} max={0.5} step={0.01} onChange={(turbulence) => update({ turbulence })} />
      <Slider
        id="temperature"
        label="Temperature"
        value={weather.temperature}
        display={`${weather.temperature}°C${weather.temperature <= 0 ? " · icing" : ""}`}
        min={-20}
        max={40}
        onChange={(temperature) => update({ temperature })}
      />
    </Section>
  );
}

export function GridControls({ grid, setGrid, batterySoc }) {
  const update = (changes) => setGrid((current) => ({ ...current, ...changes }));
  return (
    <Section title="Grid & storage">
      <Slider id="export-limit" label="Export limit" value={grid.exportLimit} display={`${grid.exportLimit} MW`} min={5} max={60} onChange={(exportLimit) => update({ exportLimit })} />
      <Toggle id="battery" label="Battery storage" checked={grid.batteryEnabled} onChange={(batteryEnabled) => update({ batteryEnabled })} />
      <div>
        <div className="flex justify-between text-[11px] text-slate-400">
          <span>Battery charge</span>
          <span className="tabular-nums text-slate-200">{batterySoc.toFixed(1)} / {grid.batteryCapacity} MWh</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-mint transition-all" style={{ width: `${(batterySoc / grid.batteryCapacity) * 100}%` }} />
        </div>
      </div>
    </Section>
  );
}

export function TurbineInspector({ turbine, reading, onEdit, onRemove }) {
  if (!turbine) {
    return (
      <Section title="Turbine">
        <p className="text-[11px] leading-relaxed text-slate-500">Click a turbine on the map to change its condition.</p>
      </Section>
    );
  }
  const edit = (changes) => onEdit(turbine.id, changes);
  return (
    <Section
      title={`Turbine ${turbine.id}`}
      trailing={
        <button type="button" onClick={() => onRemove(turbine.id)} className="flex items-center gap-1 text-[10px] text-slate-500 transition hover:text-danger" aria-label={`Remove ${turbine.id}`}>
          <Trash2 size={12} /> Remove
        </button>
      }
    >
      {reading && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Output", `${reading.power.toFixed(2)} MW`],
            ["Wind", `${reading.effectiveWind.toFixed(1)} m/s`],
            ["Risk", `${Math.round(reading.risk * 100)}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-1 py-2">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
              <div className="mt-0.5 text-xs font-semibold tabular-nums text-slate-100">{value}</div>
            </div>
          ))}
        </div>
      )}
      {reading && reading.wakeDeficit > 0.005 && (
        <p className="text-[10px] text-amber">Sitting in a wake: {Math.round(reading.wakeDeficit * 100)}% slower wind than upstream.</p>
      )}
      <Slider id="rated-power" label="Rated power" value={turbine.ratedPower} display={`${turbine.ratedPower} MW`} min={1.5} max={8} step={0.1} onChange={(ratedPower) => edit({ ratedPower })} />
      <Slider
        id="vibration"
        label="Base vibration"
        value={turbine.vibration}
        display={`${turbine.vibration.toFixed(1)} mm/s${reading ? ` · live ${reading.liveVibration.toFixed(1)}` : ""}`}
        min={0}
        max={12}
        step={0.1}
        onChange={(vibration) => edit({ vibration })}
      />
      <Slider
        id="bearing-temp"
        label="Bearing temperature"
        value={turbine.bearingTemp}
        display={`${turbine.bearingTemp}°C${reading ? ` · live ${reading.liveBearingTemp.toFixed(0)}` : ""}`}
        min={40}
        max={100}
        onChange={(bearingTemp) => edit({ bearingTemp })}
      />
      <Slider id="maintenance" label="Days since maintenance" value={turbine.daysSinceMaintenance} display={`${turbine.daysSinceMaintenance} d`} min={0} max={730} step={5} onChange={(daysSinceMaintenance) => edit({ daysSinceMaintenance })} />
      <Toggle id="fault" label="Inject fault" tone="danger" checked={turbine.fault} onChange={(fault) => edit({ fault, tripped: false })} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => edit({ vibration: 1.5, bearingTemp: 60, daysSinceMaintenance: 0, fault: false, tripped: false })}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[11px] text-slate-300 transition hover:border-white/25"
        >
          <Wrench size={12} /> Perform maintenance
        </button>
        {turbine.tripped && (
          <button
            type="button"
            onClick={() => edit({ tripped: false })}
            className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] font-semibold text-danger transition hover:bg-danger/15"
          >
            Restart
          </button>
        )}
      </div>
    </Section>
  );
}
