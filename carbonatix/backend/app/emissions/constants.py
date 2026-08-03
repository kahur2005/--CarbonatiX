"""Process constants for the RKEF emission model.

Every default below is an UNVALIDATED PLACEHOLDER pending the calibration
gate in PRD section 17.1. They are literature-plausible, not sourced. Do not
present figures derived from them as findings.
"""

import math
from dataclasses import dataclass, fields

__all__ = ["DEFAULT_CONSTANTS", "ProcessConstants"]

# Fields constrained to (0, 1]. The rest need only be positive and finite.
_FRACTION_FIELDS = frozenset({"recovery_yield", "alloy_nickel_grade", "kiln_thermal_efficiency"})


@dataclass(frozen=True)
class ProcessConstants:
    """Physical and empirical constants of an RKEF line.

    Validates on construction so that no downstream code has to re-check.
    """

    recovery_yield: float = 0.90  # fraction of contained Ni recovered
    delta_h_vap: float = 2.60  # GJ per tonne water (heat + latent)
    lhv_coal: float = 20.0  # GJ per tonne, Indonesian sub-bituminous
    ef_coal_thermal: float = 2.20  # tCO2e per tonne thermal coal
    kiln_thermal_efficiency: float = 0.55  # fraction
    k_heat: float = 1.80  # GJ per tonne dry ore, preheat + calcination
    k_stoic: float = 2.00  # tonnes coke per tonne Ni
    ef_reductant: float = 3.20  # tCO2e per tonne coke
    alloy_nickel_grade: float = 0.10  # Ni fraction of tapped alloy; NPI ~0.10

    def __post_init__(self) -> None:
        for f in fields(self):
            value = getattr(self, f.name)
            if f.name in _FRACTION_FIELDS:
                # Written so NaN fails: `not (0 < nan <= 1)` is True.
                if not 0.0 < value <= 1.0:
                    raise ValueError(f"{f.name} must be a fraction in (0, 1], got {value!r}")
            # not `math.isfinite(value) and value <= 0`: NaN and +/-inf must fail this
            elif not (math.isfinite(value) and value > 0):
                raise ValueError(f"{f.name} must be positive and finite, got {value!r}")


DEFAULT_CONSTANTS = ProcessConstants()
