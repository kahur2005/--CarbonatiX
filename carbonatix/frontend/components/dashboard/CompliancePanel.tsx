"use client";

import { compliancePositionView, formatRupiah, formatTco2e, PTBAE_DISCLOSURE } from "@/lib/dashboard";
import { Card, Label, Mono } from "@/components/shell/primitives";
import { useTheme } from "@/components/shell/ThemeProvider";
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
 *
 * Typography matches the rest of the shell: Rajdhani titles, Inter body,
 * JetBrains Mono for figures (via `Label` / `Mono`).
 */
export default function CompliancePanel({ compliance }: CompliancePanelProps) {
  const { colors: C } = useTheme();
  const { capTco2e, projectedTco2e, positionTco2e, positionValueIdr, isCompliant } = compliance;
  const position = compliancePositionView(positionTco2e);

  const statusColor = isCompliant ? C.green : C.red;
  const meterPct = capTco2e > 0 ? Math.min((projectedTco2e / capTco2e) * 100, 100) : 0;
  const meterOverPct = capTco2e > 0 ? (projectedTco2e / capTco2e) * 100 : 0;

  const stats = [
    { label: "Batas alokasi", value: formatTco2e(capTco2e) },
    { label: "Proyeksi emisi", value: formatTco2e(projectedTco2e) },
    { label: `Posisi (${position.label})`, value: position.magnitudeTco2e },
    { label: "Nilai posisi", value: formatRupiah(positionValueIdr) },
  ] as const;

  return (
    <Card className="flex flex-col gap-4 p-3" glowColor={`${statusColor}44`}>
      <div>
        <div
          className="text-sm font-semibold"
          style={{ fontFamily: "var(--font-display), sans-serif", color: C.text }}
        >
          Status Kepatuhan
        </div>

        <div
          className="mt-2 inline-flex items-center gap-2 rounded px-2.5 py-1 text-xs font-medium"
          style={{
            border: `1px solid ${statusColor}55`,
            background: `${statusColor}18`,
            color: statusColor,
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          <span aria-hidden>{isCompliant ? "✓" : "⚠"}</span>
          <span>{position.label}</span>
          <Mono className="text-[11px]" style={{ color: statusColor }}>
            {position.magnitudeTco2e}
          </Mono>
        </div>

        {/* Permanent body text, directly beneath the badge -- never a
            tooltip or footnote. See component docstring. */}
        <p
          className="mt-2 max-w-prose text-[12px] leading-relaxed"
          style={{ color: C.dimText, fontFamily: "var(--font-body), sans-serif" }}
        >
          {PTBAE_DISCLOSURE}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label>Proyeksi vs batas alokasi</Label>
          <span data-testid="compliance-meter-pct">
            <Mono className="text-[11px]" style={{ color: C.dimText }}>
              {meterOverPct.toFixed(0)}%
            </Mono>
          </span>
        </div>
        <div
          className="mt-1.5 h-2 w-full overflow-hidden rounded-full"
          style={{ background: C.border }}
        >
          <div
            data-testid="compliance-meter-fill"
            className="h-full rounded-full"
            style={{ width: `${meterPct}%`, backgroundColor: statusColor }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>
              <Label>{stat.label}</Label>
            </dt>
            <dd className="mt-0.5">
              <Mono className="text-sm" style={{ color: C.text }}>
                {stat.value}
              </Mono>
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
