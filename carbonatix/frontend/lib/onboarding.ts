/**
 * Pure helpers for the onboarding / site-specification form.
 *
 * Percentage <-> fraction conversion always goes through `toFraction` /
 * `toPercent` from `lib/units.ts` -- nothing in this file divides or
 * multiplies by 100 directly. See that module's docstring for why.
 */

import { toFraction, toPercent } from "./units";
import type { CompanyInput, SuggestCapInput } from "@/types/emissions";

/**
 * Site-spec form state as the user edits it. Percentage-valued fields are
 * held as percentages (0-100), matching what's rendered on screen --
 * exactly the fields `lib/units.ts` names as percentage-valued:
 * `dryerThermalEfficiency`, `alloyNickelGrade`, `kilnThermalEfficiency`.
 */
export interface SiteSpecFormValues {
  name: string;
  technology: string;
  efCaptivePltu: number;
  dryerThermalEfficiencyPercent: number;
  secEafKwhPerTAlloy: number;
  alloyNickelGradePercent: number;
  kilnThermalEfficiencyPercent: number;
  capTco2e: number;
}

/**
 * Builds the `PUT /company` payload. The only place this form's percentage
 * fields become fractions -- via `toFraction`, never a bare `/ 100`.
 */
export function buildCompanyInput(form: SiteSpecFormValues): CompanyInput {
  return {
    name: form.name,
    technology: form.technology,
    efCaptivePltu: form.efCaptivePltu,
    dryerThermalEfficiency: toFraction(form.dryerThermalEfficiencyPercent),
    secEafKwhPerTAlloy: form.secEafKwhPerTAlloy,
    alloyNickelGrade: toFraction(form.alloyNickelGradePercent),
    kilnThermalEfficiency: toFraction(form.kilnThermalEfficiencyPercent),
    capTco2e: form.capTco2e,
  };
}

/**
 * The "Hitung dari baseline" panel's inputs: a nominal operational interval
 * plus a reduction target. Percentage fields are held as percentages, as
 * displayed.
 */
export interface CapHelperFormValues {
  wetOreInputTons: number;
  moistureContentPercent: number;
  nickelGradePercent: number;
  reductantBiocokePercent: number;
  powerMixCaptiveCoalPercent: number;
  powerMixHydroGridPercent: number;
  reductionTargetPercent: number;
}

/** Builds the `POST /company/suggest-cap` payload. */
export function buildSuggestCapInput(form: CapHelperFormValues): SuggestCapInput {
  return {
    wetOreInputTons: form.wetOreInputTons,
    moistureContentPct: toFraction(form.moistureContentPercent),
    nickelGradePct: toFraction(form.nickelGradePercent),
    reductantBiocokePct: toFraction(form.reductantBiocokePercent),
    powerMixCaptiveCoal: toFraction(form.powerMixCaptiveCoalPercent),
    powerMixHydroGrid: toFraction(form.powerMixHydroGridPercent),
    reductionTarget: toFraction(form.reductionTargetPercent),
  };
}

/**
 * The cap's implied intensity (tCO2e per wet-ore tonne), from the interval
 * entered in the baseline helper -- surfaced so an implausible absolute
 * allocation is visible on entry, not just at commit.
 *
 * `null` when there's nothing sensible to divide by: no ore tonnage
 * entered yet, a non-positive tonnage, or a non-finite cap.
 */
export function computeImpliedIntensity(
  capTco2e: number,
  wetOreInputTons: number,
): number | null {
  if (!Number.isFinite(capTco2e) || !Number.isFinite(wetOreInputTons)) return null;
  if (wetOreInputTons <= 0) return null;
  return capTco2e / wetOreInputTons;
}

/**
 * Converts an extracted OCR candidate's value into the unit the form
 * displays it in -- a percentage for percentage-valued fields, unchanged
 * otherwise. `null` in, `null` out: an unreadable candidate (`value ===
 * null`, rendered as "Tidak terbaca") is never coerced into a number.
 */
export function candidateDisplayValue(
  value: number | null,
  isPercent: boolean,
): number | null {
  if (value === null) return null;
  return isPercent ? toPercent(value) : value;
}

// ---- Client-side range validation, mirroring schemas.py's bounds --------
//
// The backend is still the source of truth and re-validates everything
// (see CompanyRequest / OperationalRequest / SuggestCapRequest in
// schemas.py); these bounds exist only so an out-of-range value is caught
// here, in Bahasa Indonesia, naming the field and its valid range --
// instead of surfacing the backend's English 422 detail text verbatim.
// `toFraction` (lib/units.ts) is the enforcement boundary for the 0-100
// percentage range; the `minExclusive`/`maxExclusive` bounds below add the
// *stricter* backend constraints (e.g. "> 0", "< 100") that toFraction
// alone does not know about.

