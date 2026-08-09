"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import NodePanel from "@/components/twin/NodePanel";
import AppShell from "@/components/shell/AppShell";
import { GlassPanel, Label, Mono } from "@/components/shell/primitives";
import { useTheme } from "@/components/shell/ThemeProvider";
import { useSelectedPeriod } from "@/components/shell/PeriodProvider";
import {
  getCompany,
  getProductionMonth,
  postEmissions,
  postRun,
  putProductionMonth,
} from "@/lib/api";
import { formatPeriodLabel } from "@/lib/period";
import {
  buildEmissionInput,
  buildOperationalInput,
  buildPartialProductionMonthInputs,
  CANDIDATE_FIELD_TO_FORM_KEY,
  EMPTY_TWIN_FORM,
  hydrateOperationalFormFromInputs,
  NODE_LABELS,
  NODE_ORDER,
  nodeEmissionContribution,
  nodeHasOperationalInput,
  parseEmissionError,
  POWER_MIX_INCOMPLETE_MESSAGE,
  powerMixSummary,
  toNumber,
  validateTwinForm,
  type NodeId,
  type TwinFormState,
} from "@/lib/twin";
import {
  GLB_HOTSPOT_NODES,
  HOTSPOT_TO_NODE,
  NODE_TO_HOTSPOT,
} from "@/lib/twinHotspots";
import type { Company, EmissionResult } from "@/types/emissions";

const TwinScene = dynamic(() => import("@/components/twin/TwinScene"), { ssr: false });

const DEBOUNCE_MS = 150;
const AUTOSAVE_MS = 400;

type SaveStatus = "idle" | "saving" | "saved" | "error";

const RANGE_ERROR_FALLBACK =
  "Salah satu nilai persentase di luar rentang 0-100%. Periksa kembali bidang yang diisi.";

function formatTco2e(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-- tCO₂e";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO₂e`;
}

type CompanyState = "loading" | "ready" | "missing";

