"""Tests for the Supabase JWT verification dependency.

Isolated from test_api.py: the autouse fixture below sets
SUPABASE_JWT_SECRET for every test in this module, and appending these
tests to test_api.py would leak that env var into the unrelated
/emissions tests.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.main import app

client = TestClient(app)

SECRET = "test-secret-value"
WRONG_SECRET = "a-different-secret-entirely"


@pytest.fixture(autouse=True)
def _jwt_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)


def _token(sub: str, *, expired: bool = False, secret: str = SECRET) -> str:
    exp = datetime.now(UTC) + timedelta(hours=-1 if expired else 1)
    return jwt.encode({"sub": sub, "exp": exp, "aud": "authenticated"}, secret, algorithm="HS256")


def test_protected_route_rejects_missing_token():
    assert client.get("/company").status_code == 401


def test_protected_route_rejects_garbage_token():
    r = client.get("/company", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_protected_route_rejects_expired_token():
    t = _token(str(uuid.uuid4()), expired=True)
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401


def test_protected_route_accepts_valid_token(fake_db):
    # A valid token clears the auth dependency and reaches the real
    # database-backed handler; this fresh user has no company profile yet,
    # so the route itself reports 404, not 401 -- confirming auth passed.
    user_id = str(uuid.uuid4())
    t = _token(user_id)
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 404


def test_401_carries_no_detail_about_failure_reason():
    t = _token(str(uuid.uuid4()), expired=True)
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Not authenticated"
    assert r.headers["www-authenticate"] == "Bearer"


def test_rejects_token_signed_with_wrong_secret():
    # A forged token: syntactically valid, but never issued by Supabase.
    t = _token(str(uuid.uuid4()), secret=WRONG_SECRET)
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401


def test_rejects_valid_signature_with_non_uuid_sub():
    # Signature checks out, but "sub" isn't a UUID -- must not be trusted
    # as a user id, and must not crash the dependency with an unhandled
    # ValueError.
    t = _token("not-a-uuid")
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401


def test_rejects_wrong_audience():
    # Correct secret, unexpired, otherwise well-formed -- but minted for a
    # different audience (e.g. Supabase's own "anon" role token rather than
    # an authenticated user's access token). Guards the `audience=` argument
    # to jwt.decode: if a future edit ever drops it, this is the test that
    # would catch a token meant for someone else being accepted here.
    exp = datetime.now(UTC) + timedelta(hours=1)
    t = jwt.encode({"sub": str(uuid.uuid4()), "exp": exp, "aud": "anon"}, SECRET, algorithm="HS256")
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401


def test_rejects_token_missing_sub_claim():
    exp = datetime.now(UTC) + timedelta(hours=1)
    t = jwt.encode({"exp": exp, "aud": "authenticated"}, SECRET, algorithm="HS256")
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 401


def test_rejects_non_bearer_authorization_header():
    t = _token(str(uuid.uuid4()))
    r = client.get("/company", headers={"Authorization": f"Basic {t}"})
    assert r.status_code == 401


def test_missing_secret_is_a_server_error_not_a_client_error(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    t = _token(str(uuid.uuid4()))
    r = client.get("/company", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 500
