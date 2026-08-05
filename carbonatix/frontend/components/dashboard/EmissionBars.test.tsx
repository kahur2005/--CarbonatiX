import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import EmissionBars from "./EmissionBars";
import { INTENSITY_NULL_TOOLTIP } from "@/lib/dashboard";
import type { EmissionResult } from "@/types/emissions";

const BASE_RESULT: EmissionResult = {
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

describe("EmissionBars", () => {
  it("renders the total and a numeric intensity together when nickel was tapped", () => {
    render(<EmissionBars result={BASE_RESULT} />);
    expect(screen.getByText("75 tCO2e")).toBeInTheDocument();
    expect(screen.getByText("0,75 tCO2e/ton Ni")).toBeInTheDocument();
  });

  it('renders "—" (never "0") for a null intensity, with the tap-free tooltip attached', () => {
    const result: EmissionResult = { ...BASE_RESULT, intensityPerTonneNi: null };
    render(<EmissionBars result={result} />);

    // The intensity stat tile must show the em dash, not a literal 0.
    const intensityTile = screen.getByText("—");
    expect(intensityTile).toBeInTheDocument();
    expect(screen.queryByText(/^0(\.|,)?0* tCO2e\/ton Ni/)).not.toBeInTheDocument();

    // The Indonesian explanation is present in the DOM (tooltip visibility
    // is CSS-only, so it's reachable without hovering).
    expect(screen.getByText(INTENSITY_NULL_TOOLTIP)).toBeInTheDocument();
  });

  it("groups the four stage bars into the ore-driven and nickel-driven clusters, not a flat row", () => {
    render(<EmissionBars result={BASE_RESULT} />);
    expect(screen.getByText("Digerakkan bijih")).toBeInTheDocument();
    expect(screen.getByText("Digerakkan nikel")).toBeInTheDocument();

    expect(screen.getByTestId("bar-dryerEmissions")).toBeInTheDocument();
    expect(screen.getByTestId("bar-kilnHeatEmissions")).toBeInTheDocument();
    expect(screen.getByTestId("bar-kilnReductantEmissions")).toBeInTheDocument();
    expect(screen.getByTestId("bar-eafEmissions")).toBeInTheDocument();
  });

  it("shows the Scope 1 / Scope 2 split as its own stacked bar with both values", () => {
    render(<EmissionBars result={BASE_RESULT} />);
    expect(screen.getByTestId("scope1-segment")).toBeInTheDocument();
    expect(screen.getByTestId("scope2-segment")).toBeInTheDocument();
    expect(screen.getByText(/Scope 1 -- 35 tCO2e/)).toBeInTheDocument();
    expect(screen.getByText(/Scope 2 -- 40 tCO2e/)).toBeInTheDocument();
  });
});
