/**
 * Field-to-node mapping and form helpers for the digital twin (`app/twin`).
 *
 * `NODE_FOR_FIELD` below must match `NODE_FOR_FIELD` in
 * `carbonatix/backend/app/ingestion/mapping.py` **exactly** -- field for
 * field, node for node -- because the OCR pipeline routes candidates by that
 * table (`Candidate.node`) and this table is what the twin uses to decide
 * which node's panel a given wire field lives on. The backend table is
 * keyed by the snake_case Python field name; this one is keyed by the
 * camelCase wire name each snake_case field serializes to (confirmed against
 * `EmissionRequest`'s actual 422 `loc` values, e.g. `moisture_content_pct`
 * always appears on the wire, and in error bodies, as `moistureContentPct`
 * -- see `parseEmissionError` below). The two tables are the same mapping
 * expressed in the two languages either side of the wire speaks.
 *
 * Percentage <-> fraction conversion always goes through `toFraction` /
 * `toPercent` from `lib/units.ts` -- nothing here divides or multiplies by
 * 100 directly.
 */

import { toFraction, toPercent } from "./units";
import {
  CAP_HELPER_RANGES,
  SITE_SPEC_RANGES,
  validateFields,
  type FieldRange,
} from "./onboarding";
import type {
  Company,
  CompanyInput,
  EmissionInput,
  EmissionResult,
  OperationalInput,
  ProductionMonthInputs,
} from "@/types/emissions";

export const NODE_ORDER = ["stockpile", "dryer", "kiln", "eaf", "pltu"] as const;
export type NodeId = (typeof NODE_ORDER)[number];

export const NODE_LABELS: Record<NodeId, string> = {
  stockpile: "Stockpile Bijih",
  dryer: "Dryer",
  kiln: "Kiln",
  eaf: "Electric Arc Furnace (EAF)",
  pltu: "PLTU Captive",
};

/** Mirrors `NODE_FOR_FIELD` in `app/ingestion/mapping.py` field-for-field
 * (9 entries, same 5 nodes) -- see module docstring for the camelCase
 * correspondence. `test_ingestion.py` guards the backend side; nothing
 * currently guards these two tables staying in sync with each other beyond
 * this comment and `lib/twin.test.ts`'s parseEmissionError coverage, so a
 * change to one must be mirrored in the other by hand. */
export const NODE_FOR_FIELD: Record<keyof EmissionInput, NodeId> = {
  wetOreInputTons: "stockpile",
  moistureContentPct: "stockpile",
  nickelGradePct: "stockpile",
  dryerThermalEfficiency: "dryer",
  reductantBiocokePct: "kiln",
  secEafKwhPerTAlloy: "eaf",
  powerMixCaptiveCoal: "pltu",
  powerMixHydroGrid: "pltu",
  efCaptivePltu: "pltu",
};

/** Twin form state, held as the raw string each input shows -- same
 * convention as `SiteSpecFormValues`/`HelperState` in the onboarding page,
 * so an in-progress or empty entry is never a stray `NaN`. Percentage
 * fields are held as percentages (0-100), matching what's rendered.
 *
 * Six daily operational levers plus three site-spec values. Site-spec edits
 * are flushed to `PUT /company` before they affect preview/commit (see
 * `buildCompanyInputFromTwin`); `buildEmissionInput` still reads those
 * three from `Company` so the live preview cannot diverge from what
 * `POST /runs` persists. */
export interface TwinFormState {
  wetOreInputTons: string;
  moistureContentPercent: string;
  nickelGradePercent: string;
  reductantBiocokePercent: string;
  powerMixCaptiveCoalPercent: string;
  powerMixHydroGridPercent: string;
  dryerThermalEfficiencyPercent: string;
  secEafKwhPerTAlloy: string;
  efCaptivePltu: string;
}

export type SiteSpecFormKey =
  | "dryerThermalEfficiencyPercent"
  | "secEafKwhPerTAlloy"
  | "efCaptivePltu";

export const EMPTY_TWIN_FORM: TwinFormState = {
  wetOreInputTons: "",
  moistureContentPercent: "",
  nickelGradePercent: "",
  reductantBiocokePercent: "",
  powerMixCaptiveCoalPercent: "",
  powerMixHydroGridPercent: "",
  dryerThermalEfficiencyPercent: "",
  secEafKwhPerTAlloy: "",
  efCaptivePltu: "",
};

