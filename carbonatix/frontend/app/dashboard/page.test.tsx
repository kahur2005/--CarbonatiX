import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "./page";
import { getRun, RunNotFoundError } from "@/lib/api";
import { PTBAE_DISCLOSURE, STANDING_DISCLOSURES, SYNTHETIC_PRICE_LABEL } from "@/lib/dashboard";
import type { RunResult } from "@/types/emissions";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getRun: vi.fn(),
  };
});

let currentRunParam: string | null = "run-123";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "run" ? currentRunParam : null),
  }),
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
};

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.mocked(getRun).mockReset();
    currentRunParam = "run-123";
  });

  it("loads the run from ?run= and renders its results, disclosures, and synthetic-price labels", async () => {
    vi.mocked(getRun).mockResolvedValue(RUN);
    render(<DashboardPage />);

    await waitFor(() => expect(getRun).toHaveBeenCalledWith("run-123"));
    await screen.findByText(PTBAE_DISCLOSURE);

    // Standing disclosures footer is always in the document.
    expect(screen.getByText(STANDING_DISCLOSURES)).toBeInTheDocument();

    // Both currency charts render with the synthetic-data label visible.
    const syntheticBadges = screen.getAllByText(SYNTHETIC_PRICE_LABEL);
    expect(syntheticBadges.length).toBe(2);
  });

  it('shows "no run selected" when the URL has no ?run= param, without calling the API', () => {
    currentRunParam = null;
    render(<DashboardPage />);
    expect(screen.getByText(/Tidak ada perhitungan yang dipilih/)).toBeInTheDocument();
    expect(getRun).not.toHaveBeenCalled();
  });

  it("shows a fixed Indonesian message for a missing run, never a raw error body", async () => {
    vi.mocked(getRun).mockRejectedValue(new RunNotFoundError('{"detail":"Run not found"}'));
    render(<DashboardPage />);
    await screen.findByText(/Perhitungan tidak ditemukan/);
    expect(screen.queryByText(/detail/)).not.toBeInTheDocument();
  });

  it("shows a fixed Indonesian message on a generic failure, never the raw exception text", async () => {
    vi.mocked(getRun).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<DashboardPage />);
    await screen.findByText(/Gagal memuat data dashboard/);
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });
});
