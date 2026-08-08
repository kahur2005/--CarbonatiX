"""Supabase JWT verification.

The browser calls this service directly carrying the Supabase access token,
so this module is the only thing standing between the internet and a user's
data. Every *caller* error -- missing header, wrong scheme, unknown key,
bad signature, expired token, wrong audience, malformed or absent ``sub`` --
returns 401 with the same generic detail and a ``WWW-Authenticate: Bearer``
header: a caller who supplied a bad token learns nothing about which check
failed.

Two failures are deliberately not 401, because they are not the caller's
fault and do not belong on that "learns nothing" guarantee:

* a missing ``SUPABASE_URL`` returns 500 -- operator misconfiguration;
* an unreachable JWKS endpoint with no usable cached key returns 503 --
  a dependency outage, treated the same way ``/forecasts`` treats a missing
  forecast. Answering 401 there would tell every logged-in user their
  password had stopped working.

This project's Supabase instance signs access tokens **asymmetrically**
(ES256, EC P-256) and publishes the public half at
``/auth/v1/.well-known/jwks.json``. There is no shared HS256 secret for user
tokens; the dashboard's "JWT signing keys" screen shows a key *id*, which is
a public identifier, not a credential. Verification therefore fetches the
JWKS, selects the key named by the token's own ``kid`` header, and checks the
signature against the public key.

Only asymmetric algorithms are ever accepted (see ``_ASYMMETRIC_ALGORITHMS``).
That exclusion is a security control, not tidiness: in the classic algorithm
confusion attack an attacker takes the *public* key -- which is, by design,
published to the world at the URL above -- re-signs a token of their choosing
with it as an HMAC secret, and sets ``alg: HS256``. A verifier that honours
the token's own algorithm choice computes HMAC with that same public key, the
signature matches, and any ``sub`` the attacker likes is authenticated. The
algorithm used here comes from the JWKS entry, never from the token.
"""

import asyncio
import os
import time
from typing import Any
from uuid import UUID

import httpx
from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

__all__ = ["current_user_id"]

# Asymmetric only -- never HS*. See the module docstring for the attack this
# closes. Supabase issues ES256 today; the RS*/PS* entries cost nothing and
# mean a future key-type migration is a dashboard change, not a code change.
_ASYMMETRIC_ALGORITHMS = frozenset(
    {"ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512"}
)

_DEFAULT_ALG_BY_KTY = {"EC": "ES256", "RSA": "RS256"}

# How long a fetched key set is served without re-checking upstream.
_CACHE_TTL_SECONDS = 600.0

# Floor on time between upstream fetches. Without it, a token bearing an
# unknown `kid` forces a refetch, and a stream of tokens with random `kid`s
# -- which anyone can mint, since none of this needs a valid signature --
# turns this dependency into an unauthenticated amplifier pointed at Supabase.
#
# The cost is that a key rotation is picked up up to this many seconds late,
# and genuine tokens signed by the new key are rejected in the meantime. That
# is acceptable because rotation publishes the new public key to the JWKS
# *before* tokens are issued against it, so the window where a valid token
# carries a `kid` this cache has never seen is close to empty in practice.
# Trading a bounded, self-healing delay for an open amplification vector is
# the right way round; the reverse is not.
_MIN_REFETCH_INTERVAL_SECONDS = 30.0

_JWKS_TIMEOUT_SECONDS = 5.0

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)

_UNAVAILABLE = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="Authentication is temporarily unavailable",
)

# Process-wide key cache. `_keys` maps kid -> JWK dict.
_keys: dict[str, dict[str, Any]] = {}
_fetched_at: float = 0.0
_last_attempt_at: float = 0.0
_lock = asyncio.Lock()


def _jwks_url() -> str:
    base = os.environ.get("SUPABASE_URL")
    if not base:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth is not configured",
        )
    return f"{base.rstrip('/')}/auth/v1/.well-known/jwks.json"


