"use client";

import {
  ALL_DRIVER_STAGES,
  DRIVER_GROUPS,
  formatIntensity,
  formatTco2e,
  INTENSITY_NULL_TOOLTIP,
  stageValue,
} from "@/lib/dashboard";
import type { EmissionResult } from "@/types/emissions";

export interface EmissionBarsProps {
  result: EmissionResult;
}

const BAR_PLOT_HEIGHT = 140; // px -- plot area only, excludes value/axis labels

const CARD_CLASS =
  "rounded-lg border border-black/[.08] bg-[var(--chart-surface)] p-4 dark:border-white/[.145]";

/**
 * A stat value with an optional attached tooltip -- used for the
 * `intensityPerTonneNi === null` case, where the em dash on screen needs an
 * explanation reachable by hover *and* keyboard focus. The tooltip text
 * itself is always in the DOM (visibility is CSS-only), so it's reachable
 * without hovering too -- consistent with the "tooltips enhance, never
 * gate" rule.
 */
function StatTile({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip?: string;
}) {
  return (
    <div className={CARD_CLASS}>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--chart-muted)]">
        {label}
      </p>
      <div className="group relative mt-1 inline-flex items-baseline gap-1.5">
        <p className="text-2xl font-semibold text-[var(--chart-text-primary)]">{value}</p>
        {tooltip && (
          <>
            <span
              tabIndex={0}
              aria-label={tooltip}
              className="cursor-help text-sm text-[var(--chart-muted)]"
            >
              (?)
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-56 rounded bg-black px-2 py-1 text-xs font-normal text-white group-hover:block group-focus-within:block dark:bg-zinc-800"
            >
              {tooltip}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Driver bars (grouped into the two clusters the task brief calls for --
 * see `lib/dashboard.ts`'s `DRIVER_GROUPS` docstring for why a flat
 * four-bar row would lose the story), the Scope 1/2 split, and the
 * total/intensity pair that must never be shown one without the other.
 */
export default function EmissionBars({ result }: EmissionBarsProps) {
  const maxStageValue = Math.max(0, ...ALL_DRIVER_STAGES.map((s) => stageValue(result, s.key)));
  const scopeTotal = result.scope1 + result.scope2;
  const scope1Pct = scopeTotal > 0 ? (result.scope1 / scopeTotal) * 100 : 0;
  const scope2Pct = scopeTotal > 0 ? (result.scope2 / scopeTotal) * 100 : 0;

  return (
    <div className="viz-root flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile label="Total emisi" value={formatTco2e(result.totalEmissions)} />
        <StatTile
          label="Intensitas per ton Ni"
          value={formatIntensity(result.intensityPerTonneNi)}
          tooltip={result.intensityPerTonneNi === null ? INTENSITY_NULL_TOOLTIP : undefined}
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--chart-text-primary)]">
          Emisi per tahap proses
        </h3>
        <p className="text-xs text-[var(--chart-text-secondary)]">
          Dikelompokkan menurut pemicunya -- bijih atau nikel.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DRIVER_GROUPS.map((group) => (
            <div key={group.id} className={CARD_CLASS}>
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--chart-text-secondary)]">
                {group.label}
              </p>
              <div
                className="mt-3 flex items-end justify-center gap-8"
                style={{ height: BAR_PLOT_HEIGHT }}
              >
                {group.stages.map((stage) => {
                  const value = stageValue(result, stage.key);
                  const heightPct = maxStageValue > 0 ? (value / maxStageValue) * 100 : 0;
                  return (
                    <div
                      key={stage.key}
                      className="flex h-full w-14 flex-col items-center justify-end"
                    >
                      <span
                        className="mb-1 font-mono text-xs text-[var(--chart-text-primary)]"
                        data-testid={`bar-value-${stage.key}`}
                      >
                        {value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
                      </span>
                      <div
                        data-testid={`bar-${stage.key}`}
                        aria-label={`${stage.label}: ${formatTco2e(value)}`}
                        className="w-6 rounded-t-[4px]"
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor: `var(${stage.colorVar})`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-center gap-6 border-t border-[var(--chart-gridline)] pt-2">
                {group.stages.map((stage) => (
                  <div
                    key={stage.key}
                    className="flex items-center gap-1.5 text-xs text-[var(--chart-text-secondary)]"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: `var(${stage.colorVar})` }}
                      aria-hidden
                    />
                    {stage.label}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--chart-text-primary)]">
          Scope 1 vs Scope 2
        </h3>
        <div
          className="mt-3 flex h-6 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--chart-gridline)]"
          role="img"
          aria-label={`Scope 1: ${formatTco2e(result.scope1)}. Scope 2: ${formatTco2e(result.scope2)}.`}
        >
          <div
            data-testid="scope1-segment"
            className="rounded-l-full"
            style={{ width: `${scope1Pct}%`, backgroundColor: "var(--chart-series-1)" }}
          />
          <div
            data-testid="scope2-segment"
            className="rounded-r-full"
            style={{ width: `${scope2Pct}%`, backgroundColor: "var(--chart-series-2)" }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-6 text-xs text-[var(--chart-text-secondary)]">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "var(--chart-series-1)" }}
              aria-hidden
            />
            Scope 1 -- {formatTco2e(result.scope1)}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "var(--chart-series-2)" }}
              aria-hidden
            />
            Scope 2 -- {formatTco2e(result.scope2)}
          </span>
        </div>
      </div>

      <details className="text-xs text-[var(--chart-text-secondary)]">
        <summary className="cursor-pointer select-none">Tampilkan sebagai tabel</summary>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--chart-gridline)]">
              <th className="py-1 pr-4 font-medium">Tahap</th>
              <th className="py-1 font-medium">Emisi (tCO2e)</th>
            </tr>
          </thead>
          <tbody>
            {ALL_DRIVER_STAGES.map((stage) => (
              <tr key={stage.key} className="border-b border-[var(--chart-gridline)]">
                <td className="py-1 pr-4">{stage.label}</td>
                <td className="py-1 font-mono">
                  {stageValue(result, stage.key).toLocaleString("id-ID", {
                    maximumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-1 pr-4">Scope 1</td>
              <td className="py-1 font-mono">
                {result.scope1.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
              </td>
            </tr>
            <tr>
              <td className="py-1 pr-4">Scope 2</td>
              <td className="py-1 font-mono">
                {result.scope2.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}
