"""Structural properties of the model. These outlive any particular
calibration of the constants, and several of them are the reason the product
is designed the way it is (PRD 7.5 and 8.1).
"""

import pytest

from app.emissions.calculator import calculate_emissions

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
    assert doubled.nickel_output_tons == pytest.approx(2.0 * base.nickel_output_tons, rel=1e-12)
    assert doubled.intensity_per_tonne_ni == pytest.approx(base.intensity_per_tonne_ni, rel=1e-12)


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
        **{
            **NOMINAL,
            "reductant_biocoke_pct": 0.5,
            "power_mix_captive_coal": 0.5,
            "dryer_thermal_efficiency": 0.75,
        }
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
