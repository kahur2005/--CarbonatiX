"use client";

import { useState } from "react";
import { SYNTHETIC_PRICE_LABEL, STALE_FORECAST_BANNER } from "@/lib/dashboard";

export interface ForecastChartProps {
  /** Chart title -- names the series, doubling as its (single-series, no
   * legend box needed) identity label. */
  title: string;
  /** Shown beside the title, e.g. "USD/ton" or "IDR/ton" -- the currency
   * unit is always part of the chart's own label, never left implicit,
   * because this screen must never let a USD series and an IDR series be
   * mistaken for each other. Each `ForecastChart` instance plots exactly
   * one series on exactly one axis -- never call this twice into a shared
   * chart to put two currencies on one axis. */
  unitLabel: string;
  dates: string[];
  values: number[];
  lower: number[];
  upper: number[];
  /** One categorical slot's CSS custom property, e.g. `--chart-series-1`. */
  colorVar: string;
  formatValue: (value: number) => string;
  /** True if this series may originate from fabricated training data --
   * see `types/emissions.ts`'s `PriceProvenance`. Must render a persistent,
   * always-visible label on the chart itself, not only in a tooltip: a
   * judge glancing at the chart, never hovering, must still see it. */
  synthetic: boolean;
  provenanceWarning?: string;
  stale?: boolean;
}

const VIEW_W = 600;
const VIEW_H = 220;
const PAD_L = 64;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

function buildScales(n: number, lower: number[], upper: number[]) {
  const x = (i: number) => (n <= 1 ? PAD_L : PAD_L + (i / (n - 1)) * PLOT_W);
  const minY = Math.min(...lower);
  const maxY = Math.max(...upper);
  const span = maxY - minY || 1;
  const y = (v: number) => PAD_T + (1 - (v - minY) / span) * PLOT_H;
  return { x, y, minY, maxY };
}

/**
 * One price series with its 80% interval band -- LME nickel or IDX Carbon,
 * never both at once (see `unitLabel` doc). Built as a fixed-viewBox inline
 * SVG rather than a library chart: it scales responsively without a
 * `ResizeObserver`, and every value is a real DOM text node, so the
 * synthetic label, the axis ticks, and the accessible table fallback are
 * all reachable without hovering.
 */
