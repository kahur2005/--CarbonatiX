# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SmartSmelt ERP** — a carbon-accounting web app for Indonesian nickel smelters (RKEF
pyrometallurgy with captive coal PLTU), built for the BRIN AIdeanation 2026 research
competition. A user enters or uploads their site specification and one production
interval; the app computes expected emissions, positions them against an absolute
carbon allocation, prices the gap against forecast IDX carbon prices, and streams an
LLM advisory grounded in Indonesian regulation.

`PRD_SmartSmelt_ERP_v2.md` (Bahasa Indonesia) is the authoritative spec. `PRD_SmartSmelt_ERP.md`
is the superseded v1 — v2 §2 lists what was dropped and why. The UI is in Bahasa Indonesia;
code, comments and docs are in English.

## Commands

Backend (`carbonatix/backend`, Python 3.11+, venv at `.venv`):

```bash
.venv/Scripts/python.exe -m pytest -q              # full suite (286 tests, ~7s)
.venv/Scripts/python.exe -m pytest tests/test_calculator_golden.py -q
.venv/Scripts/python.exe -m pytest -k "biocoke" -q # single test by name
.venv/Scripts/python.exe -m ruff check app tests
.venv/Scripts/python.exe -m uvicorn app.main:app --env-file .env --reload # :8000
```

Frontend (`carbonatix/frontend`, Next.js 16.3):

```bash
npx vitest run                          # full suite (118 tests)
npx vitest run lib/units.test.ts        # single file
npx vitest run -t "rejects out of range"
npx tsc --noEmit                        # type check
npm run lint
npm run dev                             # :3000
npx playwright test                     # e2e/full-flow.spec.ts — needs live Supabase + backend
```

Models (`ml/`) are trained manually and the pickles committed; nothing trains at request
time. `python ml/train_nickel.py`, `python ml/train_carbon.py`.

Environment. The backend `.env.example` is a placeholder-only template; the frontend
`.env.example` remains absent. Backend: `DATABASE_URL`, `SUPABASE_URL` (the JWKS URL is
derived from it), optional `SUPABASE_SERVICE_ROLE_KEY` (currently unused by the
backend), and one `ELICE_API_KEY` shared by two model-specific deployments: `ELICE_BASE_URL` for GPT-5.6 Sol and required `HELPY_BASE_URL`
for document vision. The two base URLs are not interchangeable. Frontend:
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus
`E2E_EXISTING_USER_*` for Playwright. There is no `SUPABASE_JWT_SECRET` — see the auth
invariant below.

## Architecture

Three deployables: Next.js frontend → FastAPI backend → Supabase Postgres. The browser
talks to Supabase directly **only for auth**; every data read/write goes through FastAPI
carrying the Supabase JWT as a bearer token. `supabase-js` is never used with `.from()`.
Every AI provider call happens inside FastAPI — no model API key ever reaches the browser.

### Backend (`carbonatix/backend/app`)

- `main.py` — route registration only. All logic lives in modules.
- `emissions/` — the product's core. `constants.py` holds a frozen `ProcessConstants`
  dataclass; `calculator.py` is a pure deterministic mass-and-energy balance (no ML);
  `compliance.py` positions a result against the cap.
- `companies.py` / `runs.py` — persistence. A committed run stores the forecast snapshot
  it was computed against, so reopening it never shows today's prices against yesterday's
  emissions.
- `forecasting/service.py` — loads pre-trained Prophet pickles from `forecasting/artifacts/`.
- `ingestion/` — Helpy reads documents, GPT-5.6 Sol identifies fields, pure Python verifies
  and computes, and `mapping.py` returns review candidates. A candidate can never become a
  stored value without a separate explicit user action.
- `advisor/` — `corpus.py` (regulation clauses), `prompt.py`, `pipeline.py` (four-stage
  SSE stream).
- `recommendation.py` — reconstructs a stored run into `EmissionResult`/`CompliancePosition`
  and SSE-frames the pipeline's events for `GET /runs/{id}/recommendation`.
- `auth.py` — Supabase JWT verification, the only thing between the internet and user data.

### Frontend (`carbonatix/frontend`)

