"""Helpy Document Vision client.

Stage 1 of ingestion: bytes in, a normalised `ParsedDocument` out. This
module knows nothing about emission fields, profiles or candidates -- it
reads a document, and that is all.

It deliberately does NOT return Helpy's own JSON. Normalising here is what
keeps a provider swap from leaking a response shape through the rest of the
codebase; everything downstream sees `Element`/`ParsedDocument` only.

Helpy is asynchronous: POST returns a job id, and the result is polled.
`parse` blocks until the job finishes or `_POLL_BUDGET_SECONDS` elapses,
because `/documents` keeps its existing synchronous contract (upload in,
candidates out). A one-page report completed in under 4 seconds when this
was measured live on 2026-08-08; the budget is set well above that so a
slow multi-page document fails as a timeout rather than hanging a worker
forever.

Two corrections to Elice's published API docs, both confirmed by request on
2026-08-08 and both load-bearing here:
  * job polling is `GET /v1/jobs/{id}`; the docs' endpoint table says
    `GET /jobs/{id}`, which 404s.
  * `/healthz` and `/readyz` require `Authorization` despite being
    documented as needing none. (Not used by this module -- noted so nobody
    adds an unauthenticated health probe and is confused by the 401.)
"""

import asyncio
import json
import os
import re
from dataclasses import dataclass
from typing import Any

import httpx

__all__ = ["Element", "ExtractionFailed", "ParsedDocument", "parse"]

# Deliberately generous. Helpy averages ~10s per the vendor and measured
# under 4s on a one-page report; a document that needs more than this is one
# the user should be told about rather than one a request should wait on.
_POLL_BUDGET_SECONDS = 90.0
_POLL_INTERVAL_SECONDS = 2.0
_HTTP_TIMEOUT_SECONDS = 30.0

# Image captions cost time and say nothing about a numbers document. Chart
# conversion is kept: a chart may be where a figure actually lives.
_CONFIGS = json.dumps({"do_image_description": False, "do_chart_conversion": True})


class ExtractionFailed(RuntimeError):
    """The document could not be read. Callers must treat this as "ask the
    user to enter values manually" -- never as a 500, and never by silently
    returning an empty result."""


@dataclass(frozen=True)
class Element:
    label: str
    text: str
    table_rows: list[list[str]] | None
    score: float
    page: int


@dataclass(frozen=True)
class ParsedDocument:
    elements: list[Element]
    page_count: int

    def full_text(self) -> str:
        """Every element's text, newline-joined. This is the corpus that
        `verify.py` grounds figures against, so it must preserve numbers
        exactly as printed -- no locale normalisation happens here."""
        return "\n".join(e.text for e in self.elements)


def _cells(row_html: str) -> list[str]:
    return [
        re.sub(r"<[^>]*>", "", cell).strip()
        for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.DOTALL)
    ]


def _table_rows(html: str) -> list[list[str]]:
    return [_cells(row) for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)]


def _normalise(result: dict[str, Any]) -> ParsedDocument:
    """Helpy's hierarchical JSON -> `ParsedDocument`.

    Split out from `parse` so every parsing test runs against the committed
    fixture with no HTTP mocking at all.
    """
    elements: list[Element] = []
    for page_index, page in enumerate(result.get("pages", [])):
        for raw in page.get("elements", []):
            label = raw.get("label", "")
            content = raw.get("content") or raw.get("description") or ""
            rows = None
            if label == "table":
                # `content_compact` carries the same cells without inline
                # styles, so it is both cheaper and safer to parse.
                rows = _table_rows(raw.get("content_compact") or content)
                text = "\n".join(" | ".join(r) for r in rows)
            else:
                text = re.sub(r"<[^>]*>", "", content).strip()
            elements.append(
                Element(
                    label=label,
                    text=text,
                    table_rows=rows,
                    score=float(raw.get("score") or 0.0),
                    page=page_index,
                )
            )
    return ParsedDocument(elements=elements, page_count=int(result.get("page_count", 0)))


async def parse(
    file_bytes: bytes, media_type: str, filename: str = "document"
) -> ParsedDocument:
    """Submit to Helpy, poll to completion, return the normalised document.

    Every failure path raises `ExtractionFailed`: a missing config, a
    transport error, a rejected upload, a job that reports failure, and a
    job that outlives the budget all mean the same thing to the caller.
    """
    base_url = os.environ.get("HELPY_BASE_URL")
    if not base_url:
        raise ExtractionFailed("Document vision is not configured: HELPY_BASE_URL is not set")
    # Shared with the advisor deliberately: one Elice account, two
    # deployments. There is no HELPY_API_KEY.
    api_key = os.environ.get("ELICE_API_KEY")
    if not api_key:
        raise ExtractionFailed("Document vision is not configured: ELICE_API_KEY is not set")

    headers = {"Authorization": f"Bearer {api_key}"}
    base_url = base_url.rstrip("/")

    try:
        async with asyncio.timeout(_POLL_BUDGET_SECONDS):
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                submit = await client.post(
                    f"{base_url}/v1/documents",
                    headers=headers,
                    files={"document": (filename, file_bytes, media_type)},
                    data={"configs": _CONFIGS},
                )
                submit.raise_for_status()
                job_id = submit.json()["job_id"]

                while True:
                    poll = await client.get(f"{base_url}/v1/jobs/{job_id}", headers=headers)
                    poll.raise_for_status()
                    body = poll.json()
                    status = body.get("status")
                    if status == "succeeded":
                        return _normalise(body["result"])
                    if status == "failure":
                        raise ExtractionFailed(f"Helpy reported job {job_id} as failed")
                    await asyncio.sleep(_POLL_INTERVAL_SECONDS)
    except TimeoutError as exc:
        raise ExtractionFailed(
            f"Document parsing exceeded {_POLL_BUDGET_SECONDS:.0f}s"
        ) from exc
    except ExtractionFailed:
        raise
    except Exception as exc:  # transport, JSON, and key errors alike
        raise ExtractionFailed(str(exc)) from exc