interface FieldDisplayMeta {
  label: string;
  unit?: string;
  isPercent: boolean;
}

/** A daily operational lever: editable, backed by a `TwinFormState` key,
 * OCR-able (`candidateField` matches `Candidate.field` / the backend's
 * `FIELDS_BY_PROFILE["operational"]`), and range-checked client-side
 * (reusing `CAP_HELPER_RANGES` from `lib/onboarding.ts` rather than
 * re-declaring backend bounds a second time). */
export interface OperationalFieldDescriptor extends FieldDisplayMeta {
  kind: "operational";
  key: keyof TwinFormState;
  candidateField: string;
  range: FieldRange;
}

/**
 * A site-spec value editable on the twin. Edits live in `TwinFormState` and
 * are persisted with `PUT /company` (`buildCompanyInputFromTwin`) before
 * `buildEmissionInput` / `POST /runs` see them -- those paths still read
 * only from the stored `Company`, so a mid-edit draft cannot make the
 * preview disagree with the committed run.
 */
export interface SiteSpecFieldDescriptor extends FieldDisplayMeta {
  kind: "siteSpec";
  key: SiteSpecFormKey;
  companyKey: "dryerThermalEfficiency" | "secEafKwhPerTAlloy" | "efCaptivePltu";
  range: FieldRange;
}

export type TwinFieldDescriptor = OperationalFieldDescriptor | SiteSpecFieldDescriptor;

export const SITE_SPEC_EDIT_LABEL = "Ubah di profil perusahaan";
export const SITE_SPEC_SAVE_HINT =
  "Perubahan disimpan ke profil perusahaan agar pratinjau sama dengan hasil commit.";

const STOCKPILE_FIELDS: TwinFieldDescriptor[] = [
  {
    kind: "operational",
    key: "wetOreInputTons",
    candidateField: "wet_ore_input_tons",
    label: "Bijih basah masuk",
    unit: "ton",
    isPercent: false,
    range: CAP_HELPER_RANGES.wetOreInputTons,
  },
  {
    kind: "operational",
    key: "moistureContentPercent",
    candidateField: "moisture_content_pct",
    label: "Kadar air",
    unit: "%",
    isPercent: true,
    range: CAP_HELPER_RANGES.moistureContentPercent,
  },
  {
    kind: "operational",
    key: "nickelGradePercent",
    candidateField: "nickel_grade_pct",
    label: "Kadar nikel bijih",
    unit: "%",
    isPercent: true,
    range: CAP_HELPER_RANGES.nickelGradePercent,
  },
];

const DRYER_FIELDS: TwinFieldDescriptor[] = [
  {
    kind: "siteSpec",
    key: "dryerThermalEfficiencyPercent",
    companyKey: "dryerThermalEfficiency",
    label: "Efisiensi termal dryer",
    unit: "%",
    isPercent: true,
    range: SITE_SPEC_RANGES.dryerThermalEfficiencyPercent,
  },
];

const KILN_FIELDS: TwinFieldDescriptor[] = [
  {
    kind: "operational",
    key: "reductantBiocokePercent",
    candidateField: "reductant_biocoke_pct",
    label: "Reduktan biocoke",
    unit: "%",
    isPercent: true,
    range: CAP_HELPER_RANGES.reductantBiocokePercent,
  },
];

const EAF_FIELDS: TwinFieldDescriptor[] = [
  {
    kind: "siteSpec",
    key: "secEafKwhPerTAlloy",
    companyKey: "secEafKwhPerTAlloy",
    label: "Energi spesifik EAF",
    unit: "kWh/ton alloy",
    isPercent: false,
    range: SITE_SPEC_RANGES.secEafKwhPerTAlloy,
  },
];

const PLTU_FIELDS: TwinFieldDescriptor[] = [
  {
    kind: "operational",
    key: "powerMixCaptiveCoalPercent",
    candidateField: "power_mix_captive_coal",
    label: "Bauran daya - captive coal",
    unit: "%",
    isPercent: true,
    range: CAP_HELPER_RANGES.powerMixCaptiveCoalPercent,
  },
  {
    kind: "operational",
    key: "powerMixHydroGridPercent",
    candidateField: "power_mix_hydro_grid",
    label: "Bauran daya - hidro/grid",
    unit: "%",
    isPercent: true,
    range: CAP_HELPER_RANGES.powerMixHydroGridPercent,
  },
  {
    kind: "siteSpec",
    key: "efCaptivePltu",
    companyKey: "efCaptivePltu",
    label: "Faktor emisi PLTU captive",
    unit: "tCO2e/MWh",
    isPercent: false,
    range: SITE_SPEC_RANGES.efCaptivePltu,
  },
];

