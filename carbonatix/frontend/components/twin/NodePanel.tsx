"use client";

import { useState } from "react";
import Link from "next/link";
import UploadDropzone from "@/components/twin/UploadDropzone";
import { useTheme } from "@/components/shell/ThemeProvider";
import {
  formatSiteSpecValue,
  NODE_FIELDS,
  NODE_LABELS,
  nodeHasOperationalInput,
  OPERATIONAL_FIELD_LABELS,
  POWER_MIX_INCOMPLETE_MESSAGE,
  powerMixSummary,
  SITE_SPEC_EDIT_LABEL,
  toNumber,
  type NodeId,
  type TwinFormState,
} from "@/lib/twin";
import type { Company } from "@/types/emissions";

type Tab = "manual" | "upload";

export interface NodePanelProps {
  node: NodeId;
  form: TwinFormState;
  onFieldChange: <K extends keyof TwinFormState>(key: K, value: string) => void;
  onAcceptCandidate: (field: string, displayValue: number) => void;
  /** Clears a form field after Perbaiki on an auto-filled OCR candidate. */
  onClearCandidate: (field: string) => void;
  /** The saved company profile, for this node's read-only site-spec
   * field(s) (see `lib/twin.ts`'s `SiteSpecFieldDescriptor`). `null` while
   * still loading or when onboarding hasn't been completed yet -- the
   * field then shows a placeholder rather than a stale/fabricated number. */
  company: Company | null;
  /** This node's live emission contribution, tCO2e -- `null` while no
   * result is available (still typing, last recompute failed). */
  badgeValue: number | null;
  /** The Indonesian message from a 422 whose owning field lives on this
   * node (see `lib/twin.ts`'s `parseEmissionError`). Shown here as well as
   * on the mesh's floating label -- attached to the node, never a bare
   * banner. */
  errorMessage?: string;
  onClose: () => void;
}

function formatTco2e(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-- tCO2e";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO2e`;
}

/**
 * The twin's per-node input surface. Text colors come from `useTheme()`
 * (not Tailwind `dark:`) so light mode stays near-black and dark mode
 * near-white regardless of OS color-scheme.
 */
