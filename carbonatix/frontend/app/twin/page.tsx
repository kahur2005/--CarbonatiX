"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import NodePanel from "@/components/twin/NodePanel";
import { getCompany, postEmissions, postRun } from "@/lib/api";
import {
  buildEmissionInput,
  buildOperationalInput,
  CANDIDATE_FIELD_TO_FORM_KEY,
  EMPTY_TWIN_FORM,
  NODE_LABELS,
  NODE_ORDER,
  nodeEmissionContribution,
  parseEmissionError,
  POWER_MIX_INCOMPLETE_MESSAGE,
  powerMixSummary,
  toNumber,
  validateTwinForm,
  type NodeId,
  type TwinFormState,
} from "@/lib/twin";
import type { Company, EmissionResult } from "@/types/emissions";

// R3F's Canvas needs a WebGL context, which only exists in the browser --
// `ssr: false` keeps it out of the server-rendered HTML entirely rather
// than rendering a container that gets thrown away on hydration.
const Scene = dynamic(() => import("@/components/twin/Scene"), { ssr: false });

const DEBOUNCE_MS = 150;

/** Same backstop as `app/onboarding/page.tsx`'s `describeError`: a
 * `RangeError` from `toFraction` (via `buildOperationalInput`) is an
 * English sentence and must never reach this Bahasa Indonesia UI verbatim.
 * Reached only if `validateTwinForm`'s range table let something through
 * that `toFraction`'s stricter 0-100 check still rejects. */
const RANGE_ERROR_FALLBACK =
  "Salah satu nilai persentase di luar rentang 0-100%. Periksa kembali bidang yang diisi.";

function formatTco2e(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-- tCO2e";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO2e`;
}

type CompanyState = "loading" | "ready" | "missing";

