"use client";

import Link from "next/link";
import { useTheme } from "./ThemeProvider";
import { DummyBadge, Mono } from "./primitives";

export default function AppFooter({
  disclosure,
}: {
  disclosure?: string;
}) {
  const { colors: C } = useTheme();

  return (
    <footer
      className="sticky bottom-0 z-20 flex shrink-0 items-center justify-between gap-4 px-5"
      style={{
        height: 40,
        background: C.headerBg,
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Mono className="truncate text-[10px]" style={{ color: C.muted }}>
          {disclosure ?? "SmartSmelt ERP — angka emisi dari neraca massa deterministik; harga & sitasi dapat berlabel provisional."}
        </Mono>
      </div>
      <div className="flex items-center gap-2">
        <DummyBadge />
        <Link
          href="/workflow"
          className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-bold tracking-wider transition-opacity hover:opacity-80"
          style={{
            background: `${C.violet}18`,
            border: `1px solid ${C.violet}44`,
            color: C.violet,
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          Layer 1 → 2 → 3
        </Link>
      </div>
    </footer>
  );
}
