// Single-series charts (SVG): thin marks with a rounded data end, hairline grid, one hover tooltip.
// One series means no legend; the panel title names what is plotted.
import { useState } from 'react';

/** Axis top and tick step: steps of 1, 2, 5 × 10^k, at most 5 gridlines (whole numbers for counts). */
const niceScale = (m: number) => {
  if (m <= 0) return { max: 4, step: 1 };
  const p = 10 ** Math.floor(Math.log10(m));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * p).find((s) => m / s <= 4) ?? 10 * p);
  return { max: Math.ceil(m / step) * step, step };
};
const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n * 10) / 10));

/** Columns over time (e.g. reports per week). */
export function Columns({ data, fmt, label }: { data: { x: string; y: number }[]; fmt: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 210, pl = 34, pb = 26, pt = 12;
  const { max, step } = niceScale(Math.max(0, ...data.map((d) => d.y)));
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const band = (W - pl - 4) / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.6);
  const y = (v: number) => H - pb - (v / max) * (H - pb - pt);
  const every = Math.ceil(data.length / 8);
  return (
    <div className="chart relative">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}><line className="grid" x1={pl} x2={W - 4} y1={y(t)} y2={y(t)} /><text x={pl - 6} y={y(t) + 4} fontSize={10} textAnchor="end">{compact(t)}</text></g>
        ))}
        {data.map((d, i) => {
          const x = pl + i * band + (band - bw) / 2;
          const top = y(d.y);
          const h = H - pb - top;
          const r = Math.min(4, h, bw / 2);
          return (
            <g key={d.x} onMouseEnter={() => setHover(i)}>
              <rect x={pl + i * band} y={pt} width={band} height={H - pb - pt} fill="transparent" />
              {d.y > 0 && <path className={`bar ${hover === i ? 'on' : ''}`} d={`M${x} ${H - pb}V${top + r}a${r} ${r} 0 0 1 ${r}-${r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${H - pb}Z`} />}
              {i % every === 0 && <text x={x + bw / 2} y={H - 8} fontSize={10} textAnchor="middle">{d.x}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="charttip" style={{ left: `${((pl + hover * band + band / 2) / W) * 100}%`, top: `${(y(data[hover].y) / H) * 100}%` }}>{data[hover].x}: {fmt(data[hover].y)}</div>
      )}
    </div>
  );
}

/** Horizontal bars for categories (banks, localities, stages), value at the tip. */
export function Bars({ data, fmt, label, labelWidth = 130 }: { data: { x: string; y: number }[]; fmt: (v: number) => string; label: string; labelWidth?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, row = 30, H = data.length * row + 6, pl = labelWidth;
  const max = Math.max(0, ...data.map((d) => d.y)) || 1;
  const span = W - pl - 70;
  if (!data.length) return <p className="sub m-0">No data in this period.</p>;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const y0 = i * row + 6;
          const w = Math.max(2, (d.y / max) * span);
          const r = Math.min(4, w / 2);
          return (
            <g key={d.x} onMouseEnter={() => setHover(i)}>
              <rect x={0} y={y0 - 3} width={W} height={row} fill="transparent" />
              <text x={pl - 8} y={y0 + 13} fontSize={12} textAnchor="end">{d.x.length > 22 ? `${d.x.slice(0, 21)}…` : d.x}<title>{d.x}</title></text>
              <path className={`bar ${hover === i ? 'on' : ''}`} d={`M${pl} ${y0 + 2}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${16 - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}Z`} />
              <text className="val" x={pl + w + 6} y={y0 + 14} fontSize={12}>{fmt(d.y)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
