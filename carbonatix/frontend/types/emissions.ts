/**
 * TypeScript mirror of the backend wire contract (see
 * `carbonatix/backend/app/schemas.py`). Field names below are the actual
 * JSON keys FastAPI emits -- not a guess at what pydantic's `to_camel`
 * alias generator would produce from the Python snake_case name.
 *
 * That distinction matters for every field containing "tco2e": to_camel
 * capitalizes the letter immediately following a digit, so
 * `to_camel("cap_tco2e")` produces `"capTco2E"` (capital E), not
 * `"capTco2e"`. schemas.py pins explicit aliases for `capTco2e`,
 * `projectedTco2e` and `positionTco2e` to avoid that, and the same
 * spelling is reproduced verbatim here -- do not "fix" the casing to look
 * more consistent with the rest of the file.
 *
 * Monetary field names always carry an explicit currency suffix
 * (`UsdPerTon`, `IdrPerTon`, `ValueIdr`). USD and IDR are never mixed in
 * one field, and this file must not introduce a field that mixes them.
 *
 * All `*Pct` fields and power-mix shares are fractions in [0, 1], never
 * percentages -- see `lib/units.ts` for the one place that conversion
 * happens.
 */

// ---- POST /emissions (EmissionRequest / EmissionResponse) ------------

/** One production interval. */
export interface EmissionInput {
  wetOreInputTons: number;
  moistureContentPct: number;
  nickelGradePct: number;
  reductantBiocokePct: number;
  powerMixCaptiveCoal: number;
  powerMixHydroGrid: number;
  secEafKwhPerTAlloy: number;
  efCaptivePltu: number;
  dryerThermalEfficiency: number;
}

export interface EmissionResult {
  nickelOutputTons: number;
  alloyOutputTons: number;
  dryerEmissions: number;
  kilnHeatEmissions: number;
  kilnReductantEmissions: number;
  eafEmissions: number;
  totalEmissions: number;
  scope1: number;
  scope2: number;
  intensityPerTonneNi: number | null;
  dryOreTons: number;
  dryerCoalTons: number;
  kilnCoalTons: number;
  reductantTons: number;
  eafMwh: number;
}

// ---- Compliance (CompliancePositionResponse) --------------------------

/** `capTco2e` / `projectedTco2e` / `positionTco2e` are pinned aliases in
 * schemas.py -- see the module docstring above. */
export interface CompliancePosition {
  capTco2e: number;
  projectedTco2e: number;
  positionTco2e: number;
  isCompliant: boolean;
  positionValueIdr: number;
}

// ---- /company (CompanyRequest / CompanyResponse) -----------------------

/** `capTco2e` is a pinned alias here too (CompanyRequest.cap_tco2e). */
export interface CompanyInput {
  name: string;
  technology: string;
  efCaptivePltu: number;
  dryerThermalEfficiency: number;
  secEafKwhPerTAlloy: number;
  alloyNickelGrade: number;
  kilnThermalEfficiency: number;
  capTco2e: number;
}

export type Company = CompanyInput;

// ---- /runs, /company/suggest-cap (OperationalRequest / SuggestCapRequest) --

/** Per-interval levers; site-spec values come from the stored company. */
export interface OperationalInput {
  wetOreInputTons: number;
  moistureContentPct: number;
  nickelGradePct: number;
  reductantBiocokePct: number;
  powerMixCaptiveCoal: number;
  powerMixHydroGrid: number;
}

export interface SuggestCapInput extends OperationalInput {
  reductionTarget: number;
}

/** POST /company/suggest-cap's response is a plain dict, not a pydantic
 * model, but its two keys are already camelCase on the wire. */
export interface SuggestCapResult {
  capTco2e: number;
  baselineTco2e: number;
}

// ---- /runs/{id} (RunResponse) ------------------------------------------

export interface RunResult {
  id: string;
  result: EmissionResult;
  compliance: CompliancePosition;
  forecastSnapshot: ForecastSnapshot;
  createdAt: string;
}

// ---- /forecasts (app/forecasting/service.py's current_forecast) --------

/** Raw provenance metadata for one price series. `synthetic` is the flag a
 * consumer must check before rendering any value in this series as if it
 * were real market data -- see the backend module docstring for why. */
export interface PriceProvenance {
  synthetic: boolean;
  warning?: string;
  [key: string]: unknown;
}

export interface ForecastSnapshot {
  dates: string[];
  lmeUsdPerTon: number[];
  lmeUsdPerTonLower: number[];
  lmeUsdPerTonUpper: number[];
  idxCarbonIdrPerTon: number[];
  idxCarbonIdrPerTonLower: number[];
  idxCarbonIdrPerTonUpper: number[];
  stale: boolean;
  /** True if either price series may originate from fabricated training
   * data. Must be checked before any value here is presented as real. */
  synthetic: boolean;
  provenance: {
    lmeUsdPerTon: PriceProvenance;
    idxCarbonIdrPerTon: PriceProvenance;
  };
}

// ---- POST /documents (CandidateResponse / DocumentExtractionResponse) --

/** One extracted field awaiting user review. Deliberately carries no
 * "accepted" flag -- mirrors `Candidate` in the backend's
 * `app/ingestion/mapping.py` field-for-field. */
export interface Candidate {
  field: string;
  value: number | null;
  confidence: number;
  node: string;
  sourceHint: string;
}

export interface DocumentExtractionResult {
  candidates: Candidate[];
  /** Always `true` today: the vision model never self-reports a per-field
   * confidence, so every candidate with a non-null value carries the same
   * flat placeholder. Do not treat `confidence` as a real reliability
   * signal while this is `true`. */
  confidenceIsPlaceholder: boolean;
}
