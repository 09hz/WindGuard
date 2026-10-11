import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { FIELD, ROTOR_DIAMETER_M, flowVector } from "./engine.js";
import { QNX_BASE } from "./qnx/hardware.js";
import HoverCard from "./qnx/HoverCard.jsx";
import QnxRig, { QNX_ACCENT } from "./qnx/QnxRig.jsx";

export { riskTone } from "./qnx/QnxRig.jsx";

const ROTOR_R = ROTOR_DIAMETER_M / 2;
const WAKE_LENGTH = ROTOR_DIAMETER_M * 10;
const MARGIN = 140;

// Turbines stay on the map, left of the base, and below the map title. The
// bottom margin keeps labels and sensors off the edge.
function clampToField(point) {
  const x = Math.min(QNX_BASE.x - QNX_BASE.width / 2 - 260, Math.max(MARGIN, point.x));
  const top = x > 1500 ? 290 : 200;
  return { x, y: Math.min(FIELD.height - 200, Math.max(top, point.y)) };
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

export default function SiteCanvas({ snapshot, weather, running, selectedId, onSelect, onMove }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [hover, setHover] = useState(null);
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
      const moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
      if (moved !== drag.moved) setDrag((current) => current && { ...current, moved });
      if (moved) {
        const clamped = clampToField(toField(event.clientX, event.clientY));
        onMove(drag.id, clamped.x, clamped.y);
      }
    };
    const handleUp = () => {
      if (!drag.moved) onSelect(drag.id);
      setDrag(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, toField, onMove, onSelect]);

  const startMove = (id) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDrag({ id, startX: event.clientX, startY: event.clientY, moved: false });
  };

  const showHover = useCallback((info, event) => {
    const box = containerRef.current.getBoundingClientRect();
    setHover({ info, position: { x: event.clientX - box.left, y: event.clientY - box.top }, bounds: { width: box.width, height: box.height } });
  }, []);
  const hideHover = useCallback(() => setHover(null), []);

  const flow = flowVector(weather.direction);
  const flowAngle = (Math.atan2(flow.y, flow.x) * 180) / Math.PI;
  const windSpeed = snapshot.farm.wind || weather.windSpeed;
  const flowDuration = Math.max(0.35, 6 / Math.max(1, windSpeed));

  return (
    <section className="panel rounded-2xl p-4 sm:p-5">
      <div>
        <div className="eyebrow">QNX hardware-in-the-loop</div>
        <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-100">Three turbines wired to the QNX base</h2>
      </div>
      <div ref={containerRef} className="relative mt-4 rounded-xl border border-violet-400/15 bg-[#140f24]">
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-ink/80 px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
          <MapPin size={11} />
          2.4 × 1.4 km site · simulated
        </div>
        <HoverCard info={hover?.info} position={hover?.position} bounds={hover?.bounds} />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
          className="block h-auto w-full select-none overflow-hidden rounded-xl"
          role="application"
          aria-label="Wind site with three turbines wired to a QNX base. Drag turbines to move them, click one to edit it, hover any part for details."
        >
          <defs>
            <pattern id="qnx-grid" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke={QNX_ACCENT} strokeOpacity="0.07" strokeWidth="2" />
            </pattern>
            <marker id="flow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4fe0c1" fillOpacity="0.35" />
            </marker>
          </defs>
          <rect width={FIELD.width} height={FIELD.height} fill="url(#qnx-grid)" onPointerDown={() => onSelect(null)} />
          <g pointerEvents="none">
            <text x={FIELD.width - 40} y="70" textAnchor="end" fontSize="30" fontWeight="700" letterSpacing="4" fill={QNX_ACCENT}>QNX HARDWARE-IN-THE-LOOP</text>
            <text x={FIELD.width - 40} y="108" textAnchor="end" fontSize="22" fill="#8b7fb8">Every turbine reports to the base over its own sensor cable</text>
          </g>

          {/* Wind flow streaks, rotated to the flow direction. */}
          <g transform={`rotate(${flowAngle} ${FIELD.width / 2} ${FIELD.height / 2})`} pointerEvents="none">
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

          <QnxRig
            turbines={snapshot.turbines}
            readings={snapshot.readings}
            simHours={snapshot.simHours}
            angles={anglesRef.current}
            selectedId={selectedId}
            draggingId={drag?.id ?? null}
            onPointerDown={startMove}
            onHover={showHover}
            onLeave={hideHover}
          />
        </svg>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        Drag a turbine to move it; its cable to the base follows. Click a turbine to change its condition, and hover any part for its details and live readings. Shaded cones show each rotor's wake.
      </p>
    </section>
  );
}
