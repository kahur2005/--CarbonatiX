"use client";

import type { RecommendationStage } from "@/types/emissions";

/** Local UI status, one step wider than the wire's `RecommendationStageStatus`:
 * a stage that has never fired an event yet is `"pending"`, not merely
 * absent. `app/dashboard/page.tsx` owns the reducer that turns the SSE
 * stream into this map and is also the one place that forces a stage stuck
 * on `"running"` to `"failed"` when the stream ends or errors without a
 * terminal event for it -- this component only renders whatever map it is
 * given, never invents a fifth status of its own. */
export type NodeStatus = "pending" | "running" | "done" | "failed";

export type NodeStatuses = Record<RecommendationStage, NodeStatus>;

export const PENDING_NODE_STATUSES: NodeStatuses = {
  retrieve: "pending",
  assemble: "pending",
  synthesise: "pending",
  verify: "pending",
};

const STAGE_ORDER: RecommendationStage[] = ["retrieve", "assemble", "synthesise", "verify"];

const STAGE_LABEL: Record<RecommendationStage, string> = {
  retrieve: "Ambil regulasi",
  assemble: "Rangkai angka",
  synthesise: "Sintesis",
  verify: "Verifikasi",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: "Menunggu",
  running: "Berjalan",
  done: "Selesai",
  failed: "Gagal",
};

const STATUS_COLOR_VAR: Record<NodeStatus, string> = {
  pending: "--chart-muted",
  running: "--chart-series-1",
  done: "--chart-status-good",
  failed: "--chart-status-critical",
};

/**
 * Four nodes in a row -- Ambil regulasi, Rangkai angka, Sintesis,
 * Verifikasi -- connected by arrows, each colored by its current status.
 *
 * This graph exists to answer the "AI black box" objection: a compliance
 * officer watches each stage resolve in real time and can see exactly
 * which one failed, rather than trusting a single opaque "generating..."
 * spinner. Every status is a real DOM text node (`STATUS_LABEL`), not only
 * a color, since color alone is not accessible and not verifiable by a
 * reviewer taking a screenshot for an audit trail.
 */
export default function NodeGraph({ statuses }: { statuses: NodeStatuses }) {
  return (
    <div
      className="viz-root flex flex-col gap-3 rounded-lg border border-black/[.08] bg-[var(--chart-surface)] p-4 dark:border-white/[.145]"
      data-testid="node-graph"
    >
      <h2
        className="text-sm font-semibold text-[var(--chart-text-primary)]"
        style={{ fontFamily: "var(--font-display), sans-serif" }}
      >
        Proses Penalaran AI
      </h2>
      <ol className="flex flex-wrap items-center gap-2">
        {STAGE_ORDER.map((stage, i) => {
          const status = statuses[stage];
          const colorVar = STATUS_COLOR_VAR[status];
          return (
            <li key={stage} className="flex items-center gap-2">
              <div
                data-testid={`node-${stage}`}
                data-status={status}
                role="status"
                aria-label={`${STAGE_LABEL[stage]}: ${STATUS_LABEL[status]}`}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium"
                style={{
                  borderColor: `var(${colorVar})`,
                  color: `var(${colorVar})`,
                  fontFamily: "var(--font-mono), monospace",
                }}
              >
                {status === "running" && (
                  <span
                    aria-hidden
                    data-testid={`node-${stage}-spinner`}
                    className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {status === "done" && <span aria-hidden>✓</span>}
                {status === "failed" && <span aria-hidden>✕</span>}
                <span>{STAGE_LABEL[stage]}</span>
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <span aria-hidden className="text-[var(--chart-muted)]">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