export default function NodePanel({
  node,
  form,
  onFieldChange,
  onAcceptCandidate,
  onClearCandidate,
  company,
  badgeValue,
  errorMessage,
  onClose,
}: NodePanelProps) {
  const { colors: C } = useTheme();
  const hasOperational = nodeHasOperationalInput(node);
  const [tab, setTab] = useState<Tab>("manual");
  const fields = NODE_FIELDS[node];
  const siteSpecFields = fields.filter((f) => f.kind === "siteSpec");
  const operationalFields = fields.filter((f) => f.kind === "operational");

  const mix =
    node === "pltu"
      ? powerMixSummary(
          toNumber(form.powerMixCaptiveCoalPercent),
          toNumber(form.powerMixHydroGridPercent),
        )
      : null;

  const inputStyle = {
    background: C.panel,
    border: `1px solid ${C.border}`,
    color: C.text,
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 p-4" style={{ color: C.text }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: C.text }}>
            {NODE_LABELS[node]}
          </h2>
          <p className="font-mono text-sm" style={{ color: C.dimText }}>
            {formatTco2e(badgeValue)}
          </p>
          {!hasOperational && (
            <p
              className="mt-1 text-[10px] font-medium uppercase tracking-wider"
              style={{ color: C.amber }}
            >
              Spesifikasi situs · tanpa input interval
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Tutup panel"
          onClick={onClose}
          className="rounded-full px-2 py-1 text-sm transition-opacity hover:opacity-70"
          style={{ color: C.muted }}
        >
          Tutup
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm" style={{ color: C.red }}>
          {errorMessage}
        </p>
      )}

      {hasOperational ? (
        <div className="flex gap-2" style={{ borderBottom: `1px solid ${C.border}` }}>
          <button
            type="button"
            onClick={() => setTab("manual")}
            aria-pressed={tab === "manual"}
            className="px-2 pb-2 text-sm font-medium"
            style={{
              color: tab === "manual" ? C.text : C.muted,
              borderBottom: tab === "manual" ? `2px solid ${C.cyan}` : "2px solid transparent",
            }}
          >
            Isi manual
          </button>
          <button
            type="button"
            onClick={() => setTab("upload")}
            aria-pressed={tab === "upload"}
            className="px-2 pb-2 text-sm font-medium"
            style={{
              color: tab === "upload" ? C.text : C.muted,
              borderBottom: tab === "upload" ? `2px solid ${C.cyan}` : "2px solid transparent",
            }}
          >
            Unggah dokumen
          </button>
        </div>
      ) : null}

      {(!hasOperational || tab === "manual") && (
        <div className="flex flex-col gap-3">
          {!hasOperational && (
            <div
              className="rounded-md px-3 py-2 text-xs leading-relaxed"
              style={{
                background: `${C.amber}18`,
                border: `1px solid ${C.amber}55`,
                color: C.text,
              }}
            >
              Node ini tidak punya field operasional harian. Nilainya diambil dari
              spesifikasi situs (disetel saat onboarding) agar pratinjau emisi selalu
              sama dengan yang disimpan saat commit.{" "}
              <Link href="/onboarding" className="underline" style={{ color: C.cyan }}>
                {SITE_SPEC_EDIT_LABEL}
              </Link>
              .
            </div>
          )}

          {operationalFields.map((field) =>
            field.kind === "operational" ? (
              <div key={field.key} className="flex flex-col gap-1">
                <label
                  htmlFor={`twin-${field.key}`}
                  className="text-sm font-medium"
                  style={{ color: C.text }}
                >
                  {field.label}
                  {field.unit ? ` (${field.unit})` : ""}
                </label>
                <input
                  id={`twin-${field.key}`}
                  type="number"
                  step="any"
                  min={field.range.min}
                  max={field.range.max}
                  value={form[field.key]}
                  onChange={(e) => onFieldChange(field.key, e.target.value)}
                  className="rounded px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
            ) : null,
          )}

          {siteSpecFields.map((field) =>
            field.kind === "siteSpec" ? (
              <div key={field.companyKey} className="flex flex-col gap-1">
                <span className="text-sm font-medium" style={{ color: C.text }}>
                  {field.label}
                  {field.unit ? ` (${field.unit})` : ""}
                </span>
                <p
                  className="rounded px-3 py-2 text-sm font-mono"
                  style={{
                    background: C.panel,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                  }}
                >
                  {company ? formatSiteSpecValue(field, company) : "--"}
                </p>
                {hasOperational ? (
                  <p className="text-xs" style={{ color: C.muted }}>
                    Nilai dari spesifikasi situs tersimpan -- tidak dapat diubah di sini.{" "}
                    <Link href="/onboarding" className="underline" style={{ color: C.cyan }}>
                      {SITE_SPEC_EDIT_LABEL}
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
            ) : null,
          )}

          {mix && (
            <div
              className="rounded border px-3 py-2 text-sm"
              style={{
                borderColor: mix.complete ? C.border : C.amber,
                color: mix.complete ? C.dimText : C.amber,
              }}
            >
              <p>
                Tercatat: {mix.recordedPercent.toFixed(2)}% &middot; Belum tercatat:{" "}
                {Math.max(mix.remainderPercent, 0).toFixed(2)}%
              </p>
              {!mix.complete && (
                <p className="mt-1 font-medium">{POWER_MIX_INCOMPLETE_MESSAGE}</p>
              )}
            </div>
          )}
        </div>
      )}

      {hasOperational && tab === "upload" && (
        <UploadDropzone
          profile="operational"
          fieldLabels={OPERATIONAL_FIELD_LABELS}
          onAccept={onAcceptCandidate}
          onClear={onClearCandidate}
        />
      )}
    </div>
  );
}
