"use client";

import { useState } from "react";
import type { RecommendationVerifyPayload } from "@/types/emissions";

/**
 * The panel's three possible outcomes, computed by `app/dashboard/page.tsx`
 * from the SSE stream (see its `AdvisorSection`):
 *
 * - `"pending"`: the pipeline is still running and hasn't reached `verify`
 *   or a `synthesise` failure yet.
 * - `"unavailable"`: no recommendation ever arrives -- either `synthesise`
 *   went `failed` (see `app/advisor/pipeline.py`: no `verify` event follows
 *   a failed `synthesise`), or the stream ended/errored before reaching
 *   `verify`. Both read the same to a user: nothing to show here, and
 *   nothing is fabricated to fill the gap.
 * - `"ready"`: `verify`'s `done` payload arrived. Still may be `flagged`,
 *   which this component must never render as advice -- see below.
 */
export type AdvisorOutcome =
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "ready"; verify: RecommendationVerifyPayload };

/** The recommendation is the only non-essential output in the product --
 * the emission, compliance and forecast panels beside it are computed
 * independently and keep standing on their own regardless of this state.
 * Reused for both an explicit `synthesise` failure and a stream that never
 * reaches `verify` for any other reason: from the user's side both are
 * "no recommendation today," and inventing separate copy for the second
 * case would just be a different way of not saying anything true. */
export const RECOMMENDATION_UNAVAILABLE_MESSAGE =
  "Rekomendasi tidak tersedia saat ini. Hasil emisi, kepatuhan dan proyeksi harga di atas tetap berlaku.";

/** Exact wording from the task brief -- interpolates the fabricated tokens
 * so the reader knows specifically what was rejected, not just that
 * something was. */
function flaggedWarning(unsupported: string[]): string {
  return (
    "Rekomendasi ini memuat angka yang tidak berasal dari perhitungan sistem dan " +
    `tidak ditampilkan sebagai saran eksekusi. Angka bermasalah: ${unsupported.join(", ")}`
  );
}

const CITATION_UNVERIFIED_BADGE = "Belum terverifikasi";

/** Plain-language, always-rendered paragraph -- never a `title` tooltip --
 * shown once above the citation list whenever any citation in it carries
 * placeholder clause text on the backend (`app/advisor/corpus.py`). */
const PLACEHOLDER_CITATION_NOTE =
  "Kutipan pasal di bawah ini belum dapat diverifikasi: teks pasal asli belum " +
  "dimasukkan ke dalam sistem ini, sehingga rujukan ini TIDAK dapat dianggap " +
  "sebagai bunyi hukum yang sah.";

/** Shown when a chip is expanded. The backend's `verify` event never sends
 * clause body text over this endpoint (only the `ref` string -- see
 * `RecommendationVerifyPayload`'s doc comment), so there is no verbatim
 * article text to reveal here even when it is not a placeholder. Making
 * this up on the frontend would be exactly the fabrication this feature
 * exists to prevent, so it says plainly that the text isn't available
 * instead. */
function citationExpansionText(placeholderCitations: boolean): string {
  return placeholderCitations
    ? PLACEHOLDER_CITATION_NOTE
    : "Teks pasal verbatim tidak disertakan dalam respons ini.";
}

function CitationChip({
  citationRef,
  placeholderCitations,
}: {
  citationRef: string;
  placeholderCitations: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        data-testid="citation-chip"
        data-placeholder={placeholderCitations}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
        style={
          placeholderCitations
            ? { borderColor: "var(--chart-status-warning)", color: "var(--chart-status-warning)" }
            : { borderColor: "var(--chart-gridline)", color: "var(--chart-text-secondary)" }
        }
      >
        {placeholderCitations && <span aria-hidden>⚠</span>}
        <span>{citationRef}</span>
        {placeholderCitations && (
          <span data-testid="citation-unverified-badge" className="font-semibold">
            {CITATION_UNVERIFIED_BADGE}
          </span>
        )}
      </button>
      {open && (
        <p
          data-testid="citation-expansion"
          className="mt-1 max-w-prose text-xs text-[var(--chart-text-secondary)]"
        >
          {citationExpansionText(placeholderCitations)}
        </p>
      )}
    </li>
  );
}

/**
 * Renders the advisor's recommendation, given the outcome
 * `app/dashboard/page.tsx` derived from the SSE stream.
 *
 * Two guards this component exists to enforce, both load-bearing:
 *
 * 1. `verify.flagged` -- the model emitted a numeral that was not in the
 *    supplied figure set. `verify.body` is NEVER rendered in this state,
 *    not even alongside a warning: a reader takes the number and ignores
 *    the caveat, which is exactly what the numeral guard exists to
 *    prevent (see `app/advisor/prompt.py`'s `unsupported_numerals`).
 * 2. `placeholderCitations` -- every citation chip gets a visible,
 *    always-rendered marker (never a tooltip) when the clause text behind
 *    it is still `corpus.py`'s placeholder sentinel, so it can never be
 *    mistaken for verified law.
 */
export default function RecommendationPanel({ outcome }: { outcome: AdvisorOutcome }) {
  return (
    <div
      data-testid="recommendation-panel"
      className="viz-root flex flex-col gap-3 rounded-lg border border-black/[.08] bg-[var(--chart-surface)] p-4 dark:border-white/[.145]"
    >
      <h2
        className="text-sm font-semibold text-[var(--chart-text-primary)]"
        style={{ fontFamily: "var(--font-display), sans-serif" }}
      >
        Rekomendasi
      </h2>

      {outcome.kind === "pending" && (
        <p className="text-sm text-[var(--chart-text-secondary)]">Menyusun rekomendasi...</p>
      )}

      {outcome.kind === "unavailable" && (
        <p data-testid="recommendation-unavailable" className="text-sm text-[var(--chart-text-secondary)]">
          {RECOMMENDATION_UNAVAILABLE_MESSAGE}
        </p>
      )}

      {outcome.kind === "ready" && outcome.verify.flagged && (
        <p
          role="alert"
          data-testid="recommendation-flagged-warning"
          className="text-sm text-red-600 dark:text-red-400"
        >
          {flaggedWarning(outcome.verify.unsupported)}
        </p>
      )}

      {outcome.kind === "ready" && !outcome.verify.flagged && (
        <>
          <p
            data-testid="recommendation-body"
            className="max-w-prose whitespace-pre-wrap text-sm text-[var(--chart-text-primary)]"
          >
            {outcome.verify.body}
          </p>

          {outcome.verify.citations.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[var(--chart-text-primary)]">
                Rujukan Pasal
              </h3>
              {outcome.verify.placeholderCitations && (
                <p
                  data-testid="placeholder-citation-note"
                  className="mt-1 max-w-prose text-xs text-[var(--chart-status-warning)]"
                >
                  {PLACEHOLDER_CITATION_NOTE}
                </p>
              )}
              <ul className="mt-2 flex flex-wrap gap-2">
                {outcome.verify.citations.map((ref) => (
                  <CitationChip
                    key={ref}
                    citationRef={ref}
                    placeholderCitations={outcome.verify.placeholderCitations}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
