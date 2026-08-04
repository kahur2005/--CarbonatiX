"""Cross-tenant isolation.

RLS is inert on this backend's database connection: it connects as the
`postgres` superuser, which Postgres exempts from RLS unconditionally, and
the migration never issues `force row level security` (see
supabase/migrations/0001_init.sql). So there is no database-level backstop
here -- tenant isolation is entirely the `where user_id = $N` clauses in
app/companies.py and app/runs.py. This file is the test that enforces it.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth import current_user_id
from app.main import app

client = TestClient(app)

USER_A = uuid.uuid4()
USER_B = uuid.uuid4()

COMPANY = {
    "name": "PT Demo Smelter",
    "technology": "RKEF",
    "efCaptivePltu": 1.0,
    "dryerThermalEfficiency": 0.55,
    "secEafKwhPerTAlloy": 2400.0,
    "alloyNickelGrade": 0.10,
    "kilnThermalEfficiency": 0.55,
    "capTco2e": 7600.0,
}
OPERATIONAL = {
    "wetOreInputTons": 10000.0,
    "moistureContentPct": 0.32,
    "nickelGradePct": 0.018,
    "reductantBiocokePct": 0.0,
    "powerMixCaptiveCoal": 1.0,
    "powerMixHydroGrid": 0.0,
}


@pytest.fixture(autouse=True)
def _clear_override():
    yield
    app.dependency_overrides.pop(current_user_id, None)


def _as(user_id: uuid.UUID) -> None:
    app.dependency_overrides[current_user_id] = lambda: user_id


def test_user_b_cannot_see_or_attach_to_user_a_data(fake_db):
    # User A onboards and commits a run.
    _as(USER_A)
    put_resp = client.put("/company", json=COMPANY)
    assert put_resp.status_code == 200
    committed = client.post("/runs", json=OPERATIONAL)
    assert committed.status_code == 201
    a_run_id = committed.json()["id"]
    a_body = committed.json()

    # Now authenticated as User B, who has never onboarded.
    _as(USER_B)

    # 1. GET /runs/{A's run id} must be a plain 404, not A's data.
    run_resp = client.get(f"/runs/{a_run_id}")
    assert run_resp.status_code == 404
    assert run_resp.json() != a_body
    assert "id" not in run_resp.json()
    assert a_run_id not in run_resp.text
    assert run_resp.json() == {"detail": "Run not found"}

    # 2. GET /company must not return A's company.
    company_resp = client.get("/company")
    assert company_resp.status_code == 404
    assert "PT Demo Smelter" not in company_resp.text
    assert company_resp.json() == {"detail": "No company profile"}

    # 3. User B committing a run must not attach to A's company: B has no
    # company of their own, so the commit is rejected outright rather than
    # silently landing under A's company_id.
    commit_resp = client.post("/runs", json=OPERATIONAL)
    assert commit_resp.status_code == 409
    assert "company" in commit_resp.text.lower()
    assert commit_resp.json() != a_body


def test_user_b_with_own_company_gets_own_run_not_a_run(fake_db):
    """Stronger check: even when B *has* their own company (so the commit
    path succeeds), B's committed run must be their own -- reading it back
    must never resolve to A's row, and A's run id must remain unreachable.
    """
    _as(USER_A)
    client.put("/company", json=COMPANY)
    a_run_id = client.post("/runs", json=OPERATIONAL).json()["id"]

    _as(USER_B)
    client.put("/company", json={**COMPANY, "name": "PT Other Smelter"})
    b_committed = client.post("/runs", json=OPERATIONAL)
    assert b_committed.status_code == 201
    b_run_id = b_committed.json()["id"]

    assert b_run_id != a_run_id

    # B reading A's run id directly: still 404, even though B now has a
    # company and a run of their own.
    cross_read = client.get(f"/runs/{a_run_id}")
    assert cross_read.status_code == 404
    assert cross_read.json() == {"detail": "Run not found"}

    # B reading their own run works and is genuinely their own.
    own_read = client.get(f"/runs/{b_run_id}")
    assert own_read.status_code == 200
    assert own_read.json()["id"] == b_run_id

    # B's company profile is their own, not A's.
    b_company = client.get("/company")
    assert b_company.status_code == 200
    assert b_company.json()["name"] == "PT Other Smelter"