- `proxy.ts` — route protection. Next.js 16 renamed `middleware.ts` to `proxy.ts`; use the
  new name. Uses `getClaims()`, never `getSession()`, in server code.
- `lib/api.ts` — the single API client. `streamRecommendation` hand-parses SSE via `fetch`
  because `EventSource` cannot attach an `Authorization` header.
- `app/onboarding` → site spec; `app/twin` → 3D node graph where clicking a node opens
  manual input or document upload; `app/dashboard` → emission breakdown, compliance,
  forecasts, advisor stream.

**Read `node_modules/next/dist/docs/` before writing Next.js code.** This version has
breaking changes relative to training data (see `carbonatix/frontend/AGENTS.md`).

## The AI layers

The proposal calls this an "Agentic AI Auditor Multilayer", and the three layers are still
the vocabulary the team and the PRD use. **What each layer is made of changed in v2, and
that change is a ruling, not an implementation detail.**

### Layer 1 — emission engine: deliberately NOT a model

v1 specified XGBoost (LSTM optional) trained on synthetic thermodynamic simulation. v2
replaced it with `emissions/calculator.py`, a pure mass-and-energy balance. PRD §2 carries
the reason: a model fitted to data generated by a formula only relearns that formula plus
approximation error, while costing auditability. **Do not reintroduce a learned model on the
emission path without an explicit human ruling** — an unauditable emission number is the exact
failure this product exists to avoid, and `test_calculator_golden.py` /
`test_calculator_structural.py` pin exact arithmetic that an estimator could not satisfy.

The honest gap here is calibration, not model class: `CALIBRATION.md` records **0 of 10
physical constants sourced**. A team wanting to improve the physics should source constants,
not fit a regressor. Known unresolved finding: `sec_eaf_kwh_per_t_alloy = 2400` sits *below*
the PRD's own stated physical floor of 2700–4200 kWh/t alloy (PRD §17.1), so every current
demo figure understates Scope 2. Nothing in `constants.py` or `schemas.py` enforces that floor,
and the 25–45% Scope-2 corridor test checks only the ratio, so it does not catch this.

### Layer 2 — market quant: the real ML slot (`ml/` → `forecasting/artifacts/`)

Two Prophet models, trained offline and committed as pickles. This is where a team-developed
model actually plugs in. The serving contract in `forecasting/service.py` is narrow, so a
replacement (LightGBM or anything else) must satisfy it rather than the module being rewritten
around a new model:

- the unpickled object exposes `make_future_dataframe(periods=n)` and `predict(df)` returning
  a frame with `yhat`, `yhat_lower`, `yhat_upper`;
- it carries a `carbonatix_provenance` attribute. **An artifact with no provenance attribute is
  reported as synthetic, not as verified-real** — unlabelled ≠ trustworthy;
- a missing or unreadable artifact raises `ForecastUnavailable` → HTTP 503. It never falls back
  to a made-up price, because that price would then be handed to the advisor as fact.

Everything under `ml/` is currently fabricated. `ml/DATA_PROVENANCE.md` is the authoritative
account, including the step-by-step swap-in procedure for real LME and IDX Carbon series and
the ruling that **no MAPE or backtest number is reported anywhere** while the training series is
synthetic (a synthetic-vs-synthetic error metric measures the RNG, not forecasting skill).
Follow that file when real data lands; in particular the `_SYNTHETIC` filename suffixes and the
`carbonatix_provenance` attribute must be removed together, never one without the other.

### Layer 3 — the LLM advisor (`advisor/`), the last layer

`GET /runs/{run_id}/recommendation` streams four stages over SSE, one event per transition:
`retrieve` → `assemble` → `synthesise` → `verify`, each `running` then `done`/`failed`. The
stages are rendered as the dashboard node graph on purpose: being able to watch which step ran
and which failed is the product's answer to the "AI black box" objection, so **the stage
boundaries are a user-facing contract, not internal structure to refactor away**.

Provider wiring, all in `pipeline.py`:

- The model is reached through **Elice ML API, an OpenAI-compatible gateway** — hence the OpenAI
  SDK pointed at a custom `base_url`, not a vendor SDK. The same Elice key also authenticates
  Helpy's separate document-vision deployment.
