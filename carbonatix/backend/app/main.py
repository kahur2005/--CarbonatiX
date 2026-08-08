"""FastAPI application. Route registration only -- logic lives in modules."""

from pathlib import Path
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import companies, recommendation, runs
from .auth import current_user_id
from .emissions.calculator import calculate_emissions
from .errors import validation_exception_handler
from .forecasting.service import ForecastUnavailable, current_forecast
from .ingestion.document_vision import ExtractionFailed
from .ingestion.document_vision import parse as parse_document
from .ingestion.interpret import interpret as interpret_fields
from .ingestion.mapping import readings_to_candidates
from .schemas import (
    CandidateResponse,
    CompanyRequest,
    CompanyResponse,
    DocumentExtractionResponse,
    EmissionRequest,
    EmissionResponse,
    OperationalRequest,
    RunResponse,
    SuggestCapRequest,
)

app = FastAPI(title="SmartSmelt ERP API", version="2.0")

_MAX_UPLOAD_BYTES = 20 * 1024 * 1024

_SUPPORTED_MEDIA_TYPES = frozenset(
    {
        "application/pdf",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "image/png",
        "image/jpeg",
        "image/jpg",
    }
)
_EXTENSION_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def _resolve_upload_media_type(content_type: str | None, filename: str) -> str:
    declared = content_type.split(";")[0].strip().lower() if content_type else None
    if declared in _SUPPORTED_MEDIA_TYPES:
        return declared
    ext = Path(filename).suffix.lower()
    if ext in _EXTENSION_MEDIA_TYPES:
        return _EXTENSION_MEDIA_TYPES[ext]
    if declared:
        return declared
    return "application/pdf"

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


@app.get("/forecasts")
async def get_forecasts(horizon_days: int = Query(default=30, ge=1, le=30)) -> dict:
    """Pre-trained price forecasts. See app/forecasting/service.py for the
    response shape and the synthetic-data provenance it carries."""
    try:
        return await current_forecast(horizon_days)
    except ForecastUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Price forecast is temporarily unavailable",
        ) from exc


@app.get("/company", response_model=CompanyResponse)
async def get_company(user_id: UUID = Depends(current_user_id)) -> CompanyResponse:
    row = await companies.fetch(user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No company profile")
    return companies.to_response(row)


@app.put("/company")
async def put_company(
    req: CompanyRequest, user_id: UUID = Depends(current_user_id)
) -> dict[str, str]:
    await companies.save(user_id, req)
    return {"status": "saved"}


@app.post("/company/suggest-cap")
async def post_suggest_cap(
    req: SuggestCapRequest, user_id: UUID = Depends(current_user_id)
) -> dict:
    return await runs.suggest_cap(user_id, req)


@app.post("/runs", status_code=status.HTTP_201_CREATED, response_model=RunResponse)
async def post_run(op: OperationalRequest, user_id: UUID = Depends(current_user_id)) -> RunResponse:
    return await runs.commit(user_id, op)


@app.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: UUID, user_id: UUID = Depends(current_user_id)) -> RunResponse:
    return await runs.get(user_id, run_id)


@app.get("/runs/{run_id}/recommendation")
async def get_recommendation(
    run_id: UUID, user_id: UUID = Depends(current_user_id)
) -> StreamingResponse:
    """Stream the four-stage recommendation pipeline as SSE. `load` runs
    before the streaming response is constructed so a missing/foreign run
    resolves to a plain 404 (see recommendation.py for why that ordering
    is load-bearing, not stylistic)."""
    result, position, forecast = await recommendation.load(user_id, run_id)
    return StreamingResponse(
        recommendation.format_stream(result, position, forecast),
        media_type="text/event-stream",
    )


@app.post("/documents", response_model=DocumentExtractionResponse)
async def post_document(
    file: UploadFile = File(...),
    profile: str = Form(...),
    user_id: UUID = Depends(current_user_id),
) -> DocumentExtractionResponse:
    """Extract candidates from an uploaded document. Returns candidates for
    the user to review; writes nothing to `companies` or
    `calculation_runs` -- see `app/ingestion/mapping.py` for why a
    `Candidate` cannot become a stored value without a separate, explicit
    user action that this route does not perform.
    """
    if profile not in ("site_spec", "operational"):
        raise HTTPException(status_code=422, detail="Unknown document profile")

    if file.size is not None and file.size > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Dokumen terlalu besar. Maksimum 20 MB.",
        )

    filename = file.filename or "document"
    media_type = _resolve_upload_media_type(file.content_type, filename)
    if media_type not in _SUPPORTED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Could not read the document. Enter the values manually.",
        )

    file_bytes = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Dokumen terlalu besar. Maksimum 20 MB.",
        )
    try:
        parsed = await parse_document(file_bytes, media_type, filename)
        readings = await interpret_fields(parsed, profile)
        candidates = readings_to_candidates(readings, parsed)
    except ExtractionFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not read the document. Enter the values manually.",
        ) from exc
    return DocumentExtractionResponse(
        candidates=[CandidateResponse(**c.__dict__) for c in candidates]
    )
