import { describe, expect, it } from "vitest";
import {
  buildEmissionInput,
  buildOperationalInput,
  buildPartialProductionMonthInputs,
  EMPTY_TWIN_FORM,
  formatSiteSpecValue,
  hydrateOperationalFormFromInputs,
  NODE_FIELDS,
  NODE_FOR_FIELD,
  NODE_ORDER,
  nodeEmissionContribution,
  parseEmissionError,
  POWER_MIX_INCOMPLETE_MESSAGE,
  powerMixSummary,
  SITE_SPEC_EDIT_LABEL,
  toNumber,
  validateTwinForm,
  type SiteSpecFieldDescriptor,
  type TwinFormState,
} from "./twin";
import type { Company, EmissionResult } from "@/types/emissions";

// The exact table from `app/ingestion/mapping.py`'s `NODE_FOR_FIELD`,
// snake_case, converted 1:1 to the camelCase wire name it serializes to.
// Kept as a literal (not imported from anywhere) so this test fails loudly
// if `lib/twin.ts`'s table ever drifts from the backend's.
const BACKEND_NODE_FOR_FIELD: Record<string, string> = {
  wetOreInputTons: "stockpile",
  moistureContentPct: "stockpile",
  nickelGradePct: "stockpile",
  dryerThermalEfficiency: "dryer",
  reductantBiocokePct: "kiln",
  secEafKwhPerTAlloy: "eaf",
  powerMixCaptiveCoal: "pltu",
  powerMixHydroGrid: "pltu",
  efCaptivePltu: "pltu",
};

describe("NODE_FOR_FIELD matches app/ingestion/mapping.py exactly", () => {
  it("has exactly the same 9 fields", () => {
    expect(Object.keys(NODE_FOR_FIELD).sort()).toEqual(
      Object.keys(BACKEND_NODE_FOR_FIELD).sort(),
    );
  });

  it("maps every field to the same node as the backend", () => {
    for (const [field, node] of Object.entries(BACKEND_NODE_FOR_FIELD)) {
      expect(NODE_FOR_FIELD[field as keyof typeof NODE_FOR_FIELD]).toBe(node);
    }
  });

  it("every NODE_FIELDS descriptor converts to the same node in NODE_FOR_FIELD -- operational fields via candidateField, site-spec fields via companyKey", () => {
    // snake_case -> camelCase, the same conversion `to_camel` performs on
    // the backend (none of these 9 names contain a digit, so the "letter
    // after a digit" special case the schemas.py docstring warns about
    // never applies here).
    const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const node of NODE_ORDER) {
      for (const field of NODE_FIELDS[node]) {
        const wireField = field.kind === "operational" ? toCamel(field.candidateField) : field.companyKey;
        expect(NODE_FOR_FIELD[wireField as keyof typeof NODE_FOR_FIELD]).toBe(node);
      }
    }
  });

  it("exactly three fields are site-spec values, the rest are editable operational levers", () => {
    const allFields = NODE_ORDER.flatMap((node) => NODE_FIELDS[node]);
    const siteSpecKeys = allFields
      .filter((f) => f.kind === "siteSpec")
      .map((f) => f.companyKey)
      .sort();
    expect(siteSpecKeys).toEqual(["dryerThermalEfficiency", "efCaptivePltu", "secEafKwhPerTAlloy"].sort());
    expect(allFields.filter((f) => f.kind === "operational")).toHaveLength(6);
  });
});

const OPERATIONAL_FORM: TwinFormState = {
  wetOreInputTons: "10000",
  moistureContentPercent: "32",
  nickelGradePercent: "1.8",
  reductantBiocokePercent: "8",
  powerMixCaptiveCoalPercent: "70",
  powerMixHydroGridPercent: "30",
  dryerThermalEfficiencyPercent: "55",
  secEafKwhPerTAlloy: "2400",
  efCaptivePltu: "1",
};

const COMPANY_A: Company = {
  name: "PT Contoh Smelter",
  technology: "RKEF",
  efCaptivePltu: 1.0,
  dryerThermalEfficiency: 0.55,
  secEafKwhPerTAlloy: 2400,
  alloyNickelGrade: 0.21,
  kilnThermalEfficiency: 0.65,
  capTco2e: 120000,
};

