"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CompliancePanel from "@/components/dashboard/CompliancePanel";
import EmissionBars from "@/components/dashboard/EmissionBars";
import ForecastChart from "@/components/dashboard/ForecastChart";
import { getRun, RunNotFoundError } from "@/lib/api";
import { formatIdrPerTon, formatUsdPerTon, STANDING_DISCLOSURES } from "@/lib/dashboard";
import type { RunResult } from "@/types/emissions";

type LoadState = "loading" | "ready" | "not-found" | "error";

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
