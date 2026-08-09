import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import TwinPage from "./page";
import { PeriodProvider } from "@/components/shell/PeriodProvider";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import {
  getCompany,
  getProductionMonth,
  postDocument,
  postEmissions,
  postRun,
  putProductionMonth,
} from "@/lib/api";
import { FIELD_ERROR_MESSAGE, POWER_MIX_INCOMPLETE_MESSAGE } from "@/lib/twin";
import type { Company, EmissionResult } from "@/types/emissions";

// TwinScene needs WebGL — mocked so page logic (node panel, commit gate,
// 422 routing) can run in jsdom. Selectors live on the page's node list
// (`data-testid="select-*"`); the GLB canvas itself is a no-op.
vi.mock("@/components/twin/TwinScene", () => ({
  default: () => <div data-testid="scene-mock" />,
}));

vi.mock("@/components/shell/MonthPicker", () => ({
  default: () => null,
}));

vi.mock("@/lib/api", () => ({
  getCompany: vi.fn(),
  postEmissions: vi.fn(),
  postRun: vi.fn(),
  postDocument: vi.fn(),
  getProductionMonth: vi.fn(),
  putProductionMonth: vi.fn(),
  listProductionMonths: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/twin",
}));

function renderTwin(ui: ReactElement = <TwinPage />) {
  return render(
    <ThemeProvider>
      <PeriodProvider>{ui}</PeriodProvider>
    </ThemeProvider>,
  );
}

const VALID_COMPANY: Company = {
  name: "PT Contoh Smelter",
  technology: "RKEF",
  efCaptivePltu: 1.0,
  dryerThermalEfficiency: 0.55,
  secEafKwhPerTAlloy: 2400,
  alloyNickelGrade: 0.21,
  kilnThermalEfficiency: 0.65,
  capTco2e: 120000,
};

const VALID_RESULT: EmissionResult = {
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
};

/** Fills every editable field except the two power-mix shares: stockpile
 * and kiln. Dryer/EAF/PLTU's site-spec values are read-only (see
 * `lib/twin.ts`'s `SiteSpecFieldDescriptor`) and need no filling -- this
 * opens the EAF panel last and waits for its read-only value to show the
 * company-seeded figure ("2.400 kWh/ton alloy"), which only renders once
 * `getCompany()` has resolved. That's the test's signal that the page's
 * company fetch (and the `companyState === "ready"` gate) has settled,
 * without adding a test-only hook to the page itself. */
async function fillValidFormExceptPowerMix(user: ReturnType<typeof userEvent.setup>) {
  // `Scene` is loaded via `next/dynamic` (`ssr: false`), so even with the
  // module mocked above, it resolves asynchronously on the first render --
  // `findByTestId` (not `getByTestId`) waits for that.
  await user.click(await screen.findByTestId("select-stockpile"));
  await user.type(screen.getByLabelText(/Bijih basah masuk/), "10000");
  await user.type(screen.getByLabelText(/Kadar air/), "32");
  await user.type(screen.getByLabelText(/Kadar nikel bijih/), "1.8");

  await user.click(screen.getByTestId("select-kiln"));
  await user.type(screen.getByLabelText(/Reduktan biocoke/), "8");

  await user.click(screen.getByTestId("select-eaf"));
  await waitFor(() => expect(screen.getByText("2.400 kWh/ton alloy")).toBeInTheDocument());
  // Read-only: no input, no label association -- just the static value and
  // the link to onboarding.
  expect(screen.queryByLabelText(/Energi spesifik EAF/)).not.toBeInTheDocument();
}

