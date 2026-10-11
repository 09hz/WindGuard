import { FIELD } from "../engine.js";
import {
  BASE_PART,
  CABLE_PART,
  JUNCTION_PART,
  QNX_BASE,
  QNX_ZONE,
  SENSOR_PARTS,
  TURBINE_PART,
} from "./hardware.js";
import { readBaseStatus } from "./telemetry.js";

export const QNX_ACCENT = "#a78bfa";
const GLYPH_R = 70;
// Sensor dots sit around each turbine, clockwise from upper left.
const SENSOR_OFFSETS = {
  vibration: [-82, -70],
  temperature: [82, -70],
  rotor: [82, 70],
  wind: [-82, 70],
};

function formatSensor(part, value) {
  const digits = part.unit === "RPM" ? 0 : 1;
  return `${value.toFixed(digits)} ${part.unit}`;
}

// Port on the base where each turbine's cable lands, spread down its left edge.
function basePort(index, count) {
  const top = QNX_BASE.y - QNX_BASE.height / 2 + 70;
  const span = QNX_BASE.height - 140;
  return {
    x: QNX_BASE.x - QNX_BASE.width / 2,
    y: count > 1 ? top + (span * index) / (count - 1) : QNX_BASE.y,
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

// Background strip drawn beneath everything else on the map.
export function QnxZoneBackground() {
  return (
    <g pointerEvents="none">
      <rect x={QNX_ZONE.x} y="0" width={QNX_ZONE.width} height={FIELD.height} fill="#140f24" />
      <rect x={QNX_ZONE.x} y="0" width={QNX_ZONE.width} height={FIELD.height} fill="url(#qnx-grid)" />
      <line x1={QNX_ZONE.x} y1="0" x2={QNX_ZONE.x} y2={FIELD.height} stroke={QNX_ACCENT} strokeOpacity="0.45" strokeWidth="5" strokeDasharray="22 14" />
      <text x={QNX_ZONE.x + 40} y="70" fontSize="30" fontWeight="700" letterSpacing="4" fill={QNX_ACCENT}>QNX HARDWARE-IN-THE-LOOP</text>
      <text x={QNX_ZONE.x + 40} y="108" fontSize="22" fill="#8b7fb8">Bench rig · not affected by weather</text>
    </g>
  );
}

export default function QnxZone({ turbines, readings, simHours, angles, draggingId, onPointerDown, onHover, onLeave }) {
  const base = readBaseStatus(simHours, turbines.length);
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

  return (
    <g>
      {/* Cables and bus junctions, drawn first so turbines sit on top. */}
      {turbines.map((turbine, index) => {
        const reading = readings[turbine.id];
        const { d, mid } = cableGeometry(turbine, basePort(index, turbines.length));
        const cableInfo = {
          part: CABLE_PART,
          heading: `${turbine.id} cable`,
          live: reading ? [["Link latency", `${reading.latencyMs.toFixed(1)} ms`], ["Status", "Connected"]] : [],
        };
        return (
          <g key={`cable-${turbine.id}`}>
            <Hoverable info={cableInfo} onHover={onHover} onLeave={onLeave}>
              <path d={d} fill="none" stroke="transparent" strokeWidth="40" />
              <path d={d} fill="none" stroke="#3b2f63" strokeWidth="14" strokeLinecap="round" />
              <path d={d} fill="none" stroke={QNX_ACCENT} strokeOpacity="0.8" strokeWidth="5" strokeDasharray="18 22" className="flow-streak" style={{ animationDuration: "1.4s" }} />
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
          {turbines.map((turbine, index) => (
            <g key={turbine.id} transform={`translate(${-40 + index * 40} 95)`}>
              <circle r="9" fill="#78e7a8">
                <animate attributeName="opacity" values="1;0.35;1" dur={`${1.1 + index * 0.25}s`} repeatCount="indefinite" />
              </circle>
            </g>
          ))}
          <text textAnchor="middle" y="135" fontSize="17" fill="#8b7fb8">{base.jitterUs.toFixed(0)} µs jitter</text>
        </g>
      </Hoverable>

      {turbines.map((turbine, index) => {
        const reading = readings[turbine.id];
        const turbineInfo = {
          part: TURBINE_PART,
          heading: `Bench turbine ${turbine.id}`,
          live: reading
            ? [
                ["Output", `${reading.watts.toFixed(2)} W`],
                ["Rotor speed", `${reading.sensors.rpm.toFixed(0)} RPM`],
                ["Fan wind", `${reading.sensors.wind.toFixed(1)} m/s`],
              ]
            : [],
          hint: "Drag to move. It stays wired to the base.",
        };
        return (
          <g key={turbine.id} transform={`translate(${turbine.x} ${turbine.y})`}>
            <Hoverable
              info={turbineInfo}
              onHover={onHover}
              onLeave={onLeave}
              onPointerDown={onPointerDown(turbine.id)}
              style={{ cursor: draggingId === turbine.id ? "grabbing" : "grab", touchAction: "none" }}
              role="button"
              aria-label={`QNX bench turbine ${turbine.id}. Drag to move within the hardware zone.`}
            >
              <circle r={GLYPH_R + 6} fill={`${QNX_ACCENT}1f`} stroke={QNX_ACCENT} strokeWidth="5" />
              <g transform={`rotate(${angles[turbine.id] ?? 0})`}>
                {[0, 120, 240].map((blade) => (
                  <path
                    key={blade}
                    transform={`rotate(${blade})`}
                    d={`M -6 0 Q -9 ${-GLYPH_R * 0.5} 0 ${-GLYPH_R + 4} Q 7 ${-GLYPH_R * 0.5} 6 0 Z`}
                    fill={QNX_ACCENT}
                  />
                ))}
              </g>
              <circle r="9" fill="#140f24" stroke={QNX_ACCENT} strokeWidth="4" />
              <g transform={`translate(0 ${GLYPH_R + 50})`}>
                <rect x="-95" y="-30" width="190" height="72" rx="14" fill="#140f24e6" />
                <text textAnchor="middle" y="2" fontSize="30" fontWeight="700" fill="#ddd6fe">{turbine.id}</text>
                <text textAnchor="middle" y="32" fontSize="25" fill="#8b7fb8">{reading ? `${reading.watts.toFixed(1)} W` : "—"}</text>
              </g>
            </Hoverable>
            {Object.entries(SENSOR_OFFSETS).map(([key, [dx, dy]]) => {
              const part = SENSOR_PARTS[key];
              const value = reading?.sensors[part.key];
              const warning = part.warn != null && value >= part.warn;
              const color = warning ? "#f1bd67" : "#78e7a8";
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
                  <line x1="0" y1="0" x2={dx * 0.55} y2={dy * 0.55} stroke={QNX_ACCENT} strokeOpacity="0.35" strokeWidth="3" />
                  <circle cx={dx} cy={dy} r="21" fill="#140f24" stroke={color} strokeWidth="4" />
                  <text x={dx} y={dy + 8} textAnchor="middle" fontSize="22" fontWeight="800" fill={color}>{part.letter}</text>
                </Hoverable>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
