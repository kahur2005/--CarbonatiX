"""Monthly production log API: period bounds, upsert, isolation, run stamp."""

from datetime import date
import uuid

import pytest
from fastapi.testclient import TestClient

from app import production_months as production_months_module
from app.auth import current_user_id
from app.main import app

USER = uuid.uuid4()
USER_B = uuid.uuid4()
client = TestClient(app)

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
PARTIAL = {
    "wetOreInputTons": 5000.0,
    "moistureContentPct": 0.30,
}


@pytest.fixture(autouse=True)
def _current_user():
    app.dependency_overrides[current_user_id] = lambda: USER
    yield
    app.dependency_overrides.pop(current_user_id, None)


def test_put_requires_company(fake_db):
    r = client.put("/production-months/2025-02", json={"inputs": PARTIAL})
    assert r.status_code == 409


def test_upsert_round_trip_allows_partial_inputs(fake_db):
    client.put("/company", json=COMPANY)
    put = client.put("/production-months/2025-02", json={"inputs": PARTIAL})
    assert put.status_code == 200
    body = put.json()
    assert body["period"] == "2025-02"
    assert body["inputs"]["wetOreInputTons"] == 5000.0
    assert "powerMixCaptiveCoal" not in body["inputs"]

    got = client.get("/production-months/2025-02")
    assert got.status_code == 200
    assert got.json()["inputs"] == body["inputs"]


def test_get_missing_month_is_404(fake_db):
    client.put("/company", json=COMPANY)
    r = client.get("/production-months/2025-03")
    assert r.status_code == 404


def test_list_marks_months_with_inputs(fake_db):
    client.put("/company", json=COMPANY)
    client.put("/production-months/2025-01", json={"inputs": PARTIAL})
    client.put("/production-months/2025-02", json={"inputs": {}})
    listed = client.get("/production-months")
    assert listed.status_code == 200
    by_period = {row["period"]: row for row in listed.json()}
    assert by_period["2025-01"]["hasInputs"] is True
    assert by_period["2025-02"]["hasInputs"] is False


def test_rejects_period_before_earliest(fake_db):
    client.put("/company", json=COMPANY)
    r = client.put("/production-months/2024-12", json={"inputs": PARTIAL})
    assert r.status_code == 422


def test_rejects_future_period(fake_db, monkeypatch):
    client.put("/company", json=COMPANY)
    monkeypatch.setattr(
        production_months_module,
        "_current_month_start",
        lambda today=None: date(2026, 3, 1),
    )
    r = client.put("/production-months/2026-04", json={"inputs": PARTIAL})
    assert r.status_code == 422


def test_rejects_malformed_period(fake_db):
    client.put("/company", json=COMPANY)
    r = client.put("/production-months/2025-13", json={"inputs": PARTIAL})
    assert r.status_code == 422


def test_run_commit_stores_period(fake_db):
    client.put("/company", json=COMPANY)
    r = client.post("/runs", json={**OPERATIONAL, "period": "2025-02"})
    assert r.status_code == 201
    assert r.json()["period"] == "2025-02"
    got = client.get(f"/runs/{r.json()['id']}")
    assert got.status_code == 200
    assert got.json()["period"] == "2025-02"


def test_run_commit_rejects_out_of_range_period(fake_db):
    client.put("/company", json=COMPANY)
    r = client.post("/runs", json={**OPERATIONAL, "period": "2024-01"})
    assert r.status_code == 422


def test_user_b_cannot_read_user_a_production_month(fake_db):
    app.dependency_overrides[current_user_id] = lambda: USER
    client.put("/company", json=COMPANY)
    client.put("/production-months/2025-02", json={"inputs": PARTIAL})

    app.dependency_overrides[current_user_id] = lambda: USER_B
    listed = client.get("/production-months")
    assert listed.status_code == 200
    assert listed.json() == []
    got = client.get("/production-months/2025-02")
    assert got.status_code == 404