export default function TwinPage() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const { selectedPeriod } = useSelectedPeriod();
  const [form, setForm] = useState<TwinFormState>(EMPTY_TWIN_FORM);
  const [selectedNode, setSelectedNode] = useState<NodeId | null>("stockpile");
  const [companyState, setCompanyState] = useState<CompanyState>("loading");
  const [company, setCompany] = useState<Company | null>(null);
  const [emissionResult, setEmissionResult] = useState<EmissionResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [nodeErrors, setNodeErrors] = useState<Partial<Record<NodeId, string>>>({});
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [logReady, setLogReady] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("id-ID"));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  function setField<K extends keyof TwinFormState>(key: K, value: TwinFormState[K]) {
    setFormDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleAcceptCandidate(field: string, displayValue: number) {
    const formKey = CANDIDATE_FIELD_TO_FORM_KEY[field];
    if (!formKey) return;
    setField(formKey, String(displayValue));
  }

  function handleClearCandidate(field: string) {
    const formKey = CANDIDATE_FIELD_TO_FORM_KEY[field];
    if (!formKey) return;
    setField(formKey, "");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getCompany();
        if (cancelled) return;
        setCompany(result);
        setCompanyState("ready");
      } catch {
        if (!cancelled) setCompanyState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (companyState === "loading") return;
    let cancelled = false;
    setLogReady(false);
    setFormDirty(false);
    setLoadError(null);
    setSaveStatus("idle");
    setForm((prev) => ({
      ...prev,
      ...hydrateOperationalFormFromInputs({}),
    }));
    setEmissionResult(null);

    (async () => {
      try {
        const log =
          companyState === "ready"
            ? await getProductionMonth(selectedPeriod)
            : null;
        if (cancelled) return;
        setForm((prev) => ({
          ...prev,
          ...hydrateOperationalFormFromInputs(log?.inputs ?? {}),
        }));
        setLogReady(true);
      } catch {
        if (cancelled) return;
        setForm((prev) => ({
          ...prev,
          ...hydrateOperationalFormFromInputs({}),
        }));
        setLoadError(
          "Gagal memuat log produksi bulan ini. Form dikosongkan — Anda dapat mengisi ulang.",
        );
        setLogReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPeriod, companyState]);

  useEffect(() => {
    if (!logReady || !formDirty || companyState !== "ready") return;
    const timer = setTimeout(() => {
      const inputs = buildPartialProductionMonthInputs(form);
      setSaveStatus("saving");
      void putProductionMonth(selectedPeriod, inputs)
        .then(() => {
          setSaveStatus("saved");
        })
        .catch(() => {
          setSaveStatus("error");
        });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [form, formDirty, logReady, companyState, selectedPeriod]);

  async function recompute(currentForm: TwinFormState, currentCompany: Company | null) {
    if (!currentCompany) return;
    if (validateTwinForm(currentForm) !== null) return;
    const mix = powerMixSummary(
      toNumber(currentForm.powerMixCaptiveCoalPercent),
      toNumber(currentForm.powerMixHydroGridPercent),
    );
    if (!mix.complete) return;

    let payload;
    try {
      payload = buildEmissionInput(currentForm, currentCompany);
    } catch {
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
  const commitDisabled =
    committing || companyState !== "ready" || !mix.complete || formError !== null;

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
      const result = await postRun({ ...payload, period: selectedPeriod });
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

  const selectedHotspotId = selectedNode
    ? (NODE_TO_HOTSPOT[selectedNode] ?? "")
    : "";

  const twinPalette = useMemo(
    () => ({
      sceneA: C.sceneA,
      sceneB: C.sceneB,
      sceneC: C.sceneC,
      cyan: C.cyan,
      green: C.green,
      border: C.border,
      dimText: C.dimText,
      muted: C.muted,
      text: C.text,
      glbLabelBg: C.glbLabelBg,
    }),
    [C],
  );

  const energyMix = [
    { label: "Captive Coal", pct: Number.isFinite(captivePercent) ? captivePercent : 0, color: C.muted },
    { label: "Hydro/Grid", pct: Number.isFinite(hydroPercent) ? hydroPercent : 0, color: C.cyan },
  ];

  return (
    <AppShell showFooter={false}>
      <div className="relative flex-1 overflow-hidden" style={{ minHeight: "calc(100vh - 48px)" }}>
        <TwinScene
          colors={twinPalette}
          nodes={[...GLB_HOTSPOT_NODES]}
          selectedId={selectedHotspotId}
          onSelect={(hotspotId) => {
            const node = HOTSPOT_TO_NODE[hotspotId];
            if (node) setSelectedNode(node);
          }}
        />

        {/* Top bar overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-3">
          <div className="pointer-events-auto flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-opacity hover:opacity-80"
              style={{
                background: C.glassBg,
                border: `1px solid ${C.border}`,
                color: C.dimText,
                boxShadow: C.glassShadow,
              }}
            >
              <ArrowLeft size={12} />
              Dashboard
            </Link>
            <GlassPanel className="px-3 py-1.5">
              <Mono className="text-[11px]" style={{ color: C.text }}>
                {company?.name ?? "Digital Twin"} — Site Live
              </Mono>
            </GlassPanel>
          </div>
          <GlassPanel className="pointer-events-auto flex items-center gap-3 px-3 py-1.5">
            <Mono className="text-[11px]" style={{ color: C.dimText }}>
              {clock}
            </Mono>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest"
              style={{
                background: `${C.green}22`,
                color: C.green,
                border: `1px solid ${C.green}44`,
              }}
            >
              TELEMETRY
            </span>
          </GlassPanel>
        </div>

        {/* Left glass: node list + live summary */}
        <GlassPanel className="absolute left-4 top-16 z-20 flex w-[300px] flex-col gap-3 p-3" style={{ color: C.text }}>
          <Label>Node proses</Label>
          <div className="flex flex-col gap-1">
            {NODE_ORDER.map((node) => {
              const active = selectedNode === node;
              const contrib = nodeEmissionContribution(node, emissionResult);
              const hasError = Boolean(nodeErrors[node]);
              const operational = nodeHasOperationalInput(node);
              return (
                <div key={node}>
                  <button
                    type="button"
                    data-testid={`select-${node}`}
                    onClick={() => setSelectedNode(node)}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs transition-opacity hover:opacity-90"
                    style={{
                      background: active ? `${C.cyan}22` : "transparent",
                      border: `1px solid ${active ? C.cyan : hasError ? C.red : C.border}`,
                      color: C.text,
                    }}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span style={{ fontFamily: "var(--font-mono), monospace" }}>
                        {NODE_LABELS[node]}
                      </span>
                      {!operational ? (
                        <span
                          className="text-[9px] tracking-wide"
                          style={{ color: C.amber, fontFamily: "var(--font-mono), monospace" }}
                        >
                          site spec only
                        </span>
                      ) : null}
                    </span>
                    <Mono className="text-[10px]" style={{ color: hasError ? C.red : C.dimText }}>
                      {contrib == null
                        ? "--"
                        : `${contrib.toLocaleString("id-ID", { maximumFractionDigits: 1 })}`}
                    </Mono>
                  </button>
                  {hasError && nodeErrors[node] ? (
                    <p
                      data-testid={`scene-error-${node}`}
                      className="mt-0.5 px-1 text-[10px]"
                      style={{ color: C.red }}
                    >
                      {nodeErrors[node]}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-1 border-t pt-3" style={{ borderColor: C.border }}>
            <Label>Energy mix (input)</Label>
            <div className="mt-2 flex flex-col gap-1.5">
              {energyMix.map((row) => (
                <div key={row.label}>
                  <div className="mb-0.5 flex justify-between text-[10px]" style={{ color: C.dimText }}>
                    <span>{row.label}</span>
                    <Mono>{Number.isFinite(row.pct) ? `${row.pct}%` : "--"}</Mono>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full" style={{ background: C.border }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, row.pct || 0))}%`,
                        background: row.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-3" style={{ borderColor: C.border }}>
            <Label>Live emissions preview</Label>
            <div
              className="mt-1 text-xl font-bold"
              style={{ color: C.cyan, fontFamily: "var(--font-display), sans-serif" }}
            >
              <Mono>{formatTco2e(emissionResult?.totalEmissions)}</Mono>
            </div>
            {computing && (
              <p className="text-[10px]" style={{ color: C.muted }}>
                Menghitung…
              </p>
            )}
            {emissionResult == null && (
              <p className="mt-1 text-[10px]" style={{ color: C.muted }}>
                Isi data operasional di panel kanan untuk pratinjau.
              </p>
            )}
          </div>

          {companyState === "missing" && (
            <p className="text-[11px]" style={{ color: C.amber }}>
              Profil belum ada.{" "}
              <Link href="/onboarding" className="underline">
                Lengkapi site spec
              </Link>
              .
            </p>
          )}
        </GlassPanel>

        {/* Right: input side panel */}
        {selectedNode && (
          <div className="absolute bottom-4 right-4 top-16 z-20 w-[380px] overflow-y-auto">
            <div
              className="rounded-xl"
              style={{
                background: C.glassBg,
                border: `1px solid ${C.border}`,
                boxShadow: C.glassShadow,
                backdropFilter: "blur(12px)",
                color: C.text,
              }}
            >
              <NodePanel
                key={selectedNode}
                node={selectedNode}
                form={form}
                onFieldChange={setField}
                onAcceptCandidate={handleAcceptCandidate}
                onClearCandidate={handleClearCandidate}
                company={company}
                badgeValue={nodeEmissionContribution(selectedNode, emissionResult)}
                errorMessage={nodeErrors[selectedNode]}
                onClose={() => setSelectedNode(null)}
              />
            </div>
          </div>
        )}

        {/* Bottom commit bar */}
        <GlassPanel className="absolute bottom-4 left-1/2 z-20 flex w-[min(720px,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label>Total emisi (pratinjau)</Label>
              <Mono className="block text-lg font-semibold" style={{ color: C.text }}>
                {formatTco2e(emissionResult?.totalEmissions)}
              </Mono>
              <p className="mt-0.5 text-[10px]" style={{ color: C.dimText }}>
                Periode: {formatPeriodLabel(selectedPeriod)}
                {saveStatus === "saving"
                  ? " · Menyimpan…"
                  : saveStatus === "saved"
                    ? " · Tersimpan"
                    : saveStatus === "error"
                      ? " · Gagal menyimpan draf"
                      : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCommit}
              disabled={commitDisabled}
              className="rounded-md px-4 py-2 text-xs font-bold tracking-wider transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{
                background: `linear-gradient(135deg, ${C.cyan}, ${C.violet})`,
                color: "#fff",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              {committing ? "Menyimpan…" : "Simpan perhitungan"}
            </button>
          </div>
          {loadError && (
            <p role="alert" className="text-xs" style={{ color: C.red }}>
              {loadError}
            </p>
          )}
          {generalError && (
            <p role="alert" className="text-xs" style={{ color: C.red }}>
              {generalError}
            </p>
          )}
          {!mix.complete && (
            <p className="text-xs" style={{ color: C.amber }}>
              {POWER_MIX_INCOMPLETE_MESSAGE} ({NODE_LABELS.pltu})
            </p>
          )}
          {commitError && (
            <p role="alert" className="text-xs" style={{ color: C.red }}>
              {commitError}
            </p>
          )}
        </GlassPanel>
      </div>
    </AppShell>
  );
}
