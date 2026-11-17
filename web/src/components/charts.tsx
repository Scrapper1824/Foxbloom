import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Small SVG charts for the Statistics page: thin marks, recessive axes, a hover crosshair/tooltip, and a legend
 * plus a table view so nothing relies on colour alone.
 */

/** Categorical series colours (validated against Foxbloom's dark surface), assigned in this fixed order. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
export const OTHER = '#6b7283';

const PAD = { top: 12, right: 12, bottom: 26, left: 52 };
const HEIGHT = 230;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure straight away (resize notifications can lag, e.g. in a background tab), then follow changes.
    setWidth(Math.max(260, Math.round(el.clientWidth || 600)));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 4 tidy steps from 0 to a round number at or above `max`. */
function ticks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Which day labels to show so they never crowd (first and last always). */
function labelEvery(n: number, width: number) {
  return Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - PAD.left - PAD.right) / 70))));
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = x > width / 2;
  return (
    <div className="chart-tip" style={left ? { right: width - x + 12 } : { left: x + 12 }} role="status">
      {children}
    </div>
  );
}

export function LineChart({ days, series, format, label }: { days: string[]; series: LineSeries[]; format: (v: number) => string; label: string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const yt = ticks(max);
  const top = yt[yt.length - 1] || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const every = labelEvery(days.length, width);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(days.length - 1, Math.round(rel * (days.length - 1)))));
  };
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label={label}>
        {yt.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="chart-axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % every === 0 || i === days.length - 1 ? (
            <text key={d} className="chart-axis" x={x(i)} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}>
              {shortDay(d)}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
        {hover !== null && (
          <g>
            <line className="chart-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
            {series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4.5} fill={s.color} stroke="var(--bg)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)} width={width}>
          <strong>{shortDay(days[hover])}</strong>
          {series.map((s) => (
            <div key={s.key} className="chart-tip-row">
              <i style={{ background: s.color }} aria-hidden />
              <span>{s.label}</span>
              <b>{format(s.values[hover])}</b>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

export interface StackSegment {
  key: string;
  label: string;
  color: string;
}

/** One bar per day, stacked by segment (people), with a 2px gap between segments. */
export function StackedBars({ days, segments, value, format, label }: { days: string[]; segments: StackSegment[]; value: (day: number, seg: string) => number; format: (v: number) => string; label: string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((_, i) => segments.reduce((s, g) => s + value(i, g.key), 0));
  const yt = ticks(Math.max(0, ...totals));
  const top = yt[yt.length - 1] || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, days.length);
  const bw = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const every = labelEvery(days.length, width);
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label={label}>
        {yt.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="chart-axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          let acc = 0;
          const parts = segments
            .map((g) => ({ g, v: value(i, g.key) }))
            .filter((p) => p.v > 0)
            .map((p) => {
              const y0 = y(acc);
              acc += p.v;
              const y1 = y(acc);
              return { ...p, y: y1, h: Math.max(0, y0 - y1 - 2) };
            });
          return (
            <g key={d} opacity={hover === null || hover === i ? 1 : 0.55}>
              {parts.map((p, j) => (
                <rect key={p.g.key} x={cx - bw / 2} y={p.y} width={bw} height={p.h} rx={j === parts.length - 1 ? Math.min(4, bw / 2) : 0} fill={p.g.color} />
              ))}
              {(i % every === 0 || i === days.length - 1) && (
                <text className="chart-axis" x={cx} y={HEIGHT - 8} textAnchor="middle">
                  {shortDay(d)}
                </text>
              )}
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip x={PAD.left + slot * hover + slot / 2} width={width}>
          <strong>
            {shortDay(days[hover])} · {format(totals[hover])}
          </strong>
          {segments
            .filter((g) => value(hover, g.key) > 0)
            .map((g) => (
              <div key={g.key} className="chart-tip-row">
                <i style={{ background: g.color }} aria-hidden />
                <span>{g.label}</span>
                <b>{format(value(hover, g.key))}</b>
              </div>
            ))}
          {totals[hover] === 0 && <div className="muted small">Nothing watched</div>}
        </Tooltip>
      )}
    </div>
  );
}
