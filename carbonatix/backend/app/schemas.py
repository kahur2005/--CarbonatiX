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
    # Explicit aliases below: pydantic's to_camel alias generator capitalizes
    # any letter immediately following a digit (a "v2_api" -> "v2Api"
    # heuristic), which mangles "_tco2e" into "Tco2E" instead of "Tco2e".
    # Confirmed via `pydantic.alias_generators.to_camel("cap_tco2e")` ->
    # "capTco2E". Pinned explicitly wherever "tco2e" appears on the wire.
    cap_tco2e: float = Field(alias="capTco2e")
    projected_tco2e: float = Field(alias="projectedTco2e")
    position_tco2e: float = Field(alias="positionTco2e")
    is_compliant: bool
    position_value_idr: float


class CompanyRequest(_Camel):
    name: str = Field(min_length=1, max_length=200)
    technology: str = "RKEF"
    ef_captive_pltu: float = Field(ge=0, allow_inf_nan=False)
    dryer_thermal_efficiency: float = Field(gt=0, le=1, allow_inf_nan=False)
    sec_eaf_kwh_per_t_alloy: float = Field(ge=0, allow_inf_nan=False)
    alloy_nickel_grade: float = Field(gt=0, le=1, allow_inf_nan=False)
    kiln_thermal_efficiency: float = Field(gt=0, le=1, allow_inf_nan=False)
    # Absolute allocation in tCO2e for the period, not derived from ore
    # volume. alias= pinned explicitly -- see CompliancePositionResponse for
    # why the auto-generated alias for a "_tco2e" field cannot be trusted.
    cap_tco2e: float = Field(ge=0, allow_inf_nan=False, alias="capTco2e")


class CompanyResponse(_Camel):
    name: str
    technology: str
    ef_captive_pltu: float
    dryer_thermal_efficiency: float
    sec_eaf_kwh_per_t_alloy: float
    alloy_nickel_grade: float
    kiln_thermal_efficiency: float
    cap_tco2e: float = Field(alias="capTco2e")


class OperationalRequest(_Camel):
    """Per-interval levers. Site-spec values come from the stored company."""

    wet_ore_input_tons: float = Field(ge=0, allow_inf_nan=False)
    moisture_content_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    nickel_grade_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    reductant_biocoke_pct: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_captive_coal: float = Field(ge=0, le=1, allow_inf_nan=False)
    power_mix_hydro_grid: float = Field(ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def _power_mix_sums_to_one(self) -> "OperationalRequest":
        total = self.power_mix_captive_coal + self.power_mix_hydro_grid
        if abs(total - 1.0) > 1e-9:
            raise ValueError(
                f"power mix shares must sum to 1, got captive "
                f"{self.power_mix_captive_coal} + hydro/grid "
                f"{self.power_mix_hydro_grid} = {total}"
            )
        return self


class SuggestCapRequest(OperationalRequest):
    reduction_target: float = Field(ge=0, lt=1, allow_inf_nan=False)


class CommitRunRequest(OperationalRequest):
    """Operational levers plus optional production month (`YYYY-MM`)."""

    period: str | None = None


class RunResponse(_Camel):
    id: str
    result: EmissionResponse
    compliance: CompliancePositionResponse
    forecast_snapshot: dict
    created_at: str
    # First-of-month stamp when the twin committed with a selected period.
    period: str | None = None


class ProductionMonthSummary(_Camel):
    period: str
    updated_at: str
    has_inputs: bool


class ProductionMonthResponse(_Camel):
    period: str
    inputs: dict
    updated_at: str


class ProductionMonthPutRequest(_Camel):
    """Partial operational draft. Missing keys leave twin fields blank."""

    inputs: dict = Field(default_factory=dict)


class CandidateResponse(_Camel):
    """One extracted field awaiting user review. Deliberately carries no
    "accepted" flag -- see `app/ingestion/mapping.py`'s `Candidate`, which
    this mirrors field-for-field on the wire."""

    field: str
    value: float | None
    confidence: float
    node: str
    source_hint: str = ""
    # "derived" values were computed from other printed figures. The UI
    # must distinguish them from values transcribed directly.
    basis: str | None = None
    evidence: str = ""
    derivation: str = ""


class DocumentExtractionResponse(_Camel):
    """Response to POST /documents.

    `confidence_is_placeholder` is still `True`, for a different reason than
    it used to be. `confidence` is no longer a flat 0.75 -- it now carries
    the real score Helpy assigned to the document element the figure came
    from. But that score is per ELEMENT, not per field: a table scoring 0.96
    says the table was read cleanly, not that this particular cell was. So
    it remains an indicator of document quality rather than a per-field
    reliability signal, and this flag stays set to say so.
    """

    candidates: list[CandidateResponse]
    confidence_is_placeholder: bool = True
