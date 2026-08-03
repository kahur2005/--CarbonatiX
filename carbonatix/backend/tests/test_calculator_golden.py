"""Golden tests. The engine is deterministic arithmetic, so the correct
answer is knowable by hand and every expectation below was computed by hand.
"""

import pytest

from app.emissions.calculator import calculate_emissions
from app.emissions.constants import DEFAULT_CONSTANTS as C

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

# Inputs guarded by _validate's finiteness + non-negativity check. Passing
# +/-inf to any of these must raise, or infinity would propagate silently
# into total_emissions.
_NON_NEGATIVE_FIELDS = [
    "wet_ore_input_tons",
    "sec_eaf_kwh_per_t_alloy",
    "ef_captive_pltu",
]


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
        r.dryer_emissions + r.kiln_heat_emissions + r.kiln_reductant_emissions + r.eaf_emissions,
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


@pytest.mark.parametrize("field_name", _NON_NEGATIVE_FIELDS)
def test_rejects_positive_infinity_on_non_negative_field(field_name):
    with pytest.raises(ValueError, match=field_name):
        calculate_emissions(**{**NOMINAL, field_name: float("inf")})


@pytest.mark.parametrize("field_name", _NON_NEGATIVE_FIELDS)
def test_rejects_negative_infinity_on_non_negative_field(field_name):
    with pytest.raises(ValueError, match=field_name):
        calculate_emissions(**{**NOMINAL, field_name: float("-inf")})
