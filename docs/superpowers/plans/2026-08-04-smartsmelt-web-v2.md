# SmartSmelt ERP Web v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web application where a nickel smelter logs in, enters or uploads its site specification and daily operational data through a clickable 3D RKEF digital twin, and sees deterministic Scope 1/Scope 2 emission projections, compliance position against an absolute carbon quota, nickel and carbon price forecasts, and an AI recommendation grounded in verbatim regulation clauses.

**Architecture:** Three deployables. A Next.js frontend owns pages, auth session and the 3D twin. A FastAPI backend owns the pure emission calculator, the pre-trained forecast artifacts, and all outbound cloud AI calls. Supabase provides email/password auth, Postgres and file storage. The browser calls FastAPI directly carrying a Supabase JWT. Emission recomputation is stateless and instant; only explicit commits write to the database.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, pytest, Prophet, pandas. Next.js 15 (App Router), TypeScript, React Three Fiber, Recharts, Tailwind. Supabase (auth + Postgres + Storage). Anthropic Claude API (text + vision).

## Global Constraints

- **Currency invariant.** USD and IDR values are never mixed. Every monetary field name encodes its unit: `lmeUsdPerTon`, `limitPriceIdr`, `carbonPositionValueIdr`. No response object may contain a USD and an IDR value under an unsuffixed name.
- **Fractions, not percentages, cross the API boundary.** `moisture_content_pct` and every other `_pct` field is a fraction in `[0, 1]`. `0.32` means 32%. The UI displays percentages and converts at exactly one place: the request serializer.
- **The calculator is pure.** `app/emissions/calculator.py` performs no I/O, imports no HTTP or database module, and reads no global state. This is load-bearing — it is what makes stateless recompute and the future what-if engine possible.
- **The LLM never produces its own figures.** Every number available to the advisor is supplied in the prompt. Generated output is checked numeral-by-numeral against the supplied set.
- **Regulation clauses are injected verbatim.** Never paraphrased, always cited by article number.
- **The quota is an absolute tCO2e allocation**, a site-specification field. Never `V_ore × β`. See PRD §8.1 for why.
- **OCR output is always a candidate, never a value.** No code path may write an extracted number without an explicit user accept.
- **Constants are unvalidated placeholders.** Every default in `ProcessConstants` is provisional pending the PRD §17.1 calibration gate. Do not present absolute figures as findings.
- **UI copy in Bahasa Indonesia. Code, field names and commit messages in English.**
- Python: `ruff` + `pytest`. TypeScript: `eslint` + `tsc --noEmit`. Both must pass before any commit.

---

## File Structure

```
carbonatix/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app, route registration only
│   │   ├── auth.py                    # Supabase JWT verification dependency
│   │   ├── db.py                      # asyncpg pool, query helpers
│   │   ├── schemas.py                 # Pydantic request/response models
│   │   ├── emissions/
│   │   │   ├── constants.py           # ProcessConstants, DEFAULT_CONSTANTS
│   │   │   ├── calculator.py          # calculate_emissions, EmissionResult
│   │   │   └── compliance.py          # absolute-cap position + value
│   │   ├── forecasting/
│   │   │   ├── service.py             # artifact loading, predict()
│   │   │   └── artifacts/             # nickel_lme.pkl, idx_carbon.pkl
│   │   ├── ingestion/
│   │   │   ├── vision.py              # document -> raw field dict
│   │   │   └── mapping.py             # raw fields -> node candidates
│   │   └── advisor/
│   │       ├── corpus.py              # curated regulation clauses
│   │       ├── prompt.py              # prompt assembly + numeral check
│   │       └── pipeline.py            # 4-stage SSE pipeline
│   ├── tests/
│   │   ├── test_constants.py
│   │   ├── test_calculator_golden.py
│   │   ├── test_calculator_validation.py
│   │   ├── test_calculator_structural.py
│   │   ├── test_compliance.py
│   │   ├── test_forecasting.py
│   │   ├── test_ingestion.py
│   │   ├── test_advisor.py
│   │   └── test_api.py
│   ├── pyproject.toml
│   └── .env.example
├── ml/
│   ├── train_nickel.py                # fits + serialises LME model
│   ├── train_carbon.py                # fits + serialises IDX Carbon model
│   └── data/price_history.csv
├── frontend/
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/register/page.tsx
│   │   ├── onboarding/page.tsx
│   │   ├── twin/page.tsx
│   │   └── dashboard/page.tsx
│   ├── components/
│   │   ├── twin/Scene.tsx             # R3F canvas + node meshes
│   │   ├── twin/NodePanel.tsx         # per-node input form
│   │   ├── twin/UploadDropzone.tsx    # document -> candidates
│   │   ├── dashboard/EmissionBars.tsx
│   │   ├── dashboard/CompliancePanel.tsx
│   │   ├── dashboard/ForecastChart.tsx
│   │   ├── advisor/NodeGraph.tsx
│   │   └── advisor/RecommendationPanel.tsx
│   ├── lib/
│   │   ├── supabase.ts                # browser + server clients
│   │   ├── api.ts                     # typed FastAPI client
│   │   └── units.ts                   # THE percent <-> fraction boundary
│   └── types/emissions.ts
└── supabase/migrations/
```

**Why these boundaries:** `calculator.py` is split from `compliance.py` because the calculator answers "how much did we emit" and compliance answers "does that break a rule" — they change for different reasons, and the calculator must stay importable without any notion of quotas. `units.ts` exists as its own file so the percent-to-fraction conversion has exactly one home and one test.

---

# PHASE 1 — Emission core

Pure Python. No network, no database, no framework. Executable and reviewable entirely on its own.

---

### Task 1: Repository scaffold and process constants

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`, `backend/app/emissions/__init__.py`
- Create: `backend/app/emissions/constants.py`
- Test: `backend/tests/test_constants.py`

**Interfaces:**
- Consumes: nothing
- Produces: `ProcessConstants` frozen dataclass with fields `recovery_yield: float`, `delta_h_vap: float`, `lhv_coal: float`, `ef_coal_thermal: float`, `kiln_thermal_efficiency: float`, `k_heat: float`, `k_stoic: float`, `ef_reductant: float`, `alloy_nickel_grade: float`; and `DEFAULT_CONSTANTS: ProcessConstants`.

- [ ] **Step 1: Initialise the repository**

```bash
cd "D:/! CarbonatiX"
git init
mkdir -p carbonatix/backend/app/emissions carbonatix/backend/tests
cd carbonatix/backend
```

- [ ] **Step 2: Create `pyproject.toml`**

```toml
[project]
name = "carbonatix-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.9",
    "python-jose[cryptography]>=3.3",
    "asyncpg>=0.30",
    "httpx>=0.27",
    "anthropic>=0.40",
    "prophet>=1.1.6",
    "pandas>=2.2",
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24", "ruff>=0.7"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
```

- [ ] **Step 3: Write the failing test**

Create `backend/tests/test_constants.py`:

```python
import pytest

from app.emissions.constants import DEFAULT_CONSTANTS, ProcessConstants


def test_defaults_are_physically_plausible():
    c = DEFAULT_CONSTANTS
    assert 0.0 < c.recovery_yield <= 1.0
    assert 0.0 < c.alloy_nickel_grade <= 1.0
    assert 0.0 < c.kiln_thermal_efficiency <= 1.0
    assert c.lhv_coal > 0
    assert c.ef_coal_thermal > 0
    assert c.ef_reductant > c.ef_coal_thermal, (
        "coke carries more carbon per tonne than thermal coal"
    )


def test_rejects_fraction_out_of_range():
    with pytest.raises(ValueError, match="recovery_yield"):
        ProcessConstants(recovery_yield=1.4)


def test_rejects_nan():
    with pytest.raises(ValueError, match="lhv_coal"):
        ProcessConstants(lhv_coal=float("nan"))


def test_is_frozen():
    with pytest.raises(Exception):
        DEFAULT_CONSTANTS.lhv_coal = 1.0  # type: ignore[misc]
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pytest tests/test_constants.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.emissions.constants'`

- [ ] **Step 5: Implement `constants.py`**

Create `backend/app/emissions/constants.py`:

```python
"""Process constants for the RKEF emission model.

Every default below is an UNVALIDATED PLACEHOLDER pending the calibration
gate in PRD section 17.1. They are literature-plausible, not sourced. Do not
present figures derived from them as findings.
"""

from dataclasses import dataclass, field, fields

__all__ = ["ProcessConstants", "DEFAULT_CONSTANTS"]

# Fields constrained to (0, 1]. The rest need only be positive and finite.
_FRACTION_FIELDS = frozenset(
    {"recovery_yield", "alloy_nickel_grade", "kiln_thermal_efficiency"}
)


@dataclass(frozen=True)
class ProcessConstants:
    """Physical and empirical constants of an RKEF line.

    Validates on construction so that no downstream code has to re-check.
    """

    recovery_yield: float = 0.90            # fraction of contained Ni recovered
    delta_h_vap: float = 2.60               # GJ per tonne water (heat + latent)
    lhv_coal: float = 20.0                  # GJ per tonne, Indonesian sub-bituminous
    ef_coal_thermal: float = 2.20           # tCO2e per tonne thermal coal
    kiln_thermal_efficiency: float = 0.55   # fraction
    k_heat: float = 1.80                    # GJ per tonne dry ore, preheat + calcination
    k_stoic: float = 2.00                   # tonnes coke per tonne Ni
    ef_reductant: float = 3.20              # tCO2e per tonne coke
    alloy_nickel_grade: float = 0.10        # Ni fraction of tapped alloy; NPI ~0.10

    def __post_init__(self) -> None:
        for f in fields(self):
            value = getattr(self, f.name)
            if f.name in _FRACTION_FIELDS:
                # Written so NaN fails: `not (0 < nan <= 1)` is True.
                if not 0.0 < value <= 1.0:
                    raise ValueError(
                        f"{f.name} must be a fraction in (0, 1], got {value!r}"
                    )
            elif not value > 0:  # not `value <= 0`: NaN must fail this
                raise ValueError(f"{f.name} must be positive and finite, got {value!r}")


DEFAULT_CONSTANTS = ProcessConstants()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/test_constants.py -v`
Expected: 4 passed

- [ ] **Step 7: Lint and commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(emissions): add self-validating ProcessConstants"
```

---

### Task 2: The emission calculator

**Files:**
- Create: `backend/app/emissions/calculator.py`
- Test: `backend/tests/test_calculator_golden.py`

**Interfaces:**
- Consumes: `ProcessConstants`, `DEFAULT_CONSTANTS` from Task 1
- Produces: `EmissionResult` frozen dataclass; `calculate_emissions(*, wet_ore_input_tons, moisture_content_pct, nickel_grade_pct, reductant_biocoke_pct, sec_eaf_kwh_per_t_alloy, power_mix_captive_coal, ef_captive_pltu, dryer_thermal_efficiency, constants=DEFAULT_CONSTANTS) -> EmissionResult`. `EmissionResult` exposes properties `scope_1`, `scope_2`, `intensity_per_tonne_ni` (returns `float | None`).

- [ ] **Step 1: Write the failing golden test**

Create `backend/tests/test_calculator_golden.py`:

```python
"""Golden tests. The engine is deterministic arithmetic, so the correct
answer is knowable by hand and every expectation below was computed by hand.
"""

import pytest

from app.emissions.calculator import calculate_emissions
from app.emissions.constants import DEFAULT_CONSTANTS as C

NOMINAL = dict(
    wet_ore_input_tons=10_000.0,
    moisture_content_pct=0.32,
    nickel_grade_pct=0.018,
    reductant_biocoke_pct=0.0,
    sec_eaf_kwh_per_t_alloy=2400.0,
    power_mix_captive_coal=1.0,
    ef_captive_pltu=1.0,
    dryer_thermal_efficiency=0.55,
)


def test_nominal_interval_matches_hand_calculation():
    r = calculate_emissions(**NOMINAL)

    dry = 10_000.0 * 0.68
    water = 10_000.0 * 0.32
    m_ni = dry * 0.018 * C.recovery_yield

    coal_dryer = (water * C.delta_h_vap) / (C.lhv_coal * 0.55)
    coal_kiln = (dry * C.k_heat) / (C.lhv_coal * C.kiln_thermal_efficiency)
    reductant = m_ni * C.k_stoic * 1.0
    alloy = m_ni / C.alloy_nickel_grade
    mwh = alloy * 2400.0 / 1000.0

    assert r.dry_ore_tons == pytest.approx(dry, rel=1e-12)
    assert r.nickel_output_tons == pytest.approx(m_ni, rel=1e-12)
    assert r.dryer_coal_tons == pytest.approx(coal_dryer, rel=1e-12)
    assert r.kiln_coal_tons == pytest.approx(coal_kiln, rel=1e-12)
    assert r.reductant_tons == pytest.approx(reductant, rel=1e-12)
    assert r.eaf_mwh == pytest.approx(mwh, rel=1e-12)

    assert r.dryer_emissions == pytest.approx(coal_dryer * C.ef_coal_thermal, rel=1e-12)
    assert r.kiln_heat_emissions == pytest.approx(coal_kiln * C.ef_coal_thermal, rel=1e-12)
    assert r.kiln_reductant_emissions == pytest.approx(reductant * C.ef_reductant, rel=1e-12)
    assert r.eaf_emissions == pytest.approx(mwh * 1.0 * 1.0, rel=1e-12)

    assert r.total_emissions == pytest.approx(
        r.dryer_emissions + r.kiln_heat_emissions
        + r.kiln_reductant_emissions + r.eaf_emissions,
        rel=1e-12,
    )
    assert r.scope_1 == pytest.approx(
        r.dryer_emissions + r.kiln_heat_emissions + r.kiln_reductant_emissions, rel=1e-12
    )
    assert r.scope_2 == pytest.approx(r.eaf_emissions, rel=1e-12)


def test_zero_ore_emits_nothing_and_intensity_is_none():
    r = calculate_emissions(**{**NOMINAL, "wet_ore_input_tons": 0.0})
    assert r.total_emissions == 0.0
    assert r.intensity_per_tonne_ni is None


def test_zero_grade_still_emits_from_ore_driven_stages():
    r = calculate_emissions(**{**NOMINAL, "nickel_grade_pct": 0.0})
    assert r.dryer_emissions > 0
    assert r.kiln_heat_emissions > 0
    assert r.kiln_reductant_emissions == 0.0
    assert r.eaf_emissions == 0.0
    assert r.intensity_per_tonne_ni is None, (
        "an interval that dried and calcined ore but tapped no metal still "
        "emits; 0.0 would report the best possible intensity for the worst "
        "possible interval"
    )


