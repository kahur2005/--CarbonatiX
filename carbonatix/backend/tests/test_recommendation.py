"""GET /runs/{run_id}/recommendation: reconstruction, tenant scoping, and the
placeholder-citation flag reaching the actual HTTP response (not just the
pipeline's own return value -- see test_advisor_pipeline.py for that).

The route wires `recommendation.load` (DB fetch + reconstruction) to
`recommendation.format_stream` (SSE framing) in main.py; this module
exercises the whole path through a real `TestClient`, with the database
faked via `fake_db` (see conftest.py) and the model call monkeypatched
(so no real provider call is possible).
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.advisor import pipeline
from app.auth import current_user_id
from app.main import app

USER = uuid.uuid4()
client = TestClient(app)


@pytest.fixture(autouse=True)
def _current_user():
    """Scoped per-test, not module-level -- a bare top-level
    `app.dependency_overrides[...] = ...` would leak into every other test
    module sharing this `app` instance and silently bypass auth there too.
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


def _parse_sse(body: str) -> list[dict]:
    events = []
    for line in body.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    return events


def test_run_not_found_returns_404(fake_db):
    r = client.get(f"/runs/{uuid.uuid4()}/recommendation")
    assert r.status_code == 404
    assert r.json() == {"detail": "Run not found"}


def test_run_belonging_to_another_user_returns_404(fake_db, monkeypatch):
    """Tenant scoping: a run committed by one user must not resolve when a
    different user's token requests its recommendation stream."""
    client.put("/company", json=COMPANY)
    run_id = client.post("/runs", json=OPERATIONAL).json()["id"]

    other_user = uuid.uuid4()
    app.dependency_overrides[current_user_id] = lambda: other_user
    try:
        r = client.get(f"/runs/{run_id}/recommendation")
    finally:
        app.dependency_overrides[current_user_id] = lambda: USER
    assert r.status_code == 404
    assert r.json() == {"detail": "Run not found"}


def test_reconstruction_round_trips_a_committed_run(fake_db, monkeypatch):
    """The route hand-reconstructs EmissionResult/CompliancePosition from
    the stored JSON field by field -- a wrong wire-name guess raises a
    KeyError inside the generator instead of failing at import time. This
    drives a real run through /runs, then through the recommendation
    route, and asserts the pipeline actually completes end to end."""

    async def fake_call(prompt: str) -> str:
        return "Posisi defisit. Rujuk Permen ESDM 16/2022."

    monkeypatch.setattr(pipeline, "_call_model", fake_call)

    client.put("/company", json=COMPANY)
    run_id = client.post("/runs", json=OPERATIONAL).json()["id"]

    r = client.get(f"/runs/{run_id}/recommendation")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(r.text)
    done_stages = [e["stage"] for e in events if e["status"] == "done"]
    assert done_stages == ["retrieve", "assemble", "synthesise", "verify"]


def test_placeholder_citation_flag_reaches_the_http_response(fake_db, monkeypatch):
    """The flag must be visible on the streamed HTTP response. With the
    gazetted corpus it is False on every event."""

    async def fake_call(prompt: str) -> str:
        return "Posisi defisit."

    monkeypatch.setattr(pipeline, "_call_model", fake_call)

    client.put("/company", json=COMPANY)
    run_id = client.post("/runs", json=OPERATIONAL).json()["id"]

    r = client.get(f"/runs/{run_id}/recommendation")
    events = _parse_sse(r.text)
    assert events
    assert all(e["placeholderCitations"] is False for e in events)


def test_model_failure_streams_a_failed_synthesise_stage_only(fake_db, monkeypatch):
    async def boom(prompt: str) -> str:
        raise RuntimeError("upstream timeout")

    monkeypatch.setattr(pipeline, "_call_model", boom)

    client.put("/company", json=COMPANY)
    run_id = client.post("/runs", json=OPERATIONAL).json()["id"]

    r = client.get(f"/runs/{run_id}/recommendation")
    assert r.status_code == 200
    events = _parse_sse(r.text)
    failed = [e for e in events if e["status"] == "failed"]
    assert len(failed) == 1
    assert failed[0]["stage"] == "synthesise"
    assert not any(e["stage"] == "verify" for e in events)
