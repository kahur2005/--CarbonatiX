# Calibration record

This is the PRD §17.1 calibration gate, recorded rather than passed. It
covers every field of `ProcessConstants` (`app/emissions/constants.py`) plus
`sec_eaf_kwh_per_t_alloy`, which is a per-request input to
`calculate_emissions` (`app/emissions/calculator.py`), not a
`ProcessConstants` field, but is explicitly named in the gate because of its
history (see below).

**Result: 0 of 10 constants are sourced. All ten are UNSOURCED.**

PRD §17.1 is explicit: "Tidak satu pun angka absolut boleh tampil pada slide,
materi presentasi, atau nilai default yang dikirim ke pengguna sebelum
konstanta berikut memiliki sumber tertulis" — no absolute figure may appear
on a slide, in presentation material, or as a default sent to a user before
these constants have a written source. None of them does. That is not a
soft caveat: it means **every absolute number this system currently
produces — total emissions, intensity, Scope 1/2 split, compliance
position, position value — is a demonstration of the arithmetic, not a
claim about any real smelter.** `docs/DEMO_FIGURES.md` says the same thing
about the regenerated demo scenario.

This document does not invent citations to close that gap. Where a value is
a plausible order of magnitude for the industry, that is stated as an
unverified plausibility claim, with what would need checking to turn it
into a source — never presented as if the checking had already happened.

## Gate table

All ten fields, in `ProcessConstants` order, with `sec_eaf_kwh_per_t_alloy`
placed first because it is the priority the PRD names explicitly.

| Constant | Value used | Source | Gate satisfied? |
|---|---|---|---|
| `sec_eaf_kwh_per_t_alloy` | 2400 kWh/t alloy (test fixture / demo input; not a `ProcessConstants` default — there is none, it is supplied per company/run) | **UNSOURCED.** No citation. See "Priority 1" below for why this specific number is suspect on its own terms. | **No — blocking.** |
| `recovery_yield` | 0.90 (90% of contained Ni recovered) | **UNSOURCED.** Plausible order of magnitude for RKEF nickel recovery in general industry literature, but no specific source is attached, and "plausible" here is this author's impression, not a verified figure. Would need a cited RKEF mass-balance study or a specific smelter's disclosed metallurgical balance. | No |
| `delta_h_vap` | 2.60 GJ/t water (heat + latent) | **UNSOURCED.** The latent heat of vaporization of water alone (~2.26 GJ/t at 100°C) is a textbook constant; the extra ~0.34 GJ/t presumably represents sensible heat to bring ore and moisture to evaporation temperature, but that split is not documented anywhere in this codebase and the combined figure is not attributed to any source. | No |
| `lhv_coal` | 20.0 GJ/t (Indonesian sub-bituminous, per in-code comment) | **UNSOURCED.** Indonesian sub-bituminous coal LHV commonly cited in industry ranges from roughly 17-24 GJ/t depending on seam and washing, so 20.0 is inside a plausible band, but no specific coal assay or standard (e.g. ASTM/ISO) is cited. | No |
| `ef_coal_thermal` | 2.20 tCO2e/t thermal coal | **UNSOURCED.** IPCC default emission factors for sub-bituminous coal combustion are in a broadly similar range, but this value is not traced to the IPCC guidelines, a national inventory factor, or any other citable source. | No |
| `kiln_thermal_efficiency` | 0.55 (fraction) | **UNSOURCED.** No source; no stated basis at all beyond being "literature-plausible" per the module docstring. | No |
| `k_heat` | 1.80 GJ/t dry ore (preheat + calcination) | **UNSOURCED.** No source. | No |
| `k_stoic` | 2.00 t coke/t Ni | **UNSOURCED.** No source. | No |
| `ef_reductant` | 3.20 tCO2e/t coke | **UNSOURCED.** No source. Coke has a materially higher carbon content per tonne than thermal coal, which this value being higher than `ef_coal_thermal` is at least directionally consistent with, but direction-consistency is not sourcing. | No |
| `alloy_nickel_grade` | 0.10 (NPI ~10% Ni fraction of tapped alloy, per in-code comment) | **UNSOURCED.** 8-15% Ni is a commonly cited NPI grade band in industry discussion, so 0.10 sits inside a plausible range, but again no specific source is cited, and NPI grade varies by furnace design and ore grade in ways this single constant cannot capture. | No |

