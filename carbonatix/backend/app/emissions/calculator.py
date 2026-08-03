"""Expected carbon emission for one RKEF production interval.

The core entry point, calculate_emissions, takes plain scalars and returns a
full breakdown. It has no knowledge of where those scalars came from, so it is
reusable across fixtures, database rows, API payloads and optimiser sweeps
alike.

Scope boundaries
----------------
* Scope 1 (direct): dryer combustion, kiln heating, kiln reductant.
* Scope 2 (purchased/captive electricity): electric arc furnace.

Two consequences of the specified formulas are worth stating outright, since
both suppress reported emissions:

* The biocoke share of reductant is treated as zero-emission (biogenic
  carbon), so only the ``1 - reductant_biocoke_pct`` fossil share is counted.
* The hydro grid share of power is treated as zero-emission, so
  ``power_mix_hydro_grid`` never enters the arithmetic.

All emission figures are tCO2e for the interval described by the inputs.
"""

import math
from dataclasses import dataclass

from .constants import DEFAULT_CONSTANTS, ProcessConstants

__all__ = ["EmissionResult", "calculate_emissions"]

_KWH_PER_MWH = 1_000.0


@dataclass(frozen=True)
class EmissionResult:
    """Emission breakdown plus the intermediates used to reach it.

    Intermediates are returned rather than discarded so callers can report,
    chart or sanity-check the calculation without repeating it.
    """

    nickel_output_tons: float
    alloy_output_tons: float

    dryer_emissions: float
    kiln_heat_emissions: float
    kiln_reductant_emissions: float

    eaf_emissions: float

    total_emissions: float

    dry_ore_tons: float
    dryer_coal_tons: float
    kiln_coal_tons: float
    reductant_tons: float
    eaf_mwh: float

    @property
    def scope_1(self) -> float:
        """Total direct combustion emissions, tCO2e."""
        return self.dryer_emissions + self.kiln_heat_emissions + self.kiln_reductant_emissions

    @property
    def scope_2(self) -> float:
        """Total electricity emissions, tCO2e."""
        return self.eaf_emissions

    @property
    def intensity_per_tonne_ni(self) -> "float | None":
        """Emission intensity, tCO2e per tonne of nickel produced.

        Returns None when no nickel was produced, because the intensity is
        genuinely undefined there and no float is honest about it. Callers
        aggregating over many intervals should filter None out, or better,
        divide summed emissions by summed nickel.
        """
        if self.nickel_output_tons == 0:
            return None
        return self.total_emissions / self.nickel_output_tons


def calculate_emissions(
    *,
    wet_ore_input_tons: float,
    moisture_content_pct: float,
    nickel_grade_pct: float,
    reductant_biocoke_pct: float,
    sec_eaf_kwh_per_t_alloy: float,
    power_mix_captive_coal: float,
    ef_captive_pltu: float,
    dryer_thermal_efficiency: float,
    constants: ProcessConstants = DEFAULT_CONSTANTS,
) -> EmissionResult:
    """Calculate expected carbon emission for one production interval.

    Keyword-only by design: eight positional floats would be trivial to
    transpose silently, and several share plausible magnitudes.

    Raises:
        ValueError: If an input is outside its physically meaningful range.
    """
    _validate(
        wet_ore_input_tons=wet_ore_input_tons,
        moisture_content_pct=moisture_content_pct,
        nickel_grade_pct=nickel_grade_pct,
        reductant_biocoke_pct=reductant_biocoke_pct,
        sec_eaf_kwh_per_t_alloy=sec_eaf_kwh_per_t_alloy,
        power_mix_captive_coal=power_mix_captive_coal,
        ef_captive_pltu=ef_captive_pltu,
        dryer_thermal_efficiency=dryer_thermal_efficiency,
    )

    dry_fraction = 1.0 - moisture_content_pct

    # 1. Nickel output.
    nickel_output_tons = (
        wet_ore_input_tons * dry_fraction * nickel_grade_pct * constants.recovery_yield
    )

    # 2. Scope 1 - rotary dryer, evaporating ore moisture.
    water_tons = wet_ore_input_tons * moisture_content_pct
    dryer_coal_tons = (water_tons * constants.delta_h_vap) / (
        constants.lhv_coal * dryer_thermal_efficiency
    )
    dryer_emissions = dryer_coal_tons * constants.ef_coal_thermal

    # 3. Scope 1 - rotary kiln, heating and reduction.
    #
    # k_heat is heat delivered to the ore, so it is divided by kiln efficiency
    # to reach fuel input -- the same treatment the dryer gives its own
    # efficiency above. The two stages model identical physics; only the
    # efficiency figure differs.
    dry_ore_tons = wet_ore_input_tons * dry_fraction
    kiln_coal_tons = (dry_ore_tons * constants.k_heat) / (
        constants.lhv_coal * constants.kiln_thermal_efficiency
    )
    kiln_heat_emissions = kiln_coal_tons * constants.ef_coal_thermal

    # Reductant is coke, not thermal coal, and carries its own emission
    # factor: far more carbon per tonne than the coal burned for heat.
    fossil_reductant_share = 1.0 - reductant_biocoke_pct
    reductant_tons = nickel_output_tons * constants.k_stoic * fossil_reductant_share
    kiln_reductant_emissions = reductant_tons * constants.ef_reductant

    # 4. Scope 2 - electric arc furnace.
    #
    # Furnace specific energy is quoted per tonne of tapped alloy, not per
    # tonne of contained nickel, so contained nickel is converted to alloy
    # tonnage first. Skipping this step understates furnace energy by
    # 1 / alloy_nickel_grade -- a factor of ten for NPI.
    alloy_output_tons = nickel_output_tons / constants.alloy_nickel_grade
    eaf_mwh = (alloy_output_tons * sec_eaf_kwh_per_t_alloy) / _KWH_PER_MWH
    eaf_emissions = eaf_mwh * (power_mix_captive_coal * ef_captive_pltu)

    total_emissions = (
        dryer_emissions + kiln_heat_emissions + kiln_reductant_emissions + eaf_emissions
    )

    return EmissionResult(
        nickel_output_tons=nickel_output_tons,
        alloy_output_tons=alloy_output_tons,
        dryer_emissions=dryer_emissions,
        kiln_heat_emissions=kiln_heat_emissions,
        kiln_reductant_emissions=kiln_reductant_emissions,
        eaf_emissions=eaf_emissions,
        total_emissions=total_emissions,
        dry_ore_tons=dry_ore_tons,
        dryer_coal_tons=dryer_coal_tons,
        kiln_coal_tons=kiln_coal_tons,
        reductant_tons=reductant_tons,
        eaf_mwh=eaf_mwh,
    )


