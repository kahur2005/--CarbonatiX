"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Flame,
  MapPin,
  Moon,
  Settings,
  Sun,
  User,
  Wifi,
} from "lucide-react";
import MonthPicker from "./MonthPicker";
import { useTheme } from "./ThemeProvider";
import { Mono } from "./primitives";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/twin", label: "Digital Twin" },
  { href: "/workflow", label: "AI Workflow" },
  { href: "/onboarding", label: "Site Spec" },
] as const;

export default function AppHeader({
  facilityName,
}: {
  facilityName?: string | null;
}) {
  const { theme, colors: C, toggleTheme } = useTheme();
  const pathname = usePathname();
  const chipBg = theme === "light" ? "#F1F5F9" : C.border;
  const facility = facilityName?.trim() || "Belum dikonfigurasi";

  return (
    <header
      className="flex shrink-0 items-center justify-between px-5"
      style={{
        height: 48,
        background: C.headerBg,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded"
            style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.violet})` }}
          >
            <Flame size={12} color="#fff" />
          </div>
          <span
            className="text-sm font-bold tracking-wider"
            style={{
              color: C.text,
              fontFamily: "var(--font-display), sans-serif",
              fontSize: 15,
            }}
          >
            SmartSmelt <span style={{ color: C.cyan }}>ERP</span>
          </span>
        </Link>

        <div className="h-4 w-px" style={{ background: C.border }} />

        <div
          className="flex items-center gap-2 rounded px-3 py-1 text-xs"
          style={{
            background: chipBg,
            border: `1px solid ${C.border}`,
            color: C.dimText,
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          <MapPin size={11} color={C.green} />
          <span>Facility: {facility}</span>
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest"
            style={{
              background: `${C.green}22`,
              color: C.green,
              border: `1px solid ${C.green}44`,
            }}
          >
            ACTIVE
          </span>
          <ChevronDown size={11} />
        </div>

        <nav className="ml-2 flex items-center gap-1">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-80"
                style={{
                  color: active ? C.cyan : C.dimText,
                  background: active ? `${C.cyan}18` : "transparent",
                  border: `1px solid ${active ? `${C.cyan}44` : "transparent"}`,
                  fontFamily: "var(--font-mono), monospace",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <MonthPicker />
        <div className="flex items-center gap-1.5">
          <Wifi size={12} color={C.green} />
          <Mono className="text-[11px]" style={{ color: C.green }}>
            SYNCED
          </Mono>
        </div>
        <div className="h-4 w-px" style={{ background: C.border }} />
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === "dark" ? "Mode terang" : "Mode gelap"}
          className="flex h-7 w-7 items-center justify-center rounded transition-opacity hover:opacity-70"
          style={{ background: chipBg, border: `1px solid ${C.border}` }}
        >
          {theme === "dark" ? (
            <Sun size={13} color={C.amber} />
          ) : (
            <Moon size={13} color={C.violet} />
          )}
        </button>
        <button
          type="button"
          title="Pengaturan (belum tersedia)"
          className="flex h-7 w-7 items-center justify-center rounded transition-opacity hover:opacity-70"
          style={{ background: chipBg, border: `1px solid ${C.border}` }}
        >
          <Settings size={13} color={C.dimText} />
        </button>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{ background: `linear-gradient(135deg, ${C.violet}, ${C.cyan})` }}
        >
          <User size={13} color="#fff" />
        </div>
      </div>
    </header>
  );
}
