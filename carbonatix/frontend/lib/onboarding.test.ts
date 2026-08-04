import { describe, expect, it } from "vitest";
import {
  buildCompanyInput,
  buildSuggestCapInput,
  candidateDisplayValue,
  CAP_HELPER_RANGES,
  computeImpliedIntensity,
  SITE_SPEC_RANGES,
  validateFields,
  validateRange,
  type CapHelperFormValues,
  type FieldRange,
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

describe("validateRange", () => {
  const inclusive: FieldRange = { label: "Kadar air", unit: "%", min: 0, max: 100 };
  const exclusiveMin: FieldRange = {
    label: "Efisiensi termal dryer",
    unit: "%",
    min: 0,
    minExclusive: true,
    max: 100,
  };
  const exclusiveMax: FieldRange = {
    label: "Target penurunan dari baseline",
    unit: "%",
    min: 0,
    max: 100,
    maxExclusive: true,
  };

  it("accepts a value within an inclusive range, including both endpoints", () => {
    expect(validateRange(0, inclusive)).toBeNull();
    expect(validateRange(100, inclusive)).toBeNull();
    expect(validateRange(50, inclusive)).toBeNull();
  });

  it("names the field and range in an Indonesian message when out of range", () => {
    expect(validateRange(150, inclusive)).toBe('"Kadar air" harus maksimal 100%.');
    expect(validateRange(-1, inclusive)).toBe('"Kadar air" harus minimal 0%.');
  });

  it("rejects a non-finite value with an Indonesian message, never a raw exception string", () => {
    expect(validateRange(NaN, inclusive)).toBe('Isi "Kadar air" dengan angka yang valid.');
  });

  it("rejects exactly the exclusive-min boundary (the finding-2 case: 0% dryer efficiency)", () => {
    expect(validateRange(0, exclusiveMin)).toBe(
      '"Efisiensi termal dryer" harus lebih dari 0%.',
    );
    expect(validateRange(0.0001, exclusiveMin)).toBeNull();
  });

  it("rejects exactly the exclusive-max boundary (100% reduction target)", () => {
    expect(validateRange(100, exclusiveMax)).toBe(
      '"Target penurunan dari baseline" harus kurang dari 100%.',
    );
    expect(validateRange(99.9, exclusiveMax)).toBeNull();
  });
});

describe("validateFields", () => {
  it("returns the first failing field's message, not a later one", () => {
    const result = validateFields([
      [50, { label: "A", min: 0, max: 100 }],
      [150, { label: "B", min: 0, max: 100 }],
      [-1, { label: "C", min: 0, max: 100 }],
    ]);
    expect(result).toBe('"B" harus maksimal 100.');
  });

  it("returns null when every field is in range", () => {
    const result = validateFields([
      [50, { label: "A", min: 0, max: 100 }],
      [0, { label: "B", min: 0, max: 100 }],
    ]);
    expect(result).toBeNull();
  });
});

describe("SITE_SPEC_RANGES / CAP_HELPER_RANGES reject the finding-2 zero case", () => {
  it("rejects 0% for every field the backend requires strictly > 0", () => {
    expect(validateRange(0, SITE_SPEC_RANGES.dryerThermalEfficiencyPercent)).not.toBeNull();
    expect(validateRange(0, SITE_SPEC_RANGES.alloyNickelGradePercent)).not.toBeNull();
    expect(validateRange(0, SITE_SPEC_RANGES.kilnThermalEfficiencyPercent)).not.toBeNull();
  });

  it("accepts 0 for fields the backend allows to be zero", () => {
    expect(validateRange(0, SITE_SPEC_RANGES.efCaptivePltu)).toBeNull();
    expect(validateRange(0, SITE_SPEC_RANGES.secEafKwhPerTAlloy)).toBeNull();
    expect(validateRange(0, SITE_SPEC_RANGES.capTco2e)).toBeNull();
    expect(validateRange(0, CAP_HELPER_RANGES.wetOreInputTons)).toBeNull();
    expect(validateRange(0, CAP_HELPER_RANGES.moistureContentPercent)).toBeNull();
  });

  it("rejects a 100% reduction target but accepts anything strictly below it", () => {
    expect(validateRange(100, CAP_HELPER_RANGES.reductionTargetPercent)).not.toBeNull();
    expect(validateRange(99, CAP_HELPER_RANGES.reductionTargetPercent)).toBeNull();
  });
});
