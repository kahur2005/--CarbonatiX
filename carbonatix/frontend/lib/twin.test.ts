import { describe, expect, it } from "vitest";
import {
  buildEmissionInput,
  buildOperationalInput,
  EMPTY_TWIN_FORM,
  NODE_FIELDS,
  NODE_FOR_FIELD,
  NODE_ORDER,
  nodeEmissionContribution,
  parseEmissionError,
  POWER_MIX_INCOMPLETE_MESSAGE,
  powerMixSummary,
  toNumber,
  validateTwinForm,
  type TwinFormState,
} from "./twin";
import type { EmissionResult } from "@/types/emissions";

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

  it("every NODE_FIELDS descriptor's candidateField converts to the same node in NODE_FOR_FIELD", () => {
    // snake_case candidateField -> camelCase wire field, the same
    // conversion `to_camel` performs on the backend (none of these 9 names
    // contain a digit, so the "letter after a digit" special case the
    // schemas.py docstring warns about never applies here).
    const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const node of NODE_ORDER) {
      for (const field of NODE_FIELDS[node]) {
        const wireField = toCamel(field.candidateField);
        expect(NODE_FOR_FIELD[wireField as keyof typeof NODE_FOR_FIELD]).toBe(node);
      }
    }
  });
});

const FULL_FORM: TwinFormState = {
  wetOreInputTons: "10000",
  moistureContentPercent: "32",
  nickelGradePercent: "1.8",
  dryerThermalEfficiencyPercent: "55",
  reductantBiocokePercent: "8",
  secEafKwhPerTAlloy: "2400",
  powerMixCaptiveCoalPercent: "70",
  powerMixHydroGridPercent: "30",
  efCaptivePltu: "1.0",
};

describe("buildEmissionInput", () => {
  it("converts every percentage field to a fraction, leaves the rest as-is", () => {
    const result = buildEmissionInput(FULL_FORM);
    expect(result.wetOreInputTons).toBe(10000);
    expect(result.moistureContentPct).toBeCloseTo(0.32, 10);
    expect(result.nickelGradePct).toBeCloseTo(0.018, 10);
    expect(result.reductantBiocokePct).toBeCloseTo(0.08, 10);
    expect(result.powerMixCaptiveCoal).toBeCloseTo(0.7, 10);
    expect(result.powerMixHydroGrid).toBeCloseTo(0.3, 10);
    expect(result.secEafKwhPerTAlloy).toBe(2400);
    expect(result.efCaptivePltu).toBe(1.0);
    expect(result.dryerThermalEfficiency).toBeCloseTo(0.55, 10);
  });

  it("throws RangeError (never returns) on an out-of-range percentage", () => {
    expect(() =>
      buildEmissionInput({ ...FULL_FORM, moistureContentPercent: "150" }),
    ).toThrow(RangeError);
  });

  it("throws RangeError on an empty (NaN) percentage field", () => {
    expect(() => buildEmissionInput({ ...FULL_FORM, nickelGradePercent: "" })).toThrow(
      RangeError,
    );
  });
});

describe("buildOperationalInput", () => {
  it("carries only the six daily levers -- no site-spec field", () => {
    const result = buildOperationalInput(FULL_FORM);
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
    expect(validateTwinForm(FULL_FORM)).toBeNull();
  });

  it("names the first invalid field in node order", () => {
    const result = validateTwinForm({ ...FULL_FORM, wetOreInputTons: "-1" });
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

  it("attributes pltu the same Scope 2 figure as eaf -- not a double count of totalEmissions", () => {
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
