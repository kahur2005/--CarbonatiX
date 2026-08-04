"""Extract operational figures from a document using Claude vision.

Returns raw field values only -- never a `Candidate`, never anything closer
to "accepted" than a plain dict. Normalisation and confidence handling
belong to `mapping.py`; persistence belongs nowhere in this call path at
all (see `app/main.py`'s `/documents` route).

Untested against a real document: there is no `ANTHROPIC_API_KEY` in this
environment and no fixture smelter documents. Every test for this module
mocks `AsyncAnthropic` instead of calling the API. What is verified here is
the *contract* -- exactly the requested profile's fields go out, `None`
comes back for anything the model did not report, and a malformed or
non-JSON response raises `ExtractionFailed` rather than propagating a raw
parse error. OCR quality on an actual phone photo or rotated scan remains
unverified.
"""

import base64
import json
import os
from typing import Literal

from anthropic import AsyncAnthropic

from .mapping import FIELDS_BY_PROFILE

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
    dict with one entry per field -- `None` for anything unread. Every
    failure mode (missing API key, network error, non-JSON reply, a reply
    that is valid JSON but not an object) is normalised to
    `ExtractionFailed`, so a caller never has to distinguish "no key
    configured" from "the model refused" from "the model hallucinated
    prose": all of them mean the same thing to the person waiting for a
    number -- type it in by hand.
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

    return {f: raw.get(f) for f in fields}
