"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CompliancePanel from "@/components/dashboard/CompliancePanel";
import EmissionBars from "@/components/dashboard/EmissionBars";
import ForecastChart from "@/components/dashboard/ForecastChart";
import NodeGraph, { PENDING_NODE_STATUSES, type NodeStatuses } from "@/components/advisor/NodeGraph";
import RecommendationPanel, { type AdvisorOutcome } from "@/components/advisor/RecommendationPanel";
import { getRun, RunNotFoundError, streamRecommendation } from "@/lib/api";
import { formatIdrPerTon, formatUsdPerTon, STANDING_DISCLOSURES } from "@/lib/dashboard";
import type { RecommendationVerifyPayload, RunResult } from "@/types/emissions";

type LoadState = "loading" | "ready" | "not-found" | "error";

/** Narrows `RecommendationEvent["payload"]` (an untyped bag on the wire) to
 * `RecommendationVerifyPayload` before it is trusted -- a `verify`/`done`
 * event with a payload that doesn't actually match the expected shape is
 * treated the same as one that never arrived (see `AdvisorSection` below),
 * never cast through blindly. */
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

/** When the stream ends or errors without a terminal event for every
 * stage, any stage still `"running"` is stuck -- forced to `"failed"` so
 * nothing spins forever. A stage still `"pending"` legitimately never
 * started (e.g. `verify` after a failed `synthesise`, or every later stage
 * when the connection never delivered a single event) and is left as-is,
 * except that the *first* pending stage is also marked `"failed"` so the
 * graph shows where the process broke instead of sitting entirely grey
 * with no signal at all. */
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

/**
 * Consumes `GET /runs/{id}/recommendation`'s SSE stream and renders the
 * reasoning `NodeGraph` alongside the `RecommendationPanel` it feeds.
 *
 * Mounted with `key={runId}` by `RunView` below (same reasoning as
 * `RunView` itself carrying `key={runId}` in `DashboardContent`): a change
 * of run remounts this component from scratch instead of needing an effect
 * to reset five pieces of state for the new id.
 */
function AdvisorSection({ runId }: { runId: string }) {
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

          // `verify`/`done` needs its payload validated *before* the node
          // status is decided -- writing `event.status` ("done") through
          // unconditionally first, then separately deciding whether to
          // trust the payload, would leave the node green even when the
          // payload is rejected below. A malformed payload is treated as
          // its own terminal outcome: the node turns red and the panel
          // falls back to "unavailable", never a silent green node sitting
          // above a message that says there is nothing to show.
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
          // A failed `synthesise` is itself a terminal outcome for the
          // pipeline -- `run_pipeline` returns immediately after yielding
          // it and never sends `verify` (see `app/advisor/pipeline.py`).
          if (event.stage === "synthesise" && event.status === "failed") {
            sawTerminalOutcome = true;
          }
        }
      } catch {
        // A network error mid-stream is communicated below via `settled`
        // plus the forced node statuses -- never a raw exception string in
        // this Bahasa Indonesia UI.
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
    <div className="flex flex-col gap-4">
      <NodeGraph statuses={statuses} />
      <RecommendationPanel outcome={outcome} />
    </div>
  );
}

/**
 * Fetches and renders one committed run, given its id. Mounted with
 * `key={runId}` by `DashboardContent` below so a change of `?run=` remounts
 * this component from scratch (state starts fresh at `"loading"`) rather
 * than needing an effect to reset state for the new id -- an effect that
 * calls `setState` synchronously on every dependency change is exactly what
 * `react-hooks/set-state-in-effect` flags, and a fresh mount per id avoids
 * needing that call at all.
 */
function RunView({ runId }: { runId: string }) {
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
        // Never render a raw exception string in this Bahasa Indonesia UI
        // -- only the two fixed messages below, regardless of what the
        // backend's error body actually said.
        setState(err instanceof RunNotFoundError ? "not-found" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (state === "loading") {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Memuat data...</p>;
  }

  if (state === "not-found") {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
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
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Gagal memuat data dashboard. Coba lagi.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <EmissionBars result={run.result} />
      <CompliancePanel compliance={run.compliance} />
      <div>
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Proyeksi Harga</h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Harga yang digunakan saat perhitungan ini disimpan.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ForecastChart
            title="LME Nikel"
            unitLabel="USD/ton"
            dates={run.forecastSnapshot.dates}
            values={run.forecastSnapshot.lmeUsdPerTon}
            lower={run.forecastSnapshot.lmeUsdPerTonLower}
            upper={run.forecastSnapshot.lmeUsdPerTonUpper}
            colorVar="--chart-series-1"
            formatValue={formatUsdPerTon}
            synthetic={
              run.forecastSnapshot.provenance?.lmeUsdPerTon?.synthetic ??
              run.forecastSnapshot.synthetic
            }
            provenanceWarning={run.forecastSnapshot.provenance?.lmeUsdPerTon?.warning}
            stale={run.forecastSnapshot.stale}
          />
          <ForecastChart
            title="IDX Carbon"
            unitLabel="IDR/ton"
            dates={run.forecastSnapshot.dates}
            values={run.forecastSnapshot.idxCarbonIdrPerTon}
            lower={run.forecastSnapshot.idxCarbonIdrPerTonLower}
            upper={run.forecastSnapshot.idxCarbonIdrPerTonUpper}
            colorVar="--chart-series-2"
            formatValue={formatIdrPerTon}
            synthetic={
              run.forecastSnapshot.provenance?.idxCarbonIdrPerTon?.synthetic ??
              run.forecastSnapshot.synthetic
            }
            provenanceWarning={run.forecastSnapshot.provenance?.idxCarbonIdrPerTon?.warning}
            stale={run.forecastSnapshot.stale}
          />
        </div>
      </div>

      <AdvisorSection key={run.id} runId={run.id} />
    </div>
  );
}

/**
 * Reads `?run=<id>` and delegates to `RunView`. Forecasts always come from
 * that run's stored `forecastSnapshot`, never a fresh `GET /forecasts`
 * call, so the prices on screen are always the ones the run's compliance
 * figure was actually computed against (see `lib/api.ts`'s `getRun`
 * docstring).
 */
function DashboardContent() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("run");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Dashboard Emisi</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Hasil perhitungan untuk satu interval produksi yang tersimpan.
        </p>
      </header>

      <main className="flex-1 px-6 py-6">
        {runId ? (
          <RunView key={runId} runId={runId} />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Tidak ada perhitungan yang dipilih.{" "}
            <Link href="/twin" className="underline">
              Kembali ke digital twin
            </Link>{" "}
            untuk membuat perhitungan baru.
          </p>
        )}
      </main>

      {/* Standing disclosures: permanently visible without scrolling to
          find it -- sticky to the viewport bottom rather than laid out at
          the natural end of a page that can grow taller than the screen. */}
      <footer className="sticky bottom-0 border-t border-black/[.08] bg-zinc-50/95 px-6 py-3 text-xs text-zinc-600 backdrop-blur dark:border-white/[.145] dark:bg-black/95 dark:text-zinc-400">
        {STANDING_DISCLOSURES}
      </footer>
    </div>
  );
}

function DashboardFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-black">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Memuat data...</p>
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