- The gateway **rejects any parameter outside its documented allowlist with a 400** rather than
  ignoring it. Supported: `model`, `messages`, `max_completion_tokens`, `temperature`, `top_p`,
  `stop`, `stream`, `tools`, `tool_choice`, `response_format`, `reasoning_effort`;
  `presence_penalty`, `seed` and `frequency_penalty` were each measured to 400. A 400 is
  therefore never fixed by swapping `max_completion_tokens` for `max_tokens`.
- Default model **`gpt-5.6-sol`** (OpenAI GPT-5.6 Sol; `openai/gpt-5.6-sol` is the same model
  fully qualified), overridable at call time via `ELICE_MODEL`. Switched from `claude-fable-5`
  on 2026-08-07.
- **`ELICE_BASE_URL` is model-specific and must move with `_DEFAULT_MODEL`.** Each Elice
  serverless deployment answers on its own `mlapi.run/<uuid>/v1` endpoint and serves only the
  models provisioned to it — the Fable 5 deployment's `GET /models` listed `claude-fable-5` and
  nothing else. Changing the model string against a stale base URL asks an endpoint for a model
  it has never heard of; nothing in code can catch that.
- `reasoning_effort="high"` — GPT-5.6 Sol accepts `none`/`low`/`medium`/`high`, so `high` is the
  top of the range. **Do not carry Fable 5's `xhigh`/`max` over; this model 400s on them**
  (`test_reasoning_effort_is_one_this_model_accepts` guards it — the allowlist test checks
  parameter names, never values).
- `_MAX_COMPLETION_TOKENS = 32000` (raised from 4000 on 2026-08-08 for longer dashboard
  advisories). Measured need at `high` on a real deficit prompt: Sol 798 prompt / 2409
  completion, Fable 5 1438 / 2618 (whose original 1500 cap truncated mid-sentence). Only
  generated tokens are billed, so an unused ceiling costs nothing — but it *is* the per-call
  cost ceiling ($30/1M output ⇒ ~$0.96 worst case at 32000).
- **`_GATEWAY_MAX_COMPLETION_TOKENS = 128000` is a hard limit**, probed live: above it every
  request 400s before the model is reached, so an over-large cap yields no advisory at all
  rather than a long one. It is nowhere near the 1.05M context, which is not where anyone would
  look for it. `test_token_cap_clears_the_measured_requirement` guards both ends of the range.
- `finish_reason == "length"` and an empty completion both **raise**. A truncated advisory reads
  as finished advice and the numeral guard cannot object to it; an empty one renders as a blank
  panel that also looks like advice. Neither may be presented.
- A `synthesise` failure fails only that stage and ends the stream — `verify` never runs, and
  nothing is fabricated to fill the gap. The emission, compliance and forecast panels are
  computed independently and must keep standing on their own.

Two independent safety mechanisms, and they are the point of the layer:

1. **Verbatim clause injection** (`corpus.py`). No vector database — a few dozen curated clauses,
   selected by compliance status, injected character-for-character. Embedding similarity can
   retrieve the wrong clause silently; verbatim injection cannot. Every `text` field must be
   copied from the gazetted source: never summarise, never translate, never tidy.
2. **The numeral guard** (`prompt.py`). The model may never originate a figure. `build_prompt`
   returns both the prompt and the set of permitted numerals; `unsupported_numerals` scans the
   output for anything outside it, and a non-empty result sets `verify`'s `flagged`, which means
   the body is *not* rendered as advice. Three rules, all locale-aware for Indonesian: unmatched
   digit runs of 3+ digits; a digit followed by a magnitude word (`ribu`/`juta`/`miliar`/
   `triliun`, flagged at any length — "50 ribu" hides 50 000 behind the two-digit exemption);
   and a quantity spelled out in words next to a unit ("lima puluh ribu ton"), rejected rather
   than parsed. Citation digits are exempt only *inside an actual occurrence of the clause ref
   text*, never globally, so a fabricated "110 ton" cannot launder through by matching an
   article number.

