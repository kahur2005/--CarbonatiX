"""Validation-error response handling.

FastAPI's default RequestValidationError handler echoes the rejected value
verbatim into the 422 body's ``detail[].input``. Starlette's JSONResponse
renders with ``json.dumps(..., allow_nan=False)``, so a request containing a
literal NaN or Infinity produces an error payload that itself contains a
non-finite float -- and rendering that response raises ValueError, turning
the intended 422 into an opaque 500. This module exists solely to make that
422 actually reach the client; for any error made only of finite values it
reproduces FastAPI's default output byte-for-byte.
"""

import math
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def sanitize_non_finite(obj: Any) -> Any:
    """Replace NaN/Infinity with their str() form, recursively.

    Applied only to the error body of a rejected request, never to a
    successful response -- EmissionResponse fields are already finite by the
    time they reach the client, since the calculator raises on non-finite
    inputs before producing a result.
    """
    if isinstance(obj, float) and not math.isfinite(obj):
        return str(obj)
    if isinstance(obj, dict):
        return {k: sanitize_non_finite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_non_finite(v) for v in obj]
    return obj


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Same shape and status code as FastAPI's default handler, but safe
    to render when the rejected input itself was non-finite."""
    content = sanitize_non_finite(jsonable_encoder({"detail": exc.errors()}))
    return JSONResponse(status_code=422, content=content)
