"""Tests for the four-stage SSE recommendation pipeline.

Every test monkeypatches `pipeline._call_model` -- there is no
ANTHROPIC_API_KEY in this environment and no test here may make a real
API call. Three things this module pins down, matching the guarantees the
rest of the backend already makes for provisional data:

1. Placeholder regulation text (`corpus.has_placeholder_text`) must reach
   both the top-level event shape and the `verify` stage's payload.
2. A model-call failure must fail only the `synthesise` stage and produce
   nothing that looks like a recommendation -- the run itself is untouched.
3. A fabricated figure must flag the recommendation via `verify`'s
   `flagged`/`unsupported` fields, never silently disappear.
"""

import pytest

from app.advisor import pipeline
from app.emissions.calculator import calculate_emissions
from app.emissions.compliance import assess

NOMINAL = {
    "wet_ore_input_tons": 10_000.0,
    "moisture_content_pct": 0.32,
    "nickel_grade_pct": 0.018,
    "reductant_biocoke_pct": 0.0,
    "sec_eaf_kwh_per_t_alloy": 2400.0,
    "power_mix_captive_coal": 1.0,
    "ef_captive_pltu": 1.0,
    "dryer_thermal_efficiency": 0.55,
}
FORECAST = {
    "idxCarbonIdrPerTon": [35200.0],
    "lmeUsdPerTon": [16500.0],
    "synthetic": True,
    "provenance": {"idxCarbonIdrPerTon": {"synthetic": True}},
}


def _fixture():
    r = calculate_emissions(**NOMINAL)
    return r, assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)


@pytest.mark.asyncio
async def test_all_four_stages_emit_in_order(monkeypatch):
    async def fake_call(prompt: str) -> str:
        return "Posisi defisit. Rujuk Permen ESDM 16/2022."

    monkeypatch.setattr(pipeline, "_call_model", fake_call)

    r, p = _fixture()
    stages = [
        e["stage"] async for e in pipeline.run_pipeline(r, p, FORECAST) if e["status"] == "done"
    ]
    assert stages == ["retrieve", "assemble", "synthesise", "verify"]


@pytest.mark.asyncio
async def test_model_failure_marks_the_stage_failed_not_the_run(monkeypatch):
    async def boom(prompt: str) -> str:
        raise RuntimeError("upstream timeout")

    monkeypatch.setattr(pipeline, "_call_model", boom)

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    failed = [e for e in events if e["status"] == "failed"]
    assert len(failed) == 1
    assert failed[0]["stage"] == "synthesise"
    # No verify stage runs, and nothing resembling a recommendation body
    # is emitted anywhere in the stream once synthesise has failed.
    assert not any(e["stage"] == "verify" for e in events)
    assert not any(isinstance(e.get("payload"), dict) and "body" in e["payload"] for e in events)


@pytest.mark.asyncio
async def test_invented_figure_flags_the_recommendation(monkeypatch):
    async def liar(prompt: str) -> str:
        return "Beli 999888 ton kredit karbon."

    monkeypatch.setattr(pipeline, "_call_model", liar)

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    verify = next(e for e in events if e["stage"] == "verify" and e["status"] != "running")
    assert verify["payload"]["flagged"] is True
    assert "999888" in verify["payload"]["unsupported"]


@pytest.mark.asyncio
async def test_every_event_carries_the_placeholder_citation_flag(monkeypatch):
    """corpus.has_placeholder_text() is True today (see corpus.py's notice) --
    every event, regardless of stage or status, must surface that as an
    unambiguous top-level boolean so a citation chip can render as
    "not yet authoritative" without inspecting stage-specific payloads."""

    async def fake_call(prompt: str) -> str:
        return "Posisi defisit."

    monkeypatch.setattr(pipeline, "_call_model", fake_call)

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    assert events, "expected at least one event"
    for e in events:
        assert e["placeholderCitations"] is True

    verify_done = next(e for e in events if e["stage"] == "verify" and e["status"] == "done")
    assert verify_done["payload"]["placeholderCitations"] is True


@pytest.mark.asyncio
async def test_synthetic_forecast_provenance_is_not_stripped(monkeypatch):
    """The forecast snapshot carries `synthetic`/`provenance` keys (see
    forecasting/service.py); the assemble stage must pass them through
    rather than narrowing the forecast down to just the two price figures
    it needs for the prompt."""

    async def fake_call(prompt: str) -> str:
        return "Posisi defisit."

    monkeypatch.setattr(pipeline, "_call_model", fake_call)

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    assemble_done = next(e for e in events if e["stage"] == "assemble" and e["status"] == "done")
    assert assemble_done["payload"]["forecastSynthetic"] is True
    assert assemble_done["payload"]["forecastProvenance"] == FORECAST["provenance"]