def _validate(
    *,
    wet_ore_input_tons: float,
    moisture_content_pct: float,
    nickel_grade_pct: float,
    reductant_biocoke_pct: float,
    sec_eaf_kwh_per_t_alloy: float,
    power_mix_captive_coal: float,
    ef_captive_pltu: float,
    dryer_thermal_efficiency: float,
) -> None:
    """Reject inputs that would yield silently meaningless results.

    Three hazards drive the checks. Fractions are the first: passing 32
    instead of 0.32 makes ``1 - moisture`` negative and produces a negative
    nickel output rather than an error. NaN is the second, and it is easy to
    miss -- ``value < 0`` is False for NaN, so a dropped sensor read would
    sail through a naive non-negativity check and surface as
    ``total_emissions = nan``. Infinity is the third: ``value >= 0`` is True
    for ``float("inf")``, so a naive non-negativity check alone lets it
    through and it would propagate as ``total_emissions = inf``. Every
    comparison below is written so NaN and +/-inf fail.
    """
    fractions = {
        "moisture_content_pct": moisture_content_pct,
        "nickel_grade_pct": nickel_grade_pct,
        "reductant_biocoke_pct": reductant_biocoke_pct,
        "power_mix_captive_coal": power_mix_captive_coal,
    }
    for name, value in fractions.items():
        # `0.0 <= value <= 1.0` already excludes NaN and +/-inf: NaN makes
        # every comparison False, and +inf/-inf each fail one side of the
        # range.
        if not 0.0 <= value <= 1.0:
            raise ValueError(
                f"{name} must be a fraction between 0 and 1, got {value!r} "
                f"(percentages such as 32 should be passed as 0.32)"
            )

    non_negative = {
        "wet_ore_input_tons": wet_ore_input_tons,
        "sec_eaf_kwh_per_t_alloy": sec_eaf_kwh_per_t_alloy,
        "ef_captive_pltu": ef_captive_pltu,
    }
    for name, value in non_negative.items():
        # not (value < 0): NaN must fail, and it fails this. But NaN and
        # +inf both pass a bare `value >= 0`, so finiteness is also required
        # -- otherwise infinity propagates silently into total_emissions.
        if not (math.isfinite(value) and value >= 0):
            raise ValueError(f"{name} must be non-negative, got {value!r}")

    # `0.0 < dryer_thermal_efficiency <= 1.0` already excludes NaN and
    # +/-inf for the same reason as the fraction fields above.
    if not 0.0 < dryer_thermal_efficiency <= 1.0:
        raise ValueError(
            "dryer_thermal_efficiency must be a fraction in (0, 1], got "
            f"{dryer_thermal_efficiency!r}"
        )