export interface FieldRange {
  /** Indonesian field name, used verbatim in the generated message. */
  label: string;
  unit?: string;
  min: number;
  /** If true, `value` must be strictly greater than `min` (backend `gt=`). */
  minExclusive?: boolean;
  max?: number;
  /** If true, `value` must be strictly less than `max` (backend `lt=`). */
  maxExclusive?: boolean;
}

/**
 * Validates one numeric field against `range`. Returns an Indonesian
 * error message naming the field and the bound it violated, or `null` if
 * `value` is finite and within range.
 */
export function validateRange(value: number, range: FieldRange): string | null {
  // "%" reads naturally glued to the number ("100%"); every other unit
  // reads naturally as a separate word ("0 tCO2e/MWh").
  const unitSuffix = !range.unit ? "" : range.unit === "%" ? range.unit : ` ${range.unit}`;
  if (!Number.isFinite(value)) {
    return `Isi "${range.label}" dengan angka yang valid.`;
  }
  const belowMin = range.minExclusive ? value <= range.min : value < range.min;
  if (belowMin) {
    return range.minExclusive
      ? `"${range.label}" harus lebih dari ${range.min}${unitSuffix}.`
      : `"${range.label}" harus minimal ${range.min}${unitSuffix}.`;
  }
  if (range.max !== undefined) {
    const aboveMax = range.maxExclusive ? value >= range.max : value > range.max;
    if (aboveMax) {
      return range.maxExclusive
        ? `"${range.label}" harus kurang dari ${range.max}${unitSuffix}.`
        : `"${range.label}" harus maksimal ${range.max}${unitSuffix}.`;
    }
  }
  return null;
}

/**
 * Validates an ordered list of (value, range) pairs, returning the first
 * failure -- so the message a user sees corresponds to the first field on
 * the form that's wrong -- or `null` if every field is in range.
 */
export function validateFields(entries: [number, FieldRange][]): string | null {
  for (const [value, range] of entries) {
    const error = validateRange(value, range);
    if (error) return error;
  }
  return null;
}

/** Site-spec form ranges. `dryer_thermal_efficiency`, `alloy_nickel_grade`
 * and `kiln_thermal_efficiency` are `gt=0, le=1` in schemas.py -- a
 * fraction of exactly 0 divides by zero downstream in the emissions
 * calculator, so `minExclusive` here is load-bearing, not decorative. */
export const SITE_SPEC_RANGES: Record<
  Exclude<keyof SiteSpecFormValues, "name" | "technology">,
  FieldRange
> = {
  efCaptivePltu: { label: "Faktor emisi PLTU captive", unit: "tCO2e/MWh", min: 0 },
  dryerThermalEfficiencyPercent: {
    label: "Efisiensi termal dryer",
    unit: "%",
    min: 0,
    minExclusive: true,
    max: 100,
  },
  secEafKwhPerTAlloy: { label: "Energi spesifik EAF", unit: "kWh/ton alloy", min: 0 },
  alloyNickelGradePercent: {
    label: "Kadar nikel alloy",
    unit: "%",
    min: 0,
    minExclusive: true,
    max: 100,
  },
  kilnThermalEfficiencyPercent: {
    label: "Efisiensi termal kiln",
    unit: "%",
    min: 0,
    minExclusive: true,
    max: 100,
  },
  capTco2e: { label: "Kuota karbon", unit: "tCO2e", min: 0 },
};

/** Cap-helper panel ranges. `reduction_target` is `ge=0, lt=1` in
 * schemas.py -- 100% is not a valid reduction target, so `maxExclusive`
 * here is load-bearing too. */
export const CAP_HELPER_RANGES: Record<keyof CapHelperFormValues, FieldRange> = {
  wetOreInputTons: { label: "Bijih basah masuk", unit: "ton", min: 0 },
  moistureContentPercent: { label: "Kadar air", unit: "%", min: 0, max: 100 },
  nickelGradePercent: { label: "Kadar nikel bijih", unit: "%", min: 0, max: 100 },
  reductantBiocokePercent: { label: "Reduktan biocoke", unit: "%", min: 0, max: 100 },
  powerMixCaptiveCoalPercent: {
    label: "Bauran daya - captive coal",
    unit: "%",
    min: 0,
    max: 100,
  },
  powerMixHydroGridPercent: {
    label: "Bauran daya - hidro/grid",
    unit: "%",
    min: 0,
    max: 100,
  },
  reductionTargetPercent: {
    label: "Target penurunan dari baseline",
    unit: "%",
    min: 0,
    max: 100,
    maxExclusive: true,
  },
};
