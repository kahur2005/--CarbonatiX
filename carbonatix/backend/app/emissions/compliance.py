"""Compliance position against an absolute carbon allocation.

The quota is an absolute tCO2e figure held by the company for a period, NOT
a formula proportional to ore volume. Total emissions are perfectly
proportional to ore volume, so a proportional quota would cancel production
out of both sides of the inequality: raising output 5% would raise both
emissions and quota by 5% and never move the margin. See PRD section 8.1.
"""

import math
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
        ValueError: If the cap or price is negative, NaN, or infinite.
    """
    # not (isfinite and >= 0): NaN fails `>= 0` on its own, but a bare
    # `value >= 0` check alone also lets float("inf") through, so
    # finiteness is checked explicitly too.
    if not (math.isfinite(cap_tco2e) and cap_tco2e >= 0):
        raise ValueError(f"cap_tco2e must be non-negative and finite, got {cap_tco2e!r}")
    if not (math.isfinite(carbon_price_idr_per_ton) and carbon_price_idr_per_ton >= 0):
        raise ValueError(
            f"carbon_price_idr_per_ton must be non-negative and finite, "
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
        ValueError: If the target is not a fraction in [0, 1), or the
            baseline is negative, NaN, or infinite.
    """
    # `0.0 <= reduction_target < 1.0` already excludes NaN and +/-inf: NaN
    # makes every comparison False, +inf fails the upper bound, and -inf
    # fails the lower bound.
    if not 0.0 <= reduction_target < 1.0:
        raise ValueError(f"reduction_target must be a fraction in [0, 1), got {reduction_target!r}")
    # not (isfinite and >= 0): see the identical guard in assess() above.
    if not (math.isfinite(baseline_total_tco2e) and baseline_total_tco2e >= 0):
        raise ValueError(
            f"baseline_total_tco2e must be non-negative and finite, got {baseline_total_tco2e!r}"
        )
    return baseline_total_tco2e * (1.0 - reduction_target)
