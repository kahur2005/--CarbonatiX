"""Run commit and lookup.

A committed run stores the forecast it was computed against (including its
`synthetic`/`provenance` provenance keys) rather than joining a live
forecast table: reopening yesterday's run must show yesterday's emissions
against yesterday's carbon price, not today's, or the rupiah figure on
screen would silently disagree with the one the advisor was given. See
`supabase/migrations/0001_init.sql`.

Every query here filters by `user_id` for the same reason as `companies.py`:
RLS is inert on this backend's connection, so handler-level filtering is the
only tenant isolation there is.
"""

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import HTTPException

from . import companies, db
from .emissions.calculator import calculate_emissions
from .emissions.compliance import assess, suggest_cap_from_baseline
from .forecasting.service import current_forecast
from .schemas import (
    CompliancePositionResponse,
    EmissionResponse,
    OperationalRequest,
    RunResponse,
    SuggestCapRequest,
)

__all__ = ["commit", "get", "suggest_cap"]


def _emissions_for(company, op: OperationalRequest):
    return calculate_emissions(
        wet_ore_input_tons=op.wet_ore_input_tons,
        moisture_content_pct=op.moisture_content_pct,
        nickel_grade_pct=op.nickel_grade_pct,
        reductant_biocoke_pct=op.reductant_biocoke_pct,
        sec_eaf_kwh_per_t_alloy=company["sec_eaf_kwh_per_t_alloy"],
        power_mix_captive_coal=op.power_mix_captive_coal,
        ef_captive_pltu=company["ef_captive_pltu"],
        dryer_thermal_efficiency=company["dryer_thermal_efficiency"],
    )


async def suggest_cap(user_id: UUID, req: SuggestCapRequest) -> dict:
    """Grandfathered allocation from the all-coal, no-biocoke baseline."""
    company = await companies.require(user_id)
    baseline = calculate_emissions(
        wet_ore_input_tons=req.wet_ore_input_tons,
        moisture_content_pct=req.moisture_content_pct,
        nickel_grade_pct=req.nickel_grade_pct,
        reductant_biocoke_pct=0.0,  # baseline: no biocoke
        sec_eaf_kwh_per_t_alloy=company["sec_eaf_kwh_per_t_alloy"],
        power_mix_captive_coal=1.0,  # baseline: all captive coal
        ef_captive_pltu=company["ef_captive_pltu"],
        dryer_thermal_efficiency=company["dryer_thermal_efficiency"],
    )
    cap = suggest_cap_from_baseline(baseline.total_emissions, reduction_target=req.reduction_target)
    return {"capTco2e": cap, "baselineTco2e": baseline.total_emissions}


async def commit(user_id: UUID, op: OperationalRequest) -> RunResponse:
    """Compute and persist one snapshot for the caller's own company.

    `company["id"]` used as `company_id` below comes from a row that was
    itself fetched filtered by `user_id` (see `companies.require`), so a
    committed run can never be attached to another tenant's company.
    """
    company = await companies.require(user_id)
    result = _emissions_for(company, op)
    forecast = await current_forecast()
    position = assess(
        result,
        cap_tco2e=company["cap_tco2e"],
        carbon_price_idr_per_ton=forecast["idxCarbonIdrPerTon"][0],
    )

    run_id = uuid4()
    now = datetime.now(UTC)
    await db.execute(
        """insert into public.calculation_runs
           (id, user_id, company_id, inputs, result, compliance,
            forecast_snapshot, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)""",
        run_id,
        user_id,
        company["id"],
        json.dumps(op.model_dump(by_alias=True)),
        json.dumps(EmissionResponse.from_result(result).model_dump(by_alias=True)),
        json.dumps(CompliancePositionResponse(**position.__dict__).model_dump(by_alias=True)),
        json.dumps(forecast),
        now,
    )
    return RunResponse(
        id=str(run_id),
        result=EmissionResponse.from_result(result),
        compliance=CompliancePositionResponse(**position.__dict__),
        forecast_snapshot=forecast,
        created_at=now.isoformat(),
    )


async def get(user_id: UUID, run_id: UUID) -> RunResponse:
    """The caller's own run, filtered by both id and user_id so a guessed or
    leaked run id from another tenant never resolves here."""
    row = await db.fetchrow(
        "select * from public.calculation_runs where id = $1 and user_id = $2",
        run_id,
        user_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunResponse(
        id=str(row["id"]),
        result=EmissionResponse(**json.loads(row["result"])),
        compliance=CompliancePositionResponse(**json.loads(row["compliance"])),
        forecast_snapshot=json.loads(row["forecast_snapshot"]),
        created_at=row["created_at"].isoformat(),
    )
