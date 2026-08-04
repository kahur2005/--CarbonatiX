"""Reconstruction and SSE framing for GET /runs/{run_id}/recommendation.

Kept out of main.py for the same reason as errors.py: main.py stays
route-registration only. Two responsibilities live here:

1. `load` fetches the caller's own run and reconstructs `EmissionResult` /
   `CompliancePosition` from the stored JSON, field by field. This is the
   fragile part: `EmissionResponse`/`CompliancePositionResponse` write
   camelCase wire names, several pinned explicitly in schemas.py because
   pydantic's `to_camel` mangles "_tco2e" into "Tco2E" (capital E) --
   confirmed via `to_camel("cap_tco2e")` -> "capTco2E". A typo in the field
   names below compiles fine and only breaks the first time a real run is
   replayed, so `test_reconstruction_round_trips_the_wire_field_names` in
   test_recommendation.py pins this down directly.

   `load` runs eagerly, *before* the SSE generator starts -- not inside it.
   `StreamingResponse` sends its "http.response.start" ASGI message (fixing
   the status code at 200) before it ever pulls the first chunk from the
   body iterator, so an HTTPException raised from inside that iterator
   would arrive after the response has already started and could never
   turn into the 404 a missing or foreign run needs.

2. `format_stream` turns each `run_pipeline` event dict into one SSE
   `data:` line.
"""

import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import HTTPException, status

from . import db
from .advisor.pipeline import run_pipeline
from .emissions.calculator import EmissionResult
from .emissions.compliance import CompliancePosition

__all__ = ["format_stream", "load", "position_from_json", "result_from_json"]


def result_from_json(data: dict) -> EmissionResult:
    """Reconstruct `EmissionResult` from a stored run's `result` JSON.

    Every key below is the actual wire name `EmissionResponse` writes (see
    schemas.py) -- not a guess at what pydantic's `to_camel` would produce.
    """
    return EmissionResult(
        nickel_output_tons=data["nickelOutputTons"],
        alloy_output_tons=data["alloyOutputTons"],
        dryer_emissions=data["dryerEmissions"],
        kiln_heat_emissions=data["kilnHeatEmissions"],
        kiln_reductant_emissions=data["kilnReductantEmissions"],
        eaf_emissions=data["eafEmissions"],
        total_emissions=data["totalEmissions"],
        dry_ore_tons=data["dryOreTons"],
        dryer_coal_tons=data["dryerCoalTons"],
        kiln_coal_tons=data["kilnCoalTons"],
        reductant_tons=data["reductantTons"],
        eaf_mwh=data["eafMwh"],
    )


def position_from_json(data: dict) -> CompliancePosition:
    """Reconstruct `CompliancePosition` from a stored run's `compliance`
    JSON. `capTco2e`/`projectedTco2e`/`positionTco2e` are the aliases
    `CompliancePositionResponse` pins explicitly (see schemas.py) --
    `to_camel("cap_tco2e")` alone would produce `capTco2E`, which is not
    what is actually on the wire.
    """
    return CompliancePosition(
        cap_tco2e=data["capTco2e"],
        projected_tco2e=data["projectedTco2e"],
        position_tco2e=data["positionTco2e"],
        is_compliant=data["isCompliant"],
        position_value_idr=data["positionValueIdr"],
    )


async def load(user_id: UUID, run_id: UUID) -> tuple[EmissionResult, CompliancePosition, dict]:
    """The caller's own run, reconstructed for the pipeline.

    Filtered by both id and user_id, same as `runs.get` -- a guessed or
    leaked run id from another tenant never resolves here.
    """
    row = await db.fetchrow(
        "select * from public.calculation_runs where id = $1 and user_id = $2",
        run_id,
        user_id,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    result = result_from_json(json.loads(row["result"]))
    position = position_from_json(json.loads(row["compliance"]))
    forecast = json.loads(row["forecast_snapshot"])
    return result, position, forecast


async def format_stream(
    result: EmissionResult, position: CompliancePosition, forecast: dict
) -> AsyncIterator[str]:
    """SSE-encode each `run_pipeline` event as its own `data:` line."""
    async for event in run_pipeline(result, position, forecast):
        yield f"data: {json.dumps(event)}\n\n"