def test_full_biocoke_eliminates_reductant_emissions():
    r = calculate_emissions(**{**NOMINAL, "reductant_biocoke_pct": 1.0})
    assert r.kiln_reductant_emissions == 0.0
    assert r.reductant_tons == 0.0
    assert r.dryer_emissions > 0


def test_zero_captive_coal_eliminates_scope_2():
    r = calculate_emissions(**{**NOMINAL, "power_mix_captive_coal": 0.0})
    baseline = calculate_emissions(**NOMINAL)
    assert r.eaf_emissions == 0.0
    assert r.scope_1 == pytest.approx(baseline.scope_1, rel=1e-12)


def test_alloy_conversion_is_applied():
    """Guards the per-tNi vs per-tonne-alloy trap: skipping the conversion
    understates furnace energy by 1 / alloy_nickel_grade -- 10x for NPI."""
    r = calculate_emissions(**NOMINAL)
    assert r.alloy_output_tons == pytest.approx(
        r.nickel_output_tons / C.alloy_nickel_grade, rel=1e-12
    )
    assert r.alloy_output_tons > r.nickel_output_tons
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_calculator_golden.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.emissions.calculator'`

- [ ] **Step 3: Implement `calculator.py`**

Create `backend/app/emissions/calculator.py`. Use the module exactly as specified in PRD §7 — reproduced here in full:

```python
"""Expected carbon emission for one RKEF production interval.

The core entry point, calculate_emissions, takes plain scalars and returns a
full breakdown. It has no knowledge of where those scalars came from, so it is
reusable across fixtures, database rows, API payloads and optimiser sweeps
alike.

Scope boundaries
----------------
* Scope 1 (direct): dryer combustion, kiln heating, kiln reductant.
* Scope 2 (purchased/captive electricity): electric arc furnace.

Two consequences of the specified formulas are worth stating outright, since
both suppress reported emissions:

* The biocoke share of reductant is treated as zero-emission (biogenic
  carbon), so only the ``1 - reductant_biocoke_pct`` fossil share is counted.
* The hydro grid share of power is treated as zero-emission, so
  ``power_mix_hydro_grid`` never enters the arithmetic.

All emission figures are tCO2e for the interval described by the inputs.
"""

from dataclasses import dataclass

from .constants import DEFAULT_CONSTANTS, ProcessConstants

__all__ = ["EmissionResult", "calculate_emissions"]

_KWH_PER_MWH = 1_000.0


@dataclass(frozen=True)
class EmissionResult:
    """Emission breakdown plus the intermediates used to reach it.

    Intermediates are returned rather than discarded so callers can report,
    chart or sanity-check the calculation without repeating it.
    """

    nickel_output_tons: float
    alloy_output_tons: float

    dryer_emissions: float
    kiln_heat_emissions: float
    kiln_reductant_emissions: float

    eaf_emissions: float

    total_emissions: float

    dry_ore_tons: float
    dryer_coal_tons: float
    kiln_coal_tons: float
    reductant_tons: float
    eaf_mwh: float

    @property
    def scope_1(self) -> float:
        """Total direct combustion emissions, tCO2e."""
        return (
            self.dryer_emissions
            + self.kiln_heat_emissions
            + self.kiln_reductant_emissions
        )

    @property
    def scope_2(self) -> float:
        """Total electricity emissions, tCO2e."""
        return self.eaf_emissions

    @property
    def intensity_per_tonne_ni(self) -> "float | None":
        """Emission intensity, tCO2e per tonne of nickel produced.

        Returns None when no nickel was produced, because the intensity is
        genuinely undefined there and no float is honest about it. Callers
        aggregating over many intervals should filter None out, or better,
        divide summed emissions by summed nickel.
        """
        if self.nickel_output_tons == 0:
            return None
        return self.total_emissions / self.nickel_output_tons


def calculate_emissions(
    *,
    wet_ore_input_tons: float,
    moisture_content_pct: float,
    nickel_grade_pct: float,
    reductant_biocoke_pct: float,
    sec_eaf_kwh_per_t_alloy: float,
    power_mix_captive_coal: float,
    ef_captive_pltu: float,
    dryer_thermal_efficiency: float,
    constants: ProcessConstants = DEFAULT_CONSTANTS,
) -> EmissionResult:
    """Calculate expected carbon emission for one production interval.

    Keyword-only by design: eight positional floats would be trivial to
    transpose silently, and several share plausible magnitudes.

    Raises:
        ValueError: If an input is outside its physically meaningful range.
    """
    _validate(
        wet_ore_input_tons=wet_ore_input_tons,
        moisture_content_pct=moisture_content_pct,
        nickel_grade_pct=nickel_grade_pct,
        reductant_biocoke_pct=reductant_biocoke_pct,
        sec_eaf_kwh_per_t_alloy=sec_eaf_kwh_per_t_alloy,
        power_mix_captive_coal=power_mix_captive_coal,
        ef_captive_pltu=ef_captive_pltu,
        dryer_thermal_efficiency=dryer_thermal_efficiency,
    )

    dry_fraction = 1.0 - moisture_content_pct

    # 1. Nickel output.
    nickel_output_tons = (
        wet_ore_input_tons * dry_fraction * nickel_grade_pct * constants.recovery_yield
    )

    # 2. Scope 1 - rotary dryer, evaporating ore moisture.
    water_tons = wet_ore_input_tons * moisture_content_pct
    dryer_coal_tons = (water_tons * constants.delta_h_vap) / (
        constants.lhv_coal * dryer_thermal_efficiency
    )
    dryer_emissions = dryer_coal_tons * constants.ef_coal_thermal

    # 3. Scope 1 - rotary kiln, heating and reduction.
    #
    # k_heat is heat delivered to the ore, so it is divided by kiln efficiency
    # to reach fuel input -- the same treatment the dryer gives its own
    # efficiency above. The two stages model identical physics; only the
    # efficiency figure differs.
    dry_ore_tons = wet_ore_input_tons * dry_fraction
    kiln_coal_tons = (dry_ore_tons * constants.k_heat) / (
        constants.lhv_coal * constants.kiln_thermal_efficiency
    )
    kiln_heat_emissions = kiln_coal_tons * constants.ef_coal_thermal

    # Reductant is coke, not thermal coal, and carries its own emission
    # factor: far more carbon per tonne than the coal burned for heat.
    fossil_reductant_share = 1.0 - reductant_biocoke_pct
    reductant_tons = nickel_output_tons * constants.k_stoic * fossil_reductant_share
    kiln_reductant_emissions = reductant_tons * constants.ef_reductant

    # 4. Scope 2 - electric arc furnace.
    #
    # Furnace specific energy is quoted per tonne of tapped alloy, not per
    # tonne of contained nickel, so contained nickel is converted to alloy
    # tonnage first. Skipping this step understates furnace energy by
    # 1 / alloy_nickel_grade -- a factor of ten for NPI.
    alloy_output_tons = nickel_output_tons / constants.alloy_nickel_grade
    eaf_mwh = (alloy_output_tons * sec_eaf_kwh_per_t_alloy) / _KWH_PER_MWH
    eaf_emissions = eaf_mwh * (power_mix_captive_coal * ef_captive_pltu)

    total_emissions = (
        dryer_emissions + kiln_heat_emissions + kiln_reductant_emissions + eaf_emissions
    )

    return EmissionResult(
        nickel_output_tons=nickel_output_tons,
        alloy_output_tons=alloy_output_tons,
        dryer_emissions=dryer_emissions,
        kiln_heat_emissions=kiln_heat_emissions,
        kiln_reductant_emissions=kiln_reductant_emissions,
        eaf_emissions=eaf_emissions,
        total_emissions=total_emissions,
        dry_ore_tons=dry_ore_tons,
        dryer_coal_tons=dryer_coal_tons,
        kiln_coal_tons=kiln_coal_tons,
        reductant_tons=reductant_tons,
        eaf_mwh=eaf_mwh,
    )


def _validate(
    *,
    wet_ore_input_tons: float,
    moisture_content_pct: float,
    nickel_grade_pct: float,
    reductant_biocoke_pct: float,
    sec_eaf_kwh_per_t_alloy: float,
    power_mix_captive_coal: float,
    ef_captive_pltu: float,
    dryer_thermal_efficiency: float,
) -> None:
    """Reject inputs that would yield silently meaningless results.

    Two hazards drive the checks. Fractions are the first: passing 32 instead
    of 0.32 makes ``1 - moisture`` negative and produces a negative nickel
    output rather than an error. NaN is the second, and it is easy to miss --
    ``value < 0`` is False for NaN, so a dropped sensor read would sail
    through a naive non-negativity check and surface as
    ``total_emissions = nan``. Every comparison below is written so NaN fails.
    """
    fractions = {
        "moisture_content_pct": moisture_content_pct,
        "nickel_grade_pct": nickel_grade_pct,
        "reductant_biocoke_pct": reductant_biocoke_pct,
        "power_mix_captive_coal": power_mix_captive_coal,
    }
    for name, value in fractions.items():
        if not 0.0 <= value <= 1.0:
            raise ValueError(
                f"{name} must be a fraction between 0 and 1, got {value!r} "
                f"(percentages such as 32 should be passed as 0.32)"
            )

    non_negative = {
        "wet_ore_input_tons": wet_ore_input_tons,
        "sec_eaf_kwh_per_t_alloy": sec_eaf_kwh_per_t_alloy,
        "ef_captive_pltu": ef_captive_pltu,
    }
    for name, value in non_negative.items():
        if not value >= 0:  # not (value < 0): NaN must fail, and it fails this
            raise ValueError(f"{name} must be non-negative, got {value!r}")

    if not 0.0 < dryer_thermal_efficiency <= 1.0:
        raise ValueError(
            "dryer_thermal_efficiency must be a fraction in (0, 1], got "
            f"{dryer_thermal_efficiency!r}"
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_calculator_golden.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(emissions): add deterministic RKEF emission calculator"
```

---

### Task 3: Validation coverage

**Files:**
- Test: `backend/tests/test_calculator_validation.py`

**Interfaces:**
- Consumes: `calculate_emissions` from Task 2
- Produces: nothing new — this task adds only tests. It exists as its own task because validation is the layer most likely to be weakened later by someone "fixing" a failing input, and it deserves its own review gate.

- [ ] **Step 1: Write the tests**

Create `backend/tests/test_calculator_validation.py`:

```python
import math

import pytest

from app.emissions.calculator import calculate_emissions

NOMINAL = dict(
    wet_ore_input_tons=10_000.0,
    moisture_content_pct=0.32,
    nickel_grade_pct=0.018,
    reductant_biocoke_pct=0.0,
    sec_eaf_kwh_per_t_alloy=2400.0,
    power_mix_captive_coal=1.0,
    ef_captive_pltu=1.0,
    dryer_thermal_efficiency=0.55,
)

FRACTION_FIELDS = [
    "moisture_content_pct",
    "nickel_grade_pct",
    "reductant_biocoke_pct",
    "power_mix_captive_coal",
]
NON_NEGATIVE_FIELDS = [
    "wet_ore_input_tons",
    "sec_eaf_kwh_per_t_alloy",
    "ef_captive_pltu",
]


@pytest.mark.parametrize("field", FRACTION_FIELDS)
def test_percentage_passed_as_whole_number_is_rejected(field):
    """32 instead of 0.32 must raise, not silently produce negative output."""
    with pytest.raises(ValueError, match=field):
        calculate_emissions(**{**NOMINAL, field: 32.0})


@pytest.mark.parametrize("field", FRACTION_FIELDS)
def test_negative_fraction_is_rejected(field):
    with pytest.raises(ValueError, match=field):
        calculate_emissions(**{**NOMINAL, field: -0.01})


@pytest.mark.parametrize("field", NON_NEGATIVE_FIELDS)
def test_negative_magnitude_is_rejected(field):
    with pytest.raises(ValueError, match=field):
        calculate_emissions(**{**NOMINAL, field: -1.0})


@pytest.mark.parametrize("field", FRACTION_FIELDS + NON_NEGATIVE_FIELDS)
def test_nan_is_rejected_on_every_numeric_field(field):
    """`value < 0` is False for NaN. Every check must be written so NaN fails."""
    with pytest.raises(ValueError, match=field):
        calculate_emissions(**{**NOMINAL, field: float("nan")})


def test_nan_dryer_efficiency_is_rejected():
    with pytest.raises(ValueError, match="dryer_thermal_efficiency"):
        calculate_emissions(**{**NOMINAL, "dryer_thermal_efficiency": float("nan")})


def test_zero_dryer_efficiency_is_rejected():
    """Zero would divide by zero and produce inf, not an error."""
    with pytest.raises(ValueError, match="dryer_thermal_efficiency"):
        calculate_emissions(**{**NOMINAL, "dryer_thermal_efficiency": 0.0})


def test_no_output_field_is_nan_for_valid_input():
    r = calculate_emissions(**NOMINAL)
    for name in (
        "nickel_output_tons", "alloy_output_tons", "dryer_emissions",
        "kiln_heat_emissions", "kiln_reductant_emissions", "eaf_emissions",
        "total_emissions", "dry_ore_tons", "dryer_coal_tons",
        "kiln_coal_tons", "reductant_tons", "eaf_mwh",
    ):
        assert math.isfinite(getattr(r, name)), f"{name} is not finite"


def test_calculator_is_positional_proof():
    """Eight positional floats would be trivial to transpose silently."""
    with pytest.raises(TypeError):
        calculate_emissions(10_000.0, 0.32, 0.018, 0.0, 2400.0, 1.0, 1.0, 0.55)  # type: ignore[misc]
```

- [ ] **Step 2: Run and verify all pass**

Run: `pytest tests/test_calculator_validation.py -v`
Expected: all passed (the implementation from Task 2 already satisfies these)

If any fail, the Task 2 implementation deviated from the spec — fix `calculator.py`, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add carbonatix/backend/tests
git commit -m "test(emissions): cover fraction, NaN and keyword-only guards"
```

---

### Task 4: Structural and property tests

**Files:**
- Test: `backend/tests/test_calculator_structural.py`

**Interfaces:**
- Consumes: `calculate_emissions` from Task 2
- Produces: nothing new. These tests protect the PRD §7.5 and §8.1 findings from silently regressing when constants are recalibrated.

- [ ] **Step 1: Write the tests**

Create `backend/tests/test_calculator_structural.py`:

```python
"""Structural properties of the model. These outlive any particular
calibration of the constants, and several of them are the reason the product
is designed the way it is (PRD 7.5 and 8.1).
"""

