import { describe, expect, it } from "vitest";
import { toFraction, toPercent } from "./units";

describe("the single percent<->fraction boundary", () => {
  it("converts a displayed percentage to an API fraction", () => {
    expect(toFraction(32)).toBeCloseTo(0.32, 10);
    expect(toFraction(1.8)).toBeCloseTo(0.018, 10);
    expect(toFraction(100)).toBeCloseTo(1.0, 10);
    expect(toFraction(0)).toBe(0);
  });

  it("converts an API fraction back for display", () => {
    expect(toPercent(0.32)).toBeCloseTo(32, 10);
  });

  it("round-trips", () => {
    for (const p of [0, 1.8, 25, 32, 99.9, 100]) {
      expect(toPercent(toFraction(p))).toBeCloseTo(p, 10);
    }
  });

  it("rejects NaN rather than passing it to the API", () => {
    expect(() => toFraction(NaN)).toThrow();
  });

  it("rejects percentages above 100", () => {
    expect(() => toFraction(101)).toThrow();
  });
});
