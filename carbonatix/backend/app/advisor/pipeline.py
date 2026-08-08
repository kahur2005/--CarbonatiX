"""Four-stage recommendation pipeline.

Each stage is a node in the dashboard's graph the user watches update in
real time, not internal structure -- that visibility is the answer to the
"AI black box" objection: a compliance officer can see retrieve -> assemble
-> synthesise -> verify happen, and which step failed if one does. Every
stage emits `running` then `done` (or `failed`) so the frontend has
something to animate.

Three things this module carries through rather than drops, matching the
pattern already established elsewhere in the backend (`synthetic` on
`/forecasts`, `confidence_is_placeholder` on `/documents`):

1. `corpus.has_placeholder_text()` -- every regulation citation this system
   produces is currently backed by placeholder text, not the real gazetted
   article. That state rides on every event as a top-level
   `placeholderCitations` boolean, and again inside `verify`'s payload, so a
   citation chip can render itself as "not yet authoritative" without
   digging into a stage-specific shape.
2. The forecast snapshot's `synthetic`/`provenance` keys -- the prices the
   recommendation is computed against may be synthetic training data (see
   `forecasting/service.py`), and that label is passed through unmodified
   rather than narrowed away.
3. `unsupported_numerals` -- if the model invents a figure, `verify`'s
   `flagged` boolean is set and the fabricated tokens are listed. Nothing
   here silently drops that signal.
"""

import os
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from ..emissions.calculator import EmissionResult
from ..emissions.compliance import CompliancePosition
from .corpus import has_placeholder_text, select_clauses
from .prompt import build_prompt, unsupported_numerals

__all__ = ["run_pipeline"]

# Reached through Elice ML API, an OpenAI-compatible proxy, rather than any
# model vendor directly -- hence the OpenAI SDK pointed at a custom base URL.
#
# That gateway rejects any parameter outside its documented set with a 400
# rather than ignoring it, deliberately, so that nobody is billed for a
# request whose settings were silently dropped. Measured against the live
# gateway on 2026-08-06: `presence_penalty`, `seed` and `frequency_penalty`
# all 400, so the allowlist is genuinely enforced and not advisory.
# Supported: model, messages, max_completion_tokens, temperature, top_p,
# stop, stream, tools, tool_choice, response_format, reasoning_effort.
# GPT-5.6 Sol publishes the same allowlist, so the kwargs below are unchanged
# by the model switch.
#
# `max_tokens` is the one documented-as-unsupported parameter that the
# gateway did in fact accept from the Fable 5 deployment, truncating
# correctly (verified: finish_reason "length" at the requested cap). This
# code still sends `max_completion_tokens`, because an undocumented alias
# that happens to work today is not something to build on -- but do not
# "fix" a 400 by reaching for `max_tokens`, since that is not where a 400
# would be coming from.
#
# SWITCHED 2026-08-07: was `claude-fable-5`. `openai/gpt-5.6-sol` is the
# fully-qualified id; the bare form below is what the gateway's own examples
# use and both resolve.
#
# **`ELICE_BASE_URL` is model-specific and must move with this constant.**
# Each Elice serverless deployment answers on its own `mlapi.run/<uuid>/v1`
# endpoint and serves only the models provisioned to it -- the Fable 5
# deployment's `GET /models` listed `claude-fable-5` and nothing else. So
# changing this string alone, against the old base URL, does not switch
# models: it produces a request for a model that endpoint has never heard
# of. There is no code-level defence against that mismatch (the model name
# is a plain string to the SDK), which is why it is written here.
_DEFAULT_MODEL = "gpt-5.6-sol"

# GPT-5.6 Sol accepts none / low / medium / high -- unlike Fable 5, whose
# reasoning could not be switched off at all, and which also offered xhigh
# and max above this point. `high` is therefore now the top of the range,
# not a setting above its middle. Compliance advice is intelligence-sensitive
# -- misreading Indonesian carbon regulation is precisely the failure the
# numeral guard and verbatim-citation checks exist to catch -- so it stays
# at the top rather than dropping to a cheaper setting. Do not carry Fable
# 5's `xhigh`/`max` over: this model 400s on them.
_REASONING_EFFORT = "high"

# Measured on both deployments with the same real deficit-position prompt.
# GPT-5.6 Sol, 2026-08-07: 798 prompt tokens, 2409 completion tokens at
# `high`, finish_reason "stop" -- 1591 headroom under this cap. Fable 5,
# 2026-08-06: 1438 prompt tokens, and low 1565 / medium 2149 / high 2618
# completion; its inherited 1500 cap truncated the first real recommendation
# mid-sentence, which is what set this constant.
#
# Raised from 4000 to 32000 on 2026-08-08 by human instruction, to leave room
# for a substantially longer dashboard advisory than either measurement above.
# That is ~13x the observed need, and deliberately generous: only tokens
# actually generated are billed (`prompt_tokens` + `completion_tokens`), so an
# unused ceiling costs nothing, while too low a ceiling fails the `synthesise`
# stage outright via the truncation guard below.
#
# What this number still does, and why it is not simply set to the maximum:
# it is the per-call cost ceiling. At Sol's $30 / 1M output tokens, 32000
# bounds a single runaway generation at roughly $0.96, where the hard limit
# would bound it at ~$3.84. Keep it a number someone would be willing to pay
# by accident.
#
# Prompt size is not a constraint here: this model takes 272k input tokens
# (rejecting more with a 400) against a prompt currently under 1k, with room
# to spare even once corpus.py holds real verbatim article text.
_MAX_COMPLETION_TOKENS = 32000

