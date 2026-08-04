"""Extract operational figures from a document using Claude vision.

Returns raw field values only -- never a `Candidate`, never anything closer
to "accepted" than a plain dict. Confidence handling belongs to
`mapping.py`'s `to_candidates`; persistence belongs nowhere in this call
path at all (see `app/main.py`'s `/documents` route).

`extract` has exactly three outcomes, never a fourth:
1. The response is not JSON, or its top level is not a JSON object ->
   raises `ExtractionFailed`. This is the only case that raises.
2. A requested field's value is present but is not a finite number
   (a string, a list, a nested object, `NaN`/`Infinity`, a bare `bool`) ->
   that field comes back as `None` in the result dict, i.e. reported
   unreadable rather than fabricated by coercion or allowed to leak a
   non-finite float downstream.
3. A requested field's value is a finite number (or the model reported it
   as `null`) -> it comes back as that number (or `None`).
A malformed *individual field* therefore never discards an otherwise
readable document, and never raises -- only a malformed *response as a
whole* does.

Untested against a real document: there is no `ANTHROPIC_API_KEY` in this
environment and no fixture smelter documents. Every test for this module
mocks `AsyncAnthropic` instead of calling the API. OCR quality on an
actual phone photo or rotated scan remains unverified.
"""

import base64
import json
import os
from typing import Literal

from anthropic import AsyncAnthropic

from .mapping import FIELDS_BY_PROFILE, sanitize_leaf

__all__ = ["ExtractionFailed", "extract"]

_FIELDS = FIELDS_BY_PROFILE

_MODEL = "claude-sonnet-5"

_PROMPT = """You are reading an Indonesian nickel smelter document.

Extract ONLY these fields: {fields}

Rules:
- Return strict JSON: {{"field_name": number_or_null, ...}}
- If a field is not present or you cannot read it clearly, return null.
- NEVER estimate, infer, or calculate a value that is not printed in the document.
- Report percentages exactly as printed (32 if the document says "32%").
- Include every field in the output, using null for the ones you did not find.

Return the JSON object and nothing else."""


class ExtractionFailed(RuntimeError):
    """The vision call failed, was misconfigured, or returned unparseable
    output. Callers must treat this as "could not read the document" and
    ask the user to enter values manually -- never as a 500, and never by
    silently returning an empty result."""


def _content_block(file_bytes: bytes, media_type: str) -> dict:
    """Anthropic's API distinguishes an "image" block (JPEG/PNG/etc, the
    phone-photo case) from a "document" block (PDF, the clean-scan or
    site-spec-sheet case). Route on media type so both upload kinds work
    through the same call."""
    data = base64.b64encode(file_bytes).decode()
    block_type = "document" if media_type == "application/pdf" else "image"
    return {
        "type": block_type,
        "source": {"type": "base64", "media_type": media_type, "data": data},
    }


async def extract(
    file_bytes: bytes,
    media_type: str,
    profile: Literal["site_spec", "operational"],
) -> dict[str, float | None]:
    """Ask the model for exactly `FIELDS_BY_PROFILE[profile]` and return a
    dict with one entry per field.

    Two independent failure handlers, deliberately not conflated:
    - Shape-level failure (missing API key, network error, non-JSON reply,
      a reply that is valid JSON but not an object) raises
      `ExtractionFailed` -- the whole document could not be read, so the
      caller shows "enter values manually" for everything.
    - Leaf-level failure (a field present but not a finite number) does
      not raise. It is sanitised to `None` via `sanitize_leaf` and
      returned like any other unread field, so one bad field never
      discards the other eight that read cleanly.
    """
    fields = _FIELDS[profile]
    try:
        api_key = os.environ["ANTHROPIC_API_KEY"]
        client = AsyncAnthropic(api_key=api_key)
        msg = await client.messages.create(
            model=_MODEL,
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        _content_block(file_bytes, media_type),
                        {"type": "text", "text": _PROMPT.format(fields=", ".join(fields))},
                    ],
                }
            ],
        )
        raw = json.loads(msg.content[0].text)
        if not isinstance(raw, dict):
            raise TypeError(f"model response was not a JSON object: {raw!r}")
    except Exception as exc:
        raise ExtractionFailed(str(exc)) from exc

    return {f: sanitize_leaf(raw.get(f)) for f in fields}
