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

from anthropic import AsyncAnthropic

from ..emissions.calculator import EmissionResult
from ..emissions.compliance import CompliancePosition
from .corpus import has_placeholder_text, select_clauses
from .prompt import build_prompt, unsupported_numerals

__all__ = ["run_pipeline"]

# Compliance advice is intelligence-sensitive -- a misread of Indonesian
# carbon regulation is exactly the failure mode the numeral guard and
# verbatim-citation mechanisms exist to catch -- so this runs on the Opus
# tier rather than a cheaper/faster model.
_MODEL = "claude-opus-5"


async def _call_model(prompt: str) -> str:
    """Isolated into its own function so tests can monkeypatch it: there is
    no ANTHROPIC_API_KEY in this environment, and no test may make a real
    network call."""
    client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = await client.messages.create(
        model=_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


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
            "model": _MODEL,
            "placeholderCitations": placeholder,
        },
        placeholder=placeholder,
    )
