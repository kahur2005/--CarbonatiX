import { describe, expect, it } from "vitest";
import {
  ensureLineRenderable,
  sliceByTimeframe,
  TIMEFRAME_POINTS,
} from "./forecastTimeframe";

describe("forecastTimeframe", () => {
  const series = Array.from({ length: 30 }, (_, i) => i + 1);

  it("slices trailing windows for 1d / 1w / 1m", () => {
    expect(sliceByTimeframe(series, "1d")).toEqual([30]);
    expect(sliceByTimeframe(series, "1w")).toHaveLength(TIMEFRAME_POINTS["1w"]);
    expect(sliceByTimeframe(series, "1w")?.[0]).toBe(24);
    expect(sliceByTimeframe(series, "1m")).toEqual(series);
  });

  it("returns the full series when shorter than the window", () => {
    expect(sliceByTimeframe([1, 2, 3], "1w")).toEqual([1, 2, 3]);
  });

  it("duplicates a lone point so a line chart can render", () => {
    expect(ensureLineRenderable([42])).toEqual([42, 42]);
    expect(ensureLineRenderable([1, 2])).toEqual([1, 2]);
  });
});
