# Demo scenario figures — regenerated from the real engine

Per PRD §21: the demo figures currently written into `PRD_SmartSmelt_ERP_v2.md`
and the proposal PDF are from v1 and were never re-verified against the v2
deterministic engine. This document does that: every number below was
produced by calling `app.emissions.calculator.calculate_emissions`,
`app.emissions.compliance.assess`, and `app.forecasting.service.current_forecast`
directly, in `carbonatix/backend`, with `.venv/Scripts/python.exe`. No figure
here was copied from the PRD or the proposal; the PRD/proposal figures are
reproduced in the comparison table purely for the diff.

**Read `carbonatix/backend/CALIBRATION.md` first.** Every `ProcessConstants`
field and `sec_eaf_kwh_per_t_alloy` is UNSOURCED. Every absolute figure below
is a demonstration of the arithmetic on a fixed operating point, not a claim
about a real smelter's actual emissions.

## Inputs used (exact, reproducible)

This is the same operating point used in `tests/test_calculator_structural.py`'s
`NOMINAL` fixture, `tests/test_compliance.py`'s `NOMINAL`, and
`frontend/e2e/full-flow.spec.ts`'s onboarding/twin fill values — chosen
deliberately so the demo, the tests, and the E2E spec all describe the same
scenario instead of three different invented ones.

```python
NOMINAL = {
    "wet_ore_input_tons": 10_000.0,
    "moisture_content_pct": 0.32,
    "nickel_grade_pct": 0.018,
    "reductant_biocoke_pct": 0.0,
    "sec_eaf_kwh_per_t_alloy": 2400.0,
    "power_mix_captive_coal": 1.0,
    "ef_captive_pltu": 1.0,
    "dryer_thermal_efficiency": 0.55,
}
```

`ProcessConstants` used: `DEFAULT_CONSTANTS` (unmodified) from
`app/emissions/constants.py` — `recovery_yield=0.90`, `delta_h_vap=2.60`,
`lhv_coal=20.0`, `ef_coal_thermal=2.20`, `kiln_thermal_efficiency=0.55`,
`k_heat=1.80`, `k_stoic=2.00`, `ef_reductant=3.20`, `alloy_nickel_grade=0.10`.