Every row: **UNSOURCED**. The `DEFAULT_CONSTANTS` module docstring already
says as much ("Every default below is an UNVALIDATED PLACEHOLDER... They are
literature-plausible, not sourced"); this table exists to make that
findable per-field rather than only as one blanket disclaimer, and to rank
the fields by how much damage an unexamined placeholder does.

## Ranking: how much each constant moves the result

Two rankings are given because they answer different questions. The first
is the PRD's own qualitative ranking (§17.1), which is about *narrative
risk* — which constant, if wrong, undermines the product's problem
statement, not just its arithmetic. The second is a direct measurement of
*numerical sensitivity* at the demo operating point, which is about how
much a 10% calibration error in one direction moves `total_emissions`.
They mostly agree, but not perfectly, and the disagreement is itself
informative.

### PRD's qualitative ranking (§17.1)

1. **`sec_eaf_kwh_per_t_alloy`** — highest priority. Determines whether
   Scope 2 (captive PLTU) is 11% of the total (at 550 kWh/t alloy, per the
   PRD's own worked example) or 36% (at 2,400 kWh/t alloy). The product's
   entire problem statement is built on captive-coal Scope 2 being large,
   not incidental — see PRD §3. A miscalibration here doesn't just shift a
   number, it can invalidate the reason the product exists.
2. **`k_stoic`, `ef_reductant`** — drive the entire reductant term linearly;
   coke carries the highest per-tonne emission factor in the model.
3. **`k_heat`** — drives kiln heat, one of the largest Scope 1 terms.
4. **`ef_coal_thermal`, `lhv_coal`** — appear in both the dryer and kiln
   heat terms simultaneously.
5. **`recovery_yield`, `alloy_nickel_grade`** — govern the ore-to-nickel and
   nickel-to-alloy conversions; an error here shifts every nickel-driven
   term at once.

### Measured sensitivity at the demo operating point

Computed by perturbing each constant ±10% independently, holding the demo
operating point (10,000 t wet ore, 32% moisture, 1.8% nickel grade, 0%
biocoke, 100% captive coal, `ef_captive_pltu = 1.0`, `dryer_thermal_efficiency
= 0.55`, `sec_eaf_kwh_per_t_alloy = 2400`) fixed, and reading the resulting
change in `total_emissions` from the base value of 7,460.864 tCO2e. Script
used `app/emissions/calculator.calculate_emissions` directly via
`dataclasses.replace` on `DEFAULT_CONSTANTS`; not committed, reproducible
from the demo inputs in `docs/DEMO_FIGURES.md`.

| Constant | +10% | -10% | Rank by \|effect\| |
|---|---|---|---|
| `ef_coal_thermal` | +5.511% | -5.511% | 1 |
| `lhv_coal` | -5.010% | +6.124% | 2 |
| `recovery_yield` | +4.489% | -4.489% | 3 |
| `alloy_nickel_grade` | -3.221% | +3.937% | 4 |
| `sec_eaf_kwh_per_t_alloy` | +3.544% | -3.544% | 5 |
| `k_heat` | +3.281% | -3.281% | 6 |
| `kiln_thermal_efficiency` | -2.983% | +3.646% | 7 |
| `delta_h_vap` | +2.230% | -2.230% | 8 |
| `k_stoic` | +0.945% | -0.945% | 9 (tie) |
| `ef_reductant` | +0.945% | -0.945% | 9 (tie) |

**Why `sec_eaf_kwh_per_t_alloy` outranks its ±10% number.** By simple ±10%
elasticity on `total_emissions` at this one operating point, `sec_eaf` ranks
5th, not 1st — `ef_coal_thermal` and `lhv_coal` move the total more per
percentage point here, because Scope 1 (dryer + kiln) is the majority of
the total at this operating point. But the PRD's concern is not "which
constant moves the total most at ±10%" — it's "which constant, when
mis-set by a large *multiple* rather than a small percentage, has already
silently broken the model in the past, twice, and could again invalidate
the product's core claim without any arithmetic error being visible":

1. **The unit-basis bug (PRD §7.4).** `sec_eaf_kwh_per_t_alloy` is
   specified per tonne of tapped **alloy**, not per tonne of contained
   **nickel**. `calculator.py` converts explicitly:
   `alloy_output_tons = nickel_output_tons / constants.alloy_nickel_grade`
   before applying `sec_eaf_kwh_per_t_alloy`. Skipping that conversion (using
   `nickel_output_tons` directly) understates EAF energy by
   `1 / alloy_nickel_grade` — measured directly against this demo operating
   point: 2,643.84 MWh with the conversion vs. 264.38 MWh without it, a
   **9.9999...× (effectively 10×) understatement** for `alloy_nickel_grade
   = 0.10` (NPI). This is not a ±10% sensitivity, it is an order-of-magnitude
   silent error that a units mistake reproduces exactly.
2. **The magnitude bug (PRD §8.1 / §17.1 worked example).** At 550 kWh/t
   alloy the PRD's own worked example puts Scope 2 at 11% of total — small
   enough to look incidental, directly contradicting the product's problem
   statement that captive-coal Scope 2 is the thing worth building a
   product around. At 2,400 kWh/t alloy (this codebase's test/demo value),
   Scope 2 is 35.44% at the demo operating point (measured:
   `eaf_emissions / total_emissions` = 2,643.84 / 7,460.864), which is
   comfortably inside the 25-45% corridor `test_calculator_structural.py`
   now enforces (`test_scope_2_share_stays_in_calibration_corridor`).

**A specific red flag found while writing this document: 2,400 kWh/t alloy
sits below the PRD's own stated physical floor.** PRD §17.1 states the
physical lower bound of calcine smelting enthalpy is roughly
**2,700-4,200 kWh/t alloy**, depending on grade. The value actually used
throughout this codebase's tests and the demo scenario — 2,400 — is
**below that floor**, not inside it. The structural corridor test still
passes (35.44% is within 25-45%), because the corridor test only checks the
*Scope 2 share*, not whether `sec_eaf_kwh_per_t_alloy` itself clears the
physical minimum quoted elsewhere in the same PRD section. Nothing in
`app/emissions/constants.py`, `app/schemas.py`, or
`lib/onboarding.ts`/`lib/twin.ts` enforces a lower bound on this field
beyond `>= 0`. This is exactly the kind of gap the calibration gate exists
to surface: the test suite is green, the corridor is satisfied, and the
number is still inconsistent with the PRD's own physics statement. Whether
2,400 or something in 2,700-4,200 is right for the demo's implied ore grade
and furnace design is a sourcing question, not one this document can
resolve — it can only flag that the current value has not been checked
against the bound the PRD itself names.

## What would close the gate

For each row above, closing the gate means attaching one of:

- A peer-reviewed or industry-standard reference for the specific
  parameter (e.g. an IPCC emission factor, a published RKEF mass-and-energy
  balance study, a coal or coke assay standard).
- A disclosed operating figure from a real Indonesian RKEF/NPI smelter
  (production report, environmental disclosure, or direct measurement),
  ideally with the ore grade and furnace design it applies to, since several
  of these constants (notably `sec_eaf_kwh_per_t_alloy` and
  `alloy_nickel_grade`) are grade- and design-dependent rather than
  universal.
- At minimum, an explicit range with a cited basis for the range's
  endpoints, if a single point value cannot be defended.

None of that sourcing work was in scope for this task. This document's job
was to state plainly that it has not happened yet, not to do it under time
pressure and call the result a source.
