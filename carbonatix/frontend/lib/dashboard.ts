/**
 * Formatting, grouping and copy constants for the emission dashboard
 * (`app/dashboard`). Pure helpers only -- no fetching, no React.
 *
 * `lib/units.ts` remains the one place a percentage becomes a fraction;
 * nothing here does that conversion because nothing on this screen is a
 * percentage input. Every number below is either already a fraction (never
 * shown as one -- this screen shows tCO2e and currency, not process
 * percentages) or a plain magnitude/currency value.
 */

import type { EmissionResult } from "@/types/emissions";

// ---- tCO2e / currency formatting --------------------------------------

/** `Intl`-backed, id-ID locale throughout: dot thousands separator, comma
 * decimal -- matches every other number already on screen (see
 * `lib/twin.ts`'s `formatSiteSpecValue`, `app/twin/page.tsx`'s
 * `formatTco2e`). Large standalone figures (hero/stat-tile values) keep the
 * default proportional digit widths; this helper is also used in short
 * inline stats where that distinction doesn't matter. */
export function formatTco2e(value: number): string {
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO2e`;
}

const IDR_FORMATTER = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** `positionValueIdr` is always non-negative already (`abs(position) *
 * price` -- see `app/emissions/compliance.py`'s `assess`), so this never
 * needs a sign; the Surplus/Defisit word carries that instead. */
export function formatRupiah(value: number): string {
  return IDR_FORMATTER.format(value);
}

/**
 * `positionTco2e`'s sign is the backend's, not the intuitive one: **positive
 * means deficit** (credits must be bought), **negative means surplus**
 * (credits may be sold) -- see `CompliancePosition`'s docstring in
 * `app/emissions/compliance.py`. Never format this as a bare signed number;
 * always resolve it through `compliancePosition` below and pair the
 * magnitude with its Surplus/Defisit word, so the sign convention never has
 * to be intuited from a lone `+`/`-`.
 */
export type PositionSense = "surplus" | "deficit" | "onCap";

export interface CompliancePositionView {
  sense: PositionSense;
  label: string;
  magnitudeTco2e: string;
}

export function compliancePositionView(positionTco2e: number): CompliancePositionView {
  const sense: PositionSense = positionTco2e > 0 ? "deficit" : positionTco2e < 0 ? "surplus" : "onCap";
  const label = sense === "deficit" ? "Defisit" : sense === "surplus" ? "Surplus" : "Tepat pada batas";
  return {
    sense,
    label,
    magnitudeTco2e: `${Math.abs(positionTco2e).toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO2e`,
  };
}

const USD_PER_TON_FORMATTER = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});

/** LME nickel is always USD/ton -- the unit is part of the label, never
 * inferred, because this screen must never let a USD figure and an IDR
 * figure sit on the same axis or be mistaken for each other. */
export function formatUsdPerTon(value: number): string {
  return `USD ${USD_PER_TON_FORMATTER.format(value)}/ton`;
}

/** IDX Carbon is always IDR/ton -- see `formatUsdPerTon`. */
export function formatIdrPerTon(value: number): string {
  return `${IDR_FORMATTER.format(value)}/ton`;
}

/** `intensityPerTonneNi === null` means the interval tapped no nickel --
 * it still emitted (dried and calcined ore), so `0` would misreport it as
 * the best possible outcome. Every caller must render this em dash instead
 * of the raw number, and must attach `INTENSITY_NULL_TOOLTIP` wherever it
 * appears. */
export function formatIntensity(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 3 })} tCO2e/ton Ni`;
}

export const INTENSITY_NULL_TOOLTIP = "Tidak ada nikel yang di-tap pada interval ini.";

// ---- Driver clusters (EmissionBars) ------------------------------------

export type StageKey =
  | "dryerEmissions"
  | "kilnHeatEmissions"
  | "kilnReductantEmissions"
  | "eafEmissions";

export interface DriverStage {
  key: StageKey;
  label: string;
  /** CSS custom property (see `app/globals.css`'s `.viz-root` block) --
   * one of the four categorical slots, fixed order, never cycled. */
  colorVar: string;
}

export interface DriverGroup {
  id: "ore" | "nickel";
  label: string;
  stages: DriverStage[];
}

/**
 * The two-cluster grouping from the task brief: ore-driven stages
 * (`dryerEmissions`, `kilnHeatEmissions`) depend only on ore volume and
 * moisture, independent of nickel grade; nickel-driven stages
 * (`kilnReductantEmissions`, `eafEmissions`) don't. This is the fact that
 * explains why richer ore lowers intensity (a fixed ore-processing burden
 * spread over more metal) and why two plants with identical nickel output
 * can differ substantially -- a flat four-bar row loses that distinction
 * entirely, so every renderer of these four stages must use this grouping,
 * never a flat list.
 */
export const DRIVER_GROUPS: DriverGroup[] = [
  {
    id: "ore",
    label: "Digerakkan bijih",
    stages: [
      { key: "dryerEmissions", label: "Dryer", colorVar: "--chart-series-1" },
      { key: "kilnHeatEmissions", label: "Kiln (panas)", colorVar: "--chart-series-2" },
    ],
  },
  {
    id: "nickel",
    label: "Digerakkan nikel",
    stages: [
      { key: "kilnReductantEmissions", label: "Kiln (reduktan)", colorVar: "--chart-series-3" },
      { key: "eafEmissions", label: "EAF", colorVar: "--chart-series-4" },
    ],
  },
];

export const ALL_DRIVER_STAGES: DriverStage[] = DRIVER_GROUPS.flatMap((g) => g.stages);

export function stageValue(result: EmissionResult, stage: StageKey): number {
  return result[stage];
}

// ---- Standing disclosures ----------------------------------------------

export const PTBAE_DISCLOSURE =
  "PLTU captive saat ini berada di luar cakupan wajib PTBAE-PU. Status ini bersifat kesiapan regulasi, bukan pelanggaran hukum yang berlaku.";

export const STANDING_DISCLOSURES =
  "Biocoke dihitung nol-emisi (karbon biogenik). Share hidro dan grid dihitung nol-emisi. Konstanta proses adalah placeholder yang belum terkalibrasi.";

export const SYNTHETIC_PRICE_LABEL = "DATA SINTETIS — bukan harga pasar riil";

export const STALE_FORECAST_BANNER =
  "Proyeksi harga tidak tersedia. Menampilkan data terakhir.";