/** The field table from the task brief, expressed as data: every one of
 * the 9 inputs, grouped under the one node it belongs to. Six are
 * daily operational levers; three are site-spec (editable here, persisted
 * via `PUT /company`). */
export const NODE_FIELDS: Record<NodeId, TwinFieldDescriptor[]> = {
  stockpile: STOCKPILE_FIELDS,
  dryer: DRYER_FIELDS,
  kiln: KILN_FIELDS,
  eaf: EAF_FIELDS,
  pltu: PLTU_FIELDS,
};

/** True when the node has at least one daily operational lever. */
export function nodeHasOperationalInput(node: NodeId): boolean {
  return NODE_FIELDS[node].some((f) => f.kind === "operational");
}

const ALL_FIELDS: TwinFieldDescriptor[] = NODE_ORDER.flatMap((node) => NODE_FIELDS[node]);

const OPERATIONAL_FIELDS: OperationalFieldDescriptor[] = ALL_FIELDS.filter(
  (f): f is OperationalFieldDescriptor => f.kind === "operational",
);

const SITE_SPEC_FIELDS: SiteSpecFieldDescriptor[] = ALL_FIELDS.filter(
  (f): f is SiteSpecFieldDescriptor => f.kind === "siteSpec",
);

/** Candidate.field (snake_case, the OCR wire value) -> this form's field
 * key. Built only from the six operational descriptors: the three
 * site-spec fields are read-only and have no `TwinFormState` key to land
 * in even if a document somehow reported one (it never does -- they're
 * outside `FIELDS_BY_PROFILE["operational"]` in `app/ingestion/mapping.py`,
 * only reachable via the onboarding page's `site_spec` upload). */
export const CANDIDATE_FIELD_TO_FORM_KEY: Record<string, keyof TwinFormState> = Object.fromEntries(
  OPERATIONAL_FIELDS.map((f) => [f.candidateField, f.key]),
);

/** The six operational fields' display metadata, keyed by OCR candidate
 * field -- passed to each node panel's `UploadDropzone` so a candidate is
 * labelled correctly no matter which node's upload tab it surfaces under
 * (the backend's `profile=operational` extraction is not itself
 * node-scoped: uploading from the kiln panel can still return stockpile
 * candidates). */
export const OPERATIONAL_FIELD_LABELS: Record<
  string,
  { label: string; unit: string; isPercent: boolean }
> = Object.fromEntries(
  OPERATIONAL_FIELDS.map((f) => [
    f.candidateField,
    { label: f.label, unit: f.unit ?? "", isPercent: f.isPercent },
  ]),
);

const TWIN_RANGES: Record<keyof TwinFormState, FieldRange> = Object.fromEntries(
  OPERATIONAL_FIELDS.map((f) => [f.key, f.range]),
) as Record<keyof TwinFormState, FieldRange>;

/** Empty string in, `NaN` out -- same convention `app/onboarding/page.tsx`
 * uses so an in-progress or blank field is never coerced into `0`. */
export function toNumber(value: string): number {
  return value.trim() === "" ? NaN : Number(value);
}

/** Validates the six operational fields in node order (stockpile, kiln,
 * pltu), reusing `validateFields`/`CAP_HELPER_RANGES` from
 * `lib/onboarding.ts` rather than a second bounds table. The three
 * site-spec fields are not part of this check -- they're read-only,
 * sourced from a `Company` the backend already validated when it was
 * saved (`PUT /company`). Returns the first Indonesian error message, or
 * `null` if every field is in range. */
export function validateTwinForm(form: TwinFormState): string | null {
  return validateFields(
    OPERATIONAL_FIELDS.map((f) => [toNumber(form[f.key]), TWIN_RANGES[f.key]] as [number, FieldRange]),
  );
}

