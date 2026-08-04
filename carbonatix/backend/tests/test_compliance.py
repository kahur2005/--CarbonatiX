import pytest

from app.emissions.calculator import calculate_emissions
from app.emissions.compliance import assess, suggest_cap_from_baseline

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
        **{
            **NOMINAL,
            "wet_ore_input_tons": 10_500.0,
            "reductant_biocoke_pct": 0.5,
            "power_mix_captive_coal": 0.5,
        }
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


# --- Non-finite guards -------------------------------------------------
#
# `value >= 0` alone is True for float("inf"), so a bare non-negativity
# check lets infinity through silently. Every numeric guard in this module
# must reject +inf and -inf explicitly, matching calculator.py's _validate.


@pytest.mark.parametrize("bad", [float("inf"), float("-inf")])
def test_assess_rejects_non_finite_cap(bad):
    r = calculate_emissions(**NOMINAL)
    with pytest.raises(ValueError, match="cap_tco2e"):
        assess(r, cap_tco2e=bad, carbon_price_idr_per_ton=PRICE)


@pytest.mark.parametrize("bad", [float("inf"), float("-inf")])
def test_assess_rejects_non_finite_price(bad):
    r = calculate_emissions(**NOMINAL)
    with pytest.raises(ValueError, match="carbon_price_idr_per_ton"):
        assess(r, cap_tco2e=1_000.0, carbon_price_idr_per_ton=bad)


@pytest.mark.parametrize("bad", [float("inf"), float("-inf")])
def test_suggest_cap_rejects_non_finite_baseline(bad):
    with pytest.raises(ValueError, match="baseline_total_tco2e"):
        suggest_cap_from_baseline(bad, reduction_target=0.10)


@pytest.mark.parametrize("bad", [float("inf"), float("-inf")])
def test_suggest_cap_rejects_non_finite_reduction_target(bad):
    """0.0 <= reduction_target < 1.0 already excludes +/-inf (see compliance.py),
    but this locks the observable behaviour in regardless of how it is enforced."""
    with pytest.raises(ValueError, match="reduction_target"):
        suggest_cap_from_baseline(10_000.0, reduction_target=bad)
