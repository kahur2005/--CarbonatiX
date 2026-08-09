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
  /** Twin production month (`YYYY-MM`); stamped onto the committed run. */
  period?: string;
}

/** Partial draft for `PUT /production-months/{yyyy-mm}` — missing keys = blank. */
export type ProductionMonthInputs = Partial<
  Omit<OperationalInput, "period">
>;

export interface ProductionMonthSummary {
  period: string;
  updatedAt: string;
  hasInputs: boolean;
}

export interface ProductionMonth {
  period: string;
  inputs: ProductionMonthInputs;
  updatedAt: string;
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
  /** Production month (`YYYY-MM`) when the twin stamped the commit. */
  period?: string | null;
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
  basis: "transcribed" | "derived" | null;
  evidence: string;
  derivation: string;
}

export interface DocumentExtractionResult {
  candidates: Candidate[];
  /** Still `true` today: `confidence` carries Helpy's real element score,
   * not a per-field reliability signal. Do not treat it as field-level
   * accuracy while this flag remains set. */
  confidenceIsPlaceholder: boolean;
}

// ---- GET /runs/{id}/recommendation (advisor pipeline SSE) --------------
//
// Mirrors `app/advisor/pipeline.py` and `app/recommendation.py`. This
// endpoint streams Server-Sent Events, one JSON object per `data:` line
// (see `lib/api.ts`'s `streamRecommendation`), not a single JSON response.

/** The four pipeline stages, always fired in this order --
 * `Ambil regulasi` -> `Rangkai angka` -> `Sintesis` -> `Verifikasi` in the
 * UI (see `components/advisor/NodeGraph.tsx`). Spelled exactly as
 * `run_pipeline` emits them; do not rename to look more idiomatic here. */
export type RecommendationStage = "retrieve" | "assemble" | "synthesise" | "verify";

export type RecommendationStageStatus = "running" | "done" | "failed";

/** One SSE frame, i.e. one `_event(...)` call in `run_pipeline`.
 * `placeholderCitations` rides on every single event (not only `verify`'s)
 * so a consumer never has to special-case which stage it is looking at to
 * learn that today's regulation citations are unverified placeholder text
 * -- see `app/advisor/corpus.py`'s `has_placeholder_text`. */
export interface RecommendationEvent {
  stage: RecommendationStage;
  status: RecommendationStageStatus;
  payload: Record<string, unknown> | null;
  placeholderCitations: boolean;
}

/** `verify`'s `done` payload -- the only stage whose payload this app reads
 * field by field rather than only using its stage/status. */
export interface RecommendationVerifyPayload {
  /** True if the model emitted a numeral that was not in the supplied
   * figure set. When true, `body` must never be rendered as advice -- see
   * `components/advisor/RecommendationPanel.tsx`. */
  flagged: boolean;
  /** The specific fabricated tokens; only meaningful when `flagged`. */
  unsupported: string[];
  /** Clause refs (e.g. "Permen ESDM 16/2022 Pasal 18") that appear
   * verbatim in `body`. Ref strings only -- `run_pipeline`'s `verify`
   * event never sends clause body text over this endpoint, so there is no
   * verbatim article text to expand a citation chip into on the frontend;
   * see `app/advisor/corpus.py`, which still holds only placeholder text
   * for every clause regardless. */
  citations: string[];
  body: string;
  model: string;
  placeholderCitations: boolean;
}