/** Seeds the three site-spec form strings from a fetched `Company`. */
export function seedSiteSpecForm(company: Company): Pick<TwinFormState, SiteSpecFormKey> {
  return {
    dryerThermalEfficiencyPercent: String(toPercent(company.dryerThermalEfficiency)),
    secEafKwhPerTAlloy: String(company.secEafKwhPerTAlloy),
    efCaptivePltu: String(company.efCaptivePltu),
  };
}

/** Client-side range check for the three twin site-spec inputs. */
export function validateSiteSpecTwinForm(form: TwinFormState): string | null {
  return validateFields(
    SITE_SPEC_FIELDS.map(
      (f) => [toNumber(form[f.key]), f.range] as [number, FieldRange],
    ),
  );
}

/** True when the form's site-spec strings match the stored company
 * (numeric compare so "55" vs "55.0" is not treated as dirty). */
export function siteSpecMatchesCompany(form: TwinFormState, company: Company): boolean {
  const dryer = toNumber(form.dryerThermalEfficiencyPercent);
  const sec = toNumber(form.secEafKwhPerTAlloy);
  const ef = toNumber(form.efCaptivePltu);
  if (![dryer, sec, ef].every(Number.isFinite)) return false;
  return (
    Math.abs(toFraction(dryer) - company.dryerThermalEfficiency) < 1e-9 &&
    Math.abs(sec - company.secEafKwhPerTAlloy) < 1e-9 &&
    Math.abs(ef - company.efCaptivePltu) < 1e-9
  );
}

/** Full `PUT /company` payload: edited twin site-spec + unchanged company
 * identity / alloy / kiln / cap fields. */
export function buildCompanyInputFromTwin(
  form: TwinFormState,
  company: Company,
): CompanyInput {
  return {
    name: company.name,
    technology: company.technology,
    efCaptivePltu: toNumber(form.efCaptivePltu),
    dryerThermalEfficiency: toFraction(toNumber(form.dryerThermalEfficiencyPercent)),
    secEafKwhPerTAlloy: toNumber(form.secEafKwhPerTAlloy),
    alloyNickelGrade: company.alloyNickelGrade,
    kilnThermalEfficiency: company.kilnThermalEfficiency,
    capTco2e: company.capTco2e,
  };
}

/** Local `Company` after a successful site-spec save (mirrors the PUT body). */
export function applySiteSpecFormToCompany(
  form: TwinFormState,
  company: Company,
): Company {
  return buildCompanyInputFromTwin(form, company);
}

/** Formats a site-spec field from company for display helpers/tests. */
export function formatSiteSpecValue(field: SiteSpecFieldDescriptor, company: Company): string {
  const raw = company[field.companyKey];
  const displayNumber = field.isPercent ? toPercent(raw) : raw;
  const formatted = displayNumber.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  const unitSuffix = !field.unit ? "" : field.unit === "%" ? field.unit : ` ${field.unit}`;
  return `${formatted}${unitSuffix}`;
}

/** Builds the `POST /emissions` payload. Operational levers come from the
 * twin form; the three site-spec fields come **only** from `company`
 * (after `PUT /company` has flushed form edits). That keeps this payload
 * identical to what `runs.commit` will compute from the stored row. */
export function buildEmissionInput(form: TwinFormState, company: Company): EmissionInput {
  return {
    wetOreInputTons: toNumber(form.wetOreInputTons),
    moistureContentPct: toFraction(toNumber(form.moistureContentPercent)),
    nickelGradePct: toFraction(toNumber(form.nickelGradePercent)),
    reductantBiocokePct: toFraction(toNumber(form.reductantBiocokePercent)),
    powerMixCaptiveCoal: toFraction(toNumber(form.powerMixCaptiveCoalPercent)),
    powerMixHydroGrid: toFraction(toNumber(form.powerMixHydroGridPercent)),
    secEafKwhPerTAlloy: company.secEafKwhPerTAlloy,
    efCaptivePltu: company.efCaptivePltu,
    dryerThermalEfficiency: company.dryerThermalEfficiency,
  };
}

/** Builds the `POST /runs` payload -- the six daily operational levers
 * only. Site-spec is read server-side from the stored company profile. */
