"use client";

import { compliancePositionView, formatRupiah, formatTco2e, PTBAE_DISCLOSURE } from "@/lib/dashboard";
import type { CompliancePosition } from "@/types/emissions";

export interface CompliancePanelProps {
  compliance: CompliancePosition;
}

/**
 * Compliance status, the PTBAE-PU readiness disclosure, and the four
 * figures behind it. `isCompliant` drives the badge; the disclosure is
 * fixed body text directly beneath it, not a tooltip, because a badge
 * alone -- especially a red one -- reads as "you are breaking the law",
 * which is not true today (PLTU captive is out of PTBAE-PU's mandatory
 * scope). The text is what keeps the badge honest.
 */
export default function CompliancePanel({ compliance }: CompliancePanelProps) {
  const { capTco2e, projectedTco2e, positionTco2e, positionValueIdr, isCompliant } = compliance;
  const position = compliancePositionView(positionTco2e);

  const statusColorVar = isCompliant ? "--chart-status-good" : "--chart-status-critical";
  const meterPct = capTco2e > 0 ? Math.min((projectedTco2e / capTco2e) * 100, 100) : 0;
  const meterOverPct = capTco2e > 0 ? (projectedTco2e / capTco2e) * 100 : 0;

  return (
    <div className="viz-root flex flex-col gap-4 rounded-lg border border-black/[.08] bg-[var(--chart-surface)] p-4 dark:border-white/[.145]">
      <div>
        <h2 className="text-sm font-semibold text-[var(--chart-text-primary)]">
          Status Kepatuhan
        </h2>

        <div className="mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium"
          style={{
            borderColor: `var(${statusColorVar})`,
            color: `var(${statusColorVar})`,
          }}
        >
          <span aria-hidden>{isCompliant ? "✓" : "⚠"}</span>
          <span>{position.label}</span>
          <span className="font-mono text-xs">{position.magnitudeTco2e}</span>
        </div>

        {/* Permanent body text, directly beneath the badge -- never a
            tooltip or footnote. See component docstring. */}
        <p className="mt-2 max-w-prose text-sm text-[var(--chart-text-secondary)]">
          {PTBAE_DISCLOSURE}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-[var(--chart-text-secondary)]">
          <span>Proyeksi vs batas alokasi</span>
          <span data-testid="compliance-meter-pct">{meterOverPct.toFixed(0)}%</span>
        </div>
        <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-[var(--chart-gridline)]">
          <div
            data-testid="compliance-meter-fill"
            className="h-full rounded-full"
            style={{ width: `${meterPct}%`, backgroundColor: `var(${statusColorVar})` }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--chart-text-secondary)]">Batas alokasi</dt>
          <dd className="font-mono text-[var(--chart-text-primary)]">{formatTco2e(capTco2e)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--chart-text-secondary)]">Proyeksi emisi</dt>
          <dd className="font-mono text-[var(--chart-text-primary)]">
            {formatTco2e(projectedTco2e)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--chart-text-secondary)]">
            Posisi ({position.label})
          </dt>
          <dd className="font-mono text-[var(--chart-text-primary)]">{position.magnitudeTco2e}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--chart-text-secondary)]">Nilai posisi</dt>
          <dd className="font-mono text-[var(--chart-text-primary)]">
            {formatRupiah(positionValueIdr)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