import pytest

from app.emissions.calculator import calculate_emissions

NOMINAL = dict(
    wet_ore_input_tons=10_000.0,
    moisture_content_pct=0.32,
    nickel_grade_pct=0.018,
    reductant_biocoke_pct=0.0,
    sec_eaf_kwh_per_t_alloy=2400.0,
    power_mix_captive_coal=1.0,
    ef_captive_pltu=1.0,
    dryer_thermal_efficiency=0.55,
)


@pytest.mark.parametrize("grade", [0.012, 0.014, 0.018, 0.022, 0.026])
def test_ore_driven_stages_ignore_nickel_grade(grade):
    """dryer and kiln heat follow ore, not nickel. If this ever fails,
    someone has wired grade into an ore-driven term."""
    base = calculate_emissions(**NOMINAL)
    r = calculate_emissions(**{**NOMINAL, "nickel_grade_pct": grade})
    assert r.dryer_emissions == pytest.approx(base.dryer_emissions, rel=1e-12)
    assert r.kiln_heat_emissions == pytest.approx(base.kiln_heat_emissions, rel=1e-12)
    assert r.dry_ore_tons == pytest.approx(base.dry_ore_tons, rel=1e-12)


def test_richer_ore_lowers_intensity():
    """The fixed ore-processing burden spreads over more metal."""
    lean = calculate_emissions(**{**NOMINAL, "nickel_grade_pct": 0.012})
    rich = calculate_emissions(**{**NOMINAL, "nickel_grade_pct": 0.026})
    assert rich.total_emissions > lean.total_emissions
    assert rich.intensity_per_tonne_ni < lean.intensity_per_tonne_ni


def test_ore_volume_elasticity_is_exactly_one():
    """Total emissions are perfectly proportional to ore volume. This is why
    a volume-proportional quota is meaningless: production cancels from both
    sides of the compliance inequality (PRD 8.1)."""
    base = calculate_emissions(**NOMINAL)
    doubled = calculate_emissions(**{**NOMINAL, "wet_ore_input_tons": 20_000.0})
    assert doubled.total_emissions == pytest.approx(2.0 * base.total_emissions, rel=1e-12)
    assert doubled.nickel_output_tons == pytest.approx(
        2.0 * base.nickel_output_tons, rel=1e-12
    )
    assert doubled.intensity_per_tonne_ni == pytest.approx(
        base.intensity_per_tonne_ni, rel=1e-12
    )


@pytest.mark.parametrize("biocoke", [0.0, 0.25, 0.5, 0.75, 1.0])
def test_reductant_emissions_fall_monotonically_with_biocoke(biocoke):
    base = calculate_emissions(**NOMINAL)
    r = calculate_emissions(**{**NOMINAL, "reductant_biocoke_pct": biocoke})
    assert r.kiln_reductant_emissions <= base.kiln_reductant_emissions


def test_emissions_rise_monotonically_with_ore():
    prev = -1.0
    for ore in (1_000.0, 5_000.0, 10_000.0, 20_000.0):
        r = calculate_emissions(**{**NOMINAL, "wet_ore_input_tons": ore})
        assert r.total_emissions > prev
        prev = r.total_emissions


def test_levers_move_emissions_at_constant_nickel_output():
    """The 28% spread at fixed production is the entire reason this product
    exists. If emissions were a fixed multiple of tonnage there would be no
    decision to support."""
    base = calculate_emissions(**NOMINAL)
    best = calculate_emissions(
        **{**NOMINAL, "reductant_biocoke_pct": 0.5,
           "power_mix_captive_coal": 0.5, "dryer_thermal_efficiency": 0.75}
    )
    assert best.nickel_output_tons == pytest.approx(base.nickel_output_tons, rel=1e-12)
    assert best.total_emissions < base.total_emissions * 0.85


def test_scope_2_share_stays_in_calibration_corridor():
    """Guards the SEC calibration. Below this corridor, captive PLTU looks
    trivial and the product's own problem statement collapses (PRD 17.1)."""
    r = calculate_emissions(**NOMINAL)
    share = r.eaf_emissions / r.total_emissions
    assert 0.25 <= share <= 0.45, (
        f"Scope 2 share {share:.1%} is outside the 25-45% corridor; "
        "SEC or the emission factors are out of calibration"
    )


def test_higher_moisture_lowers_total_but_raises_intensity():
    """Counterintuitive and worth locking down: at fixed wet ore input,
    wetter ore means less actual ore, so total falls while intensity rises.
    The dashboard must show both numbers."""
    dry = calculate_emissions(**{**NOMINAL, "moisture_content_pct": 0.25})
    wet = calculate_emissions(**{**NOMINAL, "moisture_content_pct": 0.40})
    assert wet.total_emissions < dry.total_emissions
    assert wet.intensity_per_tonne_ni > dry.intensity_per_tonne_ni
```

- [ ] **Step 2: Run the tests**

Run: `pytest tests/test_calculator_structural.py -v`
Expected: all passed.

If `test_scope_2_share_stays_in_calibration_corridor` fails, that is a real signal, not a broken test. Adjust `sec_eaf_kwh_per_t_alloy` in `NOMINAL` and the `ProcessConstants` defaults until the share lands in corridor, and record the reasoning in `backend/CALIBRATION.md`.

- [ ] **Step 3: Commit**

```bash
git add carbonatix/backend/tests
git commit -m "test(emissions): lock in driver separation, elasticity and Scope 2 corridor"
```

---

### Task 5: Compliance against an absolute quota

**Files:**
- Create: `backend/app/emissions/compliance.py`
- Test: `backend/tests/test_compliance.py`

**Interfaces:**
- Consumes: `EmissionResult` from Task 2
- Produces: `CompliancePosition` frozen dataclass with fields `cap_tco2e: float`, `projected_tco2e: float`, `position_tco2e: float`, `is_compliant: bool`, `position_value_idr: float`; `assess(result: EmissionResult, *, cap_tco2e: float, carbon_price_idr_per_ton: float) -> CompliancePosition`; `suggest_cap_from_baseline(baseline_total_tco2e: float, *, reduction_target: float) -> float`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_compliance.py`:

```python
import pytest

from app.emissions.calculator import calculate_emissions
from app.emissions.compliance import assess, suggest_cap_from_baseline

NOMINAL = dict(
    wet_ore_input_tons=10_000.0,
    moisture_content_pct=0.32,
    nickel_grade_pct=0.018,
    reductant_biocoke_pct=0.0,
    sec_eaf_kwh_per_t_alloy=2400.0,
    power_mix_captive_coal=1.0,
    ef_captive_pltu=1.0,
    dryer_thermal_efficiency=0.55,
)
PRICE = 35_200.0


def test_deficit_when_projection_exceeds_cap():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500.0, carbon_price_idr_per_ton=PRICE)
    assert p.is_compliant is False
    assert p.position_tco2e == pytest.approx(500.0, rel=1e-9)
    assert p.position_value_idr == pytest.approx(500.0 * PRICE, rel=1e-9)


def test_surplus_when_projection_below_cap():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions + 500.0, carbon_price_idr_per_ton=PRICE)
    assert p.is_compliant is True
    assert p.position_tco2e == pytest.approx(-500.0, rel=1e-9)
    assert p.position_value_idr == pytest.approx(500.0 * PRICE, rel=1e-9)


def test_exact_boundary_is_compliant():
    """Deliberate: E == Cap resolves to compliant, once, on purpose."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions, carbon_price_idr_per_ton=PRICE)
    assert p.is_compliant is True
    assert p.position_tco2e == pytest.approx(0.0, abs=1e-9)


def test_raising_production_can_cross_an_absolute_cap():
    """The scenario a volume-proportional cap makes arithmetically impossible.
    Both sides of the trading panel must be reachable (PRD 8.1)."""
    base = calculate_emissions(**NOMINAL)
    cap = base.total_emissions * 1.02
    assert assess(base, cap_tco2e=cap, carbon_price_idr_per_ton=PRICE).is_compliant

    overdrive = calculate_emissions(**{**NOMINAL, "wet_ore_input_tons": 10_500.0})
    assert not assess(overdrive, cap_tco2e=cap, carbon_price_idr_per_ton=PRICE).is_compliant


def test_levers_can_restore_compliance_after_overdrive():
    overdrive = calculate_emissions(**{**NOMINAL, "wet_ore_input_tons": 10_500.0})
    cap = calculate_emissions(**NOMINAL).total_emissions * 1.02
    improved = calculate_emissions(
        **{**NOMINAL, "wet_ore_input_tons": 10_500.0,
           "reductant_biocoke_pct": 0.5, "power_mix_captive_coal": 0.5}
    )
    assert not assess(overdrive, cap_tco2e=cap, carbon_price_idr_per_ton=PRICE).is_compliant
    assert assess(improved, cap_tco2e=cap, carbon_price_idr_per_ton=PRICE).is_compliant


def test_suggest_cap_applies_reduction_target():
    assert suggest_cap_from_baseline(10_000.0, reduction_target=0.10) == pytest.approx(9_000.0)


def test_suggest_cap_rejects_out_of_range_target():
    with pytest.raises(ValueError, match="reduction_target"):
        suggest_cap_from_baseline(10_000.0, reduction_target=1.5)


def test_assess_rejects_negative_cap():
    r = calculate_emissions(**NOMINAL)
    with pytest.raises(ValueError, match="cap_tco2e"):
        assess(r, cap_tco2e=-1.0, carbon_price_idr_per_ton=PRICE)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_compliance.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.emissions.compliance'`

- [ ] **Step 3: Implement `compliance.py`**

```python
"""Compliance position against an absolute carbon allocation.

The quota is an absolute tCO2e figure held by the company for a period, NOT
a formula proportional to ore volume. Total emissions are perfectly
proportional to ore volume, so a proportional quota would cancel production
out of both sides of the inequality: raising output 5% would raise both
emissions and quota by 5% and never move the margin. See PRD section 8.1.
"""

from dataclasses import dataclass

from .calculator import EmissionResult

__all__ = ["CompliancePosition", "assess", "suggest_cap_from_baseline"]


@dataclass(frozen=True)
class CompliancePosition:
    """Where a projection sits relative to the allocation.

    position_tco2e is signed: positive is a deficit (credits must be bought),
    negative is a surplus (credits may be sold). position_value_idr is the
    absolute rupiah value of that position and is therefore never negative.
    """

    cap_tco2e: float
    projected_tco2e: float
    position_tco2e: float
    is_compliant: bool
    position_value_idr: float


def assess(
    result: EmissionResult,
    *,
    cap_tco2e: float,
    carbon_price_idr_per_ton: float,
) -> CompliancePosition:
    """Compare a projection against the allocation.

    Raises:
        ValueError: If the cap or price is negative or not finite.
    """
    if not cap_tco2e >= 0:  # NaN fails this
        raise ValueError(f"cap_tco2e must be non-negative, got {cap_tco2e!r}")
    if not carbon_price_idr_per_ton >= 0:
        raise ValueError(
            f"carbon_price_idr_per_ton must be non-negative, "
            f"got {carbon_price_idr_per_ton!r}"
        )

    projected = result.total_emissions
    position = projected - cap_tco2e
    return CompliancePosition(
        cap_tco2e=cap_tco2e,
        projected_tco2e=projected,
        position_tco2e=position,
        # Exactly at the cap counts as compliant. Deliberate, and tested.
        is_compliant=projected <= cap_tco2e,
        position_value_idr=abs(position) * carbon_price_idr_per_ton,
    )


def suggest_cap_from_baseline(
    baseline_total_tco2e: float,
    *,
    reduction_target: float,
) -> float:
    """Grandfathered allocation: baseline emissions less a reduction target.

    Only a suggestion for the site-specification field. The stored value is
    always an absolute figure the user can edit.

    Raises:
        ValueError: If the target is not a fraction in [0, 1).
    """
    if not 0.0 <= reduction_target < 1.0:
        raise ValueError(
            f"reduction_target must be a fraction in [0, 1), got {reduction_target!r}"
        )
    if not baseline_total_tco2e >= 0:
        raise ValueError(
            f"baseline_total_tco2e must be non-negative, got {baseline_total_tco2e!r}"
        )
    return baseline_total_tco2e * (1.0 - reduction_target)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_compliance.py -v`
Expected: 8 passed

- [ ] **Step 5: Run the whole Phase 1 suite**

Run: `pytest tests/ -v`
Expected: all passed. This is the Phase 1 gate.

