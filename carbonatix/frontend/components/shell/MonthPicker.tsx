"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { listProductionMonths } from "@/lib/api";
import { formatPeriodLabel, listPeriods } from "@/lib/period";
import { useSelectedPeriod } from "./PeriodProvider";
import { useTheme } from "./ThemeProvider";
import { Mono } from "./primitives";

export default function MonthPicker() {
  const { colors: C, theme } = useTheme();
  const { selectedPeriod, setSelectedPeriod } = useSelectedPeriod();
  const [open, setOpen] = useState(false);
  const [savedPeriods, setSavedPeriods] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const chipBg = theme === "light" ? "#F1F5F9" : C.border;
  const periods = listPeriods();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listProductionMonths();
        if (cancelled) return;
        setSavedPeriods(
          new Set(rows.filter((r) => r.hasInputs).map((r) => r.period)),
        );
      } catch {
        if (!cancelled) setSavedPeriods(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriod, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Pilih bulan produksi"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-opacity hover:opacity-80"
        style={{
          background: chipBg,
          border: `1px solid ${C.border}`,
          color: C.text,
          fontFamily: "var(--font-mono), monospace",
        }}
      >
        <CalendarDays size={12} color={C.cyan} />
        <Mono className="text-[11px]" style={{ color: C.text }}>
          {formatPeriodLabel(selectedPeriod)}
        </Mono>
        <ChevronDown size={11} color={C.dimText} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Bulan produksi"
          className="absolute right-0 z-50 mt-1 max-h-64 w-52 overflow-y-auto rounded-md py-1 shadow-lg"
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
          }}
        >
          {[...periods].reverse().map((period) => {
            const active = period === selectedPeriod;
            const hasInputs = savedPeriods.has(period);
            return (
              <button
                key={period}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setSelectedPeriod(period);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] transition-opacity hover:opacity-80"
                style={{
                  background: active ? `${C.cyan}18` : "transparent",
                  color: active ? C.cyan : C.text,
                  fontFamily: "var(--font-mono), monospace",
                }}
              >
                <span>{formatPeriodLabel(period)}</span>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background: hasInputs ? C.cyan : "transparent",
                    border: hasInputs ? "none" : `1px solid ${C.border}`,
                  }}
                  title={hasInputs ? "Ada data tersimpan" : "Belum ada data"}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
