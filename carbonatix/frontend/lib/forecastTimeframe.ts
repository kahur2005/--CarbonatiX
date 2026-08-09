/** Window sizes for slicing a daily forecast snapshot on the dashboard. */

export type ForecastTimeframe = "1d" | "1w" | "1m";

export const FORECAST_TIMEFRAMES: readonly {
  id: ForecastTimeframe;
  label: string;
}[] = [
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
] as const;

/** How many trailing daily points each window keeps. */
export const TIMEFRAME_POINTS: Record<ForecastTimeframe, number> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
};

/** Keep the last N points for the selected window (whole series if shorter). */
export function sliceByTimeframe<T>(items: T[], timeframe: ForecastTimeframe): T[] {
  if (items.length === 0) return items;
  const n = TIMEFRAME_POINTS[timeframe];
  if (items.length <= n) return items;
  return items.slice(-n);
}

/**
 * For a single remaining point (typical `1d` on a daily series), duplicate
 * it so the Area chart still draws a short horizontal segment rather than
 * a blank plot.
 */
export function ensureLineRenderable<T>(items: T[]): T[] {
  if (items.length === 1) return [items[0], items[0]];
  return items;
}