// A second, distinctly-valued company -- used to prove `buildEmissionInput`
// tracks whichever `Company` it's given rather than some hidden default,
// and that the three site-spec numbers in its output come from nowhere
// else.
const COMPANY_B: Company = {
  ...COMPANY_A,
  efCaptivePltu: 0.42,
  dryerThermalEfficiency: 0.61,
  secEafKwhPerTAlloy: 3100,
};

describe("buildEmissionInput sources site-spec fields only from Company -- never from form state", () => {
  it("the six operational fields come from form, converted to fractions where applicable", () => {
    const result = buildEmissionInput(OPERATIONAL_FORM, COMPANY_A);
    expect(result.wetOreInputTons).toBe(10000);
    expect(result.moistureContentPct).toBeCloseTo(0.32, 10);
    expect(result.nickelGradePct).toBeCloseTo(0.018, 10);
    expect(result.reductantBiocokePct).toBeCloseTo(0.08, 10);
    expect(result.powerMixCaptiveCoal).toBeCloseTo(0.7, 10);
    expect(result.powerMixHydroGrid).toBeCloseTo(0.3, 10);
  });

  it("the three site-spec fields come from Company verbatim, unconverted", () => {
    const result = buildEmissionInput(OPERATIONAL_FORM, COMPANY_A);
    expect(result.secEafKwhPerTAlloy).toBe(COMPANY_A.secEafKwhPerTAlloy);
    expect(result.efCaptivePltu).toBe(COMPANY_A.efCaptivePltu);
    expect(result.dryerThermalEfficiency).toBe(COMPANY_A.dryerThermalEfficiency);
  });

  it("swapping the Company changes the three site-spec fields with the operational form held identical -- proving there is no other source for them", () => {
    const resultA = buildEmissionInput(OPERATIONAL_FORM, COMPANY_A);
    const resultB = buildEmissionInput(OPERATIONAL_FORM, COMPANY_B);
    expect(resultB.secEafKwhPerTAlloy).toBe(COMPANY_B.secEafKwhPerTAlloy);
    expect(resultB.efCaptivePltu).toBe(COMPANY_B.efCaptivePltu);
    expect(resultB.dryerThermalEfficiency).toBe(COMPANY_B.dryerThermalEfficiency);
    expect(resultB.secEafKwhPerTAlloy).not.toBe(resultA.secEafKwhPerTAlloy);
    expect(resultB.efCaptivePltu).not.toBe(resultA.efCaptivePltu);
    expect(resultB.dryerThermalEfficiency).not.toBe(resultA.dryerThermalEfficiency);
    // The six operational fields are untouched by the company swap.
    expect(resultB.wetOreInputTons).toBe(resultA.wetOreInputTons);
    expect(resultB.moistureContentPct).toBe(resultA.moistureContentPct);
  });

  it("site-spec form keys exist for UI editing, but buildEmissionInput still reads those three from Company only", () => {
    // Form holds display strings for the twin panel; the emissions payload
    // must still come from the stored company (what POST /runs uses).
    const formKeys = Object.keys(EMPTY_TWIN_FORM);
    expect(formKeys).toContain("dryerThermalEfficiencyPercent");
    expect(formKeys).toContain("secEafKwhPerTAlloy");
    expect(formKeys).toContain("efCaptivePltu");
    const drifted: TwinFormState = {
      ...OPERATIONAL_FORM,
      dryerThermalEfficiencyPercent: "99",
      secEafKwhPerTAlloy: "9999",
      efCaptivePltu: "9",
    };
    const result = buildEmissionInput(drifted, COMPANY_A);
    expect(result.dryerThermalEfficiency).toBe(COMPANY_A.dryerThermalEfficiency);
    expect(result.secEafKwhPerTAlloy).toBe(COMPANY_A.secEafKwhPerTAlloy);
    expect(result.efCaptivePltu).toBe(COMPANY_A.efCaptivePltu);
  });

  it("throws RangeError (never returns) on an out-of-range operational percentage", () => {
    expect(() =>
      buildEmissionInput({ ...OPERATIONAL_FORM, moistureContentPercent: "150" }, COMPANY_A),
    ).toThrow(RangeError);
  });

  it("throws RangeError on an empty (NaN) operational percentage field", () => {
    expect(() =>
      buildEmissionInput({ ...OPERATIONAL_FORM, nickelGradePercent: "" }, COMPANY_A),
    ).toThrow(RangeError);
  });
});