export function buildOperationalInput(form: TwinFormState): OperationalInput {
  return {
    wetOreInputTons: toNumber(form.wetOreInputTons),
    moistureContentPct: toFraction(toNumber(form.moistureContentPercent)),
    nickelGradePct: toFraction(toNumber(form.nickelGradePercent)),
    reductantBiocokePct: toFraction(toNumber(form.reductantBiocokePercent)),
    powerMixCaptiveCoal: toFraction(toNumber(form.powerMixCaptiveCoalPercent)),
    powerMixHydroGrid: toFraction(toNumber(form.powerMixHydroGridPercent)),
  };
}

type OperationalFormKey =
  | "wetOreInputTons"
  | "moistureContentPercent"
  | "nickelGradePercent"
  | "reductantBiocokePercent"
  | "powerMixCaptiveCoalPercent"
  | "powerMixHydroGridPercent";

/** Maps a stored production-month draft (fractions) onto twin form strings
 * (percentages for `*Pct` / power-mix fields). Missing keys stay blank. */
export function hydrateOperationalFormFromInputs(
  inputs: ProductionMonthInputs,
): Pick<TwinFormState, OperationalFormKey> {
  const pct = (fraction: number | undefined): string => {
    if (fraction === undefined || !Number.isFinite(fraction)) return "";
    return String(toPercent(fraction));
  };
  const tons = (value: number | undefined): string => {
    if (value === undefined || !Number.isFinite(value)) return "";
    return String(value);
  };
  return {
    wetOreInputTons: tons(inputs.wetOreInputTons),
    moistureContentPercent: pct(inputs.moistureContentPct),
    nickelGradePercent: pct(inputs.nickelGradePct),
    reductantBiocokePercent: pct(inputs.reductantBiocokePct),
    powerMixCaptiveCoalPercent: pct(inputs.powerMixCaptiveCoal),
    powerMixHydroGridPercent: pct(inputs.powerMixHydroGrid),
  };
}

/** Partial draft for autosave. Only finite, in-range fields are included so
 * mid-edit incomplete mixes survive without failing the PUT. */
