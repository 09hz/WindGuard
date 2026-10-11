import { Cpu } from "lucide-react";

// Floating detail card for a QNX rig part. `position` is relative to the map
// container; the card flips left or up so it stays inside it.
export default function HoverCard({ info, position, bounds }) {
  if (!info) return null;
  const width = 260;
  const flipX = position.x + width + 24 > bounds.width;
  const flipY = position.y > bounds.height * 0.55;
  const style = {
    width,
    left: flipX ? Math.max(8, position.x - width - 16) : position.x + 16,
    ...(flipY ? { bottom: bounds.height - position.y + 12 } : { top: position.y + 12 }),
  };
  const { part, heading, live, hint } = info;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-xl border border-violet-400/25 bg-[#120d22]/95 p-3 text-[11px] shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur"
      style={style}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-violet-400/15 p-1 text-violet-300">
          <Cpu size={12} />
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-violet-100">{heading}</div>
          <div className="truncate text-[10px] text-violet-300/70">{part.title}</div>
        </div>
      </div>
      <div className="mt-2 text-[10px] font-medium text-slate-300">{part.hardware}</div>
      <p className="mt-1 leading-snug text-slate-400">{part.role}</p>
      {live?.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
          {live.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-right font-semibold tabular-nums text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {part.specs?.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {part.specs.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-right text-slate-300">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hint && <div className="mt-2 text-[10px] text-violet-300/80">{hint}</div>}
    </div>
  );
}
