import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, MapPin, Zap } from "lucide-react";
import { FIELD, ROTOR_DIAMETER_M, flowVector } from "./engine.js";

const RISK_COLORS = { green: "#78e7a8", yellow: "#f1bd67", red: "#ff6b70" };
const ROTOR_R = ROTOR_DIAMETER_M / 2;
const GLYPH_R = 78; // drawn a little larger than true rotor scale so it reads on screen
const WAKE_LENGTH = ROTOR_DIAMETER_M * 10;
const MARGIN = 90;
const SUBSTATION = { x: FIELD.width / 2, y: FIELD.height - 70 };

export function riskTone(risk = 0) {
  if (risk >= 0.65) return "red";
  if (risk >= 0.35) return "yellow";
  return "green";
}

function clampToField(point) {
  return {
    x: Math.min(FIELD.width - MARGIN, Math.max(MARGIN, point.x)),
    y: Math.min(FIELD.height - MARGIN - 80, Math.max(MARGIN, point.y)),
  };
}

function insideField(point) {
  return point.x >= 0 && point.x <= FIELD.width && point.y >= 0 && point.y <= FIELD.height;
}

// Wake cone drawn downstream of a rotor, widening at the Jensen decay rate.
function WakeCone({ turbine, flow, strength }) {
  const normal = { x: -flow.y, y: flow.x };
  const end = { x: turbine.x + flow.x * WAKE_LENGTH, y: turbine.y + flow.y * WAKE_LENGTH };
  const endR = ROTOR_R + 0.075 * WAKE_LENGTH;
  const points = [
    [turbine.x + normal.x * ROTOR_R, turbine.y + normal.y * ROTOR_R],
    [end.x + normal.x * endR, end.y + normal.y * endR],
    [end.x - normal.x * endR, end.y - normal.y * endR],
    [turbine.x - normal.x * ROTOR_R, turbine.y - normal.y * ROTOR_R],
  ];
  const gradientId = `wake-${turbine.id}`;
  return (
    <g>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={turbine.x} y1={turbine.y} x2={end.x} y2={end.y}>
          <stop offset="0%" stopColor="#4fe0c1" stopOpacity={0.22 * strength} />
          <stop offset="100%" stopColor="#4fe0c1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={points.map((p) => p.join(",")).join(" ")} fill={`url(#${gradientId})`} />
    </g>
  );
}

