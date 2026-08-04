"""Request and response models.

Field names are camelCase on the wire, snake_case in Python. Monetary fields
carry an explicit currency suffix; USD and IDR are never mixed in one object.
"""

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from .emissions.calculator import EmissionResult


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class EmissionRequest(_Camel):
    """One production interval. All _pct fields are fractions, never percentages."""

    wet_ore_input_tons: float = Field(ge=0, allow_inf_nan=False)
    moisture_content_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    nickel_grade_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    reductant_biocoke_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_captive_coal: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_hydro_grid: float = Field(ge=0, le=1, allow_inf_nan=False)
    sec_eaf_kwh_per_t_alloy: float = Field(ge=0, allow_inf_nan=False)
    ef_captive_pltu: float = Field(ge=0, allow_inf_nan=False)
    dryer_thermal_efficiency: float = Field(gt=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def _power_mix_sums_to_one(self) -> "EmissionRequest":
        """The hydro share never enters the arithmetic, so an unaccounted
        share would be invisible: a plant with a 15% diesel genset would
        produce output identical to a fully-accounted one. Check it here,
        where both shares are still in scope.
        """
        total = self.power_mix_captive_coal + self.power_mix_hydro_grid
        if abs(total - 1.0) > 1e-9:
            raise ValueError(
                f"power mix shares must sum to 1, got captive "
                f"{self.power_mix_captive_coal} + hydro/grid "
                f"{self.power_mix_hydro_grid} = {total}"
            )
        return self


class EmissionResponse(_Camel):
    nickel_output_tons: float
    alloy_output_tons: float
    dryer_emissions: float
    kiln_heat_emissions: float
    kiln_reductant_emissions: float
    eaf_emissions: float
    total_emissions: float
    scope_1: float
    scope_2: float
    intensity_per_tonne_ni: float | None
    dry_ore_tons: float
    dryer_coal_tons: float
    kiln_coal_tons: float
    reductant_tons: float
    eaf_mwh: float

    @classmethod
    def from_result(cls, r: EmissionResult) -> "EmissionResponse":
        return cls(
            nickel_output_tons=r.nickel_output_tons,
            alloy_output_tons=r.alloy_output_tons,
            dryer_emissions=r.dryer_emissions,
            kiln_heat_emissions=r.kiln_heat_emissions,
            kiln_reductant_emissions=r.kiln_reductant_emissions,
            eaf_emissions=r.eaf_emissions,
            total_emissions=r.total_emissions,
            scope_1=r.scope_1,
            scope_2=r.scope_2,
            intensity_per_tonne_ni=r.intensity_per_tonne_ni,
            dry_ore_tons=r.dry_ore_tons,
            dryer_coal_tons=r.dryer_coal_tons,
            kiln_coal_tons=r.kiln_coal_tons,
            reductant_tons=r.reductant_tons,
            eaf_mwh=r.eaf_mwh,
        )


class CompliancePositionResponse(_Camel):
    cap_tco2e: float
    projected_tco2e: float
    position_tco2e: float
    is_compliant: bool
    position_value_idr: float