def _algorithm_for(key: dict[str, Any]) -> str | None:
    """The algorithm this module will verify `key` with, or None to refuse it.

    Taken from the JWKS entry -- never from the token -- and checked against
    the asymmetric allowlist.
    """
    alg = key.get("alg") or _DEFAULT_ALG_BY_KTY.get(key.get("kty", ""))
    return alg if alg in _ASYMMETRIC_ALGORITHMS else None


async def _fetch_jwks() -> dict[str, dict[str, Any]]:
    """Fetch and index the published key set by `kid`.

    Entries without a `kid`, or whose algorithm this module will not accept,
    are dropped here rather than at verification time -- an unusable key in
    the cache would otherwise be indistinguishable from a usable one until a
    token asked for it.
    """
    async with httpx.AsyncClient(timeout=_JWKS_TIMEOUT_SECONDS) as client:
        response = await client.get(_jwks_url())
        response.raise_for_status()
        payload = response.json()

    indexed: dict[str, dict[str, Any]] = {}
    for key in payload.get("keys", []):
        kid = key.get("kid")
        if kid and _algorithm_for(key) is not None:
            indexed[kid] = key
    return indexed


async def _key_for(kid: str) -> dict[str, Any]:
    """Resolve `kid` to a JWK, refreshing the cache when it is stale or when
    `kid` is unrecognised (which is what a Supabase key rotation looks like
    from here).

    On a fetch failure a stale cached key set is preferred over an error:
    Supabase signing keys are long-lived, and a brief JWKS outage should not
    log every user out.
    """
    global _keys, _fetched_at, _last_attempt_at

    if (time.monotonic() - _fetched_at) < _CACHE_TTL_SECONDS and kid in _keys:
        return _keys[kid]

    async with _lock:
        # Re-check: another request may have refreshed while this one waited.
        now = time.monotonic()
        if (now - _fetched_at) < _CACHE_TTL_SECONDS and kid in _keys:
            return _keys[kid]

        if (now - _last_attempt_at) >= _MIN_REFETCH_INTERVAL_SECONDS:
            _last_attempt_at = now
            try:
                _keys = await _fetch_jwks()
                _fetched_at = now
            except HTTPException:
                # A deliberate status from `_jwks_url` -- 500 for a missing
                # SUPABASE_URL. Operator misconfiguration must surface as
                # itself, not get laundered into the 503 below: "temporarily
                # unavailable" would send someone hunting a network fault
                # that does not exist, and unlike a real outage this one
                # never resolves on its own.
                raise
            except Exception as exc:  # httpx errors, bad JSON, non-2xx
                if not _keys:
                    raise _UNAVAILABLE from exc
                # Stale keys beat no keys; fall through and try them.

        if not _keys:
            raise _UNAVAILABLE

        key = _keys.get(kid)
        if key is None:
            raise _UNAUTHORIZED
        return key


async def current_user_id(authorization: str | None = Header(default=None)) -> UUID:
    """Resolve the caller's user id, or raise 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise _UNAUTHORIZED

    token = authorization.removeprefix("Bearer ").strip()

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise _UNAUTHORIZED from exc

    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise _UNAUTHORIZED

    # Cheap pre-filter only. The authoritative choice is `algorithm` below,
    # which comes from the key; this just avoids a cache lookup for a token
    # announcing an algorithm that would never be honoured anyway.
    if header.get("alg") not in _ASYMMETRIC_ALGORITHMS:
        raise _UNAUTHORIZED

    key = await _key_for(kid)
    algorithm = _algorithm_for(key)
    if algorithm is None:  # pragma: no cover -- _fetch_jwks drops these
        raise _UNAUTHORIZED

    try:
        claims = jwt.decode(token, key, algorithms=[algorithm], audience="authenticated")
        return UUID(claims["sub"])
    except (JWTError, KeyError, ValueError, TypeError) as exc:
        raise _UNAUTHORIZED from exc