describe("buildOperationalInput", () => {
  it("carries only the six daily levers -- structurally cannot carry a site-spec field", () => {
    const result = buildOperationalInput(OPERATIONAL_FORM);
    expect(result.wetOreInputTons).toBe(10000);
    expect(result.moistureContentPct).toBeCloseTo(0.32, 10);
    expect(result.nickelGradePct).toBeCloseTo(0.018, 10);
    expect(result.reductantBiocokePct).toBeCloseTo(0.08, 10);
    expect(result.powerMixCaptiveCoal).toBeCloseTo(0.7, 10);
    expect(result.powerMixHydroGrid).toBeCloseTo(0.3, 10);
    expect(result).not.toHaveProperty("dryerThermalEfficiency");
    expect(result).not.toHaveProperty("secEafKwhPerTAlloy");
    expect(result).not.toHaveProperty("efCaptivePltu");
  });
});

describe("formatSiteSpecValue", () => {
  const dryerField: SiteSpecFieldDescriptor = NODE_FIELDS.dryer.find(
    (f): f is SiteSpecFieldDescriptor => f.kind === "siteSpec",
  )!;
  const eafField: SiteSpecFieldDescriptor = NODE_FIELDS.eaf.find(
    (f): f is SiteSpecFieldDescriptor => f.kind === "siteSpec",
  )!;

  it("converts a fraction to a percentage and glues the % sign", () => {
    expect(formatSiteSpecValue(dryerField, COMPANY_A)).toBe("55%");
  });

  it("leaves a non-percent field's number as-is with a space-separated unit", () => {
    expect(formatSiteSpecValue(eafField, COMPANY_A)).toBe("2.400 kWh/ton alloy");
  });
});

describe("SITE_SPEC_EDIT_LABEL", () => {
  it("is the fixed Indonesian link text pointing back to onboarding", () => {
    expect(SITE_SPEC_EDIT_LABEL).toBe("Ubah di profil perusahaan");
  });
});

describe("toNumber", () => {
  it("parses a numeric string", () => {
    expect(toNumber("32")).toBe(32);
  });
  it("is NaN for an empty/in-progress field, not 0", () => {
    expect(Number.isNaN(toNumber(""))).toBe(true);
    expect(Number.isNaN(toNumber("   "))).toBe(true);
  });
});

describe("validateTwinForm", () => {
  it("is null for a fully valid form", () => {
    expect(validateTwinForm(OPERATIONAL_FORM)).toBeNull();
  });

  it("names the first invalid field in node order", () => {
    const result = validateTwinForm({ ...OPERATIONAL_FORM, wetOreInputTons: "-1" });
    expect(result).toMatch(/Bijih basah masuk/);
  });

  it("rejects the empty form without throwing", () => {
    expect(() => validateTwinForm(EMPTY_TWIN_FORM)).not.toThrow();
    expect(validateTwinForm(EMPTY_TWIN_FORM)).not.toBeNull();
  });
});

describe("powerMixSummary", () => {
  it("is incomplete below 100%, reporting the exact remainder", () => {
    const summary = powerMixSummary(85, 0);
    expect(summary.recordedPercent).toBe(85);
    expect(summary.remainderPercent).toBe(15);
    expect(summary.complete).toBe(false);
  });

  it("is complete at exactly 100%", () => {
    const summary = powerMixSummary(70, 30);
    expect(summary.remainderPercent).toBeCloseTo(0, 10);
    expect(summary.complete).toBe(true);
  });

  it("tolerates float rounding at the 100% boundary", () => {
    const summary = powerMixSummary(33.33, 66.67);
    expect(summary.complete).toBe(true);
  });

  it("treats a non-finite (still-being-typed) share as 0, not NaN", () => {
    const summary = powerMixSummary(NaN, 40);
    expect(summary.recordedPercent).toBe(40);
    expect(Number.isNaN(summary.recordedPercent)).toBe(false);
  });
});