export default function ForecastChart({
  title,
  unitLabel,
  dates,
  values,
  lower,
  upper,
  colorVar,
  formatValue,
  synthetic,
  provenanceWarning,
  stale,
}: ForecastChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const n = values.length;

  if (n === 0) {
    return (
      <div className="viz-root rounded-lg border border-black/[.08] bg-[var(--chart-surface)] p-4 dark:border-white/[.145]">
        <h3
          className="text-sm font-semibold text-[var(--chart-text-primary)]"
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          {title} ({unitLabel})
        </h3>
        <p className="mt-2 text-sm text-[var(--chart-text-secondary)]">Tidak ada data proyeksi.</p>
      </div>
    );
  }

  const { x, y, minY, maxY } = buildScales(n, lower, upper);
  const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const bandPath =
    upper.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ") +
    " " +
    lower
      .map((v, i) => `L ${x(n - 1 - i)} ${y(lower[n - 1 - i])}`)
      .join(" ") +
    " Z";
  const sliceWidth = n <= 1 ? PLOT_W : PLOT_W / n;
  const midY = (minY + maxY) / 2;

  return (
    <div className="viz-root rounded-lg border border-black/[.08] bg-[var(--chart-surface)] p-4 dark:border-white/[.145]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          className="text-sm font-semibold text-[var(--chart-text-primary)]"
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          {title}{" "}
          <span className="font-normal text-[var(--chart-text-secondary)]">({unitLabel})</span>
        </h3>
        {synthetic && (
          <span
            data-testid="synthetic-badge"
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold"
            style={{ borderColor: "var(--chart-status-warning)", color: "var(--chart-status-warning)" }}
            title={provenanceWarning}
          >
            <span aria-hidden>⚠</span>
            {SYNTHETIC_PRICE_LABEL}
          </span>
        )}
      </div>

      {stale && (
        <p className="mt-1 text-xs text-[var(--chart-status-warning)]">{STALE_FORECAST_BANNER}</p>
      )}

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={`${title} dalam ${unitLabel}, ${n} titik proyeksi`}
          className="w-full"
        >
          {/* y-axis ticks: min / mid / max */}
          {[minY, midY, maxY].map((v, idx) => (
            <g key={idx}>
              <line
                x1={PAD_L}
                x2={VIEW_W - PAD_R}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--chart-gridline)"
                strokeWidth={1}
              />
              <text x={PAD_L - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--chart-muted)">
                {formatValue(v)}
              </text>
            </g>
          ))}

          {/* band */}
          <path d={bandPath} fill={`var(${colorVar})`} fillOpacity={0.12} stroke="none" />

          {/* line */}
          <path d={linePath} fill="none" stroke={`var(${colorVar})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* x-axis: first + last date only (selective direct labels) */}
          <text x={x(0)} y={VIEW_H - PAD_B + 16} textAnchor="start" fontSize={10} fill="var(--chart-muted)">
            {dates[0]}
          </text>
          <text x={x(n - 1)} y={VIEW_H - PAD_B + 16} textAnchor="end" fontSize={10} fill="var(--chart-muted)">
            {dates[n - 1]}
          </text>

          {/* crosshair + hovered point */}
          {hovered !== null && (
            <>
              <line
                x1={x(hovered)}
                x2={x(hovered)}
                y1={PAD_T}
                y2={VIEW_H - PAD_B}
                stroke="var(--chart-baseline)"
                strokeWidth={1}
              />
              <circle cx={x(hovered)} cy={y(values[hovered])} r={4} fill={`var(${colorVar})`} stroke="var(--chart-surface)" strokeWidth={2} />
            </>
          )}

          {/* per-point hit targets -- hover/focus without needing pointer
              coordinate math (see component docstring). */}
          {values.map((_, i) => (
            <rect
              key={i}
              x={x(i) - sliceWidth / 2}
              y={PAD_T}
              width={sliceWidth}
              height={PLOT_H}
              fill="transparent"
              onPointerEnter={() => setHovered(i)}
              onPointerLeave={() => setHovered((cur) => (cur === i ? null : cur))}
              onFocus={() => setHovered(i)}
              tabIndex={0}
              aria-label={`${dates[i]}: ${formatValue(values[i])}, kisaran ${formatValue(lower[i])} - ${formatValue(upper[i])}`}
            />
          ))}
        </svg>

        {hovered !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 rounded bg-black px-2 py-1 text-xs text-white shadow dark:bg-zinc-800"
            style={{
              left: `${(x(hovered) / VIEW_W) * 100}%`,
              transform: x(hovered) / VIEW_W > 0.7 ? "translateX(-100%)" : undefined,
            }}
          >
            <p className="font-semibold">{formatValue(values[hovered])}</p>
            <p className="text-[10px] text-zinc-300">{dates[hovered]}</p>
            <p className="text-[10px] text-zinc-300">
              {formatValue(lower[hovered])} - {formatValue(upper[hovered])}
            </p>
          </div>
        )}
      </div>

      <details className="mt-2 text-xs text-[var(--chart-text-secondary)]">
        <summary className="cursor-pointer select-none">Tampilkan sebagai tabel</summary>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--chart-gridline)]">
              <th className="py-1 pr-4 font-medium">Tanggal</th>
              <th className="py-1 pr-4 font-medium">Nilai</th>
              <th className="py-1 font-medium">Kisaran 80%</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d, i) => (
              <tr key={d} className="border-b border-[var(--chart-gridline)]">
                <td className="py-1 pr-4">{d}</td>
                <td className="py-1 pr-4 font-mono">{formatValue(values[i])}</td>
                <td className="py-1 font-mono">
                  {formatValue(lower[i])} - {formatValue(upper[i])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
