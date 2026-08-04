"use client";

import { useRef, useState } from "react";
import { postDocument } from "@/lib/api";
import { candidateDisplayValue } from "@/lib/onboarding";
import type { Candidate } from "@/types/emissions";

/** Display metadata for one extractable field. Supplied by the caller
 * rather than hardcoded here, since this component is shared across
 * document profiles that extract different fields (site-spec here in
 * onboarding, operational documents in the twin). */
export interface FieldMeta {
  label: string;
  unit: string;
  /** Whether the API value is a fraction that the form displays as a
   * percentage -- see `lib/units.ts`. */
  isPercent: boolean;
}

interface UploadDropzoneProps {
  /** Sent as the `profile` form field on `POST /documents`. */
  profile: "site_spec" | "operational";
  /** Candidate.field (snake_case, matches the backend wire value) -> how to
   * label and display it. */
  fieldLabels: Record<string, FieldMeta>;
  /**
   * Called once per field, and only in direct response to the user
   * clicking "Terima" on that field's row. `displayValue` is already in
   * the unit the form shows (a percentage for percentage-valued fields),
   * so the caller can drop it straight into its own form state.
   */
  onAccept: (field: string, displayValue: number) => void;
}

type CandidateStatus = "pending" | "accepted" | "dismissed";

/**
 * A dropzone that posts a document to `POST /documents` and renders the
 * returned candidates as a review list -- never as form values.
 *
 * OCR output is a candidate, never a value: nothing here writes to a form
 * except through `onAccept`, and `onAccept` fires only from a "Terima"
 * button's `onClick`. A candidate with `value === null` renders as "Tidak
 * terbaca" with no accept button at all, because there is nothing to
 * accept -- the corresponding field stays exactly as blank as it started.
 */
export default function UploadDropzone({ profile, fieldLabels, onAccept }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [confidenceIsPlaceholder, setConfidenceIsPlaceholder] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, CandidateStatus>>({});
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setPending(true);
    setError(null);
    setCandidates([]);
    setStatuses({});
    try {
      const result = await postDocument(file, profile);
      setCandidates(result.candidates);
      setConfidenceIsPlaceholder(result.confidenceIsPlaceholder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah dokumen.");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleAccept(candidate: Candidate) {
    if (candidate.value === null) return;
    const meta = fieldLabels[candidate.field];
    const displayValue = candidateDisplayValue(candidate.value, meta?.isPercent ?? false);
    if (displayValue === null) return;
    onAccept(candidate.field, displayValue);
    setStatuses((prev) => ({ ...prev, [candidate.field]: "accepted" }));
  }

  function handleDismiss(candidate: Candidate) {
    setStatuses((prev) => ({ ...prev, [candidate.field]: "dismissed" }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Unggah dokumen"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
          dragOver
            ? "border-black bg-black/[.03] dark:border-white dark:bg-white/[.06]"
            : "border-black/[.2] dark:border-white/[.25]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-sm font-medium text-black dark:text-zinc-50">
          Seret dokumen ke sini, atau klik untuk memilih file
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Foto atau pindaian (JPG, PNG, PDF)
        </p>
      </div>

      {pending && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Membaca dokumen...</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-black/[.08] p-3 dark:border-white/[.145]">
          {confidenceIsPlaceholder && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Tanda &ldquo;terbaca&rdquo; di bawah hanya menunjukkan bahwa model menemukan
              sebuah nilai -- bukan seberapa yakin model terhadap nilai tersebut. Periksa tiap
              nilai sebelum menerimanya.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {candidates.map((candidate) => {
              const meta = fieldLabels[candidate.field];
              const status = statuses[candidate.field] ?? "pending";
              const displayValue = candidateDisplayValue(
                candidate.value,
                meta?.isPercent ?? false,
              );
              const readable = candidate.value !== null;

              return (
                <li
                  key={candidate.field}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/[.08] px-3 py-2 text-sm dark:border-white/[.145]"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-black dark:text-zinc-50">
                      {meta?.label ?? candidate.field}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {displayValue === null
                        ? "Tidak terbaca"
                        : `${displayValue}${meta?.unit ? ` ${meta.unit}` : ""}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        readable
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                      title={
                        confidenceIsPlaceholder
                          ? "Bukan skor keandalan -- hanya menandai apakah nilai terbaca."
                          : undefined
                      }
                    >
                      {readable ? "Terbaca" : "Tidak terbaca"}
                    </span>

                    {status === "pending" && readable && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleAccept(candidate)}
                          className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                        >
                          Terima
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDismiss(candidate)}
                          className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium text-black transition-colors hover:bg-black/[.04] dark:border-white/[.2] dark:text-zinc-50 dark:hover:bg-white/[.08]"
                        >
                          Perbaiki
                        </button>
                      </>
                    )}
                    {status === "accepted" && (
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        Diterima
                      </span>
                    )}
                    {status === "dismissed" && (
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Isi manual di bawah
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
