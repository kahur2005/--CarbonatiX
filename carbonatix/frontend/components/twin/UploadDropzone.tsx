"use client";

import { useRef, useState } from "react";
import { useTheme } from "@/components/shell/ThemeProvider";
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
   * Called for each readable candidate after a successful upload. Upload is
   * the explicit user action; this only mutates parent form state — never
   * `companies` / `calculation_runs`. `displayValue` is already in the unit
   * the form shows (a percentage for percentage-valued fields).
   */
  onAccept: (field: string, displayValue: number) => void;
  /** Optional clearer when the user clicks Perbaiki on a filled field. */
  onClear?: (field: string) => void;
}

type CandidateStatus = "pending" | "accepted" | "dismissed";

/**
 * A dropzone that posts a document to `POST /documents`, auto-fills form
 * state for every non-null candidate, and lists filled vs unreadable rows.
 *
 * OCR still never writes the database: only parent form state via `onAccept`.
 * Null candidates stay blank. Perbaiki clears that field (via `onClear`) for
 * manual edit.
 */
export default function UploadDropzone({
  profile,
  fieldLabels,
  onAccept,
  onClear,
}: UploadDropzoneProps) {
  const { colors: C } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [hasResult, setHasResult] = useState(false);
  const [confidenceIsPlaceholder, setConfidenceIsPlaceholder] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, CandidateStatus>>({});
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const generation = ++requestGeneration.current;
    setPending(true);
    setError(null);
    setCandidates([]);
    setHasResult(false);
    setStatuses({});
    try {
      const result = await postDocument(file, profile);
      if (generation !== requestGeneration.current) return;
      setCandidates(result.candidates);
      setConfidenceIsPlaceholder(result.confidenceIsPlaceholder);
      setHasResult(true);

      const nextStatuses: Record<string, CandidateStatus> = {};
      for (const candidate of result.candidates) {
        if (candidate.value === null) continue;
        const meta = fieldLabels[candidate.field];
        const displayValue = candidateDisplayValue(
          candidate.value,
          meta?.isPercent ?? false,
        );
        if (displayValue === null) continue;
        onAccept(candidate.field, displayValue);
        nextStatuses[candidate.field] = "accepted";
      }
      setStatuses(nextStatuses);
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Permintaan unggah habis waktu. Masukkan nilai secara manual.");
      } else {
        setError(err instanceof Error ? err.message : "Gagal mengunggah dokumen.");
      }
    } finally {
      if (generation === requestGeneration.current) {
        setPending(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  }

  function handleDismiss(candidate: Candidate) {
    onClear?.(candidate.field);
    setStatuses((prev) => ({ ...prev, [candidate.field]: "dismissed" }));
  }

  const allUnreadable =
    candidates.length === 0 || candidates.every((candidate) => candidate.value === null);

  return (
    <div className="flex flex-col gap-3" style={{ color: C.text }}>
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
        className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center transition-opacity"
        style={{
          borderColor: dragOver ? C.cyan : C.border,
          background: dragOver ? `${C.cyan}12` : "transparent",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-sm font-medium" style={{ color: C.text }}>
          Seret dokumen ke sini, atau klik untuk memilih file
        </p>
        <p className="text-xs" style={{ color: C.muted }}>
          Foto atau pindaian (JPG, PNG, PDF)
        </p>
      </div>

      {pending && (
        <p className="text-sm" style={{ color: C.dimText }}>
          Membaca dokumen...
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: C.red }}>
          {error}
        </p>
      )}

      {hasResult && !pending && allUnreadable && (
        <p role="status" className="text-sm" style={{ color: C.dimText }}>
          Dokumen berhasil dibaca, tetapi tidak ada medan yang dicari ditemukan di dalamnya.
          Masukkan nilai secara manual.
        </p>
      )}

      {candidates.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-lg p-3"
          style={{ border: `1px solid ${C.border}` }}
        >
          {confidenceIsPlaceholder && (
            <p className="text-xs" style={{ color: C.muted }}>
              Skor &ldquo;terbaca&rdquo; berasal dari kualitas elemen dokumen Helpy, bukan
              keandalan per medan. Periksa nilai yang terisi; Perbaiki untuk mengosongkan
              dan mengisi manual.
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded px-3 py-2 text-sm"
                  style={{ border: `1px solid ${C.border}` }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium" style={{ color: C.text }}>
                      {meta?.label ?? candidate.field}
                    </span>
                    <span style={{ color: C.dimText }}>
                      {displayValue === null
                        ? "Tidak terbaca"
                        : `${displayValue}${meta?.unit ? ` ${meta.unit}` : ""}`}
                    </span>
                    {candidate.basis === "derived" && (
                      <span
                        className="mt-1 w-fit rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          background: `${C.amber}22`,
                          color: C.amber,
                        }}
                      >
                        Dihitung, bukan dibaca
                      </span>
                    )}
                    {candidate.derivation && (
                      <span
                        className="mt-1 break-words font-mono text-xs"
                        style={{ color: C.muted }}
                      >
                        {candidate.derivation}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        background: readable ? `${C.green}22` : C.panel,
                        color: readable ? C.green : C.muted,
                      }}
                      title={
                        confidenceIsPlaceholder
                          ? "Bukan skor keandalan -- hanya menandai apakah nilai terbaca."
                          : undefined
                      }
                    >
                      {readable ? "Terbaca" : "Tidak terbaca"}
                    </span>

                    {status === "accepted" && (
                      <>
                        <span className="text-xs font-medium" style={{ color: C.green }}>
                          Diterima
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDismiss(candidate)}
                          className="rounded-md px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
                          style={{
                            border: `1px solid ${C.border}`,
                            color: C.text,
                          }}
                        >
                          Perbaiki
                        </button>
                      </>
                    )}
                    {status === "dismissed" && (
                      <span className="text-xs font-medium" style={{ color: C.muted }}>
                        Isi manual di bawah
                      </span>
                    )}
                    {status === "pending" && !readable && (
                      <span className="text-xs font-medium" style={{ color: C.muted }}>
                        Tidak terbaca
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