This describes **one production interval** (e.g. one day's ore throughput),
not a year. That distinction matters below.

## Real engine output — base case (100% production)

```
nickel_output_tons        =    110.160
alloy_output_tons         =  1,101.600
dryer_emissions           =  1,664.000   tCO2e
kiln_heat_emissions       =  2,448.000   tCO2e
kiln_reductant_emissions  =    705.024   tCO2e
eaf_emissions             =  2,643.840   tCO2e
total_emissions           =  7,460.864   tCO2e
scope_1 (dryer+kiln+reductant) = 4,817.024 tCO2e
scope_2 (eaf)                  = 2,643.840 tCO2e
scope_2 share of total         = 35.44%   (inside the 25-45% corridor test)
intensity_per_tonne_ni         = 67.7275  tCO2e/tNi
```

## Real engine output — overdrive case (105% production)

Same inputs, `wet_ore_input_tons = 10_500.0` (nickel grade, moisture, and
every other lever unchanged):

```
nickel_output_tons  =    115.668
total_emissions     =  7,833.9072  tCO2e
intensity_per_tonne_ni = 67.7275  tCO2e/tNi   (unchanged — see below)
```

Intensity is unchanged because `total_emissions` and `nickel_output_tons`
both scale by exactly 1.05 (the model's elasticity-of-exactly-one property,
locked down by `test_ore_volume_elasticity_is_exactly_one`). This is also
why the compliance mechanism below only works with an **absolute** cap.

## Compliance position, at a fixed cap of 7,600 tCO2e

7,600 was chosen because it is close to — and just above — the base case's
7,460.864 tCO2e, giving a clean "compliant with headroom" story at 100%
production and a clean "crosses into deficit" story at 105%. It is also the
exact `capTco2e` value used in `frontend/e2e/full-flow.spec.ts`'s onboarding
step, so the E2E spec and this document describe the same scenario.

Carbon price used: **Rp 47,231.34/ton**, the actual output of
`current_forecast(horizon_days=1)`'s `idxCarbonIdrPerTon[0]` for the demo
run's date, read from the committed synthetic-training-data forecasting
artifacts (`ml/*_SYNTHETIC.pkl`). This is **not** the PRD's Rp 35,200/ton —
that figure was never re-derived from this system's forecast artifacts, and
this system has no other source of a carbon price. The forecast response's
own `synthetic: true` flag and per-series `provenance.warning` both say this
plainly: it is a synthetic training series, not a real market quote, and
must not be presented as one.

| Case | `total_emissions` | `cap_tco2e` | `is_compliant` | `position_tco2e` | `position_value_idr` |
|---|---|---|---|---|---|
| Base (100%) | 7,460.864 | 7,600 | **True** (surplus) | -139.136 | Rp 6,571,579.68 |
| Overdrive (105%) | 7,833.9072 | 7,600 | **False** (deficit) | +233.9072 | Rp 11,047,750.42 |

`position_value_idr` is `abs(position_tco2e) * carbon_price_idr_per_ton` —
exactly `CompliancePosition.position_value_idr` from
`app/emissions/compliance.py`, computed by calling `assess()` directly, not
hand-derived.

### Does the overdrive scenario actually work now? Yes — demonstrated directly.

Under the v1 formula (`Cap = V_ore * beta`), the quota was proportional to
ore volume, so raising production by 5% raised both emissions and quota by
5% and could never create a deficit — this is exactly
`test_ore_volume_elasticity_is_exactly_one`'s point, and PRD §21 correction
#1 says so. Under the v2 model, the cap is an **absolute** figure stored on
the company/run, independent of `wet_ore_input_tons`. The numbers above
show this directly: holding the cap fixed at 7,600, moving ore volume alone
from 10,000 to 10,500 tons (a 5% increase — exactly the proposal's "raise
production to 105%") flips `is_compliant` from `True` to `False`. No formula
change, no special-casing — the same `assess()` call, same cap, different
`wet_ore_input_tons`.

The crossing is not narrowly tuned to 105%: the breakeven point (where
`total_emissions` exactly equals the 7,600 cap) is at **10,186.49 tons**, a
**+1.86%** increase over the 10,000-ton base case — verified directly:
`calculate_emissions(wet_ore_input_tons=10_186.487784792755, ...).total_emissions
== 7600.0` (exact, since the model's ore-elasticity is exactly 1). So the
cap is crossed well before 105%; 105% was only kept here to mirror the
proposal's own number, not because it is a special threshold.

## The Rp 19,8 miliar "net margin tambahan" claim — dropped

Per PRD §21 correction #2, this figure cannot be produced by this system,
and this task confirms that by inspection, not just by citing the PRD's own
admission:

- `calculate_emissions` returns an emissions breakdown. No revenue, no
  nickel sales volume, no production cost.
- `current_forecast` returns two price series (LME nickel USD/ton, IDX
  Carbon IDR/ton). No cost basis, no margin calculation.
- `assess`/`CompliancePosition` returns a carbon position and its rupiah
  value (`position_value_idr`). This is the only monetary output the system
  computes, and it is a carbon-liability/asset value, not a margin.
- There is no code path anywhere in `carbonatix/backend/app/` that combines
  a nickel price, a production volume, and a cost figure into a margin.
  Searched `app/recommendation.py` and `app/advisor/prompt.py` specifically
  for the proposal's "105%" / "8,5%" production-increase narrative: neither
  file contains any logic that computes a suggested production increase
  from a price move. That narrative is not something this system generates
  today; it would need a recommendation rule this codebase does not have,
  in addition to the missing revenue/cost model.

**The defensible financial figure this system does compute is
`positionValueIdr`** (`CompliancePositionResponse.position_value_idr`,
wired through unchanged from `CompliancePosition` in
`app/emissions/compliance.py`): `|E_total − Cap| × carbon_price_forecast`.
At the demo operating point above, that is **Rp 6,571,579.68** (base case
surplus value) or **Rp 11,047,750.42** (overdrive case deficit value),
depending which side of the cap the scenario lands on. Any presentation
material should use one of these two numbers — or the equivalent computed
at whatever operating point is actually being shown — never the margin
figure.

## PRD §21 / proposal figures vs. real engine output

| PRD §21 / proposal figure | PRD value | Real engine equivalent | Delta / verdict |
|---|---|---|---|
| Total emisi YTD | 525.000 tCO₂e | 7,460.864 tCO₂e for **one interval** (10,000 t wet ore) | **Not comparable at face value.** This system has no year-to-date aggregation feature at all — `calculate_emissions` computes exactly one interval, and no endpoint or dashboard component sums multiple runs into a YTD figure (checked: no `ytd`/`aggregate` logic anywhere in `app/` or the frontend). The PRD's 525,000 tCO₂e is not wrong so much as describing a capability that does not exist yet. |
| Intensitas | 52,5 tCO₂/tNi | 67.7275 tCO₂e/tNi | **+29.0% higher** than the PRD figure, at this operating point, using unsourced placeholder constants (see `CALIBRATION.md`). Since the underlying constants aren't sourced, this delta cannot be attributed to "the PRD was wrong" or "the engine is wrong" — only that they disagree and neither is currently defensible as ground truth. |
| Target kuota | 480.000 tCO₂e | 7,600 tCO₂e (single-interval demo cap) | **Not comparable at face value**, same YTD-vs-interval issue as the total-emissions row. |
| Net carbon position | -45.000 tCO₂e (deficit) | -139.136 tCO₂e (surplus) at 100% production; +233.9072 tCO₂e (deficit) at 105% production | Sign and mechanism now match the proposal's qualitative story (raising production can create a deficit against a fixed cap) but magnitudes are on entirely different scales (YTD aggregate vs. one interval) and should not be quoted interchangeably. |
| Harga karbon IDX Carbon | Rp 35.200/ton | Rp 47,231.34/ton (from this system's own synthetic forecast artifact, for the date the figures were generated) | Different number, different source. The PRD's Rp 35.200 is not traceable to this system's forecasting module at all. |
| Net margin tambahan | Rp 19,8 miliar | **Cannot be produced.** No revenue, cost, or margin model exists in this codebase. | **Dropped**, per PRD §21 correction #2. Use `positionValueIdr` instead (see above). |
| Denda pajak dihindari | Rp 1,35 miliar | Not computed by this system (no tax-penalty model either) | Not addressed by this task; flagged for the same reason as the margin figure — no code path produces it. |
| Kredit karbon dieksekusi | 120.750 ton | Not computed; trading execution is explicitly out of scope / mocked per PRD §17 disclosure #6 | No engine equivalent exists or is claimed to exist. |

## Reproducing these numbers

```bash
cd carbonatix/backend
.venv/Scripts/python.exe -c "
from app.emissions.calculator import calculate_emissions
from app.emissions.compliance import assess

NOMINAL = {
    'wet_ore_input_tons': 10_000.0,
    'moisture_content_pct': 0.32,
    'nickel_grade_pct': 0.018,
    'reductant_biocoke_pct': 0.0,
    'sec_eaf_kwh_per_t_alloy': 2400.0,
    'power_mix_captive_coal': 1.0,
    'ef_captive_pltu': 1.0,
    'dryer_thermal_efficiency': 0.55,
}
CAP = 7600.0
PRICE = 47231.33970917886  # from current_forecast(), see below

base = calculate_emissions(**NOMINAL)
overdrive = calculate_emissions(**{**NOMINAL, 'wet_ore_input_tons': 10_500.0})
print(base)
print(overdrive)
print(assess(base, cap_tco2e=CAP, carbon_price_idr_per_ton=PRICE))
print(assess(overdrive, cap_tco2e=CAP, carbon_price_idr_per_ton=PRICE))
"
```

To regenerate the carbon price used above (will differ by date, since the
synthetic model forecasts forward from 'today'):

```bash
cd carbonatix/backend
.venv/Scripts/python.exe -c "
import asyncio
from app.forecasting.service import current_forecast
print(asyncio.run(current_forecast(horizon_days=1)))
"
```
