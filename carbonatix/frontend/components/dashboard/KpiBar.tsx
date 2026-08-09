"use client";

import { AlertTriangle, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Card, Label, Mono } from "@/components/shell/primitives";
import { useTheme } from "@/components/shell/ThemeProvider";
import {
  compliancePositionView,
  formatIntensity,
  formatRupiah,
  formatTco2e,
} from "@/lib/dashboard";
import { formatPeriodLabel } from "@/lib/period";
import type { CompliancePosition, EmissionResult } from "@/types/emissions";

function KpiCard({
  label,
  value,
  sub,
  accent,
  glowColor,
  badge,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
  glowColor?: string;
  badge?: React.ReactNode;
}) {
  return (
    <Card
      className="flex min-w-0 flex-1 flex-col justify-between px-4 py-3"
      glowColor={glowColor}
      style={{ minHeight: 88 }}
    >
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {badge}
      </div>
      <div>
        <div
          className="text-xl font-bold leading-tight"
          style={{
            color: accent,
            fontFamily: "var(--font-display), sans-serif",
            fontSize: 22,
          }}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[11px]">{sub}</div>}
      </div>
    </Card>
  );
}

export default function KpiBar({
  result,
  compliance,
  period,
}: {
  result: EmissionResult;
  compliance: CompliancePosition;
  period?: string | null;
}) {
  const { colors: C } = useTheme();
  const position = compliancePositionView(compliance.positionTco2e);
  const utilPct =
    compliance.capTco2e > 0
      ? (compliance.projectedTco2e / compliance.capTco2e) * 100
      : 0;
  const over = utilPct > 100;
  const deficit = position.sense === "deficit";
  const periodLabel = period ? formatPeriodLabel(period) : null;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-4">
      {periodLabel ? (
        <p className="text-[11px]" style={{ color: C.dimText }}>
          Periode produksi: <Mono style={{ color: C.cyan }}>{periodLabel}</Mono>
        </p>
      ) : null}
      <div className="flex shrink-0 items-stretch gap-2" style={{ minHeight: 96 }}>
      <KpiCard
        label="Total CO₂e (interval)"
        value={
          <Mono>
            {formatTco2e(result.totalEmissions).replace(" tCO2e", "")}{" "}
            <span className="text-sm font-normal" style={{ color: C.dimText }}>
              tCO₂e
            </span>
          </Mono>
        }
        sub={
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
            style={{
              background: `${over ? C.red : C.green}18`,
              border: `1px solid ${over ? C.red : C.green}44`,
              color: over ? C.red : C.green,
            }}
          >
            {over ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            <Mono className="text-[11px] font-bold">{utilPct.toFixed(1)}% vs cap</Mono>
          </span>
        }
        accent={C.text}
      />

      <KpiCard
        label="Emission Intensity"
        value={
          <Mono style={{ color: C.amber }}>
            {formatIntensity(result.intensityPerTonneNi)}
          </Mono>
        }
        sub={
          <span style={{ color: C.dimText }}>
            Scope 1 {formatTco2e(result.scope1)} · Scope 2 {formatTco2e(result.scope2)}
          </span>
        }
        accent={C.amber}
      />

      <KpiCard
        label="ESDM Cap Target"
        value={
          <Mono>
            {formatTco2e(compliance.capTco2e).replace(" tCO2e", "")}{" "}
            <span className="text-sm font-normal" style={{ color: C.dimText }}>
              tCO₂e
            </span>
          </Mono>
        }
        sub={
          <div className="mt-1">
            <div className="mb-1 flex justify-between text-[10px]">
              <span style={{ color: C.muted }}>Utilization</span>
              <span style={{ color: over ? C.red : C.green, fontFamily: "var(--font-mono), monospace" }}>
                {utilPct.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: C.border }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(utilPct, 100)}%`,
                  background: over
                    ? `linear-gradient(90deg, ${C.amber}, ${C.red})`
                    : C.green,
                }}
              />
            </div>
          </div>
        }
      />

      <KpiCard
        label="Tax / Position Value"
        value={<Mono style={{ color: C.amber }}>{formatRupiah(compliance.positionValueIdr)}</Mono>}
        sub={<span style={{ color: C.muted }}>Nilai posisi × harga snapshot IDX</span>}
        accent={C.amber}
        badge={
          !compliance.isCompliant ? (
            <div
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-bold"
              style={{
                background: `${C.amber}18`,
                color: C.amber,
                border: `1px solid ${C.amber}33`,
              }}
            >
              <AlertTriangle size={9} />
              FISCAL RISK
            </div>
          ) : null
        }
      />

      <KpiCard
        label="Net Carbon Position"
        value={
          <Mono className="flex items-center gap-2" style={{ color: deficit ? C.red : C.green }}>
            {deficit ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
            <span>
              {deficit ? "-" : position.sense === "surplus" ? "+" : ""}
              {position.magnitudeTco2e}
            </span>
          </Mono>
        }
        sub={
          <span
            className="mt-1 inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-bold tracking-wider"
            style={{
              background: `${deficit ? C.red : C.green}22`,
              border: `1px solid ${deficit ? C.red : C.green}55`,
              color: deficit ? C.red : C.green,
              fontFamily: "var(--font-mono), monospace",
            }}
          >
            <Zap size={10} />
            {position.label.toUpperCase()}
          </span>
        }
        accent={deficit ? C.red : C.green}
        glowColor={deficit ? C.red : undefined}
        badge={
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest"
            style={{
              background: `${deficit ? C.red : C.green}22`,
              color: deficit ? C.red : C.green,
              border: `1px solid ${deficit ? C.red : C.green}44`,
            }}
          >
            {position.label.toUpperCase()}
          </span>
        }
      />
      </div>
    </div>
  );
}
