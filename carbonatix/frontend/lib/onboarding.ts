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
