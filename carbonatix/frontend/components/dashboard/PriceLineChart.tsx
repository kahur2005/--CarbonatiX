"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/components/shell/ThemeProvider";

export type PriceLinePoint = {
  t: string;
  price: number;
};

/** IDX-style filled line chart — one currency series, no volume bars. */
export default function PriceLineChart({
  data,
  formatValue,
  accent,
}: {
  data: PriceLinePoint[];
  formatValue: (value: number) => string;
  /** Stroke / fill accent; defaults to theme cyan. */
  accent?: string;
}) {
  const { colors: C } = useTheme();
  const stroke = accent ?? C.cyan;

  if (data.length === 0) {
    return (
      <div
        className="flex h-[160px] w-full items-center justify-center text-[11px]"
        style={{ color: C.muted }}
      >
        Tidak ada data proyeksi.
      </div>
    );
  }

  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
          <XAxis dataKey="t" tick={{ fill: C.muted, fontSize: 9 }} />
          <YAxis
            tick={{ fill: C.muted, fontSize: 9 }}
            domain={["auto", "auto"]}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: C.card,
              border: `1px solid ${C.border}`,
              fontSize: 11,
            }}
            formatter={(value) =>
              typeof value === "number" ? [formatValue(value), "Harga"] : [value, "Harga"]
            }
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={stroke}
            fill={`${stroke}22`}
            name="price"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
