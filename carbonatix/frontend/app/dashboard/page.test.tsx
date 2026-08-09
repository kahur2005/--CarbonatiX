import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import DashboardPage from "./page";
import { PeriodProvider } from "@/components/shell/PeriodProvider";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { getRun, RunNotFoundError, streamRecommendation } from "@/lib/api";
import { PTBAE_DISCLOSURE, STANDING_DISCLOSURES, SYNTHETIC_PRICE_LABEL } from "@/lib/dashboard";
import { RECOMMENDATION_UNAVAILABLE_MESSAGE } from "@/components/advisor/RecommendationPanel";
import type { RecommendationEvent, RunResult } from "@/types/emissions";

function renderDash(ui: ReactElement = <DashboardPage />) {
  return render(
    <ThemeProvider>
      <PeriodProvider>{ui}</PeriodProvider>
    </ThemeProvider>,
  );
}

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getRun: vi.fn(),
    streamRecommendation: vi.fn(),
    listProductionMonths: vi.fn().mockResolvedValue([]),
    getCompany: vi.fn().mockRejectedValue(new Error("no company in test")),
  };
});

vi.mock("@/components/shell/MonthPicker", () => ({
  default: () => null,
}));

const STAGES = ["retrieve", "assemble", "synthesise", "verify"] as const;

/** Builds an async generator standing in for `streamRecommendation`'s real
 * SSE parsing -- tests below only care about the events the generator
 * yields, not how they got framed on the wire (that's `lib/api.ts`'s own
 * concern, exercised separately). */
async function* fakeStream(events: RecommendationEvent[]): AsyncGenerator<RecommendationEvent> {
  for (const event of events) {
    yield event;
  }
}

/** A stream that yields one event then throws, standing in for a
 * connection that drops mid-flight. */
async function* erroringStream(
  events: RecommendationEvent[],
): AsyncGenerator<RecommendationEvent> {
  for (const event of events) {
    yield event;
  }
  throw new Error("network drop");
}

function stageEvent(
  stage: (typeof STAGES)[number],
  status: RecommendationEvent["status"],
  payload: Record<string, unknown> | null = null,
): RecommendationEvent {
  return { stage, status, payload, placeholderCitations: true };
}

