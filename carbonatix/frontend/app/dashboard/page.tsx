"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CompliancePanel from "@/components/dashboard/CompliancePanel";
import EmissionBars from "@/components/dashboard/EmissionBars";
import KpiBar from "@/components/dashboard/KpiBar";
import {
  GisMapCard,
  IdxMarketCard,
  LmeMarketCard,
  PeerMetersCard,
  ProductionSummaryCard,
  ScopeAreaCard,
  WhatIfCard,
} from "@/components/dashboard/DummyCards";
import NodeGraph, { PENDING_NODE_STATUSES, type NodeStatuses } from "@/components/advisor/NodeGraph";
import RecommendationPanel, { type AdvisorOutcome } from "@/components/advisor/RecommendationPanel";
import AppShell from "@/components/shell/AppShell";
import { Card, Label, Mono } from "@/components/shell/primitives";
import { useTheme } from "@/components/shell/ThemeProvider";
import { getRun, RunNotFoundError, streamRecommendation } from "@/lib/api";
import { STANDING_DISCLOSURES } from "@/lib/dashboard";
import type { RecommendationVerifyPayload, RunResult } from "@/types/emissions";

type LoadState = "loading" | "ready" | "not-found" | "error";

function isVerifyPayload(payload: unknown): payload is RecommendationVerifyPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.flagged === "boolean" &&
    typeof p.body === "string" &&
    typeof p.placeholderCitations === "boolean" &&
    Array.isArray(p.unsupported) &&
    Array.isArray(p.citations)
  );
}

function forceInterruptedTerminal(statuses: NodeStatuses): NodeStatuses {
  const order: (keyof NodeStatuses)[] = ["retrieve", "assemble", "synthesise", "verify"];
  const next = { ...statuses };
  for (const stage of order) {
    if (next[stage] === "running" || next[stage] === "pending") {
      next[stage] = "failed";
      return next;
    }
  }
  return next;
}

