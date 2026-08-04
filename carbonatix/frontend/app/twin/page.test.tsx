import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TwinPage from "./page";
import { getCompany, postEmissions, postRun, postDocument } from "@/lib/api";
import { FIELD_ERROR_MESSAGE, POWER_MIX_INCOMPLETE_MESSAGE } from "@/lib/twin";
import type { Company, EmissionResult } from "@/types/emissions";

// `Scene` needs a WebGL canvas, which jsdom cannot provide -- it's mocked
// out here so this file can exercise the surrounding page logic (which
// node panel is open, the commit gate, 422 routing) without needing a real
// GPU context. The mock exposes one button per node (standing in for
// "click the mesh") and renders `nodeErrors` as plain text so a 422's
// node-routing is observable without touching the real Scene.
vi.mock("@/components/twin/Scene", () => ({
  default: (props: {
    onSelectNode: (node: string) => void;
    nodeErrors: Record<string, string | undefined>;
  }) => (
    <div data-testid="scene-mock">
      {["stockpile", "dryer", "kiln", "eaf", "pltu"].map((node) => (
        <button
          key={node}
          type="button"
          data-testid={`select-${node}`}
          onClick={() => props.onSelectNode(node)}
        >
          select {node}
        </button>
      ))}
      {Object.entries(props.nodeErrors).map(
        ([node, message]) =>
          message && (
            <p key={node} data-testid={`scene-error-${node}`}>
              {message}
            </p>
          ),
      )}
    </div>
  ),
}));

vi.mock("@/lib/api", () => ({
  getCompany: vi.fn(),
  postEmissions: vi.fn(),
  postRun: vi.fn(),
  postDocument: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

/** Fills every field except the two power-mix shares: stockpile, kiln, and
 * (implicitly, via the mocked company) dryer/EAF/PLTU's site-spec values.
 * Opens the EAF panel last and waits for its input to show the
 * company-seeded value, which only happens once `getCompany()` has
 * resolved -- the test's signal that the page's company fetch (and the
 * `companyState === "ready"` gate) has settled, without adding a
 * test-only hook to the page itself. */
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
  await waitFor(() => expect(screen.getByLabelText(/Energi spesifik EAF/)).toHaveValue(2400));
}

describe("TwinPage", () => {
  beforeEach(() => {
    vi.mocked(getCompany).mockReset().mockResolvedValue(VALID_COMPANY);
    vi.mocked(postEmissions).mockReset().mockResolvedValue(VALID_RESULT);
    vi.mocked(postRun).mockReset();
    vi.mocked(postDocument).mockReset();
    pushMock.mockReset();
  });

  it("disables commit while the pltu power mix is incomplete, enables it at exactly 100%", async () => {
    const user = userEvent.setup();
    render(<TwinPage />);

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
    render(<TwinPage />);

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
});