# The gateway's hard ceiling on completion tokens -- probed live on
# 2026-08-08: 16000/32000/64000/128000 all accepted, 300000 rejected with a
# 400 naming the limit ("This model supports at most 128000 completion
# tokens"). Note that error says `max_tokens` even though the request sent
# `max_completion_tokens`; that is the gateway's wording, not evidence the
# wrong parameter was sent.
#
# Named rather than inlined so the test guarding `_MAX_COMPLETION_TOKENS` can
# check both ends of the range: below the measured requirement, real
# advisories truncate; above this, every recommendation 400s before the model
# is reached at all.
_GATEWAY_MAX_COMPLETION_TOKENS = 128000


def _model() -> str:
    """Read at call time, not import time, so a deployment can switch models
    without a code change and tests can pin one without import-order games."""
    return os.environ.get("ELICE_MODEL") or _DEFAULT_MODEL


async def _call_model(prompt: str) -> str:
    """Isolated into its own function so tests can monkeypatch it: no test
    may make a real network call, and there is no API key in the test
    environment.

    Raises on a missing key or base URL rather than defaulting, so a
    misconfigured deployment surfaces as a visibly failed `synthesise` stage
    instead of silently addressing api.openai.com with no credentials.
    """
    try:
        api_key = os.environ["ELICE_API_KEY"]
        base_url = os.environ["ELICE_BASE_URL"]
    except KeyError as exc:
        raise RuntimeError(f"Advisor is not configured: {exc.args[0]} is not set") from exc

    async with AsyncOpenAI(api_key=api_key, base_url=base_url) as client:
        response = await client.chat.completions.create(
            model=_model(),
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=_MAX_COMPLETION_TOKENS,
            reasoning_effort=_REASONING_EFFORT,
        )
    choice = response.choices[0]
    if choice.finish_reason == "length":
        # The completion hit the token ceiling and stopped mid-sentence. A
        # half-written compliance advisory is worse than none: it reads as
        # finished advice, and the numeral guard cannot object because every
        # figure it did manage to emit was legitimate. Fail the stage instead
        # -- the emission, compliance and forecast panels stand on their own.
        raise RuntimeError(
            f"Model output was truncated at {_MAX_COMPLETION_TOKENS} tokens"
        )

    content = choice.message.content
    if not content:
        # A refusal (observed on the Fable 5 deployment, which returned no
        # content and a stop_reason of "refusal"; any gateway model can
        # decline the same way) and a truncated-to-empty completion both
        # land here. Returning "" would sail through the
        # numeral guard -- no numerals, nothing unsupported -- and render as
        # a blank recommendation panel that looks like advice rather than a
        # failure, so it must raise instead.
        raise RuntimeError("Model returned an empty completion")
    return content


def _event(stage: str, status: str, payload: dict[str, Any] | None, *, placeholder: bool) -> dict:
    """Every event's shape: `stage`/`status`/`payload` plus a top-level
    `placeholderCitations` flag repeated on every single event -- not just
    `verify`'s -- so a consumer never has to special-case which stage it is
    looking at to learn that today's citations are unverified."""
    return {
        "stage": stage,
        "status": status,
        "payload": payload,
        "placeholderCitations": placeholder,
    }


async def run_pipeline(
    result: EmissionResult,
    position: CompliancePosition,
    forecast: dict,
) -> AsyncIterator[dict]:
    """Yield one event per stage transition.

    On a model failure, `synthesise` goes `failed` and the generator
    returns immediately -- `verify` never runs. The recommendation is the
    only non-essential output in the product: the emission, compliance and
    forecast panels it sits alongside are computed independently and must
    keep standing on their own. Nothing is fabricated to fill the gap --
    no placeholder text, no "recommendation unavailable" string dressed up
    as a recommendation.
    """
    placeholder = has_placeholder_text()

    yield _event("retrieve", "running", None, placeholder=placeholder)
    clauses = select_clauses(is_compliant=position.is_compliant)
    yield _event("retrieve", "done", {"refs": [c.ref for c in clauses]}, placeholder=placeholder)

    yield _event("assemble", "running", None, placeholder=placeholder)
    prompt, permitted = build_prompt(result, position, forecast, clauses)
    yield _event(
        "assemble",
        "done",
        {
            # The forecast's synthetic-data provenance (forecasting/service.py)
            # is carried through unmodified, not stripped down to just the
            # two price figures the prompt needed -- a UI showing "figures
            # used" must be able to flag that some of them trace back to a
            # fabricated training series.
            "figureCount": len(permitted),
            "forecastSynthetic": bool(forecast.get("synthetic")),
            "forecastProvenance": forecast.get("provenance"),
        },
        placeholder=placeholder,
    )

    yield _event("synthesise", "running", None, placeholder=placeholder)
    try:
        body = await _call_model(prompt)
    except Exception as exc:  # noqa: BLE001 - isolates any model-call failure
        yield _event("synthesise", "failed", {"error": str(exc)}, placeholder=placeholder)
        return
    yield _event("synthesise", "done", {"body": body}, placeholder=placeholder)

    yield _event("verify", "running", None, placeholder=placeholder)
    unsupported = unsupported_numerals(body, permitted)
    yield _event(
        "verify",
        "done",
        {
            # `flagged` is the mechanism that stops a fabricated-figure
            # recommendation from being presented as advice -- it is never
            # computed and then dropped.
            "flagged": bool(unsupported),
            "unsupported": sorted(unsupported),
            "citations": [c.ref for c in clauses if c.ref in body],
            "body": body,
            "model": _model(),
            "placeholderCitations": placeholder,
        },
        placeholder=placeholder,
    )