function AdvisorSection({ runId }: { runId: string }) {
  const { colors: C } = useTheme();
  const [statuses, setStatuses] = useState<NodeStatuses>(PENDING_NODE_STATUSES);
  const [verify, setVerify] = useState<RecommendationVerifyPayload | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      let sawTerminalOutcome = false;
      try {
        for await (const event of streamRecommendation(runId, controller.signal)) {
          if (cancelled) return;

          if (event.stage === "verify" && event.status === "done") {
            if (isVerifyPayload(event.payload)) {
              sawTerminalOutcome = true;
              setVerify(event.payload);
              setStatuses((prev) => ({ ...prev, verify: "done" }));
            } else {
              sawTerminalOutcome = true;
              setStatuses((prev) => ({ ...prev, verify: "failed" }));
            }
            continue;
          }

          setStatuses((prev) => ({ ...prev, [event.stage]: event.status }));
          if (event.stage === "synthesise" && event.status === "failed") {
            sawTerminalOutcome = true;
          }
        }
      } catch {
        // settled + forced statuses communicate the failure in BI UI
      } finally {
        if (!cancelled) {
          if (!sawTerminalOutcome) {
            setStatuses((prev) => forceInterruptedTerminal(prev));
          }
          setSettled(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId]);

  const outcome: AdvisorOutcome = verify
    ? { kind: "ready", verify }
    : settled
      ? { kind: "unavailable" }
      : { kind: "pending" };

  return (
    <Card className="flex flex-col gap-3 p-3" glowColor={`${C.violet}44`}>
      <Label>Agentic AI Auditor</Label>
      <NodeGraph statuses={statuses} />
      <RecommendationPanel outcome={outcome} />
    </Card>
  );
}

function RunView({ runId }: { runId: string }) {
  const { colors: C } = useTheme();
  const [state, setState] = useState<LoadState>("loading");
  const [run, setRun] = useState<RunResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getRun(runId);
        if (cancelled) return;
        setRun(result);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setState(err instanceof RunNotFoundError ? "not-found" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (state === "loading") {
    return (
      <p className="px-4 py-6 text-sm" style={{ color: C.dimText }}>
        Memuat data…
      </p>
    );
  }

  if (state === "not-found") {
    return (
      <p role="alert" className="px-4 py-6 text-sm" style={{ color: C.red }}>
        Perhitungan tidak ditemukan.{" "}
        <Link href="/twin" className="underline">
          Kembali ke digital twin
        </Link>
        .
      </p>
    );
  }

  if (state === "error" || !run) {
    return (
      <p role="alert" className="px-4 py-6 text-sm" style={{ color: C.red }}>
        Gagal memuat data dashboard. Coba lagi.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-4" style={{ minWidth: 1280 }}>
      <KpiBar
        result={run.result}
        compliance={run.compliance}
        period={run.period}
      />

      <div className="flex gap-3 px-4">
        {/* Left column */}
        <div className="flex w-[450px] shrink-0 flex-col gap-3">
          <ProductionSummaryCard
            nickelTons={run.result.nickelOutputTons}
            totalEmissions={run.result.totalEmissions}
          />
          <ScopeAreaCard scope1={run.result.scope1} scope2={run.result.scope2} />
          <div className="viz-root">
            <EmissionBars result={run.result} />
          </div>
          <PeerMetersCard />
          <GisMapCard />
        </div>

        {/* Center */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <IdxMarketCard
            stream={{
              dates: run.forecastSnapshot.dates,
              values: run.forecastSnapshot.idxCarbonIdrPerTon,
              lower: run.forecastSnapshot.idxCarbonIdrPerTonLower,
              upper: run.forecastSnapshot.idxCarbonIdrPerTonUpper,
              synthetic:
                run.forecastSnapshot.provenance?.idxCarbonIdrPerTon?.synthetic ??
                run.forecastSnapshot.synthetic,
              provenanceWarning: run.forecastSnapshot.provenance?.idxCarbonIdrPerTon?.warning,
              stale: run.forecastSnapshot.stale,
            }}
          />
          <CompliancePanel compliance={run.compliance} />
          <LmeMarketCard
            stream={{
              dates: run.forecastSnapshot.dates,
              values: run.forecastSnapshot.lmeUsdPerTon,
              synthetic:
                run.forecastSnapshot.provenance?.lmeUsdPerTon?.synthetic ??
                run.forecastSnapshot.synthetic,
              provenanceWarning: run.forecastSnapshot.provenance?.lmeUsdPerTon?.warning,
              stale: run.forecastSnapshot.stale,
            }}
          />
        </div>

        {/* Right */}
        <div className="flex w-[610px] shrink-0 flex-col gap-3">
          <WhatIfCard />
          <AdvisorSection key={run.id} runId={run.id} />
        </div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const { colors: C } = useTheme();
  const searchParams = useSearchParams();
  const runId = searchParams.get("run");

  return (
    <AppShell disclosure={STANDING_DISCLOSURES}>
      <main className="flex-1 overflow-auto" style={{ background: C.bg }}>
        {runId ? (
          <RunView key={runId} runId={runId} />
        ) : (
          <div className="flex flex-col gap-4 px-6 py-8" style={{ minWidth: 1280 }}>
            <Mono className="text-sm" style={{ color: C.dimText }}>
              Tidak ada perhitungan yang dipilih.{" "}
              <Link href="/twin" className="underline" style={{ color: C.cyan }}>
                Buka digital twin
              </Link>{" "}
              untuk membuat perhitungan baru.
            </Mono>
            <div className="flex gap-3">
              <div className="flex w-[450px] flex-col gap-3">
                <GisMapCard />
                <PeerMetersCard />
              </div>
              <div className="flex-1">
                <IdxMarketCard />
              </div>
              <div className="w-[610px]">
                <WhatIfCard />
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}

function DashboardFallback() {
  const { colors: C } = useTheme();
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: C.bg, color: C.dimText }}
    >
      <p className="text-sm">Memuat data…</p>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardContent />
    </Suspense>
  );
}