### Ingestion — two AI stages, and Python in between

`POST /documents` runs both stages inside one synchronous request, with a 20 MiB upload cap.
Neither stage writes a value: the output is always review candidates, and a candidate reaches
an input only after the user explicitly clicks **Terima**.

**Stage 1 — `document_vision.py`.** Helpy Document Vision (`HELPY_BASE_URL`, authenticating
with the shared `ELICE_API_KEY` — there is no `HELPY_API_KEY`). It submits at
`POST /v1/documents`, then polls `GET /v1/jobs/{id}` under a 90-second budget. **Poll on
`/v1/jobs/{id}`, not the `/jobs/{id}` the vendor docs list — that path 404s.** `/healthz` and
`/readyz` also require authorization despite being documented as open. The result is a
normalized `ParsedDocument`, never Helpy's own JSON, so a provider swap cannot leak a response
shape downstream. Helpy accepts PDF/PPT/PPTX/PNG/JPEG/JPG — **not XLSX**, despite PRD §10.

**Stage 2 — `interpret.py`.** `gpt-5.6-sol` uses `ELICE_BASE_URL` with a 60-second
client timeout and an 8,000-token completion cap that is a schema-constrained JSON cost
ceiling -- truncation fails loudly and live sufficiency is still unmeasured. For every
requested profile field it returns either verbatim `evidence` and the printed
`raw_value`, or verbatim `operands` plus a named `operation`. It never returns a
computed value, and every requested field is represented so omission becomes "not found"
rather than a missing key.

**Verification — `verify.py`.** Pure Python, with no model client or network access. It
requires complete Indonesian number-token matches: transcribed figures must occur verbatim
inside their cited evidence, while every derived operand must occur verbatim in the document.
It parses Indonesian thousands, decimal and percent notation strictly, then computes only the
closed operation set `difference_over_total`, `ratio`, and `percentage_of_total`; it never
uses `eval`. Anything unverifiable becomes a blank for manual entry.

**`mapping.py`.** Verified readings become review `Candidate`s carrying `basis`, `evidence`,
and `derivation` disclosures. `confidence` is Helpy's real element score, but
`confidence_is_placeholder` remains `True` because that score describes an element, not an
individual field.

## Invariants

These are load-bearing. Violating one produces a wrong number on screen, not a test failure.

**Absolute cap, never proportional.** `Cap = V_ore × β` is scale-invariant because
ore-volume elasticity of emissions is exactly 1.0 — raising production could never create
a deficit, making the proposal's headline demo arithmetically impossible. The cap is an
absolute tCO₂e site-spec field. PRD §8 and §7.5 carry the arithmetic; `test_calculator_structural.py`
locks the elasticity.

**Unit boundary.** `lib/units.ts` is the *only* place percentages become fractions. The API
takes fractions in [0,1]; the UI shows percentages. Converting anywhere else risks sending
32 where 0.32 was meant.

**Currency.** USD and IDR are never mixed. Every monetary field name carries its unit suffix
(`carbon_price_idr_per_ton`, `lme_usd_per_ton`).

**Provisional-data labelling.** Synthetic or placeholder data must carry its label from
origin to rendered pixel: `synthetic`/`provenance` on forecasts, `confidenceIsPlaceholder`
on extractions, `placeholderCitations` on advisories. A label dropped at any layer is a
defect, not cosmetic — the entire price series and the whole regulation corpus are currently
fake (see below). `placeholderCitations` rides on **every** advisor event, not just `verify`'s,
so a consumer never has to special-case a stage to learn that today's citations are unverified.

**The LLM never originates a number, and a flagged recommendation is never advice.** Both
halves are enforced in code (`prompt.py`, and the `flagged` guard in
`components/advisor/RecommendationPanel.tsx`), and the dashboard shape-checks `verify`'s payload
*before* writing the node status — a malformed payload turns that node red instead of leaving
four green nodes above an empty panel.

**Numeric validation.** `not value > 0` accepts `+inf`. Always `math.isfinite(value) and value > 0`.

