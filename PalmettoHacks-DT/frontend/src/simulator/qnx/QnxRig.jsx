import {
  BASE_PART,
  CABLE_PART,
  JUNCTION_PART,
  QNX_BASE,
  SENSOR_PARTS,
  TURBINE_PART,
} from "./hardware.js";
import { linkLatencyMs, readBaseStatus } from "./telemetry.js";

export const QNX_ACCENT = "#a78bfa";
const RISK_COLORS = { green: "#78e7a8", yellow: "#f1bd67", red: "#ff6b70" };
export const GLYPH_R = 78; // drawn a little larger than true rotor scale so it reads on screen
// Sensor dots sit around each turbine, clockwise from upper left.
const SENSOR_OFFSETS = {
  vibration: [-92, -78],
  temperature: [92, -78],
  rotor: [92, 78],
  wind: [-92, 78],
};

export function riskTone(risk = 0) {
  if (risk >= 0.65) return "red";
  if (risk >= 0.35) return "yellow";
  return "green";
}

function formatSensor(part, value) {
  const digits = part.unit === "RPM" ? 1 : part.unit === "°C" ? 0 : 1;
  return `${value.toFixed(digits)} ${part.unit}`;
}

function statusText(turbine, reading) {
  if (turbine.fault) return "Fault injected";
  if (turbine.tripped) return "Tripped offline";
  if (reading && reading.power <= 0) return reading.effectiveWind >= 25 ? "Stopped above cut-out" : "Below cut-in";
  return "Generating";
}

// Port on the base where each cable lands, spread down its left edge.
function basePort(slot, count) {
  const top = QNX_BASE.y - QNX_BASE.height / 2 + 70;
  const span = QNX_BASE.height - 140;
  return {
    x: QNX_BASE.x - QNX_BASE.width / 2,
    y: count > 1 ? top + (span * slot) / (count - 1) : QNX_BASE.y,
  };
}

