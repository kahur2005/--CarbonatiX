"""Run commit behaviour. The database is faked with an in-memory dict via
dependency override, because what matters here is the commit contract, not
Postgres."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app import runs as runs_module
from app.auth import current_user_id
from app.forecasting.service import ForecastUnavailable
from app.main import app

USER = uuid.uuid4()
client = TestClient(app)


@pytest.fixture(autouse=True)
def _current_user():
    """Scoped per-test, not module-level: a bare top-level
    `app.dependency_overrides[...] = ...` would never be undone and would
    leak into every other test module sharing this `app` instance (e.g.
    test_auth.py's real-JWT tests), silently bypassing auth there too.
    """
    app.dependency_overrides[current_user_id] = lambda: USER
    yield
    app.dependency_overrides.pop(current_user_id, None)


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


def test_run_commit_stores_result_compliance_and_forecast(fake_db):
    client.put("/company", json=COMPANY)
    r = client.post("/runs", json=OPERATIONAL)
    assert r.status_code == 201
    body = r.json()
    assert body["result"]["totalEmissions"] > 0
    assert "isCompliant" in body["compliance"]
    assert "forecastSnapshot" in body
    assert body["compliance"]["capTco2e"] == 7600.0


def test_run_is_readable_after_commit(fake_db):
    client.put("/company", json=COMPANY)
    run_id = client.post("/runs", json=OPERATIONAL).json()["id"]
    got = client.get(f"/runs/{run_id}")
    assert got.status_code == 200
    assert got.json()["id"] == run_id


def test_run_requires_a_company_first(fake_db):
    r = client.post("/runs", json=OPERATIONAL)
    assert r.status_code == 409
    assert "company" in r.text.lower()


def test_suggest_cap_endpoint_uses_baseline(fake_db):
    client.put("/company", json=COMPANY)
    r = client.post("/company/suggest-cap", json={**OPERATIONAL, "reductionTarget": 0.10})
    assert r.status_code == 200
    assert r.json()["capTco2e"] > 0


def test_run_commit_returns_503_when_forecast_unavailable(fake_db, monkeypatch):
    """Mirrors GET /forecasts' handling of the same exception (see
    app/main.py): a forecast-source outage is a 503, never an unhandled 500,
    even on the run-commit path where the failure is more consequential."""
    client.put("/company", json=COMPANY)

    async def _boom(*args, **kwargs):
        raise ForecastUnavailable("artifact missing")

    monkeypatch.setattr(runs_module, "current_forecast", _boom)

    r = client.post("/runs", json=OPERATIONAL)
    assert r.status_code == 503
    assert "forecast" in r.text.lower()