**Auth is asymmetric (ES256) and verified via JWKS**, not a shared secret. There is no
`SUPABASE_JWT_SECRET`; the dashboard's "JWT signing keys" screen shows a key *id*, which is
public. `auth.py` fetches `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, selects by the
token's `kid`, and **takes the algorithm from the JWKS entry, never from the token** — honouring
the token's own `alg` allows the algorithm-confusion attack, since the verifying key is public.
Never add `HS*` to `_ASYMMETRIC_ALGORITHMS`.

**The database is reached through Supabase's transaction pooler**, port 6543, because
`db.<ref>.supabase.co` is IPv6-only and unreachable from the dev machines, and the pooler's
session mode (5432) times out too. `db.py` therefore passes `statement_cache_size=0`;
removing it produces intermittent `prepared statement ... does not exist` failures that
appear only under concurrency. See the `db.py` module docstring.

**Tenant isolation is handler-level, not RLS.** The backend connects as `postgres` superuser,
which bypasses RLS unconditionally. Every query in `companies.py` and `runs.py` filters by
`user_id`; `tests/test_isolation.py` is the enforcement. RLS in `supabase/migrations/0001_init.sql`
is a second line of defence for JWT-scoped clients only.

**`intensity_per_tonne_ni` returns `None`, never `0.0`,** when no nickel was tapped.

**A foreign or missing run id both return a bare 404** — indistinguishably, deliberately.

## Testing conventions

- **No test may make a real model API call**, and there are no provider keys in the test
  environment. Advisor tests monkeypatch `pipeline._call_model`; the few that pin the wire-level
  request monkeypatch `AsyncOpenAI` itself. Ingestion tests replace `AsyncOpenAI` and
  `httpx.AsyncClient` at their client boundaries. A test that would need a live key is not
  written — that is what the Playwright e2e spec is for.
- `dependency_overrides` must be set in **function-scoped autouse fixtures**, never as bare
  module-level code. Top-level assignment applies at pytest collection and silently bypasses
  real JWT verification in `test_auth.py`.
- Golden tests recomputed from `DEFAULT_CONSTANTS` are self-referential. Every golden file
  carries at least one hardcoded literal anchor computed by exact rational arithmetic.
- `tests/conftest.py`'s `fake_db` inspects the *query text* for a `user_id` predicate, not just
  the arguments — an argument-only fake cannot catch a `WHERE` clause that joins the tenant
  filter with `or`.
- Guard rules are tested at the rule level, not only through the aggregate
  (`_spelled_out_number_matches` is exposed for exactly this reason): a match credited to the
  wrong rule has passed review before.
- `to_camel` capitalises any letter following a digit (`cap_tco2e` → `capTco2E`). Fields with
  digits need an explicit `Field(alias=...)`. `recommendation.py` reconstructs stored runs from
  these wire names by hand, and a typo there only breaks when a real run is replayed —
  `test_reconstruction_round_trips_the_wire_field_names` is what pins it.

## Process

Work on this branch follows Subagent-Driven Development. `.superpowers/sdd/2026-08-04-smartsmelt-web-v2/progress.md`
is the durable ledger — commit SHAs, human rulings, open items, deferred minors. Read it
before resuming work. The plan is `docs/superpowers/plans/2026-08-04-smartsmelt-web-v2.md`.

## Known gaps

`carbonatix/backend/CALIBRATION.md` tracks the PRD §17.1 calibration gate: **0 of 10 physical
constants are sourced**, and `sec_eaf_kwh_per_t_alloy` sits below the PRD's own physical floor.
`ml/DATA_PROVENANCE.md` records that both price models are trained on fabricated data.
`advisor/corpus.py` ships `PASTE THE VERBATIM ARTICLE TEXT HERE` sentinels instead of real
regulation, so **every citation the advisor currently produces is false** — the prompt carries an
explicit warning telling the model exactly that. Citation chips cannot expand to clause text:
the `verify` event sends refs only, and closing that needs a backend payload change (moot until
the real text is pasted in). The Playwright e2e spec is written but **has never executed** — it
needs a live Supabase and a `DATABASE_URL`. None of this is hidden from the UI — the labelling
invariant above is what keeps it honest — but nothing on screen is a real-world figure yet.
