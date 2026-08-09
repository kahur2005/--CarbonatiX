"""Tests for the four-stage SSE recommendation pipeline.

Every pipeline test monkeypatches `pipeline._call_model` -- there is no API
key in this environment and no test here may make a real API call. The
`_call_model` tests at the bottom instead monkeypatch `AsyncOpenAI` itself,
to pin the wire-level request the Elice gateway will actually receive.
Three things this module pins down, matching the guarantees the rest of the
backend already makes for provisional data:

1. The `placeholderCitations` label (`corpus.has_placeholder_text`) must reach
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
    """Every event must surface `placeholderCitations` as an unambiguous
    top-level boolean. With a real corpus it is False; a consumer still
    never has to special-case stage payloads to learn the label."""

    async def fake_call(prompt: str) -> str:
        return "Posisi defisit."

    monkeypatch.setattr(pipeline, "_call_model", fake_call)

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    assert events, "expected at least one event"
    for e in events:
        assert e["placeholderCitations"] is False

    verify_done = next(e for e in events if e["stage"] == "verify" and e["status"] == "done")
    assert verify_done["payload"]["placeholderCitations"] is False


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


# --- the wire call itself -------------------------------------------------
#
# The Elice gateway rejects any parameter outside its documented set with a
# 400 instead of ignoring it. That makes the exact kwargs sent here part of
# the contract, not an implementation detail: a well-meaning edit swapping
# `max_completion_tokens` back to the more familiar `max_tokens` would break
# every recommendation in production while every other test in this file --
# all of which stub `_call_model` out entirely -- kept passing.


class _CapturedCall:
    """Records the kwargs `_call_model` sends, and how the client was built."""

    def __init__(self, content: str | None = "Rekomendasi."):
        self.kwargs: dict = {}
        self.init: dict = {}
        self.content = content
        self.finish_reason = 'stop'
        self.closed = False


def _fake_openai(captured: _CapturedCall):
    class _Message:
        def __init__(self, content):
            self.content = content

    class _Choice:
        def __init__(self, content):
            self.message = _Message(content)
            self.finish_reason = captured.finish_reason

    class _Response:
        def __init__(self, content):
            self.choices = [_Choice(content)]

    class _Completions:
        async def create(self, **kwargs):
            captured.kwargs = kwargs
            return _Response(captured.content)

    class _Chat:
        completions = _Completions()

    class _FakeAsyncOpenAI:
        def __init__(self, **kwargs):
            captured.init = kwargs
            self.chat = _Chat()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            captured.closed = True
            return False

    return _FakeAsyncOpenAI


@pytest.fixture
def elice_env(monkeypatch):
    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_BASE_URL", "https://gateway.example/abc/v1")
    monkeypatch.delenv("ELICE_MODEL", raising=False)


@pytest.mark.asyncio
async def test_call_model_sends_max_completion_tokens_not_max_tokens(monkeypatch, elice_env):
    captured = _CapturedCall()
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(captured))

    await pipeline._call_model("halo")

    assert captured.kwargs["max_completion_tokens"] == pipeline._MAX_COMPLETION_TOKENS
    assert "max_tokens" not in captured.kwargs


@pytest.mark.asyncio
async def test_call_model_sends_only_parameters_the_gateway_accepts(monkeypatch, elice_env):
    permitted = {
        "model",
        "messages",
        "max_completion_tokens",
        "temperature",
        "top_p",
        "stop",
        "stream",
        "tools",
        "tool_choice",
        "response_format",
        "reasoning_effort",
    }
    captured = _CapturedCall()
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(captured))

    await pipeline._call_model("halo")

    assert set(captured.kwargs) <= permitted, (
        f"unsupported parameter(s) would 400: {set(captured.kwargs) - permitted}"
    )


@pytest.mark.asyncio
async def test_call_model_targets_the_configured_gateway_and_model(monkeypatch, elice_env):
    captured = _CapturedCall()
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(captured))

    await pipeline._call_model("halo")

    assert captured.init["base_url"] == "https://gateway.example/abc/v1"
    assert captured.init["api_key"] == "test-key"
    assert captured.kwargs["model"] == "gpt-5.6-sol"
    assert captured.kwargs["reasoning_effort"] == "high"
    assert captured.kwargs["messages"] == [{"role": "user", "content": "halo"}]
    assert captured.closed, "client was not closed -- its connection pool leaks"


def test_reasoning_effort_is_one_this_model_accepts():
    """GPT-5.6 Sol accepts none / low / medium / high and 400s on anything
    else. Fable 5, which this advisor used until 2026-08-07, also offered
    `xhigh` and `max` -- and those two names are in wide enough circulation
    (they are Claude Code's own effort vocabulary) that reaching for one
    while tuning is an easy edit to make. It would break every recommendation
    in production, and no other test here would notice: the stage tests stub
    `_call_model` out entirely, and the allowlist test checks parameter
    *names*, never their values."""
    assert pipeline._REASONING_EFFORT in {"none", "low", "medium", "high"}


@pytest.mark.asyncio
async def test_model_is_overridable_by_environment(monkeypatch, elice_env):
    """`openai/gpt-5.6-sol` is the fully-qualified form of the same model --
    used here because which models a given Elice deployment will actually
    serve depends on its provisioning, so a sibling model name would be a
    guess. What this pins is that the environment wins over `_DEFAULT_MODEL`,
    which is what lets a deployment move models without a code change."""
    monkeypatch.setenv("ELICE_MODEL", "openai/gpt-5.6-sol")
    captured = _CapturedCall()
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(captured))

    await pipeline._call_model("halo")

    assert captured.kwargs["model"] == "openai/gpt-5.6-sol"


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["ELICE_API_KEY", "ELICE_BASE_URL"])
async def test_missing_configuration_raises_rather_than_defaulting(monkeypatch, elice_env, missing):
    """Without a base URL the OpenAI SDK addresses api.openai.com; without a
    key it sends none. Either would turn a misconfigured deployment into a
    confusing upstream error instead of an obvious local one."""
    monkeypatch.delenv(missing, raising=False)
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(_CapturedCall()))

    with pytest.raises(RuntimeError, match=missing):
        await pipeline._call_model("halo")


@pytest.mark.asyncio
async def test_empty_completion_raises_rather_than_returning_blank(monkeypatch, elice_env):
    """A gateway refusal returns no content. An empty string would pass the
    numeral guard trivially (no numerals, nothing unsupported) and render as
    a blank panel indistinguishable from real advice."""
    captured = _CapturedCall(content=None)
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(RuntimeError, match="empty completion"):
        await pipeline._call_model("halo")


@pytest.mark.asyncio
async def test_a_refusal_fails_the_synthesise_stage_and_stops(monkeypatch, elice_env):
    """End to end: an empty completion must surface as a failed stage, not as
    an empty recommendation that `verify` then blesses as unflagged."""
    captured = _CapturedCall(content="")
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(captured))

    r, p = _fixture()
    events = [e async for e in pipeline.run_pipeline(r, p, FORECAST)]
    assert events[-1]["stage"] == "synthesise"
    assert events[-1]["status"] == "failed"
    assert not any(e["stage"] == "verify" for e in events)


@pytest.mark.asyncio
async def test_truncated_completion_raises_rather_than_returning_half_advice(
    monkeypatch, elice_env
):
    """A completion cut off at the token ceiling reads as finished advice,
    and the numeral guard cannot object -- every figure it managed to emit
    was legitimate. Observed live on 2026-08-06 at the inherited 1500-token
    cap, which was below even `reasoning_effort="low"`'s measured need."""
    captured = _CapturedCall(content="Rekomendasi terpotong di tengah kalim")
    captured.finish_reason = "length"
    monkeypatch.setattr(pipeline, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(RuntimeError, match="truncated"):
        await pipeline._call_model("halo")


@pytest.mark.asyncio
async def test_token_cap_clears_the_measured_requirement(monkeypatch, elice_env):
    """Guards the cap at BOTH ends, because both ends break production.

    Floor: measured at `high` on the same deficit prompt, GPT-5.6 Sol spent
    2409 completion tokens (2026-08-07) and Fable 5 spent 2618 (2026-08-06).
    The larger of the two is kept as the floor rather than the current
    model's own figure -- a cap that only just clears one observed run leaves
    nothing for a longer corpus or a position needing more explanation, and
    the failure it guards against (a truncated advisory) is one the numeral
    guard cannot catch.

    Ceiling: the gateway rejects anything above 128000 with a 400 before the
    model is reached, so a cap set above it does not produce a long advisory
    -- it produces no advisory at all, on every single request. That is a
    plausible edit precisely because raising this constant is the documented
    response to truncation, and 128000 is nowhere near the model's 1.05M
    context, so the limit is not where someone would expect to find it."""
    assert pipeline._MAX_COMPLETION_TOKENS >= 2618 * 1.25
    assert pipeline._MAX_COMPLETION_TOKENS <= pipeline._GATEWAY_MAX_COMPLETION_TOKENS
