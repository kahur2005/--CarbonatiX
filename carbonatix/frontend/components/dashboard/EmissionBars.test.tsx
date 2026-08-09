import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import EmissionBars from "./EmissionBars";
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
  it("does not repeat total/intensity tiles already shown in the KPI bar", () => {
    render(<EmissionBars result={BASE_RESULT} />);
    expect(screen.queryByText("Total emisi")).not.toBeInTheDocument();
    expect(screen.queryByText("Intensitas per ton Ni")).not.toBeInTheDocument();
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