export function buildPartialProductionMonthInputs(
  form: TwinFormState,
): ProductionMonthInputs {
  const out: ProductionMonthInputs = {};
  const wet = toNumber(form.wetOreInputTons);
  if (Number.isFinite(wet) && wet >= 0) out.wetOreInputTons = wet;

  const tryPct = (raw: string): number | undefined => {
    const n = toNumber(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
    return toFraction(n);
  };

  const moisture = tryPct(form.moistureContentPercent);
  if (moisture !== undefined) out.moistureContentPct = moisture;
  const nickel = tryPct(form.nickelGradePercent);
  if (nickel !== undefined) out.nickelGradePct = nickel;
  const biocoke = tryPct(form.reductantBiocokePercent);
  if (biocoke !== undefined) out.reductantBiocokePct = biocoke;
  const captive = tryPct(form.powerMixCaptiveCoalPercent);
  if (captive !== undefined) out.powerMixCaptiveCoal = captive;
  const hydro = tryPct(form.powerMixHydroGridPercent);
  if (hydro !== undefined) out.powerMixHydroGrid = hydro;
  return out;
}

/** The power-mix remainder: the hydro/grid share never enters the emission
 * arithmetic (see `calculate_emissions`'s docstring), so an unaccounted
 * share is invisible -- a plant with a 15% diesel genset would otherwise
 * look identical to a fully-accounted one. `recordedPercent` is the sum of
 * both shares as currently entered; `complete` uses the same 0.01 epsilon
 * as the onboarding page's own power-mix check and the backend's
 * `abs(total - 1.0) > 1e-9` (at percentage scale, not fraction scale, so a
 * looser tolerance is appropriate here -- entering "30" and "70" must read
 * as complete, not off by a float rounding hair). */
export interface PowerMixSummary {
  recordedPercent: number;
  remainderPercent: number;
  complete: boolean;
}

export function powerMixSummary(captivePercent: number, hydroPercent: number): PowerMixSummary {
  const captive = Number.isFinite(captivePercent) ? captivePercent : 0;
  const hydro = Number.isFinite(hydroPercent) ? hydroPercent : 0;
  const recordedPercent = captive + hydro;
  const remainderPercent = 100 - recordedPercent;
  return {
    recordedPercent,
    remainderPercent,
    complete: Math.abs(remainderPercent) <= 0.01,
  };
}

export const POWER_MIX_INCOMPLETE_MESSAGE = "Bauran daya harus berjumlah 100%.";

/**
 * The tCO2e attributed to one node's floating label, or `null` when there's
 * no live result yet. `EmissionResult` has no per-node breakdown -- only
 * `dryerEmissions`, `kilnHeatEmissions`, `kilnReductantEmissions` and
 * `eafEmissions` -- so this is where that breakdown is assigned to the
 * twin's five process stages:
 *
 * - `stockpile` has no combustion of its own (it's the mass-balance
 *   source: wet ore in, dry ore and nickel content out), so it always
 *   reads 0.
 * - `dryer` / `kiln` map directly onto their own emission fields (the kiln
 *   carries both its heat and reductant emissions, since the reductant is
 *   fed into the kiln for the reduction reaction).
 * - `eaf` and `pltu` both read `eafEmissions` (all of Scope 2): the EAF's
 *   demand (`secEafKwhPerTAlloy`) and the PLTU's supply (power mix, its
 *   emission factor) jointly determine this single figure, and the
 *   combustion that actually produces it happens at the captive power
 *   plant, not the furnace. Showing it on both nodes is a deliberate
 *   choice to keep it visible from wherever a viewer is looking, not a
 *   double-count: `totalEmissions` (the summary figure) still sums each
 *   component exactly once.
 */
export function nodeEmissionContribution(node: NodeId, result: EmissionResult | null): number | null {
  if (!result) return null;
  switch (node) {
    case "stockpile":
      return 0;
    case "dryer":
      return result.dryerEmissions;
    case "kiln":
      return result.kilnHeatEmissions + result.kilnReductantEmissions;
    case "eaf":
      return result.eafEmissions;
    case "pltu":
      return result.eafEmissions;
  }
}

// ---- 422 -> node mapping --------------------------------------------------

interface BackendFieldError {
  type?: string;
  loc?: unknown[];
  msg?: string;
}

/** A field-level 422's message is never shown verbatim (it's the pydantic
 * English sentence, e.g. "Input should be less than or equal to 1") --
 * this is the Indonesian text attached to the node instead. */
export const FIELD_ERROR_MESSAGE = "Nilai di luar rentang yang diizinkan untuk kolom ini.";

/**
 * Parses a `POST /emissions` (or `/runs`) 422 body -- the `Error` thrown by
 * `lib/api.ts`'s `postEmissions`/`postRun`, whose `.message` is the raw
 * response text -- into the node it belongs to and an Indonesian message,
 * or `null` if the error isn't a recognisable validation body (a network
 * failure, a non-422 error, malformed JSON).
 *
 * Two shapes are handled, both observed directly against the running
 * backend (`app/errors.py`'s handler, `EmissionRequest`'s validators):
 *
 * 1. A field-level error: `detail[].loc` ends in the wire field name
 *    (camelCase, e.g. `"moistureContentPct"`), resolved via
 *    `NODE_FOR_FIELD`.
 * 2. The power-mix model-level validator: `detail[].loc` is `["body"]`
 *    (no field -- it's a whole-model check, not tied to one field) and
 *    `msg` contains "power mix". Routed to `pltu`, since both fields behind
 *    that check live there.
 *
 * Never returns the raw `msg` text -- only the two fixed Indonesian
 * messages above -- so an English pydantic sentence can never reach this
 * Bahasa Indonesia UI.
 */
export function parseEmissionError(err: unknown): { node: NodeId; message: string } | null {
  if (!(err instanceof Error)) return null;
  let body: unknown;
  try {
    body = JSON.parse(err.message);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || !("detail" in body)) return null;
  const detail = (body as { detail: unknown }).detail;
  if (!Array.isArray(detail)) return null;
  const errors = detail as BackendFieldError[];

  for (const e of errors) {
    const loc = Array.isArray(e.loc) ? e.loc : [];
    for (let i = loc.length - 1; i >= 0; i--) {
      const segment = loc[i];
      if (typeof segment === "string" && segment in NODE_FOR_FIELD) {
        return { node: NODE_FOR_FIELD[segment as keyof EmissionInput], message: FIELD_ERROR_MESSAGE };
      }
    }
  }

  for (const e of errors) {
    if (typeof e.msg === "string" && e.msg.toLowerCase().includes("power mix")) {
      return { node: "pltu", message: POWER_MIX_INCOMPLETE_MESSAGE };
    }
  }

  return null;
}
