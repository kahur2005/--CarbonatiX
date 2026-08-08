"""Tests for the Supabase JWT verification dependency.

Isolated from test_api.py: the autouse fixture below installs a fake JWKS and
sets SUPABASE_URL for every test in this module, and appending these tests to
test_api.py would leak both into the unrelated /emissions tests.

The signing key is generated per test session, so a token here is valid only
against the fake key set this module publishes -- no fixture ever holds a real
Supabase credential.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jose import jwt
from jose.utils import base64url_encode

from app import auth
from app.main import app

client = TestClient(app)

KID = "test-kid-1"
ROTATED_KID = "test-kid-2"
SUPABASE_URL = "https://project.example.supabase.co"


def _keypair(kid: str) -> tuple[str, dict]:
    """A P-256 keypair as (PKCS8 PEM private key, public JWK)."""
    private = ec.generate_private_key(ec.SECP256R1())
    numbers = private.public_key().public_numbers()
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_jwk = {
        "kty": "EC",
        "crv": "P-256",
        "alg": "ES256",
        "use": "sig",
        "kid": kid,
        "x": base64url_encode(numbers.x.to_bytes(32, "big")).decode(),
        "y": base64url_encode(numbers.y.to_bytes(32, "big")).decode(),
    }
    return pem, public_jwk


PRIVATE_PEM, PUBLIC_JWK = _keypair(KID)
OTHER_PEM, _OTHER_JWK = _keypair("unpublished-kid")
ROTATED_PEM, ROTATED_JWK = _keypair(ROTATED_KID)


class _FakeJWKS:
    """Stands in for the network. Records calls so refetch behaviour is
    observable, and can be told to fail."""

    def __init__(self, keys: list[dict]):
        self.keys = keys
        self.calls = 0
        self.fail = False

    async def __call__(self, url: str) -> dict:
        self.calls += 1
        if self.fail:
            raise httpx.ConnectError("boom")
        return {"keys": self.keys}


@pytest.fixture(autouse=True)
def jwks(monkeypatch):
    """Fresh module state and a fake key set for every test.

    The cache is process-wide, so it must be reset per test or one test's
    fetch would satisfy the next test's lookup and the refetch assertions
    would pass without the code doing anything.
    """
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setattr(auth, "_keys", {})
    monkeypatch.setattr(auth, "_fetched_at", 0.0)
    monkeypatch.setattr(auth, "_last_attempt_at", 0.0)

    fake = _FakeJWKS([PUBLIC_JWK])

    async def fake_fetch() -> dict:
        payload = await fake(auth._jwks_url())
        return {k["kid"]: k for k in payload["keys"] if auth._algorithm_for(k) is not None}

    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch)
    return fake


def _token(
    sub: str,
    *,
    expired: bool = False,
    pem: str = PRIVATE_PEM,
    kid: str = KID,
    audience: str = "authenticated",
    include_sub: bool = True,
) -> str:
    claims: dict = {"exp": datetime.now(UTC) + timedelta(hours=-1 if expired else 1)}
    if audience is not None:
        claims["aud"] = audience
    if include_sub:
        claims["sub"] = sub
    return jwt.encode(claims, pem, algorithm="ES256", headers={"kid": kid})


# --- the happy path -------------------------------------------------------


def test_protected_route_accepts_valid_token(fake_db):
    # A valid token clears the auth dependency and reaches the real
    # database-backed handler; this fresh user has no company profile yet,
    # so the route itself reports 404, not 401 -- confirming auth passed.
    r = client.get("/company", headers={"Authorization": f"Bearer {_token(str(uuid.uuid4()))}"})
    assert r.status_code == 404


# --- caller errors, all indistinguishable ---------------------------------


def test_protected_route_rejects_missing_token():
    assert client.get("/company").status_code == 401


def test_protected_route_rejects_garbage_token():
    r = client.get("/company", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_protected_route_rejects_expired_token():
    t = _token(str(uuid.uuid4()), expired=True)
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_401_carries_no_detail_about_failure_reason():
    t = _token(str(uuid.uuid4()), expired=True)
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Not authenticated"
    assert r.headers["www-authenticate"] == "Bearer"


def test_rejects_token_signed_with_unpublished_key():
    # Syntactically valid and correctly shaped, but signed by a key whose
    # public half the JWKS does not carry -- i.e. not issued by Supabase.
    t = _token(str(uuid.uuid4()), pem=OTHER_PEM, kid=KID)
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_rejects_unknown_kid():
    t = _token(str(uuid.uuid4()), pem=OTHER_PEM, kid="no-such-kid")
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_rejects_token_with_no_kid_header():
    claims = {
        "sub": str(uuid.uuid4()),
        "exp": datetime.now(UTC) + timedelta(hours=1),
        "aud": "authenticated",
    }
    t = jwt.encode(claims, PRIVATE_PEM, algorithm="ES256")
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_rejects_valid_signature_with_non_uuid_sub():
    # Signature checks out, but "sub" isn't a UUID -- must not be trusted as a
    # user id, and must not crash the dependency with an unhandled ValueError.
    t = _token("not-a-uuid")
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_rejects_wrong_audience():
    # Correctly signed, unexpired, otherwise well-formed -- but minted for a
    # different audience (e.g. Supabase's own "anon" token rather than an
    # authenticated user's access token). Guards the `audience=` argument to
    # jwt.decode: if a future edit ever drops it, this is the test that would
    # catch a token meant for someone else being accepted here.
    t = _token(str(uuid.uuid4()), audience="anon")
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_rejects_token_missing_sub_claim():
    t = _token("", include_sub=False)
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_rejects_non_bearer_authorization_header():
    t = _token(str(uuid.uuid4()))
    assert client.get("/company", headers={"Authorization": f"Basic {t}"}).status_code == 401


# --- algorithm confusion --------------------------------------------------


def test_rejects_hs256_token_signed_with_the_public_key():
    """The attack the asymmetric-only allowlist exists to stop.

    The JWKS public key is published to the world. An attacker takes it,
    HMAC-signs a token of their choosing with it, and declares `alg: HS256`.
    A verifier that trusted the token's own algorithm would compute HMAC with
    that same public key, find the signature valid, and authenticate whatever
    `sub` the attacker chose. Nothing about this token is secret -- if it is
    ever accepted, every account is trivially impersonable.
    """
    forged_sub = str(uuid.uuid4())
    hmac_secret = json.dumps(PUBLIC_JWK, sort_keys=True)
    claims = {
        "sub": forged_sub,
        "exp": datetime.now(UTC) + timedelta(hours=1),
        "aud": "authenticated",
    }
    t = jwt.encode(claims, hmac_secret, algorithm="HS256", headers={"kid": KID})
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401


def test_rejects_unsigned_none_algorithm_token():
    header = base64url_encode(json.dumps({"alg": "none", "typ": "JWT", "kid": KID}).encode())
    body = base64url_encode(
        json.dumps({"sub": str(uuid.uuid4()), "aud": "authenticated"}).encode()
    )
    t = f"{header.decode()}.{body.decode()}."
    assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401


# --- key cache and rotation -----------------------------------------------


def test_jwks_is_fetched_once_and_then_cached(jwks, fake_db):
    headers = {"Authorization": f"Bearer {_token(str(uuid.uuid4()))}"}
    for _ in range(3):
        assert client.get("/company", headers=headers).status_code == 404
    assert jwks.calls == 1


def test_unknown_kid_triggers_a_refetch_that_picks_up_a_rotated_key(
    jwks, monkeypatch, fake_db
):
    # Warm the cache with the old key only.
    assert client.get(
        "/company", headers={"Authorization": f"Bearer {_token(str(uuid.uuid4()))}"}
    ).status_code == 404
    assert jwks.calls == 1

    # Supabase rotates: a new kid appears upstream, and a token arrives signed
    # by it.
    jwks.keys = [PUBLIC_JWK, ROTATED_JWK]
    rotated = {
        "Authorization": f"Bearer {_token(str(uuid.uuid4()), pem=ROTATED_PEM, kid=ROTATED_KID)}"
    }

    # Inside the cooldown the new key is not picked up. This is the documented
    # cost of the anti-amplification floor, asserted rather than left to be
    # discovered: see _MIN_REFETCH_INTERVAL_SECONDS.
    assert client.get("/company", headers=rotated).status_code == 401
    assert jwks.calls == 1

    # Once the cooldown lapses, the unknown kid drives a refetch and the
    # rotated key starts working -- no restart, no intervention.
    monkeypatch.setattr(auth, "_last_attempt_at", 0.0)
    assert client.get("/company", headers=rotated).status_code == 404
    assert jwks.calls == 2


def test_unknown_kid_storm_does_not_refetch_per_request(jwks, fake_db):
    """The refetch cooldown. Unknown-kid tokens need no valid signature, so
    anyone can mint an endless stream of them; without a floor on fetch
    frequency this dependency would forward that stream to Supabase."""
    for i in range(20):
        t = _token(str(uuid.uuid4()), pem=OTHER_PEM, kid=f"bogus-{i}")
        assert client.get("/company", headers={"Authorization": f"Bearer {t}"}).status_code == 401
    assert jwks.calls == 1


def test_stale_keys_are_used_when_the_jwks_endpoint_is_down(jwks, monkeypatch, fake_db):
    """A JWKS outage must not log everyone out. Keys are long-lived; serving
    a stale set beats answering 401, which would read to a logged-in user as
    'your password stopped working'."""
    headers = {"Authorization": f"Bearer {_token(str(uuid.uuid4()))}"}
    assert client.get("/company", headers=headers).status_code == 404

    # Expire the cache and take the endpoint down.
    monkeypatch.setattr(auth, "_fetched_at", 0.0)
    monkeypatch.setattr(auth, "_last_attempt_at", 0.0)
    jwks.fail = True

    r = client.get("/company", headers={"Authorization": f"Bearer {_token(str(uuid.uuid4()))}"})
    assert r.status_code == 404
    assert jwks.calls == 2  # it did try


def test_jwks_unreachable_with_a_cold_cache_is_503_not_401(jwks):
    """An outage on a cold cache is a dependency failure, not a claim about
    the caller's token -- 401 there would be a lie, and would send users to
    re-enter a password that was never wrong."""
    jwks.fail = True
    r = client.get("/company", headers={"Authorization": f"Bearer {_token(str(uuid.uuid4()))}"})
    assert r.status_code == 503


# --- operator misconfiguration --------------------------------------------


def test_missing_supabase_url_is_a_server_error_not_a_client_error(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    t = _token(str(uuid.uuid4()))
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 500


def test_jwks_url_is_derived_from_supabase_url(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co/")
    assert auth._jwks_url() == "https://abc.supabase.co/auth/v1/.well-known/jwks.json"


# --- key filtering --------------------------------------------------------


def test_symmetric_jwks_entries_are_refused():
    """A key set that somehow advertises an HMAC key must not make one usable.
    `_algorithm_for` is the single gate every key passes through."""
    assert auth._algorithm_for({"kty": "oct", "alg": "HS256", "kid": "x"}) is None
    assert auth._algorithm_for({"kty": "EC", "alg": "ES256", "kid": "x"}) == "ES256"
    assert auth._algorithm_for({"kty": "EC", "kid": "x"}) == "ES256"  # alg omitted
    assert auth._algorithm_for({"kty": "RSA", "kid": "x"}) == "RS256"
    assert auth._algorithm_for({"kty": "oct", "kid": "x"}) is None
