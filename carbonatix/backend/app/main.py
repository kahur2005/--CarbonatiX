"""FastAPI application. Route registration only -- logic lives in modules."""

import math
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .emissions.calculator import calculate_emissions
from .schemas import EmissionRequest, EmissionResponse

app = FastAPI(title="SmartSmelt ERP API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sanitize_non_finite(obj: Any) -> Any:
    """Replace NaN/Infinity with their str() form so json.dumps(allow_nan=False)
    (Starlette's default for JSONResponse) can still render the body.

    Pydantic's error detail echoes back the rejected input verbatim, so a
    request containing a literal NaN produces an error payload that itself
    contains a NaN float. Without this, rendering the 422 response raises
    ValueError and the client sees an opaque 500 instead of the validation
    error that caused it.
    """
    if isinstance(obj, float) and not math.isfinite(obj):
        return str(obj)
    if isinstance(obj, dict):
        return {k: _sanitize_non_finite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_non_finite(v) for v in obj]
    return obj


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    content = _sanitize_non_finite(jsonable_encoder({"detail": exc.errors()}))
    return JSONResponse(status_code=422, content=content)


@app.post("/emissions", response_model=EmissionResponse)
def post_emissions(req: EmissionRequest) -> EmissionResponse:
    """Stateless recompute. No database write.

    Called on every parameter change in the twin, so it must stay cheap: it is
    pure arithmetic and returns in microseconds.
    """
    result = calculate_emissions(
        wet_ore_input_tons=req.wet_ore_input_tons,
        moisture_content_pct=req.moisture_content_pct,
        nickel_grade_pct=req.nickel_grade_pct,
        reductant_biocoke_pct=req.reductant_biocoke_pct,
        sec_eaf_kwh_per_t_alloy=req.sec_eaf_kwh_per_t_alloy,
        power_mix_captive_coal=req.power_mix_captive_coal,
        ef_captive_pltu=req.ef_captive_pltu,
        dryer_thermal_efficiency=req.dryer_thermal_efficiency,
    )
    return EmissionResponse.from_result(result)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