let currentRunParam: string | null = "run-123";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "run" ? currentRunParam : null),
  }),
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const RUN: RunResult = {
  id: "run-123",
  result: {
    nickelOutputTons: 100,
    alloyOutputTons: 500,
    dryerEmissions: 10,
    kilnHeatEmissions: 20,
    kilnReductantEmissions: 5,
    eafEmissions: 40,
    totalEmissions: 75,
    scope1: 35,
    scope2: 40,
    intensityPerTonneNi: 0.75,
    dryOreTons: 6800,
    dryerCoalTons: 1,
    kilnCoalTons: 2,
    reductantTons: 3,
    eafMwh: 4,
  },
  compliance: {
    capTco2e: 120000,
    projectedTco2e: 90000,
    positionTco2e: -30000,
    isCompliant: true,
    positionValueIdr: 4500000000,
  },
  forecastSnapshot: {
    dates: ["2026-08-05", "2026-08-06"],
    lmeUsdPerTon: [15000, 15100],
    lmeUsdPerTonLower: [14500, 14600],
    lmeUsdPerTonUpper: [15500, 15600],
    idxCarbonIdrPerTon: [120000, 121000],
    idxCarbonIdrPerTonLower: [110000, 111000],
    idxCarbonIdrPerTonUpper: [130000, 131000],
    stale: false,
    synthetic: true,
    provenance: {
      lmeUsdPerTon: { synthetic: true, warning: "fabricated training series" },
      idxCarbonIdrPerTon: { synthetic: true, warning: "fabricated training series" },
    },
  },
  createdAt: "2026-08-05T00:00:00Z",
  period: "2025-02",
};

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.mocked(getRun).mockReset();
    vi.mocked(streamRecommendation).mockReset();
    // Default: an empty stream. Tests that don't care about the advisor
    // section (the pre-existing ones below) still exercise `AdvisorSection`
    // once `getRun` resolves, since it's now unconditionally rendered by
    // `RunView` -- this keeps them from crashing on an unmocked call while
    // saying nothing about advisor behaviour itself.
    vi.mocked(streamRecommendation).mockReturnValue(fakeStream([]));
    currentRunParam = "run-123";
  });

  it("loads the run from ?run= and renders its results, disclosures, and synthetic-price labels", async () => {
    vi.mocked(getRun).mockResolvedValue(RUN);
    renderDash();

    await waitFor(() => expect(getRun).toHaveBeenCalledWith("run-123"));
    await screen.findByText(PTBAE_DISCLOSURE);
    expect(screen.getByText(/Periode produksi:/)).toBeInTheDocument();
    expect(screen.getByText("Februari 2025")).toBeInTheDocument();

    // Standing disclosures footer is always in the document.
    expect(screen.getByText(STANDING_DISCLOSURES)).toBeInTheDocument();

    // Both currency charts render with the synthetic-data label visible.
    const syntheticBadges = screen.getAllByText(SYNTHETIC_PRICE_LABEL);
    expect(syntheticBadges.length).toBe(2);
  });

  it('shows "no run selected" when the URL has no ?run= param, without calling the API', () => {
    currentRunParam = null;
    renderDash();
    expect(screen.getByText(/Tidak ada perhitungan yang dipilih/)).toBeInTheDocument();
    expect(getRun).not.toHaveBeenCalled();
  });

  it("shows a fixed Indonesian message for a missing run, never a raw error body", async () => {
    vi.mocked(getRun).mockRejectedValue(new RunNotFoundError('{"detail":"Run not found"}'));
    renderDash();
    await screen.findByText(/Perhitungan tidak ditemukan/);
    expect(screen.queryByText(/detail/)).not.toBeInTheDocument();
  });

  it("shows a fixed Indonesian message on a generic failure, never the raw exception text", async () => {
    vi.mocked(getRun).mockRejectedValue(new TypeError("Failed to fetch"));
    renderDash();
    await screen.findByText(/Gagal memuat data dashboard/);
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  describe("advisor node graph and recommendation", () => {
    it("drives all four nodes to a terminal state and renders the recommendation body on a normal completed stream", async () => {
      vi.mocked(getRun).mockResolvedValue(RUN);
      vi.mocked(streamRecommendation).mockReturnValue(
        fakeStream([
          stageEvent("retrieve", "running"),
          stageEvent("retrieve", "done", { refs: ["Perpres 98/2021 Pasal 47"] }),
          stageEvent("assemble", "running"),
          stageEvent("assemble", "done", { figureCount: 5 }),
          stageEvent("synthesise", "running"),
          stageEvent("synthesise", "done", { body: "Pertahankan posisi surplus saat ini." }),
          stageEvent("verify", "running"),
          stageEvent("verify", "done", {
            flagged: false,
            unsupported: [],
            citations: ["Perpres 98/2021 Pasal 47"],
            body: "Pertahankan posisi surplus saat ini.",
            model: "claude-opus-5",
            placeholderCitations: true,
          }),
        ]),
      );

      renderDash();

      await waitFor(() => {
        for (const stage of STAGES) {
          expect(screen.getByTestId(`node-${stage}`)).toHaveAttribute("data-status", "done");
        }
      });

      expect(screen.getByTestId("recommendation-body")).toHaveTextContent(
        "Pertahankan posisi surplus saat ini.",
      );
      // No node is left running once the stream has fully settled.
      for (const stage of STAGES) {
        expect(screen.getByTestId(`node-${stage}`).getAttribute("data-status")).not.toBe(
          "running",
        );
      }
    });

    it('shows the fixed "tidak tersedia" fallback and leaves no node on "running" when synthesise fails (no verify event ever arrives)', async () => {
      vi.mocked(getRun).mockResolvedValue(RUN);
      vi.mocked(streamRecommendation).mockReturnValue(
        fakeStream([
          stageEvent("retrieve", "running"),
          stageEvent("retrieve", "done", { refs: [] }),
          stageEvent("assemble", "running"),
          stageEvent("assemble", "done", { figureCount: 5 }),
          stageEvent("synthesise", "running"),
          // Backend never sends `verify` after this -- see
          // `app/advisor/pipeline.py`'s `run_pipeline`.
          stageEvent("synthesise", "failed", { error: "AnthropicError: rate limited" }),
        ]),
      );

      renderDash();

      await screen.findByTestId("recommendation-unavailable");
      expect(screen.getByTestId("recommendation-unavailable")).toHaveTextContent(
        RECOMMENDATION_UNAVAILABLE_MESSAGE,
      );
      expect(screen.getByTestId("node-synthesise")).toHaveAttribute("data-status", "failed");

      // No node hangs on "running" forever, and the raw backend error
      // string is never leaked into the Bahasa Indonesia UI.
      for (const stage of STAGES) {
        expect(screen.getByTestId(`node-${stage}`).getAttribute("data-status")).not.toBe(
          "running",
        );
      }
      expect(screen.queryByText(/rate limited/)).not.toBeInTheDocument();
      expect(screen.queryByText(/AnthropicError/)).not.toBeInTheDocument();

      // The other panels, computed independently of the advisor, stay
      // fully rendered.
      expect(screen.getByText(PTBAE_DISCLOSURE)).toBeInTheDocument();
    });

    it('marks the verify node "failed" (not "done") and shows the unavailable fallback when the verify/done payload does not actually match the expected shape', async () => {
      vi.mocked(getRun).mockResolvedValue(RUN);
      vi.mocked(streamRecommendation).mockReturnValue(
        fakeStream([
          stageEvent("retrieve", "done", { refs: [] }),
          stageEvent("assemble", "done", { figureCount: 5 }),
          stageEvent("synthesise", "done", { body: "..." }),
          // `status: "done"` but a payload missing every field
          // `isVerifyPayload` checks for -- a hypothetical backend bug
          // must never be trusted into the UI as a real recommendation,
          // and must never leave this node silently green while the panel
          // says there is nothing to show.
          stageEvent("verify", "done", { unexpected: "shape" }),
        ]),
      );

      renderDash();

      await screen.findByTestId("recommendation-unavailable");
      expect(screen.getByTestId("node-verify")).toHaveAttribute("data-status", "failed");
      expect(screen.getByTestId("recommendation-unavailable")).toHaveTextContent(
        RECOMMENDATION_UNAVAILABLE_MESSAGE,
      );
      // The three prior stages, which genuinely did complete, are
      // unaffected -- only the node whose payload was rejected turns red.
      expect(screen.getByTestId("node-retrieve")).toHaveAttribute("data-status", "done");
      expect(screen.getByTestId("node-assemble")).toHaveAttribute("data-status", "done");
      expect(screen.getByTestId("node-synthesise")).toHaveAttribute("data-status", "done");
    });

    it('shows the flagged warning instead of the body, and never renders the fabricated figure as if it were part of the recommendation text', async () => {
      vi.mocked(getRun).mockResolvedValue(RUN);
      vi.mocked(streamRecommendation).mockReturnValue(
        fakeStream([
          stageEvent("retrieve", "done", { refs: [] }),
          stageEvent("assemble", "done", { figureCount: 5 }),
          stageEvent("synthesise", "done", { body: "Bayar 999999999 tCO2e." }),
          stageEvent("verify", "done", {
            flagged: true,
            unsupported: ["999999999"],
            citations: [],
            body: "Bayar 999999999 tCO2e.",
            model: "claude-opus-5",
            placeholderCitations: true,
          }),
        ]),
      );

      renderDash();

      await screen.findByTestId("recommendation-flagged-warning");
      expect(screen.getByTestId("recommendation-flagged-warning")).toHaveTextContent(
        "Angka bermasalah: 999999999",
      );
      expect(screen.queryByTestId("recommendation-body")).not.toBeInTheDocument();
      expect(screen.queryByText("Bayar 999999999 tCO2e.")).not.toBeInTheDocument();
    });

    it("marks citation chips as not-yet-authoritative when placeholderCitations is true", async () => {
      vi.mocked(getRun).mockResolvedValue(RUN);
      vi.mocked(streamRecommendation).mockReturnValue(
        fakeStream([
          stageEvent("retrieve", "done", { refs: ["Permen ESDM 16/2022 Pasal 18"] }),
          stageEvent("assemble", "done", { figureCount: 5 }),
          stageEvent("synthesise", "done", { body: "Lihat Permen ESDM 16/2022 Pasal 18." }),
          stageEvent("verify", "done", {
            flagged: false,
            unsupported: [],
            citations: ["Permen ESDM 16/2022 Pasal 18"],
            body: "Lihat Permen ESDM 16/2022 Pasal 18.",
            model: "claude-opus-5",
            placeholderCitations: true,
          }),
        ]),
      );

      renderDash();

      await screen.findByTestId("citation-chip");
      expect(screen.getByTestId("citation-chip")).toHaveAttribute("data-placeholder", "true");
      expect(screen.getByTestId("citation-unverified-badge")).toHaveTextContent(
        "Belum terverifikasi",
      );
      expect(screen.getByTestId("placeholder-citation-note")).toBeInTheDocument();
    });

    it('leaves no node stuck on "running" when the stream errors mid-flight before any terminal outcome', async () => {
      vi.mocked(getRun).mockResolvedValue(RUN);
      vi.mocked(streamRecommendation).mockReturnValue(
        erroringStream([stageEvent("retrieve", "running")]),
      );

      renderDash();

      await screen.findByTestId("recommendation-unavailable");
      for (const stage of STAGES) {
        expect(screen.getByTestId(`node-${stage}`).getAttribute("data-status")).not.toBe(
          "running",
        );
      }
      // The node that was in flight when the connection dropped is the one
      // that visibly failed, not silently left pending with no signal.
      expect(screen.getByTestId("node-retrieve")).toHaveAttribute("data-status", "failed");
    });

    it('leaves no node stuck on "running" when the stream ends cleanly without ever sending a terminal event for the in-flight stage', async () => {
      vi.mocked(getRun).mockResolvedValue(RUN);
      vi.mocked(streamRecommendation).mockReturnValue(
        fakeStream([
          stageEvent("retrieve", "done", { refs: [] }),
          stageEvent("assemble", "running"),
          // Stream simply ends here -- no "done"/"failed" for assemble, no
          // later stage ever starts.
        ]),
      );

      renderDash();

      await screen.findByTestId("recommendation-unavailable");
      for (const stage of STAGES) {
        expect(screen.getByTestId(`node-${stage}`).getAttribute("data-status")).not.toBe(
          "running",
        );
      }
      expect(screen.getByTestId("node-assemble")).toHaveAttribute("data-status", "failed");
    });
  });
});