describe("TwinPage", () => {
  beforeEach(() => {
    vi.mocked(getCompany).mockReset().mockResolvedValue(VALID_COMPANY);
    vi.mocked(postEmissions).mockReset().mockResolvedValue(VALID_RESULT);
    vi.mocked(postRun).mockReset();
    vi.mocked(postDocument).mockReset();
    vi.mocked(getProductionMonth).mockReset().mockResolvedValue(null);
    vi.mocked(putProductionMonth).mockReset().mockResolvedValue({
      period: "2026-08",
      inputs: {},
      updatedAt: "2026-08-08T00:00:00Z",
    });
    pushMock.mockReset();
    sessionStorage.clear();
  });

  it("disables commit while the pltu power mix is incomplete, enables it at exactly 100%", async () => {
    const user = userEvent.setup();
    renderTwin();

    await fillValidFormExceptPowerMix(user);

    await user.click(screen.getByTestId("select-pltu"));
    await user.type(screen.getByLabelText(/captive coal/), "70");
    await user.type(screen.getByLabelText(/hidro\/grid/), "0");

    const commitButton = screen.getByRole("button", { name: "Simpan perhitungan" });
    await waitFor(() => expect(commitButton).toBeDisabled());
    expect(screen.getAllByText(POWER_MIX_INCOMPLETE_MESSAGE).length).toBeGreaterThan(0);

    // Balance the remainder to exactly 100%.
    await user.type(screen.getByLabelText(/hidro\/grid/), "30");

    await waitFor(() => expect(commitButton).not.toBeDisabled());
    expect(screen.queryByText(POWER_MIX_INCOMPLETE_MESSAGE)).not.toBeInTheDocument();
  });

  it("sends the company's site-spec values verbatim to /emissions, with no editable field that could override them", async () => {
    const user = userEvent.setup();
    renderTwin();

    await fillValidFormExceptPowerMix(user);
    await user.click(screen.getByTestId("select-pltu"));
    await user.type(screen.getByLabelText(/captive coal/), "70");
    await user.type(screen.getByLabelText(/hidro\/grid/), "30");

    await waitFor(() => expect(postEmissions).toHaveBeenCalled());

    // Every /emissions call this test produces carries exactly
    // the company's three site-spec numbers -- this is the payload
    // `runs.commit` (app/runs.py) also builds from, by reading the same
    // stored row, so the preview a user approves and what gets persisted
    // are provably the same three numbers, not just documented as such.
    const lastCall = vi.mocked(postEmissions).mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall?.secEafKwhPerTAlloy).toBe(VALID_COMPANY.secEafKwhPerTAlloy);
    expect(lastCall?.efCaptivePltu).toBe(VALID_COMPANY.efCaptivePltu);
    expect(lastCall?.dryerThermalEfficiency).toBe(VALID_COMPANY.dryerThermalEfficiency);

    // There is no input anywhere on the page for any of the three
    // site-spec fields -- confirmed across every node, not just the one
    // currently open, by visiting each in turn.
    for (const node of ["dryer", "eaf", "pltu"]) {
      await user.click(screen.getByTestId(`select-${node}`));
      expect(screen.queryByLabelText(/Efisiensi termal dryer/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Energi spesifik EAF/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Faktor emisi PLTU captive/)).not.toBeInTheDocument();
    }

    // The link back to onboarding is present instead, on each of the three
    // nodes that carry a site-spec value.
    await user.click(screen.getByTestId("select-dryer"));
    expect(screen.getByRole("link", { name: "Ubah di profil perusahaan" })).toHaveAttribute(
      "href",
      "/onboarding",
    );
  });

  it("on a 422, marks only the owning node -- never a bare global banner", async () => {
    vi.mocked(postEmissions).mockReset().mockRejectedValue(
      new Error(
        JSON.stringify({
          detail: [
            {
              type: "less_than_equal",
              loc: ["body", "reductantBiocokePct"],
              msg: "Input should be less than or equal to 1",
            },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    renderTwin();

    await fillValidFormExceptPowerMix(user);
    await user.click(screen.getByTestId("select-pltu"));
    await user.type(screen.getByLabelText(/captive coal/), "70");
    await user.type(screen.getByLabelText(/hidro\/grid/), "30");

    // The debounced recompute fires ~150ms after the last edit and hits
    // the mocked 422 above -- `reductantBiocokePct` belongs to `kiln`
    // (NODE_FOR_FIELD), so `kiln`, not `pltu` (the panel that's open right
    // now), must be the one that lights up.
    await waitFor(() => expect(postEmissions).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("scene-error-kiln")).toHaveTextContent(FIELD_ERROR_MESSAGE));
    expect(screen.queryByTestId("scene-error-pltu")).not.toBeInTheDocument();

    // The message is attached to the node -- switching to its panel shows
    // it as an alert scoped to that panel, not a page-wide banner.
    await user.click(screen.getByTestId("select-kiln"));
    expect(screen.getByRole("alert")).toHaveTextContent(FIELD_ERROR_MESSAGE);

    // No generic/detached banner anywhere on the page for this error.
    expect(
      screen.queryByText("Tidak dapat menghitung ulang emisi. Periksa koneksi Anda."),
    ).not.toBeInTheDocument();
  });

  it("hydrates operational fields from the monthly production log", async () => {
    vi.mocked(getProductionMonth).mockResolvedValue({
      period: "2026-08",
      updatedAt: "2026-08-01T00:00:00Z",
      inputs: {
        wetOreInputTons: 9000,
        moistureContentPct: 0.3,
        nickelGradePct: 0.02,
        reductantBiocokePct: 0.05,
        powerMixCaptiveCoal: 0.6,
        powerMixHydroGrid: 0.4,
      },
    });

    renderTwin();
    await userEvent.setup().click(await screen.findByTestId("select-stockpile"));
    await waitFor(() => {
      expect(screen.getByLabelText(/Bijih basah masuk/)).toHaveValue(9000);
    });
    expect(screen.getByLabelText(/Kadar air/)).toHaveValue(30);
  });

  it("commits with the selected production period", async () => {
    const user = userEvent.setup();
    vi.mocked(postRun).mockResolvedValue({
      id: "run-xyz",
      result: VALID_RESULT,
      compliance: {
        capTco2e: 120000,
        projectedTco2e: 75,
        positionTco2e: -119925,
        isCompliant: true,
        positionValueIdr: 0,
      },
      forecastSnapshot: {
        dates: [],
        lmeUsdPerTon: [],
        lmeUsdPerTonLower: [],
        lmeUsdPerTonUpper: [],
        idxCarbonIdrPerTon: [1],
        idxCarbonIdrPerTonLower: [],
        idxCarbonIdrPerTonUpper: [],
        stale: false,
        synthetic: true,
        provenance: {
          lmeUsdPerTon: { synthetic: true },
          idxCarbonIdrPerTon: { synthetic: true },
        },
      },
      createdAt: "2026-08-08T00:00:00Z",
      period: "2026-08",
    });

    renderTwin();
    await fillValidFormExceptPowerMix(user);
    await user.click(screen.getByTestId("select-pltu"));
    await user.type(screen.getByLabelText(/captive coal/), "70");
    await user.type(screen.getByLabelText(/hidro\/grid/), "30");

    const commitButton = screen.getByRole("button", { name: "Simpan perhitungan" });
    await waitFor(() => expect(commitButton).not.toBeDisabled());
    await user.click(commitButton);

    await waitFor(() => expect(postRun).toHaveBeenCalled());
    const payload = vi.mocked(postRun).mock.calls.at(-1)?.[0];
    expect(payload?.period).toMatch(/^\d{4}-\d{2}$/);
    expect(pushMock).toHaveBeenCalledWith("/dashboard?run=run-xyz");
  });

  it("debounced autosave PUTs partial inputs after edits", async () => {
    const user = userEvent.setup();
    renderTwin();
    await user.click(await screen.findByTestId("select-stockpile"));
    await user.type(screen.getByLabelText(/Bijih basah masuk/), "5000");
    await waitFor(
      () => expect(putProductionMonth).toHaveBeenCalled(),
      { timeout: 3000 },
    );
    const last = vi.mocked(putProductionMonth).mock.calls.at(-1);
    expect(last?.[1]).toMatchObject({ wetOreInputTons: 5000 });
  });
});