export default function TwinPage() {
  const router = useRouter();
  const [form, setForm] = useState<TwinFormState>(EMPTY_TWIN_FORM);
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null);
  const [companyState, setCompanyState] = useState<CompanyState>("loading");
  const [company, setCompany] = useState<Company | null>(null);
  const [emissionResult, setEmissionResult] = useState<EmissionResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [nodeErrors, setNodeErrors] = useState<Partial<Record<NodeId, string>>>({});
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  function setField<K extends keyof TwinFormState>(key: K, value: TwinFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleAcceptCandidate(field: string, displayValue: number) {
    const formKey = CANDIDATE_FIELD_TO_FORM_KEY[field];
    if (!formKey) return;
    setField(formKey, String(displayValue));
  }

  // Fetch the saved company profile once: its three site-spec values
  // (dryerThermalEfficiency, secEafKwhPerTAlloy, efCaptivePltu) are shown
  // read-only on their nodes and used directly -- never copied into
  // editable form state -- by both `recompute` and `handleCommit` below,
  // so the preview and the committed run are provably built from the same
  // three numbers. The daily operational levers stay blank until the
  // operator enters them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getCompany();
        if (cancelled) return;
        setCompany(result);
        setCompanyState("ready");
      } catch {
        // No profile yet (404) or a fetch failure -- either way the twin
        // stays usable for the six operational levers, but the site-spec
        // fields have nothing to display and committing is gated below
        // until onboarding is complete.
        if (!cancelled) setCompanyState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function recompute(currentForm: TwinFormState, currentCompany: Company | null) {
    if (!currentCompany) {
      // Nothing to build the three site-spec fields from yet (still
      // loading, or onboarding was never completed) -- wait rather than
      // send a request that's missing required fields.
      return;
    }
    if (validateTwinForm(currentForm) !== null) {
      // Still mid-edit (a blank or out-of-range field) -- wait rather than
      // send a request guaranteed to 422.
      return;
    }
    const mix = powerMixSummary(
      toNumber(currentForm.powerMixCaptiveCoalPercent),
      toNumber(currentForm.powerMixHydroGridPercent),
    );
    if (!mix.complete) {
      // The pltu panel's own remainder display already communicates this;
      // avoid a guaranteed-422 request while the two shares are being
      // balanced.
      return;
    }

    let payload;
    try {
      payload = buildEmissionInput(currentForm, currentCompany);
    } catch {
      // toFraction guard tripped on something the range table above didn't
      // catch -- never surface the raw RangeError text, just wait.
      return;
    }

    setComputing(true);
    setGeneralError(null);
    try {
      const result = await postEmissions(payload);
      setEmissionResult(result);
      setNodeErrors({});
    } catch (err) {
      const parsed = parseEmissionError(err);
      if (parsed) {
        setNodeErrors((prev) => ({ ...prev, [parsed.node]: parsed.message }));
      } else {
        setGeneralError("Tidak dapat menghitung ulang emisi. Periksa koneksi Anda.");
      }
    } finally {
      setComputing(false);
    }
  }

  // Live recompute: debounce 150ms after the last edit, then POST
  // /emissions. Stateless and cheap on the backend (see app/main.py's
  // post_emissions docstring) -- recomputing on every keystroke is
  // intended, not a rate limit to work around.
  useEffect(() => {
    const timer = setTimeout(() => {
      void recompute(form, company);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [form, company]);

  const captivePercent = toNumber(form.powerMixCaptiveCoalPercent);
  const hydroPercent = toNumber(form.powerMixHydroGridPercent);
  const mix = powerMixSummary(captivePercent, hydroPercent);
  const formError = validateTwinForm(form);
  const commitDisabled = committing || companyState !== "ready" || !mix.complete || formError !== null;

  async function handleCommit() {
    if (companyState !== "ready") {
      setCommitError("Lengkapi spesifikasi situs terlebih dahulu.");
      return;
    }
    if (formError) {
      setCommitError(formError);
      return;
    }
    if (!mix.complete) {
      setCommitError(POWER_MIX_INCOMPLETE_MESSAGE);
      return;
    }

    let payload;
    try {
      payload = buildOperationalInput(form);
    } catch {
      setCommitError(RANGE_ERROR_FALLBACK);
      return;
    }

    setCommitting(true);
    setCommitError(null);
    try {
      const result = await postRun(payload);
      router.push(`/dashboard?run=${result.id}`);
    } catch (err) {
      const parsed = parseEmissionError(err);
      if (parsed) {
        setNodeErrors((prev) => ({ ...prev, [parsed.node]: parsed.message }));
        setCommitError("Beberapa nilai ditolak server. Periksa node yang ditandai merah.");
      } else {
        setCommitError("Gagal menyimpan perhitungan. Coba lagi.");
      }
      setCommitting(false);
    }
  }

  const badges = Object.fromEntries(
    NODE_ORDER.map((node) => [node, nodeEmissionContribution(node, emissionResult)]),
  ) as Partial<Record<NodeId, number | null>>;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          Digital Twin -- Input Data Operasional
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Klik salah satu tahap proses untuk mengisi datanya.
        </p>
        {companyState === "missing" && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Profil perusahaan belum ditemukan.{" "}
            <Link href="/onboarding" className="underline">
              Lengkapi spesifikasi situs
            </Link>{" "}
            sebelum menyimpan perhitungan.
          </p>
        )}
      </header>

      <div className="relative flex flex-1">
        <div className="min-h-[420px] flex-1">
          <Scene
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            badges={badges}
            nodeErrors={nodeErrors}
          />
        </div>

        {selectedNode && (
          <div className="absolute right-4 top-4 z-10">
            <NodePanel
              key={selectedNode}
              node={selectedNode}
              form={form}
              onFieldChange={setField}
              onAcceptCandidate={handleAcceptCandidate}
              company={company}
              badgeValue={nodeEmissionContribution(selectedNode, emissionResult)}
              errorMessage={nodeErrors[selectedNode]}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Total emisi (pratinjau)</p>
            <p className="font-mono text-lg font-semibold text-black dark:text-zinc-50">
              {formatTco2e(emissionResult?.totalEmissions)}
              {computing && (
                <span className="ml-2 text-sm font-normal text-zinc-500">Menghitung...</span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={handleCommit}
            disabled={commitDisabled}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {committing ? "Menyimpan..." : "Simpan perhitungan"}
          </button>
        </div>

        {generalError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {generalError}
          </p>
        )}
        {!mix.complete && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {POWER_MIX_INCOMPLETE_MESSAGE} (
            {NODE_LABELS.pltu})
          </p>
        )}
        {commitError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {commitError}
          </p>
        )}
      </footer>
    </div>
  );
}
