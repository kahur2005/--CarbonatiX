"use client";

import { useState } from "react";
import UploadDropzone from "@/components/twin/UploadDropzone";
import {
  NODE_FIELDS,
  NODE_LABELS,
  OPERATIONAL_FIELD_LABELS,
  POWER_MIX_INCOMPLETE_MESSAGE,
  powerMixSummary,
  toNumber,
  type NodeId,
  type TwinFormState,
} from "@/lib/twin";

type Tab = "manual" | "upload";

export interface NodePanelProps {
  node: NodeId;
  form: TwinFormState;
  onFieldChange: <K extends keyof TwinFormState>(key: K, value: string) => void;
  onAcceptCandidate: (field: string, displayValue: number) => void;
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

const NUMBER_INPUT_CLASS =
  "rounded border border-black/[.15] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black dark:border-white/[.2] dark:text-zinc-50 dark:focus:border-white";
const LABEL_CLASS = "text-sm font-medium text-black dark:text-zinc-50";

function formatTco2e(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-- tCO2e";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO2e`;
}

/**
 * The twin's per-node input surface. Clicking a mesh in `Scene` opens this
 * for that node, holding exactly the fields `NODE_FIELDS` assigns it --
 * the same table that must match `NODE_FOR_FIELD` in
 * `app/ingestion/mapping.py`. Two tabs: manual entry, and a document
 * upload that reuses `UploadDropzone` unmodified (`profile="operational"`)
 * so the "a candidate never populates a field without an explicit click"
 * rule stays enforced by the one component that already implements it.
 */
export default function NodePanel({
  node,
  form,
  onFieldChange,
  onAcceptCandidate,
  badgeValue,
  errorMessage,
  onClose,
}: NodePanelProps) {
  const [tab, setTab] = useState<Tab>("manual");
  const fields = NODE_FIELDS[node];

  const mix =
    node === "pltu"
      ? powerMixSummary(
          toNumber(form.powerMixCaptiveCoalPercent),
          toNumber(form.powerMixHydroGridPercent),
        )
      : null;

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-black/[.08] bg-white p-4 shadow-lg dark:border-white/[.145] dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            {NODE_LABELS[node]}
          </h2>
          <p className="font-mono text-sm text-zinc-600 dark:text-zinc-400">
            {formatTco2e(badgeValue)}
          </p>
        </div>
        <button
          type="button"
          aria-label="Tutup panel"
          onClick={onClose}
          className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-black/[.05] dark:text-zinc-400 dark:hover:bg-white/[.08]"
        >
          Tutup
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}

      <div className="flex gap-2 border-b border-black/[.08] dark:border-white/[.145]">
        <button
          type="button"
          onClick={() => setTab("manual")}
          aria-pressed={tab === "manual"}
          className={`px-2 pb-2 text-sm font-medium ${
            tab === "manual"
              ? "border-b-2 border-black text-black dark:border-white dark:text-zinc-50"
              : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          Isi manual
        </button>
        <button
          type="button"
          onClick={() => setTab("upload")}
          aria-pressed={tab === "upload"}
          className={`px-2 pb-2 text-sm font-medium ${
            tab === "upload"
              ? "border-b-2 border-black text-black dark:border-white dark:text-zinc-50"
              : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          Unggah dokumen
        </button>
      </div>

      {tab === "manual" && (
        <div className="flex flex-col gap-3">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label htmlFor={`twin-${field.key}`} className={LABEL_CLASS}>
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
                className={NUMBER_INPUT_CLASS}
              />
              {field.siteSpec && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Nilai bawaan dari spesifikasi situs tersimpan. Mengubahnya di sini hanya
                  memengaruhi pratinjau emisi -- perhitungan yang disimpan tetap memakai
                  spesifikasi situs.
                </p>
              )}
            </div>
          ))}

          {mix && (
            <div
              className={`rounded border px-3 py-2 text-sm ${
                mix.complete
                  ? "border-black/[.08] text-zinc-600 dark:border-white/[.145] dark:text-zinc-400"
                  : "border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-400"
              }`}
            >
              <p>
                Tercatat: {mix.recordedPercent.toFixed(2)}% &middot; Belum tercatat:{" "}
                {Math.max(mix.remainderPercent, 0).toFixed(2)}%
              </p>
              {!mix.complete && <p className="mt-1 font-medium">{POWER_MIX_INCOMPLETE_MESSAGE}</p>}
            </div>
          )}
        </div>
      )}

      {tab === "upload" && (
        <UploadDropzone
          profile="operational"
          fieldLabels={OPERATIONAL_FIELD_LABELS}
          onAccept={onAcceptCandidate}
        />
      )}
    </div>
  );
}
