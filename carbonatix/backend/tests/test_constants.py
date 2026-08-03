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
    with pytest.raises(Exception):  # noqa: B017 - frozen-dataclass error type is not part of the contract
        DEFAULT_CONSTANTS.lhv_coal = 1.0  # type: ignore[misc]
