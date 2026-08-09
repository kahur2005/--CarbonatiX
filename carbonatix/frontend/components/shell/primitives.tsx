"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "./ThemeProvider";

export function Label({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { colors: C } = useTheme();
  return (
    <span
      className={`text-[10px] font-medium uppercase tracking-wider ${className}`}
      style={{ color: C.muted, fontFamily: "var(--font-mono), monospace" }}
    >
      {children}
    </span>
  );
}

export function Mono({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{ fontFamily: "var(--font-mono), monospace", ...style }}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
  style,
  glowColor,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  glowColor?: string;
}) {
  const { colors: C } = useTheme();
  return (
    <div
      className={`rounded-lg ${className}`}
      style={{
        background: C.card,
        border: `1px solid ${glowColor ?? C.border}`,
        boxShadow: glowColor ? `0 0 16px 2px ${glowColor}40` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function DummyBadge({ className = "" }: { className?: string }) {
  const { colors: C } = useTheme();
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest ${className}`}
      style={{
        background: `${C.amber}22`,
        color: C.amber,
        border: `1px solid ${C.amber}55`,
        fontFamily: "var(--font-mono), monospace",
      }}
    >
      DUMMY
    </span>
  );
}

export function GlassPanel({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { colors: C } = useTheme();
  return (
    <div
      className={`rounded-xl backdrop-blur-md ${className}`}
      style={{
        background: C.glassBg,
        border: `1px solid ${C.border}`,
        boxShadow: C.glassShadow,
        color: C.text,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