- [ ] **Step 6: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(emissions): add absolute-cap compliance assessment"
```

---

# PHASE 2 — FastAPI service and persistence

---

### Task 6: Pydantic schemas and the stateless `/emissions` endpoint

**Files:**
- Create: `backend/app/schemas.py`
- Create: `backend/app/main.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `calculate_emissions`, `EmissionResult` from Task 2
- Produces: `EmissionRequest` and `EmissionResponse` Pydantic models; a FastAPI `app` exposing `POST /emissions`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api.py`:

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PAYLOAD = {
    "wetOreInputTons": 10000.0,
    "moistureContentPct": 0.32,
    "nickelGradePct": 0.018,
    "reductantBiocokePct": 0.0,
    "powerMixCaptiveCoal": 1.0,
    "powerMixHydroGrid": 0.0,
    "secEafKwhPerTAlloy": 2400.0,
    "efCaptivePltu": 1.0,
    "dryerThermalEfficiency": 0.55,
}


def test_emissions_returns_full_breakdown():
    r = client.post("/emissions", json=PAYLOAD)
    assert r.status_code == 200
    body = r.json()
    for key in (
        "totalEmissions", "scope1", "scope2", "dryerEmissions",
        "kilnHeatEmissions", "kilnReductantEmissions", "eafEmissions",
        "nickelOutputTons", "alloyOutputTons", "eafMwh",
        "intensityPerTonneNi",
    ):
        assert key in body, f"missing {key}"
    assert body["totalEmissions"] > 0


def test_intensity_is_null_not_zero_when_no_nickel():
    r = client.post("/emissions", json={**PAYLOAD, "nickelGradePct": 0.0})
    assert r.status_code == 200
    assert r.json()["intensityPerTonneNi"] is None


def test_power_mix_must_sum_to_one():
    r = client.post(
        "/emissions", json={**PAYLOAD, "powerMixCaptiveCoal": 0.6, "powerMixHydroGrid": 0.25}
    )
    assert r.status_code == 422
    assert "power mix" in r.text.lower()


def test_out_of_range_fraction_names_the_field():
    r = client.post("/emissions", json={**PAYLOAD, "moistureContentPct": 32.0})
    assert r.status_code == 422
    assert "moistureContentPct" in r.text or "moisture_content_pct" in r.text


def test_nan_is_rejected():
    r = client.post("/emissions", content='{"moistureContentPct": NaN}',
                    headers={"content-type": "application/json"})
    assert r.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Implement `schemas.py`**

```python
"""Request and response models.

Field names are camelCase on the wire, snake_case in Python. Monetary fields
carry an explicit currency suffix; USD and IDR are never mixed in one object.
"""

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from .emissions.calculator import EmissionResult


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class EmissionRequest(_Camel):
    """One production interval. All _pct fields are fractions, never percentages."""

    wet_ore_input_tons: float = Field(ge=0, allow_inf_nan=False)
    moisture_content_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    nickel_grade_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    reductant_biocoke_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_captive_coal: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_hydro_grid: float = Field(ge=0, le=1, allow_inf_nan=False)
    sec_eaf_kwh_per_t_alloy: float = Field(ge=0, allow_inf_nan=False)
    ef_captive_pltu: float = Field(ge=0, allow_inf_nan=False)
    dryer_thermal_efficiency: float = Field(gt=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def _power_mix_sums_to_one(self) -> "EmissionRequest":
        """The hydro share never enters the arithmetic, so an unaccounted
        share would be invisible: a plant with a 15% diesel genset would
        produce output identical to a fully-accounted one. Check it here,
        where both shares are still in scope.
        """
        total = self.power_mix_captive_coal + self.power_mix_hydro_grid
        if abs(total - 1.0) > 1e-9:
            raise ValueError(
                f"power mix shares must sum to 1, got captive "
                f"{self.power_mix_captive_coal} + hydro/grid "
                f"{self.power_mix_hydro_grid} = {total}"
            )
        return self


class EmissionResponse(_Camel):
    nickel_output_tons: float
    alloy_output_tons: float
    dryer_emissions: float
    kiln_heat_emissions: float
    kiln_reductant_emissions: float
    eaf_emissions: float
    total_emissions: float
    scope_1: float
    scope_2: float
    intensity_per_tonne_ni: float | None
    dry_ore_tons: float
    dryer_coal_tons: float
    kiln_coal_tons: float
    reductant_tons: float
    eaf_mwh: float

    @classmethod
    def from_result(cls, r: EmissionResult) -> "EmissionResponse":
        return cls(
            nickel_output_tons=r.nickel_output_tons,
            alloy_output_tons=r.alloy_output_tons,
            dryer_emissions=r.dryer_emissions,
            kiln_heat_emissions=r.kiln_heat_emissions,
            kiln_reductant_emissions=r.kiln_reductant_emissions,
            eaf_emissions=r.eaf_emissions,
            total_emissions=r.total_emissions,
            scope_1=r.scope_1,
            scope_2=r.scope_2,
            intensity_per_tonne_ni=r.intensity_per_tonne_ni,
            dry_ore_tons=r.dry_ore_tons,
            dryer_coal_tons=r.dryer_coal_tons,
            kiln_coal_tons=r.kiln_coal_tons,
            reductant_tons=r.reductant_tons,
            eaf_mwh=r.eaf_mwh,
        )


class CompliancePositionResponse(_Camel):
    cap_tco2e: float
    projected_tco2e: float
    position_tco2e: float
    is_compliant: bool
    position_value_idr: float
```

- [ ] **Step 4: Implement `main.py`**

```python
"""FastAPI application. Route registration only -- logic lives in modules."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .emissions.calculator import calculate_emissions
from .schemas import EmissionRequest, EmissionResponse

app = FastAPI(title="SmartSmelt ERP API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/emissions", response_model=EmissionResponse)
def post_emissions(req: EmissionRequest) -> EmissionResponse:
    """Stateless recompute. No database write.

    Called on every parameter change in the twin, so it must stay cheap: it is
    pure arithmetic and returns in microseconds.
    """
    result = calculate_emissions(
        wet_ore_input_tons=req.wet_ore_input_tons,
        moisture_content_pct=req.moisture_content_pct,
        nickel_grade_pct=req.nickel_grade_pct,
        reductant_biocoke_pct=req.reductant_biocoke_pct,
        sec_eaf_kwh_per_t_alloy=req.sec_eaf_kwh_per_t_alloy,
        power_mix_captive_coal=req.power_mix_captive_coal,
        ef_captive_pltu=req.ef_captive_pltu,
        dryer_thermal_efficiency=req.dryer_thermal_efficiency,
    )
    return EmissionResponse.from_result(result)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_api.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(api): add stateless /emissions endpoint"
```

---

### Task 7: Supabase schema and migrations

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `backend/.env.example`

**Interfaces:**
- Consumes: nothing
- Produces: tables `companies`, `calculation_runs`, `recommendations`, `documents`, `price_history`, `forecasts` with RLS enabled.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_init.sql`:

```sql
-- Company profile: one per user. Holds the site specification, which changes
-- rarely, and the absolute carbon allocation for the period.
create table public.companies (
    id                          uuid primary key default gen_random_uuid(),
    user_id                     uuid not null references auth.users(id) on delete cascade,
    name                        text not null,
    technology                  text not null default 'RKEF',
    -- Site specification
    ef_captive_pltu             double precision not null,
    dryer_thermal_efficiency    double precision not null,
    sec_eaf_kwh_per_t_alloy     double precision not null,
    alloy_nickel_grade          double precision not null default 0.10,
    kiln_thermal_efficiency     double precision not null default 0.55,
    -- Absolute allocation in tCO2e for the period. NOT derived from ore volume.
    cap_tco2e                   double precision not null,
    created_at                  timestamptz not null default now(),
    unique (user_id)
);

-- An immutable committed snapshot. Stores the forecast it was computed
-- against rather than joining live: otherwise reopening yesterday's run would
-- show yesterday's emissions against today's carbon price, and the rupiah
-- figure on screen would stop matching the one the advisor was given.
create table public.calculation_runs (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,
    company_id          uuid not null references public.companies(id) on delete cascade,
    inputs              jsonb not null,
    result              jsonb not null,
    compliance          jsonb not null,
    forecast_snapshot   jsonb not null,
    created_at          timestamptz not null default now()
);
create index on public.calculation_runs (user_id, created_at desc);

create table public.recommendations (
    id          uuid primary key default gen_random_uuid(),
    run_id      uuid not null references public.calculation_runs(id) on delete cascade,
    steps       jsonb not null,
    body        text,
    citations   jsonb not null default '[]'::jsonb,
    model       text not null,
    confidence  double precision,
    failed      boolean not null default false,
    created_at  timestamptz not null default now()
);
create index on public.recommendations (run_id);

create table public.documents (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    storage_key text not null,
    profile     text not null check (profile in ('site_spec', 'operational')),
    extraction  jsonb not null default '{}'::jsonb,
    accepted    boolean not null default false,
    created_at  timestamptz not null default now()
);

-- Historical price series. Seeded once, used for training and for chart context.
create table public.price_history (
    observed_on             date primary key,
    lme_usd_per_ton         double precision,
    idx_carbon_idr_per_ton  double precision
);

create table public.forecasts (
    id              uuid primary key default gen_random_uuid(),
    generated_on    date not null,
    horizon_days    integer not null,
    series          jsonb not null,
    unique (generated_on, horizon_days)
);

alter table public.companies          enable row level security;
alter table public.calculation_runs   enable row level security;
alter table public.recommendations    enable row level security;
alter table public.documents          enable row level security;

create policy own_company on public.companies
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_runs on public.calculation_runs
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_documents on public.documents
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_recommendations on public.recommendations
    for all using (
        exists (select 1 from public.calculation_runs r
                where r.id = run_id and r.user_id = auth.uid())
    );
```

- [ ] **Step 2: Create `.env.example`**

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_JWT_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
ANTHROPIC_API_KEY=
ALLOWED_ORIGIN=http://localhost:3000
```

- [ ] **Step 3: Apply the migration**

Run: `supabase db push` (or paste into the Supabase SQL editor).
Expected: six tables created, RLS enabled on four.

- [ ] **Step 4: Commit**

```bash
git add supabase carbonatix/backend/.env.example
git commit -m "feat(db): add schema with RLS and absolute cap field"
```

---

### Task 8: JWT auth dependency

**Files:**
- Create: `backend/app/auth.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `SUPABASE_JWT_SECRET` from environment
- Produces: `current_user_id(authorization: str = Header(...)) -> UUID`, a FastAPI dependency raising 401 on a missing, malformed or expired token.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_api.py`:

```python
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

SECRET = "test-secret-value"


@pytest.fixture(autouse=True)
def _jwt_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)


def _token(sub: str, *, expired: bool = False) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=-1 if expired else 1)
    return jwt.encode(
        {"sub": sub, "exp": exp, "aud": "authenticated"}, SECRET, algorithm="HS256"
    )


def test_protected_route_rejects_missing_token():
    assert client.get("/company").status_code == 401


def test_protected_route_rejects_garbage_token():
    r = client.get("/company", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_protected_route_rejects_expired_token():
    t = _token(str(uuid.uuid4()), expired=True)
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py -k token -v`
Expected: FAIL — `/company` returns 404, not 401

- [ ] **Step 3: Implement `auth.py`**

```python
"""Supabase JWT verification.

The browser calls this service directly carrying the Supabase access token,
so this module is the only thing standing between the internet and a user's
data. Every failure mode returns 401 with no detail: a caller who supplied a
bad token learns nothing about why.
"""

import os
from uuid import UUID

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

__all__ = ["current_user_id"]

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def current_user_id(authorization: str | None = Header(default=None)) -> UUID:
    """Resolve the caller's user id, or raise 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise _UNAUTHORIZED

    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth is not configured",
        )

    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
        return UUID(claims["sub"])
    except (JWTError, KeyError, ValueError) as exc:
        raise _UNAUTHORIZED from exc
```

- [ ] **Step 4: Add a placeholder `/company` route to `main.py`**

```python
from uuid import UUID

from fastapi import Depends

from .auth import current_user_id


