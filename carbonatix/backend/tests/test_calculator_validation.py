import math

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
        "nickel_output_tons",
        "alloy_output_tons",
        "dryer_emissions",
        "kiln_heat_emissions",
        "kiln_reductant_emissions",
        "eaf_emissions",
        "total_emissions",
        "dry_ore_tons",
        "dryer_coal_tons",
        "kiln_coal_tons",
        "reductant_tons",
        "eaf_mwh",
    ):
        assert math.isfinite(getattr(r, name)), f"{name} is not finite"


def test_calculator_is_positional_proof():
    """Eight positional floats would be trivial to transpose silently."""
    with pytest.raises(TypeError):
        calculate_emissions(10_000.0, 0.32, 0.018, 0.0, 2400.0, 1.0, 1.0, 0.55)  # type: ignore[misc]