const SAMPLE_RESULT: EmissionResult = {
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

describe("nodeEmissionContribution", () => {
  it("is null before any live result exists", () => {
    for (const node of NODE_ORDER) {
      expect(nodeEmissionContribution(node, null)).toBeNull();
    }
  });

  it("attributes stockpile 0 -- it has no combustion of its own", () => {
    expect(nodeEmissionContribution("stockpile", SAMPLE_RESULT)).toBe(0);
  });

  it("attributes dryer/kiln/eaf their own emission fields", () => {
    expect(nodeEmissionContribution("dryer", SAMPLE_RESULT)).toBe(10);
    expect(nodeEmissionContribution("kiln", SAMPLE_RESULT)).toBe(25); // heat + reductant
    expect(nodeEmissionContribution("eaf", SAMPLE_RESULT)).toBe(40);
  });

  // NOTE (per review): this only checks that a hand-built fixture is
  // internally consistent with itself -- SAMPLE_RESULT's four distinct
  // components happen to sum to its own totalEmissions because both were
  // typed in by hand to agree. It cannot catch a real double-count
  // regression (e.g. if `nodeEmissionContribution` were changed to add
  // `eafEmissions` into `totalEmissions` a second time somewhere), because
  // nothing here computes `totalEmissions` independently from the
  // components the way `calculate_emissions` does on the backend. Treat
  // this as documentation of the current attribution choice, not a safety
  // net against that class of bug.
  it("attributes pltu the same Scope 2 figure as eaf (documentation, not a regression safety net -- see note above)", () => {
    expect(nodeEmissionContribution("pltu", SAMPLE_RESULT)).toBe(40);
    const sumOfDistinctComponents =
      SAMPLE_RESULT.dryerEmissions + SAMPLE_RESULT.kilnHeatEmissions +
      SAMPLE_RESULT.kilnReductantEmissions + SAMPLE_RESULT.eafEmissions;
    expect(sumOfDistinctComponents).toBe(SAMPLE_RESULT.totalEmissions);
  });
});

describe("parseEmissionError", () => {
  function errorFor(body: unknown): Error {
    return new Error(JSON.stringify(body));
  }

  it("maps a field-level 422 to the field's node via NODE_FOR_FIELD", () => {
    const err = errorFor({
      detail: [
        {
          type: "less_than_equal",
          loc: ["body", "moistureContentPct"],
          msg: "Input should be less than or equal to 1",
          ctx: { le: 1.0 },
        },
      ],
    });
    expect(parseEmissionError(err)).toEqual({
      node: "stockpile",
      message: expect.any(String),
    });
  });

  it("never surfaces the raw pydantic English message", () => {
    const err = errorFor({
      detail: [{ loc: ["body", "secEafKwhPerTAlloy"], msg: "Input should be a valid number" }],
    });
    const result = parseEmissionError(err);
    expect(result?.message).not.toMatch(/Input should be/);
  });

  it("routes the whole-model power-mix error (loc = ['body'], no field) to pltu", () => {
    const err = errorFor({
      detail: [
        {
          type: "value_error",
          loc: ["body"],
          msg: "Value error, power mix shares must sum to 1, got captive 0.6 + hydro/grid 0.25 = 0.85",
        },
      ],
    });
    expect(parseEmissionError(err)).toEqual({
      node: "pltu",
      message: POWER_MIX_INCOMPLETE_MESSAGE,
    });
  });

  it("is null for a non-Error, non-JSON, or unrecognisable body", () => {
    expect(parseEmissionError("not an error")).toBeNull();
    expect(parseEmissionError(new Error("plain text, not JSON"))).toBeNull();
    expect(parseEmissionError(new Error(JSON.stringify({ nothing: "here" })))).toBeNull();
  });

  it("is null for a network-failure Error (no detail body at all)", () => {
    expect(parseEmissionError(new TypeError("Failed to fetch"))).toBeNull();
  });
});

describe("production-month hydrate and partial draft", () => {
  it("hydrates fractions into percent form strings and blanks missing keys", () => {
    const form = hydrateOperationalFormFromInputs({
      wetOreInputTons: 9000,
      moistureContentPct: 0.32,
      powerMixCaptiveCoal: 0.7,
    });
    expect(form.wetOreInputTons).toBe("9000");
    expect(form.moistureContentPercent).toBe("32");
    expect(form.powerMixCaptiveCoalPercent).toBe("70");
    expect(form.nickelGradePercent).toBe("");
    expect(form.powerMixHydroGridPercent).toBe("");
  });

  it("builds a partial PUT payload, skipping blank and out-of-range fields", () => {
    const partial = buildPartialProductionMonthInputs({
      ...EMPTY_TWIN_FORM,
      wetOreInputTons: "5000",
      moistureContentPercent: "30",
      powerMixCaptiveCoalPercent: "40",
      // hydro left blank — incomplete mix must still autosave
    });
    expect(partial).toEqual({
      wetOreInputTons: 5000,
      moistureContentPct: 0.3,
      powerMixCaptiveCoal: 0.4,
    });
  });
});
