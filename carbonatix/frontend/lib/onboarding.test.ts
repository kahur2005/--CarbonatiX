import { describe, expect, it } from "vitest";
import {
  buildCompanyInput,
  buildSuggestCapInput,
  candidateDisplayValue,
  computeImpliedIntensity,
  type CapHelperFormValues,
  type SiteSpecFormValues,
} from "./onboarding";

describe("buildCompanyInput", () => {
  const base: SiteSpecFormValues = {
    name: "PT Contoh Smelter",
    technology: "RKEF",
    efCaptivePltu: 0.85,
    dryerThermalEfficiencyPercent: 72,
    secEafKwhPerTAlloy: 450,
    alloyNickelGradePercent: 21,
    kilnThermalEfficiencyPercent: 65,
    capTco2e: 120000,
  };

  it("converts only the percentage fields to fractions", () => {
    const result = buildCompanyInput(base);
    expect(result).toEqual({
      name: "PT Contoh Smelter",
      technology: "RKEF",
      efCaptivePltu: 0.85,
      dryerThermalEfficiency: 0.72,
      secEafKwhPerTAlloy: 450,
      alloyNickelGrade: 0.21,
      kilnThermalEfficiency: 0.65,
      capTco2e: 120000,
    });
  });

  it("leaves the absolute cap untouched -- it is never derived from ore volume", () => {
    const result = buildCompanyInput({ ...base, capTco2e: 99999.5 });
    expect(result.capTco2e).toBe(99999.5);
  });

  it("rejects an out-of-range percentage rather than sending a bad fraction", () => {
    expect(() =>
      buildCompanyInput({ ...base, kilnThermalEfficiencyPercent: 150 }),
    ).toThrow(RangeError);
  });
});

describe("buildSuggestCapInput", () => {
  const base: CapHelperFormValues = {
    wetOreInputTons: 10000,
    moistureContentPercent: 30,
    nickelGradePercent: 1.8,
    reductantBiocokePercent: 8,
    powerMixCaptiveCoalPercent: 70,
    powerMixHydroGridPercent: 30,
    reductionTargetPercent: 15,
  };

  it("converts every percentage field, leaves tonnage as-is", () => {
    const result = buildSuggestCapInput(base);
    expect(result.wetOreInputTons).toBe(10000);
    expect(result.moistureContentPct).toBeCloseTo(0.3, 10);
    expect(result.nickelGradePct).toBeCloseTo(0.018, 10);
    expect(result.reductantBiocokePct).toBeCloseTo(0.08, 10);
    expect(result.powerMixCaptiveCoal).toBeCloseTo(0.7, 10);
    expect(result.powerMixHydroGrid).toBeCloseTo(0.3, 10);
    expect(result.reductionTarget).toBeCloseTo(0.15, 10);
  });
});

describe("computeImpliedIntensity", () => {
  it("divides cap by ore tonnage", () => {
    expect(computeImpliedIntensity(120000, 10000)).toBeCloseTo(12, 10);
  });

  it("is null with no ore tonnage entered yet", () => {
    expect(computeImpliedIntensity(120000, 0)).toBeNull();
  });

  it("is null for negative tonnage", () => {
    expect(computeImpliedIntensity(120000, -5)).toBeNull();
  });

  it("is null for a non-finite cap", () => {
    expect(computeImpliedIntensity(NaN, 10000)).toBeNull();
  });
});

describe("candidateDisplayValue", () => {
  it("passes an unreadable candidate through as null -- never guessed", () => {
    expect(candidateDisplayValue(null, true)).toBeNull();
    expect(candidateDisplayValue(null, false)).toBeNull();
  });

  it("converts a percentage-field fraction to a displayed percentage", () => {
    expect(candidateDisplayValue(0.72, true)).toBeCloseTo(72, 10);
  });

  it("leaves a non-percentage field unchanged", () => {
    expect(candidateDisplayValue(450, false)).toBe(450);
  });
});
