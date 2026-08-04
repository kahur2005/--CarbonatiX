"""Supabase JWT verification.

The browser calls this service directly carrying the Supabase access token,
so this module is the only thing standing between the internet and a user's
data. Every *caller* error -- missing header, wrong scheme, bad signature,
expired token, wrong audience, malformed or absent ``sub`` -- returns 401
with the same generic detail and a ``WWW-Authenticate: Bearer`` header: a
caller who supplied a bad token learns nothing about which check failed.

The one exception is a missing ``SUPABASE_JWT_SECRET``, which returns 500
instead of 401. That is deliberate: it is operator misconfiguration, not
something the caller did, so it does not belong on the same "learns nothing"
guarantee as the caller-facing paths above -- and the 500 still leaks nothing
beyond the bare fact that auth is unconfigured.

Assumes the Supabase project signs access tokens with HS256 against a shared
secret (``SUPABASE_JWT_SECRET``). Supabase's newer projects can instead issue
asymmetric (ES256/RS256) signing keys verified via a JWKS endpoint, with no
shared secret at all -- if this project's instance uses that mode, every
genuine token will be rejected here. See task-8-report.md for what would need
to change.
"""

import os
from uuid import UUID

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

__all__ = ["current_user_id"]

# Shared across every request (not constructed per-call), so it must stay
# immutable: anything that needs to vary per request (a dynamic header, a
# different detail) requires building a new HTTPException, not mutating this
# one in place.
_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def current_user_id(authorization: str | None = Header(default=None)) -> UUID:
    """Resolve the caller's user id, or raise 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise _UNAUTHORIZED

    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth is not configured",
        )

    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
        return UUID(claims["sub"])
    except (JWTError, KeyError, ValueError) as exc:
        raise _UNAUTHORIZED from exc
