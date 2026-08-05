import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CompliancePanel from "./CompliancePanel";
import { PTBAE_DISCLOSURE } from "@/lib/dashboard";
import type { CompliancePosition } from "@/types/emissions";

const SURPLUS: CompliancePosition = {
  capTco2e: 120000,
  projectedTco2e: 90000,
  positionTco2e: -30000, // negative == surplus (see compliance.py)
  isCompliant: true,
  positionValueIdr: 4500000000,
};

const DEFICIT: CompliancePosition = {
  capTco2e: 120000,
  projectedTco2e: 150000,
  positionTco2e: 30000, // positive == deficit
  isCompliant: false,
  positionValueIdr: 4500000000,
};

describe("CompliancePanel", () => {
  it("always shows the PTBAE-PU readiness disclosure as permanent text beneath the badge", () => {
    render(<CompliancePanel compliance={DEFICIT} />);
    expect(screen.getByText(PTBAE_DISCLOSURE)).toBeInTheDocument();
  });

  it("shows the readiness disclosure for a compliant position too, not only a non-compliant one", () => {
    render(<CompliancePanel compliance={SURPLUS} />);
    expect(screen.getByText(PTBAE_DISCLOSURE)).toBeInTheDocument();
  });

  it("labels a negative positionTco2e as Surplus", () => {
    render(<CompliancePanel compliance={SURPLUS} />);
    expect(screen.getByText("Surplus")).toBeInTheDocument();
  });

  it("labels a positive positionTco2e as Defisit", () => {
    render(<CompliancePanel compliance={DEFICIT} />);
    expect(screen.getByText("Defisit")).toBeInTheDocument();
  });

  it("shows cap, projected, and the rupiah position value", () => {
    render(<CompliancePanel compliance={DEFICIT} />);
    expect(screen.getByText(/120\.000 tCO2e/)).toBeInTheDocument();
    expect(screen.getByText(/150\.000 tCO2e/)).toBeInTheDocument();
    expect(screen.getByText(/Rp/)).toBeInTheDocument();
  });
});
