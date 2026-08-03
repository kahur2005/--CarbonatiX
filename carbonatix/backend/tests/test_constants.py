import pytest

from app.emissions.constants import DEFAULT_CONSTANTS, ProcessConstants

# All ProcessConstants fields that are validated as "positive and finite"
# rather than as a (0, 1] fraction. Parametrising over the full set means a
# future field addition to this group is covered automatically.
_NON_FRACTION_FIELDS = [
    "delta_h_vap",
    "lhv_coal",
    "ef_coal_thermal",
    "k_heat",
    "k_stoic",
    "ef_reductant",
]


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


@pytest.mark.parametrize("field_name", _NON_FRACTION_FIELDS)
def test_rejects_positive_infinity_on_non_fraction_field(field_name):
    with pytest.raises(ValueError, match=field_name):
        ProcessConstants(**{field_name: float("inf")})


@pytest.mark.parametrize("field_name", _NON_FRACTION_FIELDS)
def test_rejects_negative_infinity_on_non_fraction_field(field_name):
    with pytest.raises(ValueError, match=field_name):
        ProcessConstants(**{field_name: float("-inf")})


def test_rejects_positive_infinity_on_fraction_field():
    # The fraction branch's `not 0.0 < value <= 1.0` already excludes +inf
    # (inf <= 1.0 is False); this test pins that behaviour down.
    with pytest.raises(ValueError, match="recovery_yield"):
        ProcessConstants(recovery_yield=float("inf"))


def test_is_frozen():
    with pytest.raises(Exception):  # noqa: B017 - frozen-dataclass error type is not part of the contract
        DEFAULT_CONSTANTS.lhv_coal = 1.0  # type: ignore[misc]
