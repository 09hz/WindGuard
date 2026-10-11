import { useMemo, useState } from "react";
import { AlertTriangle, BatteryCharging, Gauge, Scissors, Wind, Zap } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import TabNav from "../TabNav.jsx";
import SiteCanvas from "./SiteCanvas.jsx";
import { GridControls, SimulationControls, TurbineInspector, WeatherControls } from "./ControlPanel.jsx";
import { useSimulation } from "./useSimulation.js";

function Readout({ icon: Icon, label, value, unit, detail, tone = "text-teal" }) {
  return (
    <article className="panel rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        <Icon size={15} className={tone} />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-slate-100">{value}</span>
        {unit && <span className="text-[11px] text-slate-500">{unit}</span>}
      </div>
      <div className="mt-1 min-h-4 text-[11px] text-slate-400">{detail}</div>
    </article>
  );
}

function formatClock(hours) {
  const h = Math.floor(hours % 24);
  const m = Math.floor((hours * 60) % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function LiveChart({ history, exportLimit }) {
  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Live output</div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-100">Farm generation vs export limit</h2>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-teal" />Generation</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-mint/60" />Exported</span>
          <span className="flex items-center gap-1.5"><span className="h-px w-4 border-t border-dashed border-slate-400" />Limit</span>
        </div>
      </div>
      <div className="mt-4 h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={history} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.07)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={formatClock} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, (max) => Math.ceil(Math.max(max, exportLimit) * 1.15)]} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "#0b171f", border: "1px solid rgba(135,166,175,0.2)", borderRadius: 12, fontSize: 11 }}
              labelFormatter={formatClock}
              formatter={(value, name) => [`${Number(value).toFixed(1)} MW`, name]}
            />
            <ReferenceLine y={exportLimit} stroke="#94a3b8" strokeDasharray="4 4" />
            <Line dataKey="gross" name="Generation" stroke="#4fe0c1" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="export" name="Exported" stroke="#78e7a8" strokeOpacity={0.6} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export default function SimulatorPage() {
  const sim = useSimulation();
  const { snapshot, weather, grid } = sim;
  const [selectedId, setSelectedId] = useState(null);
  const selected = snapshot.turbines.find((turbine) => turbine.id === selectedId) ?? null;
  const { farm } = snapshot;

  const stats = useMemo(() => {
    const farmTurbines = snapshot.turbines;
    const online = farmTurbines.filter((t) => !t.fault && !t.tripped).length;
    const highRisk = farmTurbines.filter((t) => snapshot.readings[t.id]?.risk >= 0.65).length;
    const wakeLoss = farm.freeStream > 0 ? 1 - farm.gross / farm.freeStream : 0;
    const capacity = farmTurbines.reduce((total, t) => total + t.ratedPower, 0);
    return { online, highRisk, wakeLoss, capacity, farmCount: farmTurbines.length };
  }, [snapshot, farm]);

  const cutOut = farm.wind >= 25;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/[0.06] bg-ink/75">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal/20 bg-teal/[0.075] text-teal">
              <Wind size={22} strokeWidth={1.7} />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight text-slate-100 sm:text-base">WindGuard Twin</h1>
              <div className="mt-0.5 hidden text-[10px] text-slate-500 sm:block">Turbine simulator · what-if sandbox</div>
            </div>
          </div>
          <TabNav active="simulator" />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-8 pt-6 sm:px-7 sm:pt-8 lg:px-10">
        <div className="fade-in mb-5">
          <div className="eyebrow">Simulator <span className="mx-1 text-slate-700">/</span> Real time</div>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">Stress-test the QNX-wired turbines</h2>
          <p className="mt-1 text-xs text-slate-500">
            Move the three turbines, change the weather and each turbine’s health, and watch output, wake losses, risk and grid limits respond.
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Readout icon={Zap} label="Farm output" value={farm.gross.toFixed(1)} unit={`/ ${stats.capacity.toFixed(1)} MW`} detail={`${stats.online} of ${stats.farmCount} turbines online`} />
          <Readout
            icon={Wind}
            label="Incoming wind"
            value={farm.wind.toFixed(1)}
            unit="m/s"
            detail={cutOut ? "Above 25 m/s cut-out: rotors stopped" : `Gusting ${farm.gust.toFixed(1)} m/s`}
            tone={cutOut ? "text-danger" : "text-teal"}
          />
          <Readout icon={Gauge} label="Wake loss" value={Math.round(stats.wakeLoss * 100)} unit="%" detail={`${snapshot.wakeLossMwh.toFixed(1)} MWh lost to wakes`} tone={stats.wakeLoss > 0.15 ? "text-amber" : "text-teal"} />
          <Readout icon={Scissors} label="Curtailed" value={farm.curtailed.toFixed(1)} unit="MW" detail={`${snapshot.curtailedMwh.toFixed(1)} MWh total`} tone={farm.curtailed > 0 ? "text-amber" : "text-teal"} />
          <Readout icon={BatteryCharging} label="Exported" value={snapshot.energyMwh.toFixed(1)} unit="MWh" detail={farm.charge > 0 ? `Charging battery ${farm.charge.toFixed(1)} MW` : `${farm.export.toFixed(1)} MW to grid now`} tone="text-mint" />
          <Readout icon={AlertTriangle} label="Energy at risk" value={snapshot.energyAtRiskMwh.toFixed(1)} unit="MWh" detail={`${stats.highRisk} high-risk turbine${stats.highRisk === 1 ? "" : "s"}`} tone={stats.highRisk ? "text-danger" : "text-teal"} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <SiteCanvas
              snapshot={snapshot}
              weather={weather}
              running={sim.running}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={sim.moveTurbine}
            />
            <LiveChart history={snapshot.history} exportLimit={grid.exportLimit} />
            {snapshot.events.length > 0 && (
              <section className="panel rounded-2xl p-4">
                <div className="eyebrow">Events</div>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
                  {snapshot.events.map((event, index) => (
                    <li key={`${event.at}-${index}`} className="flex gap-2">
                      <span className="tabular-nums text-slate-500">{formatClock(event.at)}</span>
                      <button type="button" className="text-left text-danger hover:underline" onClick={() => setSelectedId(event.turbineId)}>
                        {event.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <aside className="space-y-4">
            <SimulationControls sim={sim} />
            <TurbineInspector
              turbine={selected}
              reading={selected ? snapshot.readings[selected.id] : null}
              onEdit={sim.editTurbine}
            />
            <WeatherControls weather={weather} setWeather={sim.setWeather} />
            <GridControls grid={grid} setGrid={sim.setGrid} batterySoc={snapshot.batterySoc} />
          </aside>
        </div>

        <p className="mt-6 text-[10px] text-slate-600">
          Simulated sandbox using the same illustrative power curve and risk weights as the dashboard, plus a Jensen wake model. Not for real-world safety or dispatch decisions.
        </p>
      </main>
    </div>
  );
}
