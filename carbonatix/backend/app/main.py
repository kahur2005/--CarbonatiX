"""FastAPI application. Route registration only -- logic lives in modules."""

from uuid import UUID

from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from .auth import current_user_id
from .emissions.calculator import calculate_emissions
from .errors import validation_exception_handler
from .schemas import EmissionRequest, EmissionResponse

app = FastAPI(title="SmartSmelt ERP API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(RequestValidationError, validation_exception_handler)


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


@app.get("/company")
def get_company(user_id: UUID = Depends(current_user_id)) -> dict[str, str]:
    """Placeholder protected route. Replaced with the real company lookup
    once the database-backed handler lands; exists here only so there is a
    protected endpoint for the auth dependency to guard."""
    return {"userId": str(user_id)}