function TurbineGlyph({ turbine, reading, angle, selected, dragging, onPointerDown }) {
  const offline = turbine.fault || turbine.tripped;
  const color = offline ? "#ff6b70" : RISK_COLORS[riskTone(reading?.risk)];
  const label = turbine.fault ? "FAULT" : turbine.tripped ? "TRIPPED" : `${(reading?.power ?? 0).toFixed(1)} MW`;
  return (
    <g
      transform={`translate(${turbine.x} ${turbine.y})`}
      onPointerDown={onPointerDown}
      style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
      role="button"
      aria-label={`${turbine.id}, ${label}. Drag to move, click to edit.`}
    >
      {selected && <circle r={GLYPH_R + 26} fill="none" stroke="#4fe0c1" strokeWidth="6" strokeDasharray="14 10" />}
      {reading?.risk >= 0.65 && !offline && (
        <circle r={GLYPH_R + 10} fill={color} opacity="0.12">
          <animate attributeName="r" values={`${GLYPH_R};${GLYPH_R + 40};${GLYPH_R}`} dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      <circle r={GLYPH_R + 6} fill={`${color}22`} stroke={`${color}aa`} strokeWidth="5" strokeDasharray={offline ? "12 9" : undefined} />
      <g transform={`rotate(${angle})`} opacity={offline ? 0.45 : 1}>
        {[0, 120, 240].map((blade) => (
          <path
            key={blade}
            transform={`rotate(${blade})`}
            d={`M -6 0 Q -9 ${-GLYPH_R * 0.5} 0 ${-GLYPH_R + 4} Q 7 ${-GLYPH_R * 0.5} 6 0 Z`}
            fill={color}
          />
        ))}
      </g>
      <circle r="9" fill="#0b171f" stroke={color} strokeWidth="4" />
      <g transform={`translate(0 ${GLYPH_R + 50})`}>
        <rect x="-95" y="-30" width="190" height="72" rx="14" fill="#09131bdd" />
        <text textAnchor="middle" y="2" fontSize="30" fontWeight="700" fill="#cbd5e1">{turbine.id}</text>
        <text textAnchor="middle" y="32" fontSize="25" fill={offline ? "#ff6b70" : "#8b9ba5"}>{label}</text>
      </g>
    </g>
  );
}

export default function SiteCanvas({ snapshot, weather, running, selectedId, onSelect, onAdd, onMove, onRemove }) {
  const svgRef = useRef(null);
  const anglesRef = useRef({});
  const lastFrameRef = useRef(performance.now());
  const [drag, setDrag] = useState(null);

  // Advance rotor angles in real time from each turbine's live RPM.
  const now = performance.now();
  const elapsed = Math.min(0.1, (now - lastFrameRef.current) / 1000);
  lastFrameRef.current = now;
  for (const turbine of snapshot.turbines) {
    const rpm = running ? snapshot.readings[turbine.id]?.rpm ?? 0 : 0;
    anglesRef.current[turbine.id] = ((anglesRef.current[turbine.id] ?? turbine.x) + rpm * 6 * elapsed) % 360;
  }

  const toField = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: local.x, y: local.y };
  }, []);

  useEffect(() => {
    if (!drag) return undefined;
    const handleMove = (event) => {
      const point = toField(event.clientX, event.clientY);
      const moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
      setDrag((current) => current && { ...current, point, moved });
      if (drag.kind === "move" && moved && insideField(point)) {
        const clamped = clampToField(point);
        onMove(drag.id, clamped.x, clamped.y);
      }
    };
    const handleUp = (event) => {
      const point = toField(event.clientX, event.clientY);
      if (drag.kind === "new" && insideField(point)) {
        const clamped = clampToField(point);
        const created = onAdd(clamped.x, clamped.y);
        if (created) onSelect(created.id);
      } else if (drag.kind === "move") {
        if (!drag.moved) onSelect(drag.id);
        else if (!insideField(point)) onRemove(drag.id);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, toField, onAdd, onMove, onRemove, onSelect]);

  const startNew = (event) => {
    event.preventDefault();
    setDrag({ kind: "new", startX: event.clientX, startY: event.clientY, moved: false, point: null });
  };

  const startMove = (id) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDrag({ kind: "move", id, startX: event.clientX, startY: event.clientY, moved: false, point: null });
  };

  const addAtFreeSpot = () => {
    const taken = snapshot.turbines;
    for (let y = 250; y < FIELD.height - 250; y += 260) {
      for (let x = 250; x < FIELD.width - 150; x += 300) {
        if (taken.every((t) => Math.hypot(t.x - x, t.y - y) > ROTOR_DIAMETER_M * 2.5)) {
          const created = onAdd(x, y);
          if (created) onSelect(created.id);
          return;
        }
      }
    }
  };

  const flow = flowVector(weather.direction);
  const flowAngle = (Math.atan2(flow.y, flow.x) * 180) / Math.PI;
  const windSpeed = snapshot.farm.wind || weather.windSpeed;
  const flowDuration = Math.max(0.35, 6 / Math.max(1, windSpeed));
  const ghost = drag?.kind === "new" && drag.point && insideField(drag.point) ? clampToField(drag.point) : null;
  const removing = drag?.kind === "move" && drag.moved && drag.point && !insideField(drag.point);

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Site builder</div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-100">Drag turbines onto the site</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={startNew}
            className="flex select-none items-center gap-2 rounded-xl border border-teal/25 bg-teal/[0.07] px-3 py-2 text-xs font-semibold text-teal transition hover:bg-teal/[0.12]"
            style={{ cursor: drag?.kind === "new" ? "grabbing" : "grab", touchAction: "none" }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                addAtFreeSpot();
              }
            }}
            aria-label="Drag a new 4.2 MW turbine onto the site, or press Enter to place one automatically"
          >
            <GripVertical size={14} />
            4.2 MW turbine
          </button>
        </div>
      </div>
      <div className="relative mt-4 overflow-hidden rounded-xl border border-white/[0.055] bg-[#0b171f]">
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-ink/80 px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
          <MapPin size={11} />
          2.4 × 1.4 km site · simulated
        </div>
        {removing && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[10px] font-semibold text-danger">
            Release to remove turbine
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
          className="block h-auto w-full select-none"
          role="application"
          aria-label="Wind farm site. Drag turbines to move them, drag off the map to remove."
        >
          <defs>
            <pattern id="sim-grid" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#4fe0c1" strokeOpacity="0.05" strokeWidth="2" />
            </pattern>
            <marker id="flow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4fe0c1" fillOpacity="0.35" />
            </marker>
          </defs>
          <rect width={FIELD.width} height={FIELD.height} fill="url(#sim-grid)" onPointerDown={() => onSelect(null)} />

          {/* Wind flow streaks, rotated to the flow direction. */}
          <g pointerEvents="none" transform={`rotate(${flowAngle} ${FIELD.width / 2} ${FIELD.height / 2})`}>
            {Array.from({ length: 7 }, (_, row) =>
              Array.from({ length: 6 }, (_, column) => {
                const x = -600 + column * 650 + (row % 2) * 300;
                const y = -500 + row * 400;
                return (
                  <line
                    key={`${row}-${column}`}
                    x1={x}
                    y1={y}
                    x2={x + 220}
                    y2={y}
                    stroke="#4fe0c1"
                    strokeOpacity="0.16"
                    strokeWidth="5"
                    strokeDasharray="60 40"
                    markerEnd="url(#flow-head)"
                    className="flow-streak"
                    style={{ animationDuration: `${flowDuration}s` }}
                  />
                );
              }),
            )}
          </g>

          {snapshot.turbines.map((turbine) => (
            <line
              key={`cable-${turbine.id}`}
              x1={turbine.x}
              y1={turbine.y}
              x2={SUBSTATION.x}
              y2={SUBSTATION.y}
              stroke="#31515a"
              strokeOpacity="0.5"
              strokeWidth="3"
              strokeDasharray="12 10"
              pointerEvents="none"
            />
          ))}

          <g pointerEvents="none">
            {snapshot.turbines
              .filter((turbine) => !turbine.fault && !turbine.tripped)
              .map((turbine) => (
                <WakeCone
                  key={`wake-${turbine.id}`}
                  turbine={turbine}
                  flow={flow}
                  strength={Math.min(1, (snapshot.readings[turbine.id]?.power ?? 0) / turbine.ratedPower + 0.25)}
                />
              ))}
          </g>

          <g transform={`translate(${SUBSTATION.x} ${SUBSTATION.y})`} pointerEvents="none">
            <rect x="-120" y="-30" width="240" height="60" rx="14" fill="#10252b" stroke="#4fe0c1" strokeOpacity="0.3" strokeWidth="3" />
            <text textAnchor="middle" y="9" fontSize="24" fontWeight="700" letterSpacing="3" fill="#4fe0c1">SUBSTATION</text>
          </g>

          {snapshot.turbines.map((turbine) => (
            <TurbineGlyph
              key={turbine.id}
              turbine={turbine}
              reading={snapshot.readings[turbine.id]}
              angle={anglesRef.current[turbine.id] ?? 0}
              selected={selectedId === turbine.id}
              dragging={drag?.kind === "move" && drag.id === turbine.id}
              onPointerDown={startMove(turbine.id)}
            />
          ))}

          {ghost && (
            <g transform={`translate(${ghost.x} ${ghost.y})`} pointerEvents="none" opacity="0.6">
              <circle r={GLYPH_R + 6} fill="#4fe0c122" stroke="#4fe0c1" strokeWidth="5" strokeDasharray="12 9" />
              <Zap x="-14" y="-14" width="28" height="28" color="#4fe0c1" />
            </g>
          )}
        </svg>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        Drag the turbine chip onto the map to add one. Drag a turbine to move it, click to edit it, or drag it off the map to remove it. Shaded cones show each rotor's wake.
      </p>
    </section>
  );
}
