/** SmartSmelt industrial ops-console palette (ported from the layout demo). */

export type ThemeMode = "dark" | "light";

export type Palette = {
  bg: string;
  card: string;
  border: string;
  green: string;
  amber: string;
  red: string;
  cyan: string;
  violet: string;
  text: string;
  muted: string;
  dimText: string;
  panel: string;
  mapBg: string;
  sceneA: string;
  sceneB: string;
  sceneC: string;
  steelA: string;
  steelB: string;
  towerA: string;
  towerB: string;
  steam: string;
  struct: string;
  glbLabelBg: string;
  glassBg: string;
  glassShadow: string;
  headerBg: string;
};

export const darkPalette: Palette = {
  bg: "#0B0F17",
  card: "#131B2A",
  border: "#212F46",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#EF4444",
  cyan: "#06B6D4",
  violet: "#8B5CF6",
  text: "#F8FAFC",
  muted: "#64748B",
  dimText: "#94A3B8",
  panel: "#0D1420",
  mapBg: "#0A1628",
  sceneA: "#16233B",
  sceneB: "#0B0F17",
  sceneC: "#05070C",
  steelA: "#2B3B57",
  steelB: "#141E30",
  towerA: "#33455F",
  towerB: "#1A2740",
  steam: "#4B5B78",
  struct: "#22314B",
  glbLabelBg: "rgba(11,15,23,0.7)",
  glassBg: "rgba(19, 27, 42, 0.72)",
  glassShadow: "0 8px 32px rgba(0,0,0,0.45)",
  headerBg: "#0D1320",
};

export const lightPalette: Palette = {
  bg: "#F1F5F9",
  card: "#FFFFFF",
  border: "#E2E8F0",
  green: "#059669",
  amber: "#D97706",
  red: "#DC2626",
  cyan: "#0891B2",
  violet: "#7C3AED",
  text: "#0F172A",
  muted: "#64748B",
  dimText: "#475569",
  panel: "#F1F5F9",
  mapBg: "#E8EEF6",
  sceneA: "#DCE6F2",
  sceneB: "#EEF3FA",
  sceneC: "#FFFFFF",
  steelA: "#B8C6DC",
  steelB: "#94A6C2",
  towerA: "#C4D2E6",
  towerB: "#A0B2CC",
  steam: "#CBD5E1",
  struct: "#AEBFD6",
  glbLabelBg: "rgba(255,255,255,0.78)",
  glassBg: "rgba(255, 255, 255, 0.78)",
  glassShadow: "0 8px 32px rgba(15, 23, 42, 0.16)",
  headerBg: "#FFFFFF",
};

export function paletteFor(mode: ThemeMode): Palette {
  return mode === "dark" ? darkPalette : lightPalette;
}

/** Apply CSS custom properties used by Tailwind / component styles. */
export function applyPaletteVars(palette: Palette, root: HTMLElement = document.documentElement) {
  root.style.setProperty("--sm-bg", palette.bg);
  root.style.setProperty("--sm-card", palette.card);
  root.style.setProperty("--sm-border", palette.border);
  root.style.setProperty("--sm-green", palette.green);
  root.style.setProperty("--sm-amber", palette.amber);
  root.style.setProperty("--sm-red", palette.red);
  root.style.setProperty("--sm-cyan", palette.cyan);
  root.style.setProperty("--sm-violet", palette.violet);
  root.style.setProperty("--sm-text", palette.text);
  root.style.setProperty("--sm-muted", palette.muted);
  root.style.setProperty("--sm-dim", palette.dimText);
  root.style.setProperty("--sm-panel", palette.panel);
  root.style.setProperty("--sm-header", palette.headerBg);
  root.style.setProperty("--background", palette.bg);
  root.style.setProperty("--foreground", palette.text);
}