@app.get("/company")
def get_company(user_id: UUID = Depends(current_user_id)) -> dict[str, str]:
    return {"userId": str(user_id)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_api.py -v`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(auth): verify Supabase JWT on protected routes"
```

---

### Task 9: Company profile and run commit endpoints

**Files:**
- Create: `backend/app/db.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_runs.py`

**Interfaces:**
- Consumes: `current_user_id` (Task 8), `assess`, `suggest_cap_from_baseline` (Task 5)
- Produces: `GET /company`, `PUT /company`, `POST /runs`, `GET /runs/{run_id}`; `CompanyRequest`/`CompanyResponse`/`RunResponse` schemas; `db.pool()` returning an `asyncpg.Pool`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_runs.py`:

```python
"""Run commit behaviour. The database is faked with an in-memory dict via
dependency override, because what matters here is the commit contract, not
Postgres."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import current_user_id

USER = uuid.uuid4()
app.dependency_overrides[current_user_id] = lambda: USER
client = TestClient(app)

COMPANY = {
    "name": "PT Demo Smelter",
    "technology": "RKEF",
    "efCaptivePltu": 1.0,
    "dryerThermalEfficiency": 0.55,
    "secEafKwhPerTAlloy": 2400.0,
    "alloyNickelGrade": 0.10,
    "kilnThermalEfficiency": 0.55,
    "capTco2e": 7600.0,
}
OPERATIONAL = {
    "wetOreInputTons": 10000.0,
    "moistureContentPct": 0.32,
    "nickelGradePct": 0.018,
    "reductantBiocokePct": 0.0,
    "powerMixCaptiveCoal": 1.0,
    "powerMixHydroGrid": 0.0,
}


def test_run_commit_stores_result_compliance_and_forecast(fake_db):
    client.put("/company", json=COMPANY)
    r = client.post("/runs", json=OPERATIONAL)
    assert r.status_code == 201
    body = r.json()
    assert body["result"]["totalEmissions"] > 0
    assert "isCompliant" in body["compliance"]
    assert "forecastSnapshot" in body
    assert body["compliance"]["capTco2e"] == 7600.0


def test_run_is_readable_after_commit(fake_db):
    client.put("/company", json=COMPANY)
    run_id = client.post("/runs", json=OPERATIONAL).json()["id"]
    got = client.get(f"/runs/{run_id}")
    assert got.status_code == 200
    assert got.json()["id"] == run_id


def test_run_requires_a_company_first(fake_db):
    r = client.post("/runs", json=OPERATIONAL)
    assert r.status_code == 409
    assert "company" in r.text.lower()


def test_suggest_cap_endpoint_uses_baseline(fake_db):
    client.put("/company", json=COMPANY)
    r = client.post("/company/suggest-cap",
                    json={**OPERATIONAL, "reductionTarget": 0.10})
    assert r.status_code == 200
    assert r.json()["capTco2e"] > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_runs.py -v`
Expected: FAIL — `/runs` returns 404

- [ ] **Step 3: Implement `db.py`**

```python
"""Database access. A single asyncpg pool created lazily at first use."""

import os
from typing import Any

import asyncpg

_pool: asyncpg.Pool | None = None


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=5)
    return _pool


async def fetchrow(query: str, *args: Any) -> asyncpg.Record | None:
    p = await pool()
    async with p.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def execute(query: str, *args: Any) -> str:
    p = await pool()
    async with p.acquire() as conn:
        return await conn.execute(query, *args)
```

- [ ] **Step 4: Add the schemas**

Append to `backend/app/schemas.py`:

```python
class CompanyRequest(_Camel):
    name: str = Field(min_length=1, max_length=200)
    technology: str = "RKEF"
    ef_captive_pltu: float = Field(ge=0, allow_inf_nan=False)
    dryer_thermal_efficiency: float = Field(gt=0, le=1, allow_inf_nan=False)
    sec_eaf_kwh_per_t_alloy: float = Field(ge=0, allow_inf_nan=False)
    alloy_nickel_grade: float = Field(gt=0, le=1, allow_inf_nan=False)
    kiln_thermal_efficiency: float = Field(gt=0, le=1, allow_inf_nan=False)
    # Absolute allocation in tCO2e for the period, not derived from ore volume.
    cap_tco2e: float = Field(ge=0, allow_inf_nan=False)


class OperationalRequest(_Camel):
    """Per-interval levers. Site-spec values come from the stored company."""

    wet_ore_input_tons: float = Field(ge=0, allow_inf_nan=False)
    moisture_content_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    nickel_grade_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    reductant_biocoke_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_captive_coal: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_hydro_grid: float = Field(ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def _power_mix_sums_to_one(self) -> "OperationalRequest":
        total = self.power_mix_captive_coal + self.power_mix_hydro_grid
        if abs(total - 1.0) > 1e-9:
            raise ValueError(
                f"power mix shares must sum to 1, got captive "
                f"{self.power_mix_captive_coal} + hydro/grid "
                f"{self.power_mix_hydro_grid} = {total}"
            )
        return self


class SuggestCapRequest(OperationalRequest):
    reduction_target: float = Field(ge=0, lt=1, allow_inf_nan=False)


class RunResponse(_Camel):
    id: str
    result: EmissionResponse
    compliance: CompliancePositionResponse
    forecast_snapshot: dict
    created_at: str
```

- [ ] **Step 5: Add the routes to `main.py`**

```python
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException, status

from . import db
from .emissions.calculator import calculate_emissions
from .emissions.compliance import assess, suggest_cap_from_baseline
from .forecasting.service import current_forecast  # added in Task 11
from .schemas import (
    CompanyRequest, CompliancePositionResponse, EmissionResponse,
    OperationalRequest, RunResponse, SuggestCapRequest,
)


async def _load_company(user_id: UUID):
    row = await db.fetchrow(
        "select * from public.companies where user_id = $1", user_id
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No company profile. Complete onboarding first.",
        )
    return row


def _emissions_for(company, op: OperationalRequest):
    return calculate_emissions(
        wet_ore_input_tons=op.wet_ore_input_tons,
        moisture_content_pct=op.moisture_content_pct,
        nickel_grade_pct=op.nickel_grade_pct,
        reductant_biocoke_pct=op.reductant_biocoke_pct,
        sec_eaf_kwh_per_t_alloy=company["sec_eaf_kwh_per_t_alloy"],
        power_mix_captive_coal=op.power_mix_captive_coal,
        ef_captive_pltu=company["ef_captive_pltu"],
        dryer_thermal_efficiency=company["dryer_thermal_efficiency"],
    )


@app.put("/company")
async def put_company(req: CompanyRequest, user_id: UUID = Depends(current_user_id)):
    await db.execute(
        """
        insert into public.companies (
            user_id, name, technology, ef_captive_pltu, dryer_thermal_efficiency,
            sec_eaf_kwh_per_t_alloy, alloy_nickel_grade, kiln_thermal_efficiency,
            cap_tco2e
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (user_id) do update set
            name = excluded.name,
            technology = excluded.technology,
            ef_captive_pltu = excluded.ef_captive_pltu,
            dryer_thermal_efficiency = excluded.dryer_thermal_efficiency,
            sec_eaf_kwh_per_t_alloy = excluded.sec_eaf_kwh_per_t_alloy,
            alloy_nickel_grade = excluded.alloy_nickel_grade,
            kiln_thermal_efficiency = excluded.kiln_thermal_efficiency,
            cap_tco2e = excluded.cap_tco2e
        """,
        user_id, req.name, req.technology, req.ef_captive_pltu,
        req.dryer_thermal_efficiency, req.sec_eaf_kwh_per_t_alloy,
        req.alloy_nickel_grade, req.kiln_thermal_efficiency, req.cap_tco2e,
    )
    return {"status": "saved"}


@app.post("/company/suggest-cap")
async def post_suggest_cap(req: SuggestCapRequest, user_id: UUID = Depends(current_user_id)):
    """Grandfathered allocation from the all-coal, no-biocoke baseline."""
    company = await _load_company(user_id)
    baseline = calculate_emissions(
        wet_ore_input_tons=req.wet_ore_input_tons,
        moisture_content_pct=req.moisture_content_pct,
        nickel_grade_pct=req.nickel_grade_pct,
        reductant_biocoke_pct=0.0,          # baseline: no biocoke
        sec_eaf_kwh_per_t_alloy=company["sec_eaf_kwh_per_t_alloy"],
        power_mix_captive_coal=1.0,         # baseline: all captive coal
        ef_captive_pltu=company["ef_captive_pltu"],
        dryer_thermal_efficiency=company["dryer_thermal_efficiency"],
    )
    cap = suggest_cap_from_baseline(
        baseline.total_emissions, reduction_target=req.reduction_target
    )
    return {"capTco2e": cap, "baselineTco2e": baseline.total_emissions}


@app.post("/runs", status_code=status.HTTP_201_CREATED, response_model=RunResponse)
async def post_run(op: OperationalRequest, user_id: UUID = Depends(current_user_id)):
    """Commit a snapshot. Stores the forecast it was computed against so the
    rupiah figure on screen never drifts from the one the advisor was given."""
    company = await _load_company(user_id)
    result = _emissions_for(company, op)
    forecast = await current_forecast()
    position = assess(
        result,
        cap_tco2e=company["cap_tco2e"],
        carbon_price_idr_per_ton=forecast["idxCarbonIdrPerTon"][0],
    )

    run_id = uuid4()
    now = datetime.now(timezone.utc)
    await db.execute(
        """insert into public.calculation_runs
           (id, user_id, company_id, inputs, result, compliance,
            forecast_snapshot, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)""",
        run_id, user_id, company["id"],
        json.dumps(op.model_dump(by_alias=True)),
        json.dumps(EmissionResponse.from_result(result).model_dump(by_alias=True)),
        json.dumps(CompliancePositionResponse(**position.__dict__).model_dump(by_alias=True)),
        json.dumps(forecast), now,
    )
    return RunResponse(
        id=str(run_id),
        result=EmissionResponse.from_result(result),
        compliance=CompliancePositionResponse(**position.__dict__),
        forecast_snapshot=forecast,
        created_at=now.isoformat(),
    )


@app.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: UUID, user_id: UUID = Depends(current_user_id)):
    row = await db.fetchrow(
        "select * from public.calculation_runs where id = $1 and user_id = $2",
        run_id, user_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunResponse(
        id=str(row["id"]),
        result=EmissionResponse(**json.loads(row["result"])),
        compliance=CompliancePositionResponse(**json.loads(row["compliance"])),
        forecast_snapshot=json.loads(row["forecast_snapshot"]),
        created_at=row["created_at"].isoformat(),
    )
```

- [ ] **Step 6: Add the `fake_db` fixture**

Create `backend/tests/conftest.py`:

```python
"""In-memory stand-in for Postgres. The commit contract is what these tests
check; Postgres itself is exercised by the E2E test in Task 20."""

import json
import re
import uuid
from datetime import datetime, timezone

import pytest

from app import db


@pytest.fixture
def fake_db(monkeypatch):
    companies: dict[uuid.UUID, dict] = {}
    runs: dict[uuid.UUID, dict] = {}

    async def fake_fetchrow(query, *args):
        if "from public.companies" in query:
            return companies.get(args[0])
        if "from public.calculation_runs" in query:
            row = runs.get(args[0])
            return row if row and row["user_id"] == args[1] else None
        return None

    async def fake_execute(query, *args):
        if "insert into public.companies" in query:
            companies[args[0]] = {
                "id": uuid.uuid4(), "user_id": args[0], "name": args[1],
                "technology": args[2], "ef_captive_pltu": args[3],
                "dryer_thermal_efficiency": args[4],
                "sec_eaf_kwh_per_t_alloy": args[5], "alloy_nickel_grade": args[6],
                "kiln_thermal_efficiency": args[7], "cap_tco2e": args[8],
            }
        elif "insert into public.calculation_runs" in query:
            runs[args[0]] = {
                "id": args[0], "user_id": args[1], "company_id": args[2],
                "inputs": args[3], "result": args[4], "compliance": args[5],
                "forecast_snapshot": args[6], "created_at": args[7],
            }
        return "OK"

    monkeypatch.setattr(db, "fetchrow", fake_fetchrow)
    monkeypatch.setattr(db, "execute", fake_execute)
    yield
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/test_runs.py -v`
Expected: 4 passed (requires Task 11's `current_forecast`; if running out of order, stub it to return `{"idxCarbonIdrPerTon": [35200.0], "lmeUsdPerTon": [16500.0]}`)

- [ ] **Step 8: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(api): add company profile and run commit endpoints"
```

---

# PHASE 3 — Price forecasting

---

### Task 10: Seed price history and train the artifacts

**Files:**
- Create: `ml/data/price_history.csv`
- Create: `ml/train_nickel.py`
- Create: `ml/train_carbon.py`

**Interfaces:**
- Consumes: nothing
- Produces: `backend/app/forecasting/artifacts/nickel_lme.pkl` and `idx_carbon.pkl`, each a pickled fitted Prophet model.

- [ ] **Step 1: Assemble the history CSV**

Create `ml/data/price_history.csv` with columns `observed_on,lme_usd_per_ton,idx_carbon_idr_per_ton`. Collect LME nickel daily settlement and IDX Carbon daily prices from `https://www.idxcarbon.co.id/data-daily`. Blank cells are allowed and expected — Prophet tolerates gaps, which is part of why it was chosen.

Minimum viable coverage: 24 months of LME, and every available IDX Carbon print since September 2023.

- [ ] **Step 2: Write `train_nickel.py`**

```python
"""Fit and serialise the LME nickel forecaster.

Run manually; the artifact is committed to the repo. Nothing trains at
request time.
"""

import pickle
from pathlib import Path

import pandas as pd
from prophet import Prophet

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "carbonatix/backend/app/forecasting/artifacts/nickel_lme.pkl"


def main() -> None:
    df = pd.read_csv(ROOT / "ml/data/price_history.csv", parse_dates=["observed_on"])
    series = (
        df[["observed_on", "lme_usd_per_ton"]]
        .dropna()
        .rename(columns={"observed_on": "ds", "lme_usd_per_ton": "y"})
    )
    if len(series) < 180:
        raise SystemExit(f"Only {len(series)} observations; need at least 180.")

    model = Prophet(daily_seasonality=False, weekly_seasonality=True,
                    yearly_seasonality=True, interval_width=0.80)
    model.fit(series)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(pickle.dumps(model))
    print(f"Wrote {OUT} from {len(series)} observations "
          f"({series.ds.min().date()} to {series.ds.max().date()})")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Write `train_carbon.py`**

Identical structure, reading `idx_carbon_idr_per_ton`, writing `idx_carbon.pkl`, with two differences:

```python
    # IDX Carbon launched September 2023 and trades thinly. Yearly seasonality
    # cannot be estimated from a short, sparse series -- asking Prophet for it
    # produces a confident-looking curve fitted to noise.
    model = Prophet(daily_seasonality=False, weekly_seasonality=False,
                    yearly_seasonality=False, interval_width=0.80)

    if len(series) < 60:
        raise SystemExit(
            f"Only {len(series)} observations. Report this honestly: the "
            f"confidence band is wide because the market is illiquid."
        )
```

- [ ] **Step 4: Train and record a backtest**

```bash
python ml/train_nickel.py
python ml/train_carbon.py
```

Then hold out the last 30 days, refit on the remainder, and record MAPE for both series in `ml/BACKTEST.md`. This number must be quotable — a judge will ask, and "we didn't measure" is a worse answer than a poor MAPE.

- [ ] **Step 5: Commit**

```bash
git add ml carbonatix/backend/app/forecasting/artifacts
git commit -m "feat(forecasting): seed price history and train model artifacts"
```

---

### Task 11: Forecast service and endpoint

**Files:**
- Create: `backend/app/forecasting/__init__.py`, `backend/app/forecasting/service.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_forecasting.py`

**Interfaces:**
- Consumes: the `.pkl` artifacts from Task 10
- Produces: `async current_forecast(horizon_days: int = 30) -> dict` returning `{"lmeUsdPerTon": [...], "lmeUsdPerTonLower": [...], "lmeUsdPerTonUpper": [...], "idxCarbonIdrPerTon": [...], "idxCarbonIdrPerTonLower": [...], "idxCarbonIdrPerTonUpper": [...], "dates": [...], "stale": bool}`; `GET /forecasts`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_forecasting.py`:

```python
import pytest

from app.forecasting import service


@pytest.mark.asyncio
async def test_forecast_returns_both_series_with_bands():
    f = await service.current_forecast(horizon_days=7)
    for key in ("lmeUsdPerTon", "idxCarbonIdrPerTon", "dates"):
        assert key in f
    assert len(f["lmeUsdPerTon"]) == 7
    assert len(f["idxCarbonIdrPerTon"]) == 7
    for lo, mid, hi in zip(
        f["idxCarbonIdrPerTonLower"], f["idxCarbonIdrPerTon"],
        f["idxCarbonIdrPerTonUpper"],
    ):
        assert lo <= mid <= hi


@pytest.mark.asyncio
async def test_currency_suffixes_are_never_bare():
    """No response object may carry a USD and an IDR value under an
    unsuffixed name."""
    f = await service.current_forecast(horizon_days=3)
    for key in f:
        if key == "dates" or key == "stale":
            continue
        assert "Usd" in key or "Idr" in key, f"{key} lacks a currency suffix"


@pytest.mark.asyncio
async def test_missing_artifact_raises_rather_than_inventing(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "_ARTIFACT_DIR", tmp_path)
    service._models.clear()
    with pytest.raises(service.ForecastUnavailable):
        await service.current_forecast()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_forecasting.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `service.py`**

```python
"""Price forecasting from pre-trained artifacts.

Models are fitted offline (see ml/train_*.py) and loaded once at first use.
Nothing trains at request time, so the demo is reproducible.
"""

import pickle
from datetime import date, timedelta
from pathlib import Path
from typing import Any

__all__ = ["current_forecast", "ForecastUnavailable"]

_ARTIFACT_DIR = Path(__file__).parent / "artifacts"
_models: dict[str, Any] = {}


class ForecastUnavailable(RuntimeError):
    """Raised when an artifact is missing or unreadable.

    Deliberately fatal rather than falling back to a made-up number: the
    advisor is told forecasts are unavailable instead of being left to
    invent a price.
    """


def _load(name: str) -> Any:
    if name not in _models:
        path = _ARTIFACT_DIR / f"{name}.pkl"
        try:
            _models[name] = pickle.loads(path.read_bytes())
        except (OSError, pickle.UnpicklingError) as exc:
            raise ForecastUnavailable(f"Cannot load forecast artifact {name}") from exc
    return _models[name]


def _predict(name: str, horizon_days: int) -> tuple[list[float], list[float], list[float]]:
    model = _load(name)
    future = model.make_future_dataframe(periods=horizon_days)
    fc = model.predict(future).tail(horizon_days)
    return (
        fc["yhat"].tolist(),
        fc["yhat_lower"].tolist(),
        fc["yhat_upper"].tolist(),
    )


async def current_forecast(horizon_days: int = 30) -> dict:
    """Both price series for the horizon, with 80% intervals.

    Currency units are encoded in every key. USD and IDR never share a key.
    """
    if not 1 <= horizon_days <= 30:
        raise ValueError(f"horizon_days must be 1..30, got {horizon_days}")

    lme, lme_lo, lme_hi = _predict("nickel_lme", horizon_days)
    car, car_lo, car_hi = _predict("idx_carbon", horizon_days)
    start = date.today()
    return {
        "dates": [(start + timedelta(days=i)).isoformat() for i in range(horizon_days)],
        "lmeUsdPerTon": lme,
        "lmeUsdPerTonLower": lme_lo,
        "lmeUsdPerTonUpper": lme_hi,
        "idxCarbonIdrPerTon": car,
        "idxCarbonIdrPerTonLower": car_lo,
        "idxCarbonIdrPerTonUpper": car_hi,
        "stale": False,
    }
```

- [ ] **Step 4: Add the route to `main.py`**

```python
from fastapi import Query

from .forecasting.service import ForecastUnavailable, current_forecast


@app.get("/forecasts")
async def get_forecasts(horizon_days: int = Query(default=30, ge=1, le=30)):
    try:
        return await current_forecast(horizon_days)
    except ForecastUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Price forecast is temporarily unavailable",
        ) from exc
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_forecasting.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(forecasting): serve pre-trained price forecasts"
```

---

# PHASE 4 — Document ingestion

---

### Task 12: Vision extraction and candidate mapping

**Files:**
- Create: `backend/app/ingestion/__init__.py`, `vision.py`, `mapping.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_ingestion.py`
- Create: `backend/tests/fixtures/` (one clean PDF, one phone photo, one rotated scan)

**Interfaces:**
- Consumes: `ANTHROPIC_API_KEY`
- Produces: `async extract(file_bytes: bytes, media_type: str, profile: Literal["site_spec","operational"]) -> dict[str, float | None]`; `Candidate` dataclass with `field: str`, `value: float | None`, `confidence: float`, `source_hint: str`, `node: str`; `to_candidates(raw: dict, profile: str) -> list[Candidate]`; `POST /documents`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ingestion.py`:

```python
import pytest

from app.ingestion.mapping import NODE_FOR_FIELD, to_candidates


def test_every_operational_field_maps_to_exactly_one_node():
    """Each of the eight inputs belongs to exactly one twin node (PRD 13.1).
    A field with no node cannot be entered; a field with two is ambiguous."""
    operational = {
        "wet_ore_input_tons", "moisture_content_pct", "nickel_grade_pct",
        "reductant_biocoke_pct", "power_mix_captive_coal", "power_mix_hydro_grid",
    }
    site_spec = {
        "ef_captive_pltu", "dryer_thermal_efficiency", "sec_eaf_kwh_per_t_alloy",
    }
    for field in operational | site_spec:
        assert field in NODE_FOR_FIELD, f"{field} has no twin node"
        assert isinstance(NODE_FOR_FIELD[field], str)


def test_unreadable_field_becomes_a_blank_candidate_not_a_guess():
    cands = to_candidates(
        {"wet_ore_input_tons": 10000.0, "moisture_content_pct": None}, "operational"
    )
    by_field = {c.field: c for c in cands}
    assert by_field["moisture_content_pct"].value is None
    assert by_field["moisture_content_pct"].confidence == 0.0


def test_low_confidence_is_flagged_not_dropped():
    cands = to_candidates(
        {"nickel_grade_pct": 0.018}, "operational", confidences={"nickel_grade_pct": 0.3}
    )
    assert cands[0].confidence == 0.3
    assert cands[0].value == 0.018


def test_candidates_are_never_marked_accepted():
    """No code path may write an extracted value without an explicit user
    accept. This test is the guard on that rule."""
    for c in to_candidates({"wet_ore_input_tons": 10000.0}, "operational"):
        assert not hasattr(c, "accepted") or c.accepted is False


def test_percentages_are_normalised_to_fractions():
    """A document saying '32%' must arrive as 0.32, never 32."""
    cands = to_candidates({"moisture_content_pct": 32.0}, "operational")
    assert cands[0].value == pytest.approx(0.32)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ingestion.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `mapping.py`**

```python
"""Map raw extracted fields onto twin-node candidates.

A candidate is never a value. The user accepts or corrects every one, because
the difference between OCR that speeds up data entry and OCR that silently
fabricates a plant's carbon footprint is exactly this step.
"""

from dataclasses import dataclass

__all__ = ["Candidate", "NODE_FOR_FIELD", "to_candidates"]

# Every one of the eight inputs belongs to exactly one process stage.
NODE_FOR_FIELD: dict[str, str] = {
    "wet_ore_input_tons": "stockpile",
    "moisture_content_pct": "stockpile",
    "nickel_grade_pct": "stockpile",
    "dryer_thermal_efficiency": "dryer",
    "reductant_biocoke_pct": "kiln",
    "sec_eaf_kwh_per_t_alloy": "eaf",
    "power_mix_captive_coal": "pltu",
    "power_mix_hydro_grid": "pltu",
    "ef_captive_pltu": "pltu",
}

# Fields a document may express as "32%" but which the API needs as 0.32.
_FRACTION_FIELDS = frozenset(
    {"moisture_content_pct", "nickel_grade_pct", "reductant_biocoke_pct",
     "power_mix_captive_coal", "power_mix_hydro_grid", "dryer_thermal_efficiency"}
)


@dataclass(frozen=True)
class Candidate:
    """One extracted field awaiting user verification."""

    field: str
    value: float | None
    confidence: float
    node: str
    source_hint: str = ""


def _normalise(field: str, value: float | None) -> float | None:
    """Convert a percentage to a fraction when the document used one.

    A value above 1.0 on a fraction field can only be a percentage: no
    physical fraction exceeds 1. Below 1.0 it is already a fraction.
    """
    if value is None or field not in _FRACTION_FIELDS:
        return value
    return value / 100.0 if value > 1.0 else value


def to_candidates(
    raw: dict[str, float | None],
    profile: str,
    *,
    confidences: dict[str, float] | None = None,
    hints: dict[str, str] | None = None,
) -> list[Candidate]:
    """Turn a raw extraction into candidates. Unknown fields are dropped;
    unreadable fields are kept with value None and confidence 0."""
    confidences = confidences or {}
    hints = hints or {}
    out: list[Candidate] = []
    for field, value in raw.items():
        node = NODE_FOR_FIELD.get(field)
        if node is None:
            continue
        out.append(
            Candidate(
                field=field,
                value=_normalise(field, value),
                confidence=0.0 if value is None else confidences.get(field, 0.75),
                node=node,
                source_hint=hints.get(field, ""),
            )
        )
    return out
```

- [ ] **Step 4: Implement `vision.py`**

```python
"""Extract operational figures from a document using Claude vision.

Returns raw field values only. Mapping, normalisation and confidence handling
belong to mapping.py.
"""

import base64
import json
import os
from typing import Literal

from anthropic import AsyncAnthropic

__all__ = ["extract", "ExtractionFailed"]

_FIELDS = {
    "operational": [
        "wet_ore_input_tons", "moisture_content_pct", "nickel_grade_pct",
        "reductant_biocoke_pct", "power_mix_captive_coal", "power_mix_hydro_grid",
    ],
    "site_spec": [
        "ef_captive_pltu", "dryer_thermal_efficiency", "sec_eaf_kwh_per_t_alloy",
        "alloy_nickel_grade", "kiln_thermal_efficiency",
    ],
}

_PROMPT = """You are reading an Indonesian nickel smelter document.

Extract ONLY these fields: {fields}

Rules:
- Return strict JSON: {{"field_name": number_or_null, ...}}
- If a field is not present or you cannot read it clearly, return null.
- NEVER estimate, infer, or calculate a value that is not printed in the document.
- Report percentages exactly as printed (32 if the document says "32%").
- Include every field in the output, using null for the ones you did not find.

Return the JSON object and nothing else."""


class ExtractionFailed(RuntimeError):
    """The vision call failed or returned unparseable output."""


async def extract(
    file_bytes: bytes,
    media_type: str,
    profile: Literal["site_spec", "operational"],
) -> dict[str, float | None]:
    client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    fields = ", ".join(_FIELDS[profile])
    try:
        msg = await client.messages.create(
            model="claude-sonnet-5",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {
                        "type": "base64", "media_type": media_type,
                        "data": base64.b64encode(file_bytes).decode(),
                    }},
                    {"type": "text", "text": _PROMPT.format(fields=fields)},
                ],
            }],
        )
        raw = json.loads(msg.content[0].text)
    except Exception as exc:
        raise ExtractionFailed(str(exc)) from exc

    return {f: raw.get(f) for f in _FIELDS[profile]}
```

- [ ] **Step 5: Add the route to `main.py`**

```python
from fastapi import File, Form, UploadFile

from .ingestion.mapping import to_candidates
from .ingestion.vision import ExtractionFailed, extract


@app.post("/documents")
async def post_document(
    file: UploadFile = File(...),
    profile: str = Form(...),
    user_id: UUID = Depends(current_user_id),
):
    """Extract candidates from a document. Never writes a value anywhere."""
    if profile not in ("site_spec", "operational"):
        raise HTTPException(status_code=422, detail="Unknown document profile")
    try:
        raw = await extract(
            await file.read(), file.content_type or "image/jpeg", profile  # type: ignore[arg-type]
        )
    except ExtractionFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not read the document. Enter the values manually.",
        ) from exc
    return {"candidates": [c.__dict__ for c in to_candidates(raw, profile)]}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/test_ingestion.py -v`
Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(ingestion): extract document candidates via vision API"
```

---

# PHASE 5 — Advisor

---

### Task 13: Regulation corpus and prompt assembly with numeral verification

**Files:**
- Create: `backend/app/advisor/__init__.py`, `corpus.py`, `prompt.py`
- Test: `backend/tests/test_advisor.py`

**Interfaces:**
- Consumes: `EmissionResult`, `CompliancePosition`
- Produces: `Clause` dataclass (`ref: str`, `title: str`, `text: str`); `CORPUS: list[Clause]`; `select_clauses(is_compliant: bool) -> list[Clause]`; `build_prompt(result, position, forecast, clauses) -> tuple[str, set[str]]` returning the prompt and the set of permitted numerals; `unsupported_numerals(output: str, permitted: set[str]) -> set[str]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_advisor.py`:

```python
import pytest

from app.advisor.corpus import CORPUS, select_clauses
from app.advisor.prompt import build_prompt, unsupported_numerals
from app.emissions.calculator import calculate_emissions
from app.emissions.compliance import assess

NOMINAL = dict(
    wet_ore_input_tons=10_000.0, moisture_content_pct=0.32,
    nickel_grade_pct=0.018, reductant_biocoke_pct=0.0,
    sec_eaf_kwh_per_t_alloy=2400.0, power_mix_captive_coal=1.0,
    ef_captive_pltu=1.0, dryer_thermal_efficiency=0.55,
)
FORECAST = {"idxCarbonIdrPerTon": [35200.0], "lmeUsdPerTon": [16500.0]}


def test_corpus_clauses_carry_a_traceable_reference():
    assert CORPUS
    for c in CORPUS:
        assert c.ref and c.text
        assert any(k in c.ref for k in ("Perpres", "Permen", "SRN"))


def test_deficit_selects_at_least_one_clause():
    assert select_clauses(is_compliant=False)


def test_prompt_contains_clause_text_verbatim():
    """Verbatim injection is the whole anti-hallucination mechanism. If a
    clause is summarised on the way into the prompt, the citation is a lie."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    text, _ = build_prompt(r, p, FORECAST, clauses)
    for c in clauses:
        assert c.text in text, f"clause {c.ref} was not injected verbatim"


def test_permitted_numerals_include_every_supplied_figure():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    assert f"{r.total_emissions:.1f}" in permitted
    assert f"{p.position_tco2e:.1f}" in permitted


def test_invented_figure_is_caught():
    _, permitted = build_prompt(
        calculate_emissions(**NOMINAL),
        assess(calculate_emissions(**NOMINAL), cap_tco2e=1000.0,
               carbon_price_idr_per_ton=35200.0),
        FORECAST, select_clauses(is_compliant=False),
    )
    bad = "Kami merekomendasikan pembelian 999888 ton kredit karbon."
    assert "999888" in unsupported_numerals(bad, permitted)


def test_supplied_figure_passes_the_check():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    good = f"Posisi defisit sebesar {p.position_tco2e:.1f} tCO2e."
    assert unsupported_numerals(good, permitted) == set()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_advisor.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `corpus.py`**

```python
"""Curated regulation clauses, stored verbatim.

No vector database. The corpus is a few dozen clauses, and injecting the
selected ones verbatim is stronger on the no-paraphrase principle than
embedding similarity, which can silently retrieve the wrong clause.

Every `text` below must be copied character-for-character from the source
regulation. Never summarise, never translate, never tidy.
"""

from dataclasses import dataclass

__all__ = ["Clause", "CORPUS", "select_clauses"]


@dataclass(frozen=True)
class Clause:
    ref: str        # e.g. "Permen ESDM 16/2022 Pasal 18 ayat (3)"
    title: str
    text: str       # verbatim
    applies_to: str  # "deficit" | "surplus" | "always"


CORPUS: list[Clause] = [
    Clause(
        ref="Perpres 98/2021 Pasal 47",
        title="Nilai Ekonomi Karbon",
        text=(
            "PASTE THE VERBATIM ARTICLE TEXT HERE. Do not paraphrase. "
            "Source: Peraturan Presiden Nomor 98 Tahun 2021."
        ),
        applies_to="always",
    ),
    Clause(
        ref="Permen ESDM 16/2022 Pasal 18",
        title="Sanksi administratif pemotongan kuota",
        text=(
            "PASTE THE VERBATIM ARTICLE TEXT HERE, including the 25 percent "
            "quota reduction for failure to report verified emissions."
        ),
        applies_to="deficit",
    ),
    Clause(
        ref="Permen ESDM 2/2023",
        title="Tata cara perdagangan karbon subsektor pembangkitan",
        text="PASTE THE VERBATIM ARTICLE TEXT HERE.",
        applies_to="always",
    ),
    Clause(
        ref="Perpres 110/2025",
        title="Perluasan cakupan ke sektor captive",
        text="PASTE THE VERBATIM ARTICLE TEXT HERE.",
        applies_to="always",
    ),
]


def select_clauses(*, is_compliant: bool) -> list[Clause]:
    """Clauses relevant to the current position."""
    wanted = "surplus" if is_compliant else "deficit"
    return [c for c in CORPUS if c.applies_to in ("always", wanted)]
```

**Before this task is complete**, replace every `PASTE THE VERBATIM ARTICLE TEXT HERE` with the actual article text from the source regulation. A placeholder that reaches the prompt makes every citation false.

- [ ] **Step 4: Implement `prompt.py`**

```python
"""Prompt assembly and the numeral guard.

The model never produces its own figures. Every number it may use appears in
the prompt, and every numeral in its output is checked against that set.
"""

import re

from ..emissions.calculator import EmissionResult
from ..emissions.compliance import CompliancePosition
from .corpus import Clause

__all__ = ["build_prompt", "unsupported_numerals"]

_NUMERAL = re.compile(r"\d[\d.,]*")

_TEMPLATE = """Anda adalah penasihat kepatuhan karbon untuk smelter nikel RKEF di Indonesia.

ANGKA YANG TERSEDIA (gunakan HANYA angka-angka ini; jangan menghitung atau mengarang angka lain):
{figures}

KLAUSA REGULASI (dikutip verbatim; rujuk dengan nomor pasal):
{clauses}

Tugas Anda: susun rekomendasi strategis dalam Bahasa Indonesia yang menimbang
posisi karbon terhadap harga pasar, dengan rujukan pasal yang tepat.

Aturan mutlak:
- Jangan menyebut angka apa pun yang tidak ada dalam daftar di atas.
- Kutip pasal persis seperti tertulis. Jangan memparafrasa klausa hukum.
- Nyatakan secara eksplisit bahwa PLTU captive saat ini di luar cakupan wajib
  PTBAE-PU, sehingga status ini bersifat kesiapan, bukan pelanggaran berlaku.
"""


def _canonical(token: str) -> str:
    """Strip thousands separators so 35.200 and 35200 compare equal."""
    return token.replace(".", "").replace(",", "").lstrip("0") or "0"


def build_prompt(
    result: EmissionResult,
    position: CompliancePosition,
    forecast: dict,
    clauses: list[Clause],
) -> tuple[str, set[str]]:
    """Assemble the prompt and the set of numerals the model may use."""
    figures = {
        "Total emisi (tCO2e)": f"{result.total_emissions:.1f}",
        "Scope 1 (tCO2e)": f"{result.scope_1:.1f}",
        "Scope 2 (tCO2e)": f"{result.scope_2:.1f}",
        "Produksi nikel (ton)": f"{result.nickel_output_tons:.1f}",
        "Kuota (tCO2e)": f"{position.cap_tco2e:.1f}",
        "Posisi karbon (tCO2e)": f"{position.position_tco2e:.1f}",
        "Nilai posisi (IDR)": f"{position.position_value_idr:.0f}",
        "Harga karbon IDX (IDR/ton)": f"{forecast['idxCarbonIdrPerTon'][0]:.0f}",
        "Harga nikel LME (USD/ton)": f"{forecast['lmeUsdPerTon'][0]:.0f}",
    }
    if result.intensity_per_tonne_ni is not None:
        figures["Intensitas (tCO2e/tNi)"] = f"{result.intensity_per_tonne_ni:.1f}"

    figures_block = "\n".join(f"- {k}: {v}" for k, v in figures.items())
    clauses_block = "\n\n".join(f"[{c.ref}] {c.title}\n{c.text}" for c in clauses)

    permitted = {v for v in figures.values()}
    permitted |= {_canonical(v) for v in figures.values()}
    # Article numbers appearing in the citations are legitimate numerals too.
    for c in clauses:
        permitted |= {_canonical(m) for m in _NUMERAL.findall(c.ref)}

    return _TEMPLATE.format(figures=figures_block, clauses=clauses_block), permitted


def unsupported_numerals(output: str, permitted: set[str]) -> set[str]:
    """Numerals in the output that were not supplied. Non-empty means the
    recommendation is flagged, not shipped as advice."""
    found = set()
    for token in _NUMERAL.findall(output):
        if token in permitted or _canonical(token) in permitted:
            continue
        # Single- and double-digit numbers are ordinals, dates and list
        # markers far more often than fabricated quantities.
        if len(_canonical(token)) <= 2:
            continue
        found.add(token)
    return found
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_advisor.py -v`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(advisor): add regulation corpus and numeral-guarded prompt"
```

---

### Task 14: SSE recommendation pipeline

**Files:**
- Create: `backend/app/advisor/pipeline.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_advisor_pipeline.py`

**Interfaces:**
- Consumes: `build_prompt`, `unsupported_numerals`, `select_clauses`
- Produces: `async run_pipeline(result, position, forecast) -> AsyncIterator[dict]` yielding `{"stage": str, "status": "running"|"done"|"failed", "payload": ...}` for stages `retrieve`, `assemble`, `synthesise`, `verify`; `GET /runs/{run_id}/recommendation` as `text/event-stream`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_advisor_pipeline.py`:

```python
import pytest

from app.advisor import pipeline
from app.emissions.calculator import calculate_emissions
from app.emissions.compliance import assess

NOMINAL = dict(
    wet_ore_input_tons=10_000.0, moisture_content_pct=0.32,
    nickel_grade_pct=0.018, reductant_biocoke_pct=0.0,
    sec_eaf_kwh_per_t_alloy=2400.0, power_mix_captive_coal=1.0,
    ef_captive_pltu=1.0, dryer_thermal_efficiency=0.55,
)
FORECAST = {"idxCarbonIdrPerTon": [35200.0], "lmeUsdPerTon": [16500.0]}


def _fixture():
    r = calculate_emissions(**NOMINAL)
    return r, assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)


@pytest.mark.asyncio
async def test_all_four_stages_emit_in_order(monkeypatch):
    async def fake_call(prompt: str) -> str:
        return "Posisi defisit. Rujuk Permen ESDM 16/2022."
    monkeypatch.setattr(pipeline, "_call_model", fake_call)

    r, p = _fixture()
    stages = [e["stage"] async for e in pipeline.run_pipeline(r, p, FORECAST)
              if e["status"] == "done"]
    assert stages == ["retrieve", "assemble", "synthesise", "verify"]


@pytest.mark.asyncio
async def test_model_failure_marks_the_stage_failed_not_the_run(monkeypatch):
    async def boom(prompt: str) -> str:
        raise RuntimeError("upstream timeout")
    monkeypatch.setattr(pipeline, "_call_model", boom)

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    failed = [e for e in events if e["status"] == "failed"]
    assert len(failed) == 1
    assert failed[0]["stage"] == "synthesise"


@pytest.mark.asyncio
async def test_invented_figure_flags_the_recommendation(monkeypatch):
    async def liar(prompt: str) -> str:
        return "Beli 999888 ton kredit karbon."
    monkeypatch.setattr(pipeline, "_call_model", liar)

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    verify = next(e for e in events if e["stage"] == "verify" and e["status"] != "running")
    assert verify["payload"]["flagged"] is True
    assert "999888" in verify["payload"]["unsupported"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_advisor_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `pipeline.py`**

```python
"""Four-stage recommendation pipeline.

Each stage is a node in the dashboard's graph. Stages emit running/done/failed
so the user can watch the reasoning rather than wait on a spinner -- which is
the answer to the "AI black box" objection.
"""

import os
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from ..emissions.calculator import EmissionResult
from ..emissions.compliance import CompliancePosition
from .corpus import select_clauses
from .prompt import build_prompt, unsupported_numerals

__all__ = ["run_pipeline"]

_MODEL = "claude-sonnet-5"


async def _call_model(prompt: str) -> str:
    client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = await client.messages.create(
        model=_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


async def run_pipeline(
    result: EmissionResult,
    position: CompliancePosition,
    forecast: dict,
) -> AsyncIterator[dict]:
    """Yield one event per stage transition."""

    yield {"stage": "retrieve", "status": "running", "payload": None}
    clauses = select_clauses(is_compliant=position.is_compliant)
    yield {"stage": "retrieve", "status": "done",
           "payload": {"refs": [c.ref for c in clauses]}}

    yield {"stage": "assemble", "status": "running", "payload": None}
    prompt, permitted = build_prompt(result, position, forecast, clauses)
    yield {"stage": "assemble", "status": "done",
           "payload": {"figureCount": len(permitted)}}

    yield {"stage": "synthesise", "status": "running", "payload": None}
    try:
        body = await _call_model(prompt)
    except Exception as exc:
        # The recommendation is the only non-essential output. Emission,
        # compliance and forecast panels stand on their own; nothing is
        # fabricated to fill the gap.
        yield {"stage": "synthesise", "status": "failed", "payload": {"error": str(exc)}}
        return
    yield {"stage": "synthesise", "status": "done", "payload": {"body": body}}

    yield {"stage": "verify", "status": "running", "payload": None}
    unsupported = unsupported_numerals(body, permitted)
    yield {
        "stage": "verify",
        "status": "done",
        "payload": {
            "flagged": bool(unsupported),
            "unsupported": sorted(unsupported),
            "citations": [c.ref for c in clauses if c.ref in body],
            "body": body,
            "model": _MODEL,
        },
    }
```

- [ ] **Step 4: Add the SSE route to `main.py`**

```python
import json

from fastapi.responses import StreamingResponse

from .advisor.pipeline import run_pipeline


@app.get("/runs/{run_id}/recommendation")
async def get_recommendation(run_id: UUID, user_id: UUID = Depends(current_user_id)):
    row = await db.fetchrow(
        "select * from public.calculation_runs where id = $1 and user_id = $2",
        run_id, user_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    from .emissions.calculator import EmissionResult
    from .emissions.compliance import CompliancePosition

    result_json = json.loads(row["result"])
    compliance_json = json.loads(row["compliance"])

    async def stream():
        result = EmissionResult(
            nickel_output_tons=result_json["nickelOutputTons"],
            alloy_output_tons=result_json["alloyOutputTons"],
            dryer_emissions=result_json["dryerEmissions"],
            kiln_heat_emissions=result_json["kilnHeatEmissions"],
            kiln_reductant_emissions=result_json["kilnReductantEmissions"],
            eaf_emissions=result_json["eafEmissions"],
            total_emissions=result_json["totalEmissions"],
            dry_ore_tons=result_json["dryOreTons"],
            dryer_coal_tons=result_json["dryerCoalTons"],
            kiln_coal_tons=result_json["kilnCoalTons"],
            reductant_tons=result_json["reductantTons"],
            eaf_mwh=result_json["eafMwh"],
        )
        position = CompliancePosition(
            cap_tco2e=compliance_json["capTco2e"],
            projected_tco2e=compliance_json["projectedTco2e"],
            position_tco2e=compliance_json["positionTco2e"],
            is_compliant=compliance_json["isCompliant"],
            position_value_idr=compliance_json["positionValueIdr"],
        )
        async for event in run_pipeline(
            result, position, json.loads(row["forecast_snapshot"])
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/ -v`
Expected: all passed. This is the Phase 5 gate — the entire backend.

- [ ] **Step 6: Commit**

```bash
ruff check app tests && ruff format app tests
git add carbonatix/backend
git commit -m "feat(advisor): stream four-stage recommendation over SSE"
```

---

# PHASE 6 — Frontend

---

### Task 15: Next.js scaffold, Supabase auth, and the unit boundary

**Files:**
- Create: `frontend/` (via `create-next-app`)
- Create: `frontend/lib/supabase.ts`, `frontend/lib/units.ts`, `frontend/lib/api.ts`
- Create: `frontend/types/emissions.ts`
- Create: `frontend/app/(auth)/login/page.tsx`, `frontend/app/(auth)/register/page.tsx`
- Test: `frontend/lib/units.test.ts`

**Interfaces:**
- Consumes: `POST /emissions` from Task 6
- Produces: `toFraction(percent: number): number`, `toPercent(fraction: number): number`; `createBrowserClient()`; `postEmissions(input: EmissionInput): Promise<EmissionResult>`; the `EmissionInput` and `EmissionResult` TypeScript types.

- [ ] **Step 1: Scaffold**

```bash
cd "D:/! CarbonatiX/carbonatix"
npx create-next-app@latest frontend --typescript --tailwind --app --eslint --no-src-dir
cd frontend
npm install @supabase/supabase-js @supabase/ssr three @react-three/fiber @react-three/drei recharts
npm install -D vitest @vitejs/plugin-react
```

- [ ] **Step 2: Write the failing unit-boundary test**

Create `frontend/lib/units.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { toFraction, toPercent } from "./units";

describe("the single percent<->fraction boundary", () => {
  it("converts a displayed percentage to an API fraction", () => {
    expect(toFraction(32)).toBeCloseTo(0.32, 10);
    expect(toFraction(1.8)).toBeCloseTo(0.018, 10);
    expect(toFraction(100)).toBeCloseTo(1.0, 10);
    expect(toFraction(0)).toBe(0);
  });

  it("converts an API fraction back for display", () => {
    expect(toPercent(0.32)).toBeCloseTo(32, 10);
  });

  it("round-trips", () => {
    for (const p of [0, 1.8, 25, 32, 99.9, 100]) {
      expect(toPercent(toFraction(p))).toBeCloseTo(p, 10);
    }
  });

  it("rejects NaN rather than passing it to the API", () => {
    expect(() => toFraction(NaN)).toThrow();
  });

  it("rejects percentages above 100", () => {
    expect(() => toFraction(101)).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/units.test.ts`
Expected: FAIL — cannot resolve `./units`

- [ ] **Step 4: Implement `lib/units.ts`**

```typescript
/**
 * The one and only place percentages become fractions.
 *
 * The API takes fractions in [0, 1]; the UI shows percentages because that is
 * what an operator reads off a report. Converting anywhere else risks sending
 * 32 where 0.32 is meant -- which the backend rejects, but only after the user
 * has filled in a form and pressed a button.
 */

export function toFraction(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new RangeError(`Expected a finite percentage, got ${percent}`);
  }
  if (percent < 0 || percent > 100) {
    throw new RangeError(`Percentage must be between 0 and 100, got ${percent}`);
  }
  return percent / 100;
}

export function toPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    throw new RangeError(`Expected a finite fraction, got ${fraction}`);
  }
  return fraction * 100;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/units.test.ts`
Expected: 5 passed

- [ ] **Step 6: Implement `lib/supabase.ts` and the auth pages**

```typescript
import { createBrowserClient as create } from "@supabase/ssr";

export function createBrowserClient() {
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

Login page calls `supabase.auth.signInWithPassword({ email, password })`; register page calls `supabase.auth.signUp(...)`. Both redirect to `/onboarding` on success and render the Supabase error message in Bahasa Indonesia on failure. Unauthenticated visits to `/twin`, `/dashboard` or `/onboarding` redirect to `/login`.

- [ ] **Step 7: Implement `lib/api.ts`**

```typescript
import { createBrowserClient } from "./supabase";
import type { EmissionInput, EmissionResult } from "@/types/emissions";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await createBrowserClient().auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
  };
}

export async function postEmissions(input: EmissionInput): Promise<EmissionResult> {
  const res = await fetch(`${BASE}/emissions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 8: Commit**

```bash
npm run lint && npx tsc --noEmit
git add carbonatix/frontend
git commit -m "feat(web): scaffold Next.js with Supabase auth and unit boundary"
```

---

### Task 16: Onboarding and site specification

**Files:**
- Create: `frontend/app/onboarding/page.tsx`
- Create: `frontend/components/twin/UploadDropzone.tsx`

**Interfaces:**
- Consumes: `PUT /company`, `POST /company/suggest-cap`, `POST /documents` (profile `site_spec`)
- Produces: a completed company profile; redirects to `/twin`.

- [ ] **Step 1: Build the form**

Fields, labelled in Bahasa Indonesia, with units shown: `efCaptivePltu` (tCO₂e/MWh), `dryerThermalEfficiency` (%), `secEafKwhPerTAlloy` (kWh/ton alloy), `alloyNickelGrade` (%), `kilnThermalEfficiency` (%), `capTco2e` (tCO₂e).

Percentage fields use `toFraction` on submit. Never inline the division.

- [ ] **Step 2: Add the cap helper**

Next to `capTco2e`, a button reading **"Hitung dari baseline"** opens a small panel taking a nominal operational interval plus a reduction target, calls `POST /company/suggest-cap`, and fills the field. The field stays editable; the stored value is always absolute.

Below the field, show the implied intensity — `capTco2e / wetOreInputTons` — so an implausible allocation is visible on entry rather than at commit.

- [ ] **Step 3: Add the site-spec dropzone**

`UploadDropzone` posts to `/documents` with `profile=site_spec` and renders returned candidates as a review list: field label, extracted value, confidence badge, and **Terima** / **Perbaiki** buttons. Nothing writes to the form until **Terima** is pressed. Candidates with `value === null` render as "Tidak terbaca" with the input left blank.

- [ ] **Step 4: Verify manually**

Register a new account, complete onboarding, confirm the row lands in `public.companies` with the cap stored, and confirm an uploaded document never populates a field without a click.

- [ ] **Step 5: Commit**

```bash
npm run lint && npx tsc --noEmit
git add carbonatix/frontend
git commit -m "feat(web): add onboarding with cap helper and site-spec upload"
```

---

### Task 17: Digital Twin 3D as the input interface

**Files:**
- Create: `frontend/app/twin/page.tsx`
- Create: `frontend/components/twin/Scene.tsx`, `frontend/components/twin/NodePanel.tsx`

**Interfaces:**
- Consumes: `postEmissions`, `toFraction`, `UploadDropzone`
- Produces: parameter state in the page, live `EmissionResult`, and a **Commit** action calling `POST /runs`.

- [ ] **Step 1: Build the scene**

Five clickable meshes in a React Three Fiber canvas, laid out left to right in process order: `stockpile`, `dryer`, `kiln`, `eaf`, `pltu`. Primitive geometry is fine — a cylinder for the kiln, a box for the furnace. Do not block on a modelled asset.

Each mesh carries a floating label showing its emission contribution in tCO₂e, updated live.

- [ ] **Step 2: Build the node panel**

Clicking a mesh opens `NodePanel` for that node. The field-to-node mapping is fixed and must match `NODE_FOR_FIELD` in the backend exactly:

| node | fields |
|---|---|
| `stockpile` | `wetOreInputTons`, `moistureContentPct`, `nickelGradePct` |
| `dryer` | `dryerThermalEfficiency` |
| `kiln` | `reductantBiocokePct` |
| `eaf` | `secEafKwhPerTAlloy` |
| `pltu` | `powerMixCaptiveCoal`, `powerMixHydroGrid`, `efCaptivePltu` |

Each panel has two tabs: **Isi manual** and **Unggah dokumen** (reusing `UploadDropzone` with `profile=operational`).

- [ ] **Step 3: Add the power-mix remainder display**

The `pltu` panel shows a running total: `Tercatat: 85% · Belum tercatat: 15%`. When the remainder is non-zero, the Commit button is disabled with the message *"Bauran daya harus berjumlah 100%."*

This exists because the hydro share never enters the arithmetic, so an unaccounted 15% diesel genset would otherwise produce output identical to a fully-accounted plant.

- [ ] **Step 4: Wire live recompute**

On every field change, debounce 150 ms and call `postEmissions`. Update node labels and the dashboard summary. On a 422, parse the field name from the response and turn the owning node's mesh red with the message attached to that node.

- [ ] **Step 5: Add commit**

A **Simpan perhitungan** button calls `POST /runs` and navigates to `/dashboard?run=<id>`.

- [ ] **Step 6: Commit**

```bash
npm run lint && npx tsc --noEmit
git add carbonatix/frontend
git commit -m "feat(web): add 3D twin as the primary input interface"
```

---

### Task 18: Dashboard

**Files:**
- Create: `frontend/app/dashboard/page.tsx`
- Create: `frontend/components/dashboard/EmissionBars.tsx`, `CompliancePanel.tsx`, `ForecastChart.tsx`

**Interfaces:**
- Consumes: `GET /runs/{id}`, `GET /forecasts`
- Produces: the results view.

- [ ] **Step 1: Build `EmissionBars`**

Group the four stage bars into two labelled clusters, not four side-by-side bars:

- **Digerakkan bijih** — `dryerEmissions`, `kilnHeatEmissions`
- **Digerakkan nikel** — `kilnReductantEmissions`, `eafEmissions`

That grouping is what explains why richer ore lowers intensity and why two plants with identical nickel output can differ by 28%. Also show the Scope 1 / Scope 2 split as a separate stacked bar.

- [ ] **Step 2: Show total and intensity together**

Always render `totalEmissions` and `intensityPerTonneNi` as a pair, never one alone — they move in opposite directions when moisture changes, and showing only the total makes wetter ore look like an improvement.

Render `intensityPerTonneNi === null` as `—` with the tooltip *"Tidak ada nikel yang di-tap pada interval ini."* Never `0`.

- [ ] **Step 3: Build `CompliancePanel`**

Show `capTco2e`, `projectedTco2e`, the signed `positionTco2e` labelled Surplus or Defisit, and `positionValueIdr` formatted as rupiah.

Directly beneath the status badge, in permanent body text rather than a tooltip:

> PLTU captive saat ini berada di luar cakupan wajib PTBAE-PU. Status ini bersifat kesiapan regulasi, bukan pelanggaran hukum yang berlaku.

- [ ] **Step 4: Build `ForecastChart`**

Two charts. LME nickel labelled **USD/ton**, IDX Carbon labelled **IDR/ton**, each with its 80% band. Never plot both on one axis.

If `GET /forecasts` returns 503, render the last cached series behind a banner: *"Proyeksi harga tidak tersedia. Menampilkan data terakhir."*

- [ ] **Step 5: Add the standing disclosures**

A permanent footer, visible without scrolling to it:

> Biocoke dihitung nol-emisi (karbon biogenik). Share hidro dan grid dihitung nol-emisi. Konstanta proses adalah placeholder yang belum terkalibrasi.

- [ ] **Step 6: Commit**

```bash
npm run lint && npx tsc --noEmit
git add carbonatix/frontend
git commit -m "feat(web): add emission dashboard with grouped drivers and disclosures"
```

---

### Task 19: Node graph and recommendation panel

**Files:**
- Create: `frontend/components/advisor/NodeGraph.tsx`, `RecommendationPanel.tsx`
- Modify: `frontend/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /runs/{id}/recommendation` (SSE)
- Produces: the streamed reasoning trace and recommendation.

- [ ] **Step 1: Build `NodeGraph`**

Four nodes in a row — **Ambil regulasi**, **Rangkai angka**, **Sintesis**, **Verifikasi** — connected by arrows. Consume the SSE stream with `EventSource` and colour each node grey (pending), blue with a spinner (running), green (done), red (failed).

- [ ] **Step 2: Build `RecommendationPanel`**

Render the `body` from the `verify` payload. Render each entry in `citations` as a chip that expands to the verbatim clause text on click.

When `flagged` is true, replace the recommendation with a warning rather than showing it as advice:

> Rekomendasi ini memuat angka yang tidak berasal dari perhitungan sistem dan tidak ditampilkan sebagai saran eksekusi. Angka bermasalah: {unsupported}

- [ ] **Step 3: Handle the failed stage**

If the `synthesise` node goes red, the panel shows *"Rekomendasi tidak tersedia saat ini. Hasil emisi, kepatuhan dan proyeksi harga di atas tetap berlaku."* The other panels stay fully rendered.

- [ ] **Step 4: Commit**

```bash
npm run lint && npx tsc --noEmit
git add carbonatix/frontend
git commit -m "feat(web): stream advisor reasoning into node graph"
```

---

### Task 20: End-to-end verification

**Files:**
- Create: `frontend/e2e/full-flow.spec.ts`
- Create: `backend/CALIBRATION.md`

- [ ] **Step 1: Install Playwright**

```bash
cd carbonatix/frontend && npm install -D @playwright/test && npx playwright install chromium
```

- [ ] **Step 2: Write the E2E test**

```typescript
import { expect, test } from "@playwright/test";

test("register through recommendation", async ({ page }) => {
  const email = `demo+${Date.now()}@example.com`;

  await page.goto("/register");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo-password-123");
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/onboarding/);
  await page.fill('input[name="name"]', "PT Demo Smelter");
  await page.fill('input[name="efCaptivePltu"]', "1.0");
  await page.fill('input[name="dryerThermalEfficiency"]', "55");
  await page.fill('input[name="secEafKwhPerTAlloy"]', "2400");
  await page.fill('input[name="capTco2e"]', "7600");
  await page.click('button:has-text("Simpan")');

  await expect(page).toHaveURL(/twin/);
  await page.click('[data-node="stockpile"]');
  await page.fill('input[name="wetOreInputTons"]', "10000");
  await page.fill('input[name="moistureContentPct"]', "32");
  await page.fill('input[name="nickelGradePct"]', "1.8");

  await page.click('[data-node="pltu"]');
  await page.fill('input[name="powerMixCaptiveCoal"]', "100");
  await page.fill('input[name="powerMixHydroGrid"]', "0");

  await expect(page.locator('[data-testid="total-emissions"]')).not.toHaveText("0");

  await page.click('button:has-text("Simpan perhitungan")');
  await expect(page).toHaveURL(/dashboard/);

  await expect(page.locator('[data-testid="node-retrieve"]')).toHaveAttribute(
    "data-status", "done", { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="recommendation-body"]')).not.toBeEmpty();
});

test("power mix that does not sum to 100 blocks commit", async ({ page }) => {
  // ... login as an existing user, open the pltu node
  await page.fill('input[name="powerMixCaptiveCoal"]', "60");
  await page.fill('input[name="powerMixHydroGrid"]', "25");
  await expect(page.locator('button:has-text("Simpan perhitungan")')).toBeDisabled();
  await expect(page.locator("text=harus berjumlah 100%")).toBeVisible();
});
```

- [ ] **Step 3: Run the full suite**

```bash
cd carbonatix/backend && pytest tests/ -v
cd ../frontend && npm run lint && npx tsc --noEmit && npx vitest run && npx playwright test
```

Expected: everything passes.

- [ ] **Step 4: Write `CALIBRATION.md`**

Record, for each of the nine `ProcessConstants` plus `sec_eaf_kwh_per_t_alloy`: the value used, the source, and whether the PRD §17.1 gate is satisfied. Any constant still marked unsourced is a blocker for quoting absolute figures anywhere in the presentation.

- [ ] **Step 5: Regenerate the demo scenario**

Run the demo operating point through `calculate_emissions` and record the real outputs. Update every slide and document to match. Per PRD §21, drop the "net margin Rp19,8 miliar" claim — this system has no revenue or cost model and cannot produce it. Use `positionValueIdr`, which it can.

- [ ] **Step 6: Commit**

```bash
git add carbonatix
git commit -m "test: add end-to-end flow and calibration record"
```

---

## Self-Review

**Spec coverage.** Every functional requirement maps to a task: F-01 → 15; F-02 → 16; F-03 → 6; F-04/05 → 2, 3; F-06 → 6; F-07 → 5, 9; F-08/08a → 5, 9, 16; F-09/10/11 → 10; F-12 → 11; F-13/14/15 → 12; F-16 → 13; F-17 → 14; F-18/19 → 13, 14; F-20 → 14, 19; F-21 → 17; F-22 → 17; F-23 → 18; F-24 → 18; F-25 → 19; F-26 → 18.

**Known gaps, stated rather than hidden:**

- **F-07 baseline mode** is implemented as the baseline substitution inside `/company/suggest-cap` rather than a `from_snapshot(use_baseline=True)` function, because there is no `Snapshot` fixture class in this codebase — that type belongs to the ERP code the calculator was extracted from. If you want the dashboard's "before optimisation" comparison, add a task calling `calculate_emissions` twice with baseline levers substituted.
- **F-20 confidence score** currently reduces to the binary `flagged` from the numeral check. The PRD requires a numeric score and a threshold; the threshold value is not yet chosen. Pick it before demo, and record the reasoning.
- **`corpus.py` ships with placeholder clause text.** Task 13 Step 3 says so explicitly. Every citation is false until it is replaced.

**Type consistency check.** `EmissionResult` field names are identical across `calculator.py`, `EmissionResponse.from_result`, the SSE reconstruction in Task 14, and `types/emissions.ts`. `NODE_FOR_FIELD` (backend, Task 12) and the node table in Task 17 list the same nine field-to-node pairs. `current_forecast` returns the same key set consumed by `build_prompt` and `ForecastChart`.
