"use client";

import {
  FORECAST_TIMEFRAMES,
  type ForecastTimeframe,
} from "@/lib/forecastTimeframe";
import { useTheme } from "@/components/shell/ThemeProvider";

export default function TimeframeToggle({
  value,
  onChange,
}: {
  value: ForecastTimeframe;
  onChange: (next: ForecastTimeframe) => void;
}) {
  const { colors: C } = useTheme();

  return (
    <div
      className="flex gap-1"
      role="group"
      aria-label="Rentang waktu grafik"
    >
      {FORECAST_TIMEFRAMES.map((tf) => {
        const active = value === tf.id;
        return (
          <button
            key={tf.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tf.id)}
            className="rounded px-2 py-1 text-[10px] font-bold tracking-wider transition-opacity hover:opacity-80"
            style={{
              background: active ? `${C.cyan}22` : "transparent",
              border: `1px solid ${active ? C.cyan : C.border}`,
              color: active ? C.cyan : C.muted,
              fontFamily: "var(--font-mono), monospace",
            }}
          >
            {tf.label}
          </button>
        );
      })}
    </div>
  );
}
