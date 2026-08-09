import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentPeriod,
  formatPeriodLabel,
  isPeriodInRange,
  listPeriods,
  parsePeriod,
} from "./period";

afterEach(() => {
  vi.useRealTimers();
});

describe("period helpers", () => {
  it("lists Januari 2025 through the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15)); // March 2026
    const periods = listPeriods();
    expect(periods[0]).toBe("2025-01");
    expect(periods.at(-1)).toBe("2026-03");
    expect(periods).toContain("2025-12");
    expect(periods).not.toContain("2026-04");
  });

  it("formats Indonesian month labels", () => {
    expect(formatPeriodLabel("2025-01")).toBe("Januari 2025");
    expect(formatPeriodLabel("2026-08")).toBe("Agustus 2026");
  });

  it("rejects malformed and out-of-range periods", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 10));
    expect(parsePeriod("2025-13")).toBeNull();
    expect(isPeriodInRange("2024-12")).toBe(false);
    expect(isPeriodInRange("2026-02")).toBe(false);
    expect(isPeriodInRange("2026-01")).toBe(true);
    expect(currentPeriod()).toBe("2026-01");
  });
});