function cableGeometry(turbine, port) {
  const start = { x: turbine.x + GLYPH_R, y: turbine.y };
  const bend = Math.max(80, (port.x - start.x) / 2);
  const c1 = { x: start.x + bend, y: start.y };
  const c2 = { x: port.x - bend, y: port.y };
  // Midpoint of the cubic Bézier, where the bus junction sits.
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + port.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + port.y) / 8,
  };
  return { d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${port.x} ${port.y}`, mid };
}

function Hoverable({ info, onHover, onLeave, children, ...props }) {
  return (
    <g
      onPointerEnter={(event) => onHover(info, event)}
      onPointerMove={(event) => onHover(info, event)}
      onPointerLeave={onLeave}
      {...props}
    >
      {children}
    </g>
  );
}

// The QNX base, its cables and sensors, and the turbines wired to it.
export default function QnxRig({ turbines, readings, simHours, angles, selectedId, draggingId, onPointerDown, onHover, onLeave }) {
  const online = turbines.filter((turbine) => !turbine.fault && !turbine.tripped).length;
  const base = readBaseStatus(simHours, online);
  const baseInfo = {
    part: BASE_PART,
    heading: "QNX base",
    live: [
      ["Loop deadline", `${base.deadlineMs.toFixed(0)} ms`],
      ["Worst-case loop time", `${base.worstCaseMs.toFixed(2)} ms`],
      ["Jitter", `${base.jitterUs.toFixed(0)} µs`],
      ["Missed deadlines", String(base.missedDeadlines)],
      ["Turbines online", `${base.nodesOnline} of ${turbines.length}`],
    ],
  };
  // Ports are assigned top to bottom by turbine height so cables don't cross.
  const slots = Object.fromEntries([...turbines].sort((a, b) => a.y - b.y).map((turbine, slot) => [turbine.id, slot]));

  return (
    <g>
      {/* Cables and bus junctions, drawn first so turbines sit on top. */}
      {turbines.map((turbine, index) => {
        const offline = turbine.fault || turbine.tripped;
        const { d, mid } = cableGeometry(turbine, basePort(slots[turbine.id], turbines.length));
        const cableInfo = {
          part: CABLE_PART,
          heading: `${turbine.id} cable`,
          live: [["Link latency", `${linkLatencyMs(index, simHours).toFixed(1)} ms`], ["Status", "Connected"]],
        };
        return (
          <g key={`cable-${turbine.id}`}>
            <Hoverable info={cableInfo} onHover={onHover} onLeave={onLeave}>
              <path d={d} fill="none" stroke="transparent" strokeWidth="40" />
              <path d={d} fill="none" stroke="#3b2f63" strokeWidth="14" strokeLinecap="round" />
              <path d={d} fill="none" stroke={offline ? "#ff6b70" : QNX_ACCENT} strokeOpacity="0.8" strokeWidth="5" strokeDasharray="18 22" className="flow-streak" style={{ animationDuration: "1.4s" }} />
            </Hoverable>
            <Hoverable info={{ part: JUNCTION_PART, heading: `${turbine.id} bus channel ${index}`, live: [["Channel", String(index)]] }} onHover={onHover} onLeave={onLeave}>
              <rect x={mid.x - 22} y={mid.y - 22} width="44" height="44" rx="8" fill="#1d1638" stroke={QNX_ACCENT} strokeWidth="4" />
              <circle cx={mid.x} cy={mid.y} r="7" fill={QNX_ACCENT} />
            </Hoverable>
          </g>
        );
      })}

      <Hoverable info={baseInfo} onHover={onHover} onLeave={onLeave}>
        <g transform={`translate(${QNX_BASE.x} ${QNX_BASE.y})`}>
          <rect x={-QNX_BASE.width / 2} y={-QNX_BASE.height / 2} width={QNX_BASE.width} height={QNX_BASE.height} rx="22" fill="#1d1638" stroke={QNX_ACCENT} strokeWidth="5" />
          <rect x="-50" y="-110" width="100" height="100" rx="10" fill="#2a2150" stroke={QNX_ACCENT} strokeOpacity="0.6" strokeWidth="3" />
          {[-30, -10, 10, 30].map((offset) => (
            <g key={offset} stroke={QNX_ACCENT} strokeOpacity="0.6" strokeWidth="4">
              <line x1={offset} y1="-122" x2={offset} y2="-110" />
              <line x1={offset} y1="-10" x2={offset} y2="2" />
            </g>
          ))}
          <text textAnchor="middle" y="-48" fontSize="26" fontWeight="800" fill={QNX_ACCENT}>QNX</text>
          <text textAnchor="middle" y="50" fontSize="24" fontWeight="700" letterSpacing="3" fill="#ddd6fe">BASE</text>
          {turbines.map((turbine, index) => {
            const offline = turbine.fault || turbine.tripped;
            return (
              <g key={turbine.id} transform={`translate(${-40 + index * 40} 95)`}>
                <circle r="9" fill={offline ? "#ff6b70" : "#78e7a8"}>
                  <animate attributeName="opacity" values="1;0.35;1" dur={`${1.1 + index * 0.25}s`} repeatCount="indefinite" />
                </circle>
              </g>
            );
          })}
          <text textAnchor="middle" y="135" fontSize="17" fill="#8b7fb8">{base.jitterUs.toFixed(0)} µs jitter</text>
        </g>
      </Hoverable>

      {turbines.map((turbine) => {
        const reading = readings[turbine.id];
        const offline = turbine.fault || turbine.tripped;
        const color = offline ? "#ff6b70" : RISK_COLORS[riskTone(reading?.risk)];
        const label = turbine.fault ? "FAULT" : turbine.tripped ? "TRIPPED" : `${(reading?.power ?? 0).toFixed(1)} MW`;
        const turbineInfo = {
          part: TURBINE_PART,
          heading: `Turbine ${turbine.id}`,
          live: reading
            ? [
                ["Output", `${reading.power.toFixed(2)} of ${turbine.ratedPower} MW`],
                ["Wind at rotor", `${reading.effectiveWind.toFixed(1)} m/s`],
                ["Failure risk", `${Math.round(reading.risk * 100)}%`],
                ["Status", statusText(turbine, reading)],
              ]
            : [],
          hint: "Drag to move, click to edit. It stays wired to the base.",
        };
        const dragging = draggingId === turbine.id;
        return (
          <g key={turbine.id} transform={`translate(${turbine.x} ${turbine.y})`}>
            {Object.entries(SENSOR_OFFSETS).map(([key, [dx, dy]]) => {
              const part = SENSOR_PARTS[key];
              const value = reading?.[part.key];
              const warning = part.warn != null && value >= part.warn;
              const sensorColor = warning ? "#f1bd67" : "#78e7a8";
              return (
                <Hoverable
                  key={key}
                  info={{
                    part,
                    heading: `${turbine.id} ${part.title.toLowerCase()}`,
                    live: value != null ? [["Reading", formatSensor(part, value)], ["Status", warning ? "Above warning level" : "Normal"]] : [],
                  }}
                  onHover={onHover}
                  onLeave={onLeave}
                >
                  <line x1="0" y1="0" x2={dx} y2={dy} pointerEvents="none" stroke={QNX_ACCENT} strokeOpacity="0.35" strokeWidth="3" />
                  <circle cx={dx} cy={dy} r="21" fill="#140f24" stroke={sensorColor} strokeWidth="4" />
                  <text x={dx} y={dy + 8} textAnchor="middle" fontSize="22" fontWeight="800" fill={sensorColor}>{part.letter}</text>
                </Hoverable>
              );
            })}
            <Hoverable
              info={turbineInfo}
              onHover={onHover}
              onLeave={onLeave}
              onPointerDown={onPointerDown(turbine.id)}
              style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
              role="button"
              aria-label={`${turbine.id}, ${label}. Drag to move, click to edit.`}
            >
              {selectedId === turbine.id && <circle r={GLYPH_R + 26} fill="none" stroke="#4fe0c1" strokeWidth="6" strokeDasharray="14 10" />}
              {reading?.risk >= 0.65 && !offline && (
                <circle r={GLYPH_R + 10} fill={color} opacity="0.12">
                  <animate attributeName="r" values={`${GLYPH_R};${GLYPH_R + 40};${GLYPH_R}`} dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              <circle r={GLYPH_R + 6} fill={`${color}22`} stroke={QNX_ACCENT} strokeWidth="5" strokeDasharray={offline ? "12 9" : undefined} />
              <g transform={`rotate(${angles[turbine.id] ?? 0})`} opacity={offline ? 0.45 : 1}>
                {[0, 120, 240].map((blade) => (
                  <path
                    key={blade}
                    transform={`rotate(${blade})`}
                    d={`M -6 0 Q -9 ${-GLYPH_R * 0.5} 0 ${-GLYPH_R + 4} Q 7 ${-GLYPH_R * 0.5} 6 0 Z`}
                    fill={color}
                  />
                ))}
              </g>
              <circle r="9" fill="#140f24" stroke={color} strokeWidth="4" />
              <g transform={`translate(0 ${GLYPH_R + 70})`}>
                <rect x="-95" y="-30" width="190" height="72" rx="14" fill="#140f24e6" />
                <text textAnchor="middle" y="2" fontSize="30" fontWeight="700" fill="#ddd6fe">{turbine.id}</text>
                <text textAnchor="middle" y="32" fontSize="25" fill={offline ? "#ff6b70" : "#8b7fb8"}>{label}</text>
              </g>
            </Hoverable>
          </g>
        );
      })}
    </g>
  );
}
