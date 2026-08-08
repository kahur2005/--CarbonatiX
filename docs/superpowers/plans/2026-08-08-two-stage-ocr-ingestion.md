# Two-Stage OCR Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead single-call Claude vision path with Helpy Document Vision for reading and GPT-5.6 Sol for field identification, where the model chooses which numbers and Python does the arithmetic.

**Architecture:** Four modules in a straight line — `document_vision.py` (Helpy, async submit/poll, returns a normalized `ParsedDocument`), `interpret.py` (Sol, returns evidence and operands, never a computed value), `verify.py` (pure Python, grounds every figure in the document text and does all arithmetic), `mapping.py` (existing, turns verified values into review candidates). Nothing writes a value without a human clicking accept.

**Tech Stack:** Python 3.11+, FastAPI, httpx (already a dependency, used by `auth.py`), `openai` SDK against the Elice gateway, pytest. Frontend: Next.js 16.3, vitest.

**Design spec:** `docs/superpowers/specs/2026-08-08-ocr-two-stage-ingestion-design.md`

## Global Constraints

- **No test may make a real network call.** No Helpy key, no Sol key in the test environment. Mock at the client boundary (`httpx.AsyncClient`, `AsyncOpenAI`). This is an existing, enforced project convention.
- **A candidate is never a value.** `Candidate` has no `accepted` field; nothing in `app/ingestion/` may write to `companies` or `calculation_runs`. `tests/test_ingestion.py::test_candidate_has_no_accepted_field_at_all` enforces this and must keep passing.
- **The model never originates a number.** Stage 2 returns verbatim evidence and operands; `verify.py` computes every derived value in Python.
- **Numeric validation:** `not value > 0` accepts `+inf`. Always `math.isfinite(value)`.
- **Locale:** Indonesian numbers group thousands with `.` and mark decimals with `,`. `10.000` is ten thousand, `1,8` is one point eight.
- **`to_camel` capitalises any letter after a digit.** Fields with digits need an explicit `Field(alias=...)`. None of the new fields contain digits, so no alias is needed — but do not add one that does without checking.
- **Ruff line length is 100.** Run `.venv/Scripts/python.exe -m ruff check app tests` before every commit.
- **Backend test command:** `.venv/Scripts/python.exe -m pytest -q` from `carbonatix/backend`. Baseline before this plan: **222 passing**.
- **Env vars:** `HELPY_BASE_URL` is new. Auth reuses `ELICE_API_KEY` — one Elice account, two deployments. There is no `HELPY_API_KEY`.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/ingestion/document_vision.py` (new) | Helpy only: submit, poll, timeout, normalize to `ParsedDocument`. No knowledge of fields or profiles. |
| `app/ingestion/verify.py` (new) | Pure: Indonesian number parsing, verbatim grounding, derived arithmetic. Imports no client. |
| `app/ingestion/interpret.py` (new) | Sol only: prompt, schema-constrained reply, returns `FieldReading` per field. Does no arithmetic. |
| `app/ingestion/mapping.py` (modify) | Existing candidate mapping; gains `basis`/`evidence`/`derivation` and real confidence. |
| `app/ingestion/vision.py` (delete) | Superseded. Last `anthropic` consumer. |
| `app/main.py` (modify) | `/documents` rewired to the new chain, plus a 20 MB upload cap. |
| `app/schemas.py` (modify) | `CandidateResponse` gains three fields. |
| `tests/fixtures/helpy_laporan_harian.json` | Real Helpy output captured 2026-08-08. Already on disk. |

---

### Task 1: Helpy client and the golden fixture

**Files:**
- Create: `carbonatix/backend/app/ingestion/document_vision.py`
- Commit (already on disk): `carbonatix/backend/tests/fixtures/helpy_laporan_harian.json`
- Test: `carbonatix/backend/tests/test_document_vision.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `Element(label: str, text: str, table_rows: list[list[str]] | None, score: float, page: int)` — frozen dataclass
  - `ParsedDocument(elements: list[Element], page_count: int)` — frozen dataclass, method `full_text() -> str`
  - `async parse(file_bytes: bytes, media_type: str, filename: str = "document") -> ParsedDocument`
  - `ExtractionFailed(RuntimeError)` — moved here from `vision.py`; Task 5 imports it from this module.

**Context the implementer needs.** `tests/fixtures/helpy_laporan_harian.json` is a real captured response, not a hand-written mock. Its shape is the `GET /v1/jobs/{id}` envelope: top-level `job_id`/`type`/`status`/`created_at`/`log`/`found`/`result`, with `result.page_count` and `result.pages[].elements[]`. Each element has `bounding_box`, `label`, `score`, `content`, `description`, `data`, `content_compact`. Table elements carry HTML in `content`. Use `content_compact` (tags without inline styles) for table parsing — it is far easier to parse and carries the same cells.

- [ ] **Step 1: Write the failing tests**

Create `carbonatix/backend/tests/test_document_vision.py`:

```python
"""Tests for the Helpy Document Vision client.

No test here makes a network call: `httpx.AsyncClient` is monkeypatched.
The fixture is a REAL captured Helpy response (2026-08-08), so the parsing
tests run against genuine provider output -- including a table where Helpy
inferred a phantom `colspan` and emitted an empty cell in every row.
"""

import json
from pathlib import Path

import pytest

from app.ingestion import document_vision

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "helpy_laporan_harian.json").read_text(
        encoding="utf-8"
    )
)


def test_normalises_every_element_with_its_score():
    doc = document_vision._normalise(FIXTURE["result"])
    assert doc.page_count == 1
    assert len(doc.elements) == 10
    assert [e.label for e in doc.elements].count("table") == 3
    assert all(0.0 <= e.score <= 1.0 for e in doc.elements)
    assert all(e.page == 0 for e in doc.elements)


def test_table_rows_are_extracted_as_cells():
    doc = document_vision._normalise(FIXTURE["result"])
    first_table = next(e for e in doc.elements if e.label == "table")
    assert first_table.table_rows is not None
    header = first_table.table_rows[0]
    assert header[:3] == ["Parameter", "Nilai", "Satuan"]
    flat = [c for row in first_table.table_rows for c in row]
    assert "10.000" in flat
    assert "1,8" in flat


def test_indonesian_numbers_survive_verbatim_into_full_text():
    """The values must reach verification EXACTLY as printed. `10.000`
    silently becoming `10.0` would understate ore input by 1000x."""
    text = document_vision._normalise(FIXTURE["result"]).full_text()
    for printed in ("10.000", "6.800", "1,8", "72.250", "85.000"):
        assert printed in text, f"{printed!r} did not survive normalisation"


def test_non_table_elements_have_no_rows():
    doc = document_vision._normalise(FIXTURE["result"])
    for element in doc.elements:
        if element.label != "table":
            assert element.table_rows is None


@pytest.mark.asyncio
async def test_parse_raises_when_base_url_is_unset(monkeypatch):
    monkeypatch.delenv("HELPY_BASE_URL", raising=False)
    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    with pytest.raises(document_vision.ExtractionFailed, match="HELPY_BASE_URL"):
        await document_vision.parse(b"x", "application/pdf")


@pytest.mark.asyncio
async def test_parse_raises_when_api_key_is_unset(monkeypatch):
    monkeypatch.setenv("HELPY_BASE_URL", "https://gateway.example/uuid")
    monkeypatch.delenv("ELICE_API_KEY", raising=False)
    with pytest.raises(document_vision.ExtractionFailed, match="ELICE_API_KEY"):
        await document_vision.parse(b"x", "application/pdf")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_document_vision.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ingestion.document_vision'`

- [ ] **Step 3: Write the module**

Create `carbonatix/backend/app/ingestion/document_vision.py`:

```python
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
        for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.S)
    ]


def _table_rows(html: str) -> list[list[str]]:
    return [_cells(row) for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)]


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
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            submit = await client.post(
                f"{base_url}/v1/documents",
                headers=headers,
                files={"document": (filename, file_bytes, media_type)},
                data={"configs": _CONFIGS},
            )
            submit.raise_for_status()
            job_id = submit.json()["job_id"]

            deadline = asyncio.get_running_loop().time() + _POLL_BUDGET_SECONDS
            while True:
                poll = await client.get(f"{base_url}/v1/jobs/{job_id}", headers=headers)
                poll.raise_for_status()
                body = poll.json()
                status = body.get("status")
                if status == "succeeded":
                    return _normalise(body["result"])
                if status == "failure":
                    raise ExtractionFailed(f"Helpy reported job {job_id} as failed")
                if asyncio.get_running_loop().time() >= deadline:
                    raise ExtractionFailed(
                        f"Document parsing exceeded {_POLL_BUDGET_SECONDS:.0f}s"
                    )
                await asyncio.sleep(_POLL_INTERVAL_SECONDS)
    except ExtractionFailed:
        raise
    except Exception as exc:  # noqa: BLE001 - transport, JSON, and key errors alike
        raise ExtractionFailed(str(exc)) from exc
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_document_vision.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the polling tests**

Append to `carbonatix/backend/tests/test_document_vision.py`:

```python
class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def _fake_client(poll_payloads: list[dict], submit_payload: dict | None = None):
    """An httpx.AsyncClient stand-in that returns `poll_payloads` in order."""
    remaining = list(poll_payloads)

    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, **kwargs):
            return _FakeResponse(submit_payload or {"job_id": "job-1", "status": "queued"})

        async def get(self, url, **kwargs):
            return _FakeResponse(remaining.pop(0))

    return _Client


@pytest.fixture
def helpy_env(monkeypatch):
    monkeypatch.setenv("HELPY_BASE_URL", "https://gateway.example/uuid")
    monkeypatch.setenv("ELICE_API_KEY", "test-key")


@pytest.mark.asyncio
async def test_parse_polls_until_the_job_succeeds(monkeypatch, helpy_env):
    monkeypatch.setattr(document_vision.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(
        document_vision.httpx,
        "AsyncClient",
        _fake_client([{"status": "running"}, {"status": "running"}, FIXTURE]),
    )

    doc = await document_vision.parse(b"pdf-bytes", "application/pdf")

    assert doc.page_count == 1
    assert len(doc.elements) == 10


@pytest.mark.asyncio
async def test_job_failure_raises_rather_than_returning_an_empty_document(
    monkeypatch, helpy_env
):
    """An empty ParsedDocument would flow downstream as "no fields found",
    which reads to the user as a successfully-read blank document rather
    than a failure."""
    monkeypatch.setattr(document_vision.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(
        document_vision.httpx, "AsyncClient", _fake_client([{"status": "failure"}])
    )

    with pytest.raises(document_vision.ExtractionFailed, match="failed"):
        await document_vision.parse(b"pdf-bytes", "application/pdf")


@pytest.mark.asyncio
async def test_polling_is_bounded(monkeypatch, helpy_env):
    """Without a deadline a stuck job holds a worker forever."""
    monkeypatch.setattr(document_vision.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(
        document_vision.httpx,
        "AsyncClient",
        _fake_client([{"status": "running"}] * 500),
    )
    monkeypatch.setattr(document_vision, "_POLL_BUDGET_SECONDS", 0.0)

    with pytest.raises(document_vision.ExtractionFailed, match="exceeded"):
        await document_vision.parse(b"pdf-bytes", "application/pdf")
```

Add this helper immediately below the `FIXTURE = ...` assignment at the top of the file:

```python
async def _no_sleep(_seconds: float) -> None:
    """Polling sleeps are skipped so the bounded-polling test is instant."""
    return None
```

- [ ] **Step 6: Run the full file**

Run: `.venv/Scripts/python.exe -m pytest tests/test_document_vision.py -v`
Expected: PASS, 9 tests.

- [ ] **Step 7: Lint**

Run: `.venv/Scripts/python.exe -m ruff check app tests`
Expected: `All checks passed!`

- [ ] **Step 8: Commit**

```bash
git add carbonatix/backend/app/ingestion/document_vision.py \
        carbonatix/backend/tests/test_document_vision.py \
        carbonatix/backend/tests/fixtures/helpy_laporan_harian.json
git commit -m "feat(ingestion): add Helpy Document Vision client

Stage 1 of the two-stage OCR pipeline. Submits to Helpy, polls to
completion under a 90s budget, and returns a normalised ParsedDocument so
no Helpy response shape leaks downstream.

The committed fixture is a real captured response, including the phantom
colspan Helpy produced on one table -- parsing tests run against genuine
provider output rather than an idealised mock."
```

---

### Task 2: Verification and Indonesian number parsing

**Files:**
- Create: `carbonatix/backend/app/ingestion/verify.py`
- Test: `carbonatix/backend/tests/test_verify.py`

**Interfaces:**
- Consumes: `ParsedDocument` from Task 1.
- Produces:
  - `parse_id_number(text: str) -> float | None`
  - `PERMITTED_OPERATIONS: frozenset[str]` = `{"difference_over_total", "ratio", "percentage_of_total"}`
  - `verified_value(reading, doc) -> tuple[float | None, float]` returning `(value, confidence)`; `reading` is the `FieldReading` defined in Task 3, and only its attributes are touched, so Task 2 does not import Task 3.

**Why this is its own module.** It is the safety-critical step. Keeping it separate from `interpret.py` means it can be tested with no model mocking at all, and makes it structurally impossible for verification to acquire a model client.

- [ ] **Step 1: Write the failing tests**

Create `carbonatix/backend/tests/test_verify.py`:

```python
"""Tests for grounding and arithmetic. No model, no network, no mocks.

The rule this file enforces: a figure that cannot be found verbatim in the
document does not become a value, and every derived number is computed by
Python from operands that were themselves found verbatim.
"""

import math

import pytest

from app.ingestion import verify
from app.ingestion.document_vision import Element, ParsedDocument


def _doc(*texts: str) -> ParsedDocument:
    return ParsedDocument(
        elements=[
            Element(label="text", text=t, table_rows=None, score=0.9, page=0) for t in texts
        ],
        page_count=1,
    )


class _Reading:
    """Structural stand-in for Task 3's FieldReading -- verify.py touches
    attributes only, so the real dataclass is not needed here."""

    def __init__(self, **kw):
        self.basis = kw.get("basis")
        self.evidence = kw.get("evidence", "")
        self.raw_value = kw.get("raw_value")
        self.operands = kw.get("operands", [])
        self.operation = kw.get("operation", "")
        self.note = kw.get("note", "")


@pytest.mark.parametrize(
    ("printed", "expected"),
    [
        ("10.000", 10000.0),
        ("6.800", 6800.0),
        ("1,8", 1.8),
        ("18,4", 18.4),
        ("85", 85.0),
        ("72.250", 72250.0),
        ("1.234.567", 1234567.0),
        ("0,32", 0.32),
        ("85%", 85.0),
    ],
)
def test_indonesian_numbers_parse(printed, expected):
    assert verify.parse_id_number(printed) == pytest.approx(expected)


def test_thousands_separator_is_never_read_as_a_decimal_point():
    """`10.000` becoming 10.0 would understate ore input by 1000x -- the
    single most damaging misread available in this pipeline."""
    assert verify.parse_id_number("10.000") == 10000.0
    assert verify.parse_id_number("10.000") != 10.0


@pytest.mark.parametrize("garbage", ["", "n/a", "tidak diukur", "abc", "-", "1.2.3,4,5"])
def test_unparseable_text_is_none_not_a_guess(garbage):
    assert verify.parse_id_number(garbage) is None


def test_transcribed_value_grounded_in_the_document_is_accepted():
    doc = _doc("Bijih basah diterima (as-received) | 10.000 | ton")
    reading = _Reading(
        basis="transcribed",
        evidence="Bijih basah diterima (as-received) | 10.000 | ton",
        raw_value="10.000",
    )
    value, confidence = verify.verified_value(reading, doc)
    assert value == 10000.0
    assert confidence == pytest.approx(0.9)


def test_transcribed_value_with_evidence_absent_from_the_document_is_rejected():
    """The model inventing a plausible-looking source line is exactly the
    failure this check exists for."""
    doc = _doc("Bijih basah diterima | 10.000 | ton")
    reading = _Reading(
        basis="transcribed",
        evidence="Kadar air umpan | 32 | %",
        raw_value="32",
    )
    value, confidence = verify.verified_value(reading, doc)
    assert value is None
    assert confidence == 0.0


def test_transcribed_value_not_present_inside_its_own_evidence_is_rejected():
    doc = _doc("Bijih basah diterima | 10.000 | ton")
    reading = _Reading(
        basis="transcribed",
        evidence="Bijih basah diterima | 10.000 | ton",
        raw_value="99.999",
    )
    assert verify.verified_value(reading, doc)[0] is None


def test_derived_value_is_computed_by_python_not_taken_from_the_model():
    doc = _doc("Bijih basah | 10.000 | ton", "Bijih kering setara | 6.800 | ton")
    reading = _Reading(
        basis="derived",
        evidence="Bijih basah | 10.000 | ton",
        operands=["10.000", "6.800"],
        operation="difference_over_total",
        note="kadar air = (basah - kering) / basah",
    )
    value, confidence = verify.verified_value(reading, doc)
    assert value == pytest.approx(0.32)
    assert confidence == pytest.approx(0.9)


def test_derived_operand_absent_from_the_document_is_rejected():
    doc = _doc("Bijih basah | 10.000 | ton")
    reading = _Reading(
        basis="derived",
        operands=["10.000", "6.800"],
        operation="difference_over_total",
    )
    assert verify.verified_value(reading, doc)[0] is None


def test_unknown_operation_is_rejected_rather_than_evaluated():
    """`operation` is matched against a closed set. It is never eval'd, and
    an unrecognised one is a rejection, not a fallback."""
    doc = _doc("a | 10.000", "b | 6.800")
    reading = _Reading(
        basis="derived",
        operands=["10.000", "6.800"],
        operation="__import__('os').system('echo pwned')",
    )
    assert verify.verified_value(reading, doc)[0] is None


def test_division_by_zero_in_a_derivation_is_rejected_not_raised():
    doc = _doc("basah | 0", "kering | 0")
    reading = _Reading(
        basis="derived", operands=["0", "0"], operation="difference_over_total"
    )
    assert verify.verified_value(reading, doc)[0] is None


def test_a_reading_the_model_could_not_find_is_none():
    assert verify.verified_value(_Reading(basis=None), _doc("apa pun"))[0] is None


def test_non_finite_results_are_rejected():
    """`not value > 0` accepts +inf; every numeric path in this project must
    check isfinite explicitly."""
    doc = _doc("a | 1", "b | 0")
    reading = _Reading(basis="derived", operands=["1", "0"], operation="ratio")
    value = verify.verified_value(reading, doc)[0]
    assert value is None or math.isfinite(value)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_verify.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ingestion.verify'`

- [ ] **Step 3: Write the module**

Create `carbonatix/backend/app/ingestion/verify.py`:

```python
"""Grounding and arithmetic for stage-2 output. Pure: no model, no network.

Stage 2 (`interpret.py`) is a language model producing numbers that become a
plant's carbon footprint. The discipline here is the same one the advisor
applies in `advisor/prompt.py`, inverted: the model chooses WHICH numbers,
and this module does the arithmetic.

  * A transcribed figure must be findable verbatim in the document, inside
    the evidence the model cited for it.
  * A derived figure is never returned by the model at all. The model
    returns operands and names an operation; the operands are grounded
    verbatim, and the value is computed here.

Anything that fails is reported as unreadable -- `(None, 0.0)` -- and
surfaces in the UI as a blank for the user to fill in. Never a guess.

Note for anyone tempted to reuse `advisor/prompt.py::_canonical`: it looks
similar and is not. That function canonicalises a numeral into a string for
set comparison; `parse_id_number` parses a string into a float. Different
outputs, different failure modes, and the advisor's numeral guard is not a
place to introduce a shared dependency lightly.
"""

import math
import re
from typing import Any

__all__ = ["PERMITTED_OPERATIONS", "parse_id_number", "verified_value"]

PERMITTED_OPERATIONS = frozenset(
    {"difference_over_total", "ratio", "percentage_of_total"}
)

_NUMBER = re.compile(r"-?\d[\d.,]*")


def parse_id_number(text: str) -> float | None:
    """An Indonesian-formatted number as a float, or None if it is not one.

    Indonesian groups thousands with '.' and marks decimals with ',' -- the
    reverse of Python's literal syntax, which is why `float()` cannot be
    used directly and why `10.000` must never come back as 10.0.
    """
    if not isinstance(text, str):
        return None
    match = _NUMBER.search(text.strip())
    if match is None:
        return None
    token = match.group().rstrip(".,")
    if not token or not token.lstrip("-"):
        return None

    if "." in token and "," in token:
        # Whichever separator sits last is the decimal mark.
        if token.rindex(",") > token.rindex("."):
            token = token.replace(".", "").replace(",", ".")
        else:
            token = token.replace(",", "")
    elif "," in token:
        token = token.replace(",", ".")
    elif "." in token:
        groups = token.lstrip("-").split(".")
        # A trailing group of exactly three digits is a thousands grouping,
        # which is the only reading that makes "10.000" ten thousand.
        if len(groups) > 1 and all(len(g) == 3 for g in groups[1:]):
            token = token.replace(".", "")

    if token.count(".") > 1:
        return None
    try:
        value = float(token)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _compute(operation: str, values: list[float]) -> float | None:
    """Evaluate a named operation. `operation` is matched against a closed
    set -- it is never `eval`'d, so a hostile string is a rejection rather
    than an execution."""
    if operation not in PERMITTED_OPERATIONS or len(values) != 2:
        return None
    a, b = values
    if operation == "difference_over_total":
        result = (a - b) / a if a else None
    elif operation == "ratio":
        result = a / b if b else None
    else:  # percentage_of_total
        result = (a / b) * 100.0 if b else None
    if result is None or not math.isfinite(result):
        return None
    return result


def verified_value(reading: Any, doc: Any) -> tuple[float | None, float]:
    """`(value, confidence)` for one field, or `(None, 0.0)` if unverifiable.

    `reading` is `interpret.FieldReading`; only its attributes are read, so
    this module does not import stage 2 and can be tested without it.
    """
    text = doc.full_text()

    if reading.basis == "transcribed":
        if not reading.evidence or reading.evidence not in text:
            return None, 0.0
        if not reading.raw_value or reading.raw_value not in reading.evidence:
            return None, 0.0
        value = parse_id_number(reading.raw_value)
        if value is None:
            return None, 0.0
        return value, _score_for(reading.evidence, doc)

    if reading.basis == "derived":
        if not reading.operands:
            return None, 0.0
        values: list[float] = []
        for operand in reading.operands:
            if operand not in text:
                return None, 0.0
            parsed = parse_id_number(operand)
            if parsed is None:
                return None, 0.0
            values.append(parsed)
        result = _compute(reading.operation, values)
        if result is None:
            return None, 0.0
        return result, min(_score_for(o, doc) for o in reading.operands)

    return None, 0.0


def _score_for(needle: str, doc: Any) -> float:
    """The score of the element the text came from.

    Element-level, not field-level: a table scoring 0.96 says the table was
    read cleanly, not that this particular cell was. That caveat is why
    `confidence_is_placeholder` stays True on the wire (see schemas.py).
    """
    for element in doc.elements:
        if needle in element.text:
            return element.score
    return 0.0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_verify.py -v`
Expected: PASS, 22 tests (the parametrized cases count individually).

- [ ] **Step 5: Lint and commit**

```bash
.venv/Scripts/python.exe -m ruff check app tests
git add carbonatix/backend/app/ingestion/verify.py carbonatix/backend/tests/test_verify.py
git commit -m "feat(ingestion): ground extracted figures and compute derivations in Python

The model chooses which numbers; this module does the arithmetic. A
transcribed figure must appear verbatim inside the evidence the model cited
for it, and a derived figure is computed here from operands that were
themselves grounded verbatim -- the model never returns a computed value.

Operations are matched against a closed set, never eval'd. Anything that
fails verification becomes a blank for manual entry, never a guess."
```

---

### Task 3: Stage 2 — the interpretation call

**Files:**
- Create: `carbonatix/backend/app/ingestion/interpret.py`
- Test: `carbonatix/backend/tests/test_interpret.py`

**Interfaces:**
- Consumes: `ParsedDocument` (Task 1), `FIELDS_BY_PROFILE` from `app/ingestion/mapping.py`.
- Produces:
  - `FieldReading(basis, evidence, raw_value, operands, operation, note)` — frozen dataclass
  - `async interpret(doc: ParsedDocument, profile: str) -> dict[str, FieldReading]`

**Context.** Reuse the Elice client pattern from `app/advisor/pipeline.py`: `AsyncOpenAI(api_key=ELICE_API_KEY, base_url=ELICE_BASE_URL)`, model `gpt-5.6-sol`, `reasoning_effort="high"`. The gateway rejects any parameter outside its allowlist with a 400, so send only `model`, `messages`, `max_completion_tokens`, `reasoning_effort`, `response_format`. Do not send `max_tokens`.

- [ ] **Step 1: Write the failing tests**

Create `carbonatix/backend/tests/test_interpret.py`:

```python
"""Tests for stage 2. `AsyncOpenAI` is monkeypatched -- no network, no key.

What matters here is the CONTRACT with the model, not its intelligence: that
the prompt carries the document and the exact field list, that the reply is
parsed into FieldReading objects, and that a malformed reply fails loudly
rather than producing confident nonsense.
"""

import json

import pytest

from app.ingestion import interpret
from app.ingestion.document_vision import Element, ExtractionFailed, ParsedDocument

DOC = ParsedDocument(
    elements=[
        Element(
            label="table",
            text="Bijih basah diterima | 10.000 | ton",
            table_rows=[["Bijih basah diterima", "10.000", "ton"]],
            score=0.96,
            page=0,
        )
    ],
    page_count=1,
)


class _Captured:
    def __init__(self, content: str):
        self.content = content
        self.kwargs: dict = {}


def _fake_openai(captured: _Captured):
    class _Message:
        def __init__(self, content):
            self.content = content

    class _Choice:
        def __init__(self, content):
            self.message = _Message(content)
            self.finish_reason = "stop"

    class _Response:
        def __init__(self, content):
            self.choices = [_Choice(content)]

    class _Completions:
        async def create(self, **kwargs):
            captured.kwargs = kwargs
            return _Response(captured.content)

    class _Chat:
        completions = _Completions()

    class _Fake:
        def __init__(self, **kwargs):
            self.chat = _Chat()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    return _Fake


@pytest.fixture
def elice_env(monkeypatch):
    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_BASE_URL", "https://gateway.example/uuid/v1")


@pytest.mark.asyncio
async def test_prompt_carries_the_document_text_and_the_profile_fields(
    monkeypatch, elice_env
):
    captured = _Captured(json.dumps({"fields": {}}))
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    await interpret.interpret(DOC, "operational")

    prompt = captured.kwargs["messages"][0]["content"]
    assert "Bijih basah diterima | 10.000 | ton" in prompt
    assert "wet_ore_input_tons" in prompt
    assert "moisture_content_pct" in prompt
    # A site-spec field must not leak into an operational request.
    assert "ef_captive_pltu" not in prompt


@pytest.mark.asyncio
async def test_sends_only_parameters_the_gateway_accepts(monkeypatch, elice_env):
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
    captured = _Captured(json.dumps({"fields": {}}))
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    await interpret.interpret(DOC, "operational")

    assert set(captured.kwargs) <= permitted
    assert "max_tokens" not in captured.kwargs


@pytest.mark.asyncio
async def test_parses_a_transcribed_reading(monkeypatch, elice_env):
    captured = _Captured(
        json.dumps(
            {
                "fields": {
                    "wet_ore_input_tons": {
                        "basis": "transcribed",
                        "evidence": "Bijih basah diterima | 10.000 | ton",
                        "raw_value": "10.000",
                        "operands": [],
                        "operation": "",
                        "note": "dari tabel A",
                    }
                }
            }
        )
    )
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    readings = await interpret.interpret(DOC, "operational")

    reading = readings["wet_ore_input_tons"]
    assert reading.basis == "transcribed"
    assert reading.raw_value == "10.000"
    assert reading.evidence == "Bijih basah diterima | 10.000 | ton"


@pytest.mark.asyncio
async def test_a_field_the_model_omitted_becomes_a_not_found_reading(
    monkeypatch, elice_env
):
    """Every profile field must come back with an entry. A missing key is
    "not found", never a silently absent field."""
    captured = _Captured(json.dumps({"fields": {}}))
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    readings = await interpret.interpret(DOC, "operational")

    assert set(readings) == set(interpret.FIELDS_BY_PROFILE["operational"])
    assert all(r.basis is None for r in readings.values())


@pytest.mark.asyncio
async def test_a_field_the_model_invented_is_dropped(monkeypatch, elice_env):
    captured = _Captured(
        json.dumps({"fields": {"harga_nikel": {"basis": "transcribed"}}})
    )
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    readings = await interpret.interpret(DOC, "operational")

    assert "harga_nikel" not in readings


@pytest.mark.asyncio
async def test_non_json_reply_raises_extraction_failed(monkeypatch, elice_env):
    captured = _Captured("maaf, saya tidak bisa membaca dokumen ini")
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(ExtractionFailed):
        await interpret.interpret(DOC, "operational")


@pytest.mark.asyncio
async def test_empty_completion_raises_rather_than_returning_nothing(
    monkeypatch, elice_env
):
    captured = _Captured("")
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(ExtractionFailed):
        await interpret.interpret(DOC, "operational")


@pytest.mark.asyncio
async def test_missing_configuration_raises(monkeypatch):
    monkeypatch.delenv("ELICE_API_KEY", raising=False)
    monkeypatch.setenv("ELICE_BASE_URL", "https://gateway.example/uuid/v1")
    with pytest.raises(ExtractionFailed, match="ELICE_API_KEY"):
        await interpret.interpret(DOC, "operational")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_interpret.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ingestion.interpret'`

- [ ] **Step 3: Write the module**

Create `carbonatix/backend/app/ingestion/interpret.py`:

```python
"""Stage 2: which numbers in this document are the fields we asked for.

The model reads the parsed document and points at figures. It never
computes one -- for a field the document does not print directly, it returns
the operands and names an operation, and `verify.py` does the arithmetic.
That split is what keeps a language model out of the arithmetic path of a
carbon-accounting number.

Reached through the same Elice gateway as the advisor (`advisor/pipeline.py`)
and subject to the same enforced parameter allowlist: anything outside it is
rejected with a 400 rather than ignored. Do not add parameters here without
checking that list.
"""

import json
import os
from dataclasses import dataclass, field
from typing import Any, Literal

from openai import AsyncOpenAI

from .document_vision import ExtractionFailed, ParsedDocument
from .mapping import FIELDS_BY_PROFILE

__all__ = ["FIELDS_BY_PROFILE", "FieldReading", "interpret"]

_MODEL = "gpt-5.6-sol"
_REASONING_EFFORT = "high"
_MAX_COMPLETION_TOKENS = 8000


@dataclass(frozen=True)
class FieldReading:
    basis: Literal["transcribed", "derived"] | None = None
    evidence: str = ""
    raw_value: str | None = None
    operands: list[str] = field(default_factory=list)
    operation: str = ""
    note: str = ""


_TEMPLATE = """Anda membaca dokumen operasional smelter nikel RKEF di Indonesia.

DOKUMEN (hasil ekstraksi, apa adanya):
{document}

MEDAN YANG DICARI:
{fields}

Untuk SETIAP medan di atas, tentukan salah satu:
1. "transcribed" — angkanya tercetak langsung di dokumen. Sertakan
   "evidence": baris teks PERSIS seperti muncul di dokumen di atas, dan
   "raw_value": angkanya PERSIS seperti tercetak (contoh: "10.000", "1,8").
2. "derived" — angkanya tidak tercetak, tetapi dapat dihitung. Sertakan
   "operands": daftar angka PERSIS seperti tercetak di dokumen, dan
   "operation": salah satu dari "difference_over_total", "ratio",
   "percentage_of_total". JANGAN menghitung hasilnya sendiri.
3. null — medan tidak ada di dokumen. Ini jawaban yang benar bila ragu.

Aturan mutlak:
- Setiap "evidence" dan setiap operand HARUS disalin karakter demi karakter
  dari dokumen di atas. Teks yang tidak ada di dokumen akan ditolak sistem.
- JANGAN mengarang angka. JANGAN menghitung hasil derivasi.
- Bila sebuah medan tidak yakin, kembalikan null. Medan kosong jauh lebih
  baik daripada medan salah.

Balas HANYA JSON dengan bentuk:
{{"fields": {{"nama_medan": {{"basis": "transcribed"|"derived"|null,
"evidence": "...", "raw_value": "..."|null, "operands": [...],
"operation": "...", "note": "..."}}}}}}
"""


def _reading_from(raw: Any) -> FieldReading:
    if not isinstance(raw, dict):
        return FieldReading()
    basis = raw.get("basis")
    if basis not in ("transcribed", "derived"):
        return FieldReading()
    operands = raw.get("operands") or []
    if not isinstance(operands, list) or not all(isinstance(o, str) for o in operands):
        operands = []
    return FieldReading(
        basis=basis,
        evidence=raw.get("evidence") or "" if isinstance(raw.get("evidence"), str) else "",
        raw_value=raw.get("raw_value") if isinstance(raw.get("raw_value"), str) else None,
        operands=operands,
        operation=raw.get("operation") or "" if isinstance(raw.get("operation"), str) else "",
        note=raw.get("note") or "" if isinstance(raw.get("note"), str) else "",
    )


async def interpret(doc: ParsedDocument, profile: str) -> dict[str, FieldReading]:
    """One `FieldReading` per field in the profile -- always every field.

    A field the model omitted comes back as a not-found reading rather than
    a missing key, so a caller can never mistake "the model forgot" for
    "this field does not exist in this profile".
    """
    fields = FIELDS_BY_PROFILE[profile]

    api_key = os.environ.get("ELICE_API_KEY")
    if not api_key:
        raise ExtractionFailed("Document interpretation is not configured: ELICE_API_KEY")
    base_url = os.environ.get("ELICE_BASE_URL")
    if not base_url:
        raise ExtractionFailed("Document interpretation is not configured: ELICE_BASE_URL")

    prompt = _TEMPLATE.format(
        document=doc.full_text(),
        fields="\n".join(f"- {f}" for f in fields),
    )

    try:
        async with AsyncOpenAI(api_key=api_key, base_url=base_url) as client:
            response = await client.chat.completions.create(
                model=_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_completion_tokens=_MAX_COMPLETION_TOKENS,
                reasoning_effort=_REASONING_EFFORT,
                response_format={"type": "json_object"},
            )
        content = response.choices[0].message.content
        if not content:
            raise ValueError("model returned an empty completion")
        payload = json.loads(content)
        raw_fields = payload.get("fields")
        if not isinstance(raw_fields, dict):
            raise ValueError(f"reply had no 'fields' object: {payload!r}")
    except ExtractionFailed:
        raise
    except Exception as exc:  # noqa: BLE001 - model, transport and JSON errors alike
        raise ExtractionFailed(str(exc)) from exc

    return {name: _reading_from(raw_fields.get(name)) for name in fields}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_interpret.py -v`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and commit**

```bash
.venv/Scripts/python.exe -m ruff check app tests
git add carbonatix/backend/app/ingestion/interpret.py carbonatix/backend/tests/test_interpret.py
git commit -m "feat(ingestion): add stage-2 field interpretation via GPT-5.6 Sol

The model points at figures in the parsed document and, for fields the
document does not print, names operands and an operation -- it never
returns a computed number. Every profile field always comes back with a
reading, so an omission is 'not found' rather than a missing key."
```

---

### Task 4: Candidates carry basis, evidence and real confidence

**Files:**
- Modify: `carbonatix/backend/app/ingestion/mapping.py`
- Modify: `carbonatix/backend/app/schemas.py:157-167`
- Test: `carbonatix/backend/tests/test_ingestion.py`

**Interfaces:**
- Consumes: `FieldReading` (Task 3), `verified_value` (Task 2), `ParsedDocument` (Task 1).
- Produces: `readings_to_candidates(readings: dict[str, FieldReading], doc: ParsedDocument) -> list[Candidate]`, and `Candidate` gaining `basis`, `evidence`, `derivation`.

**Note.** `readings_to_candidates` reuses `_normalise` and `NODE_FOR_FIELD` and must fully replace `to_candidates`, which **Task 5 deletes** along with `sanitize_leaf`. Ruled 2026-08-08: after Task 5 removes the only production caller (`main.py:152`), both functions would survive purely to satisfy their own tests, which is dead code. Do not add behaviour to `to_candidates` in this task, and do not rely on it surviving.

**Two traps in this task, both of which fail in ways that look unrelated to the change:**

1. **Circular import.** `interpret.py` imports `FIELDS_BY_PROFILE` from `mapping.py`. So `mapping.py` must **not** import from `interpret.py` — that is why `readings_to_candidates` leaves `readings` and `doc` unannotated and imports `verified_value` *inside* the function body. Adding `from .interpret import FieldReading` at the top of `mapping.py` to "fix the missing type hints" will break the package at import time.
2. **`E402`.** Ruff's default rule set includes `E402` (module-level import not at top of file). The imports below belong in the existing import block at the **top** of `test_ingestion.py`, not mid-file where this snippet shows them.

- [ ] **Step 1: Write the failing tests**

Add these imports to the existing import block at the top of `carbonatix/backend/tests/test_ingestion.py`:

```python
from app.ingestion.document_vision import Element, ParsedDocument
from app.ingestion.interpret import FieldReading
from app.ingestion.mapping import readings_to_candidates
```

Then append the tests to the end of the file:

```python
# --- readings -> candidates (two-stage pipeline) -------------------------


def _twostage_doc() -> ParsedDocument:
    return ParsedDocument(
        elements=[
            Element(
                label="table",
                text="Bijih basah | 10.000 | ton\nBijih kering setara | 6.800 | ton",
                table_rows=None,
                score=0.96,
                page=0,
            )
        ],
        page_count=1,
    )


def test_transcribed_reading_becomes_a_candidate_with_element_confidence():
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
        )
    }
    [candidate] = readings_to_candidates(readings, _twostage_doc())
    assert candidate.value == 10000.0
    assert candidate.basis == "transcribed"
    assert candidate.confidence == pytest.approx(0.96)
    assert candidate.node == "stockpile"
    assert candidate.derivation == ""


def test_derived_reading_carries_a_human_readable_derivation():
    readings = {
        "moisture_content_pct": FieldReading(
            basis="derived",
            operands=["10.000", "6.800"],
            operation="difference_over_total",
            note="kadar air dari selisih basah dan kering",
        )
    }
    [candidate] = readings_to_candidates(readings, _twostage_doc())
    assert candidate.value == pytest.approx(0.32)
    assert candidate.basis == "derived"
    assert "10.000" in candidate.derivation
    assert "6.800" in candidate.derivation


def test_ungrounded_reading_becomes_a_blank_candidate_not_a_guess():
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Angka yang tidak ada di dokumen | 99.999 | ton",
            raw_value="99.999",
        )
    }
    [candidate] = readings_to_candidates(readings, _twostage_doc())
    assert candidate.value is None
    assert candidate.confidence == 0.0
    assert candidate.basis is None


def test_readings_candidates_are_never_marked_accepted():
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
        )
    }
    [candidate] = readings_to_candidates(readings, _twostage_doc())
    assert not hasattr(candidate, "accepted")


def test_percentage_normalisation_still_applies_to_a_transcribed_reading():
    doc = ParsedDocument(
        elements=[
            Element(
                label="table",
                text="Substitusi biokokas | 15 | %",
                table_rows=None,
                score=0.9,
                page=0,
            )
        ],
        page_count=1,
    )
    readings = {
        "reductant_biocoke_pct": FieldReading(
            basis="transcribed", evidence="Substitusi biokokas | 15 | %", raw_value="15"
        )
    }
    [candidate] = readings_to_candidates(readings, doc)
    assert candidate.value == pytest.approx(0.15)
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_ingestion.py -k readings -v`
Expected: FAIL — `ImportError: cannot import name 'readings_to_candidates'`

- [ ] **Step 3: Extend `Candidate` and add the new mapper**

In `carbonatix/backend/app/ingestion/mapping.py`, replace the `Candidate` dataclass with:

```python
@dataclass(frozen=True)
class Candidate:
    """One extracted field awaiting user verification.

    Deliberately has no `accepted` field: acceptance is a user action that
    happens elsewhere (the twin-node panel), never a state this object can
    carry or flip itself.

    `basis` records HOW the value was obtained. A derived value was computed
    from figures elsewhere in the document rather than read off it, and the
    UI must show that difference -- the same rule the forecasts and the
    advisory citations follow: provisional data carries its label all the
    way to the rendered pixel.
    """

    field: str
    value: float | None
    confidence: float
    node: str
    source_hint: str = ""
    basis: str | None = None
    evidence: str = ""
    derivation: str = ""
```

Append to the same file:

```python
_OPERATION_TEMPLATES = {
    "difference_over_total": "({a} − {b}) / {a}",
    "ratio": "{a} / {b}",
    "percentage_of_total": "({a} / {b}) × 100",
}


def _derivation_text(reading) -> str:
    """A human-readable rendering of a derivation, for the UI to show beside
    the value. Empty for transcribed values -- there is nothing to explain."""
    template = _OPERATION_TEMPLATES.get(reading.operation)
    if template is None or len(reading.operands) != 2:
        return ""
    return template.format(a=reading.operands[0], b=reading.operands[1])


def readings_to_candidates(readings: dict, doc) -> list[Candidate]:
    """Verified stage-2 readings -> candidates awaiting user review.

    Verification runs here, before anything becomes a Candidate: an
    ungrounded figure is reduced to a blank candidate the user fills in by
    hand, never carried forward as a value. See `verify.verified_value`.
    """
    from .verify import verified_value

    out: list[Candidate] = []
    for name, reading in readings.items():
        node = NODE_FOR_FIELD.get(name)
        if node is None:
            continue
        value, confidence = verified_value(reading, doc)
        out.append(
            Candidate(
                field=name,
                value=_normalise(name, value),
                confidence=confidence,
                node=node,
                source_hint=reading.note,
                basis=reading.basis if value is not None else None,
                evidence=reading.evidence,
                derivation=_derivation_text(reading) if value is not None else "",
            )
        )
    return out
```

- [ ] **Step 4: Extend the wire schema**

In `carbonatix/backend/app/schemas.py`, replace the body of `CandidateResponse` (lines 157-167) with:

```python
class CandidateResponse(_Camel):
    """One extracted field awaiting user review. Deliberately carries no
    "accepted" flag -- see `app/ingestion/mapping.py`'s `Candidate`, which
    this mirrors field-for-field on the wire."""

    field: str
    value: float | None
    confidence: float
    node: str
    source_hint: str = ""
    # How the value was obtained. "derived" means it was computed from other
    # figures in the document rather than read off it, and the UI must
    # render it differently -- a derived number carries error the printed
    # one does not.
    basis: str | None = None
    evidence: str = ""
    derivation: str = ""
```

**Resolving Open Question 2 from the spec, explicitly.** The spec body said
`confidence_is_placeholder` would become `False`; its own Open Question 2 said
that may be too generous. **Take the conservative option: it stays `True`.**
Helpy's `score` is per *element* — a table scoring 0.96 says the table was read
cleanly, not that the nickel grade cell was. Calling that a per-field
reliability signal would be the same overclaim the flag exists to prevent. The
value is now real rather than a hardcoded `0.75`, and that improvement is worth
having on its own.

Replace the `DocumentExtractionResponse` docstring, which still describes the
deleted `0.75` default:

```python
class DocumentExtractionResponse(_Camel):
    """Response to POST /documents.

    `confidence_is_placeholder` is still `True`, for a different reason than
    it used to be. `confidence` is no longer a flat 0.75 -- it now carries
    the real score Helpy assigned to the document element the figure came
    from. But that score is per ELEMENT, not per field: a table scoring 0.96
    says the table was read cleanly, not that this particular cell was. So
    it remains an indicator of document quality rather than a per-field
    reliability signal, and this flag stays set to say so.
    """
```

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_ingestion.py -v`
Expected: PASS — the five new tests plus every pre-existing one.

- [ ] **Step 6: Lint and commit**

```bash
.venv/Scripts/python.exe -m ruff check app tests
git add carbonatix/backend/app/ingestion/mapping.py carbonatix/backend/app/schemas.py \
        carbonatix/backend/tests/test_ingestion.py
git commit -m "feat(ingestion): candidates carry basis, evidence and real confidence

Confidence stops being the hardcoded 0.75 and becomes the Helpy element
score the figure came from. A derived candidate carries the arithmetic that
produced it so the UI can show it differently from a transcribed one."
```

---

### Task 5: Rewire `/documents`, cap uploads, delete the old path

**Files:**
- Modify: `carbonatix/backend/app/main.py:128-160`
- Delete: `carbonatix/backend/app/ingestion/vision.py`
- Modify: `carbonatix/backend/pyproject.toml` (drop `anthropic`)
- Modify: `carbonatix/backend/tests/test_ingestion.py` (remove `vision.py` tests)
- Test: `carbonatix/backend/tests/test_ingestion.py`

**Interfaces:**
- Consumes: `document_vision.parse`, `interpret.interpret`, `mapping.readings_to_candidates`, `document_vision.ExtractionFailed`.
- Produces: no new interface; `/documents` keeps its request and response contract.

- [ ] **Step 1: Write the failing tests**

Append to `carbonatix/backend/tests/test_ingestion.py`. As in Task 4, put every
`import` in the block at the **top** of the file — `E402` is in ruff's default
rule set, and the mid-function imports shown inside these test bodies are there
only to keep each snippet readable; move them up when you paste them.

```python
# --- /documents through the two-stage pipeline ---------------------------


def test_documents_rejects_an_upload_over_the_size_cap(monkeypatch):
    """`await file.read()` was unbounded: a large upload was read entirely
    into memory before anything checked it."""
    from app import main

    oversized = b"x" * (main._MAX_UPLOAD_BYTES + 1)
    with TestClient(app) as client:
        response = client.post(
            "/documents",
            files={"file": ("big.pdf", oversized, "application/pdf")},
            data={"profile": "operational"},
        )
    assert response.status_code == 413


def test_documents_returns_candidates_from_the_two_stage_pipeline(monkeypatch):
    from app import main
    from app.ingestion.document_vision import Element, ParsedDocument
    from app.ingestion.interpret import FieldReading

    doc = ParsedDocument(
        elements=[
            Element(
                label="table",
                text="Bijih basah | 10.000 | ton",
                table_rows=None,
                score=0.96,
                page=0,
            )
        ],
        page_count=1,
    )

    async def fake_parse(file_bytes, media_type, filename="document"):
        return doc

    async def fake_interpret(parsed, profile):
        return {
            "wet_ore_input_tons": FieldReading(
                basis="transcribed",
                evidence="Bijih basah | 10.000 | ton",
                raw_value="10.000",
            )
        }

    monkeypatch.setattr(main, "parse_document", fake_parse)
    monkeypatch.setattr(main, "interpret_fields", fake_interpret)

    with TestClient(app) as client:
        response = client.post(
            "/documents",
            files={"file": ("r.pdf", b"pdf", "application/pdf")},
            data={"profile": "operational"},
        )

    assert response.status_code == 200
    body = response.json()
    [candidate] = body["candidates"]
    assert candidate["value"] == 10000.0
    assert candidate["basis"] == "transcribed"
    assert candidate["confidence"] == pytest.approx(0.96)


def test_documents_returns_502_when_the_document_cannot_be_read(monkeypatch):
    from app import main
    from app.ingestion.document_vision import ExtractionFailed

    async def fake_parse(file_bytes, media_type, filename="document"):
        raise ExtractionFailed("helpy said no")

    monkeypatch.setattr(main, "parse_document", fake_parse)

    with TestClient(app) as client:
        response = client.post(
            "/documents",
            files={"file": ("r.pdf", b"pdf", "application/pdf")},
            data={"profile": "operational"},
        )

    assert response.status_code == 502
    assert "manual" in response.json()["detail"].lower()
```

These reuse the module's existing auth override fixture. If the existing `/documents` tests in this file set `app.dependency_overrides` in a function-scoped autouse fixture, the new tests inherit it — confirm before running, and never move that assignment to module level (it would bypass real JWT verification in `test_auth.py`).

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_ingestion.py -k "two_stage or size_cap" -v`
Expected: FAIL — `AttributeError: module 'app.main' has no attribute '_MAX_UPLOAD_BYTES'`

- [ ] **Step 3: Rewire the route**

In `carbonatix/backend/app/main.py`, replace the `ingestion` imports:

```python
from .ingestion.document_vision import ExtractionFailed
from .ingestion.document_vision import parse as parse_document
from .ingestion.interpret import interpret as interpret_fields
from .ingestion.mapping import readings_to_candidates
```

Add near the top, below `app = FastAPI(...)`:

```python
# Uploads are read into memory to be forwarded to Helpy, so an unbounded
# read is a memory-exhaustion vector. 20 MB comfortably clears a scanned
# multi-page report.
_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
```

Replace the whole `post_document` function with:

```python
@app.post("/documents", response_model=DocumentExtractionResponse)
async def post_document(
    file: UploadFile = File(...),
    profile: str = Form(...),
    user_id: UUID = Depends(current_user_id),
) -> DocumentExtractionResponse:
    """Extract candidates from an uploaded document. Returns candidates for
    the user to review; writes nothing to `companies` or
    `calculation_runs` -- see `app/ingestion/mapping.py` for why a
    `Candidate` cannot become a stored value without a separate, explicit
    user action that this route does not perform.

    Two stages, one synchronous request: Helpy reads the document, then a
    model identifies which figures are the requested fields, then every
    figure is grounded in the document text before it becomes a candidate.
    A failure in either stage lands on the same user-facing message,
    deliberately -- the user does the same thing either way.
    """
    if profile not in ("site_spec", "operational"):
        raise HTTPException(status_code=422, detail="Unknown document profile")

    file_bytes = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Dokumen terlalu besar. Maksimum 20 MB.",
        )

    try:
        parsed = await parse_document(
            file_bytes, file.content_type or "application/pdf", file.filename or "document"
        )
        readings = await interpret_fields(parsed, profile)
        candidates = readings_to_candidates(readings, parsed)
    except ExtractionFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not read the document. Enter the values manually.",
        ) from exc

    return DocumentExtractionResponse(
        candidates=[CandidateResponse(**c.__dict__) for c in candidates]
    )
```

- [ ] **Step 4: Delete the superseded module and the now-orphaned mappers**

```bash
git rm carbonatix/backend/app/ingestion/vision.py
```

In `tests/test_ingestion.py`, delete every test whose name begins `test_extract_` (they target the removed module), and remove the `from app.ingestion.vision import ...` import and the `anthropic_key` fixture if nothing else uses it.

**Also delete `to_candidates` and `sanitize_leaf` from `mapping.py`** and drop both from `__all__`, leaving `__all__ = ["FIELDS_BY_PROFILE", "NODE_FOR_FIELD", "Candidate", "readings_to_candidates"]`. Removing `main.py`'s old route left them with no production caller; keeping production code alive only for its own tests is dead code. Keep `_normalise` and `_FRACTION_FIELDS` — `readings_to_candidates` uses them.

Their tests split three ways. **Do not delete coverage wholesale** — this is the difference between removing dead code and quietly reducing the test suite:

*Retarget to `readings_to_candidates`* (the behaviour still exists and must stay covered) — rewrite each to build a `FieldReading` + `ParsedDocument` the way the Task 4 tests do:

- `test_unreadable_field_becomes_a_blank_candidate_not_a_guess`
- `test_low_confidence_is_flagged_not_dropped`
- `test_candidates_are_never_marked_accepted`
- `test_percentages_are_normalised_to_fractions`
- `test_percentage_at_or_below_one_is_left_alone`
- `test_unmapped_field_is_dropped_not_fabricated_into_a_candidate`

*Keep unchanged* (they assert on `Candidate`/`NODE_FOR_FIELD` directly, not through the deleted functions):

- `test_every_operational_field_maps_to_exactly_one_node`
- `test_candidate_has_no_accepted_field_at_all` — a Global Constraint; it must still pass

*Delete* (they exercise raw-JSON-leaf semantics that no longer exist anywhere — stage 2 returns strings, and hostile input is now rejected by `verify.parse_id_number`, which Task 2 covers with its own `test_unparseable_text_is_none_not_a_guess`):

- `test_to_candidates_never_raises_on_hostile_leaf_value`
- `test_sanitize_leaf_accepts_only_finite_numbers_or_none`

Finally, `app/schemas.py:175` mentions `mapping.to_candidates`'s 0.75 — that reference dies with the function. Task 4 already replaces that docstring; confirm no stale mention of `to_candidates` or `sanitize_leaf` survives anywhere: `grep -rn "to_candidates\|sanitize_leaf" carbonatix/backend/app carbonatix/backend/tests` should return nothing but the retargeted test names.

In `pyproject.toml`, delete the `"anthropic>=0.40",` line and update the comment above the `openai` dependency to:

```toml
    # Both the advisor and document ingestion reach their models through
    # Elice ML API, an OpenAI-compatible gateway, so the OpenAI SDK is
    # pointed at a custom base URL. Helpy Document Vision is called over
    # plain HTTP (httpx) because it is a multipart upload + polling API,
    # not a chat completion.
```

- [ ] **Step 5: Run the whole suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS. Count will differ from the 222 baseline — new tests added, `test_extract_*` removed.

- [ ] **Step 6: Lint and commit**

```bash
.venv/Scripts/python.exe -m ruff check app tests
git add -A carbonatix/backend
git commit -m "feat(ingestion): rewire /documents onto the two-stage pipeline

Helpy reads, a model identifies, Python verifies. The route keeps its
request and response contract, so the frontend is unaffected.

Also caps uploads at 20 MB -- the previous unbounded await file.read() read
any size into memory -- and deletes vision.py with the anthropic
dependency, its last consumer."
```

---

### Task 6: Frontend — derived labelling, empty state, timeout

**Files:**
- Modify: `carbonatix/frontend/types/emissions.ts:152-167`
- Modify: `carbonatix/frontend/lib/api.ts:194-208`
- Modify: `carbonatix/frontend/components/twin/UploadDropzone.tsx`
- Test: `carbonatix/frontend/components/twin/UploadDropzone.test.tsx`

**Interfaces:**
- Consumes: the `CandidateResponse` wire shape from Task 4 (`basis`, `evidence`, `derivation` in camelCase: `basis`, `evidence`, `derivation` — none contain digits, so `to_camel` leaves them alone).
- Produces: no interface other tasks depend on. Last task.

- [ ] **Step 1: Write the failing tests**

Append to `carbonatix/frontend/components/twin/UploadDropzone.test.tsx`, following the existing file's render helpers:

```tsx
it("marks a derived candidate as computed, not read", async () => {
  vi.mocked(postDocument).mockResolvedValue({
    candidates: [
      {
        field: "moisture_content_pct",
        value: 0.32,
        confidence: 0.96,
        node: "stockpile",
        sourceHint: "kadar air dari selisih basah dan kering",
        basis: "derived",
        evidence: "Bijih basah | 10.000 | ton",
        derivation: "(10.000 − 6.800) / 10.000",
      },
    ],
    confidenceIsPlaceholder: true,
  });

  render(<UploadDropzone node="stockpile" profile="operational" onAccept={vi.fn()} />);
  await uploadFile();

  expect(await screen.findByText(/dihitung/i)).toBeInTheDocument();
  expect(screen.getByText("(10.000 − 6.800) / 10.000")).toBeInTheDocument();
});

it("does not label a transcribed candidate as computed", async () => {
  vi.mocked(postDocument).mockResolvedValue({
    candidates: [
      {
        field: "wet_ore_input_tons",
        value: 10000,
        confidence: 0.96,
        node: "stockpile",
        sourceHint: "",
        basis: "transcribed",
        evidence: "Bijih basah | 10.000 | ton",
        derivation: "",
      },
    ],
    confidenceIsPlaceholder: true,
  });

  render(<UploadDropzone node="stockpile" profile="operational" onAccept={vi.fn()} />);
  await uploadFile();

  expect(await screen.findByText("10.000")).toBeInTheDocument();
  expect(screen.queryByText(/dihitung/i)).not.toBeInTheDocument();
});

it("distinguishes a readable document with no matching fields from a failure", async () => {
  vi.mocked(postDocument).mockResolvedValue({
    candidates: [],
    confidenceIsPlaceholder: true,
  });

  render(<UploadDropzone node="stockpile" profile="operational" onAccept={vi.fn()} />);
  await uploadFile();

  expect(
    await screen.findByText(/tidak ada medan .* ditemukan/i),
  ).toBeInTheDocument();
});
```

If `uploadFile()` does not already exist in this file, add it beside the other helpers:

```tsx
async function uploadFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["pdf"], "laporan.pdf", { type: "application/pdf" });
  await userEvent.upload(input, file);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd carbonatix/frontend && npx vitest run components/twin/UploadDropzone.test.tsx`
Expected: FAIL — the derived badge and empty-state text do not exist.

- [ ] **Step 3: Extend the wire types**

In `types/emissions.ts`, replace the `Candidate` interface:

```ts
/** One extracted field awaiting user review. Deliberately carries no
 * "accepted" flag -- mirrors `Candidate` in the backend's
 * `app/ingestion/mapping.py` field-for-field. */
export interface Candidate {
  field: string;
  value: number | null;
  confidence: number;
  node: string;
  sourceHint: string;
  /** How the value was obtained. `"derived"` means it was COMPUTED from
   * other figures in the document, not read off it -- it must never render
   * identically to a transcribed value. `null` when the figure could not be
   * grounded in the document at all, in which case `value` is null too. */
  basis: "transcribed" | "derived" | null;
  /** The document text the value was read from. */
  evidence: string;
  /** Human-readable arithmetic, derived values only: "(10.000 − 6.800) / 10.000". */
  derivation: string;
}
```

- [ ] **Step 4: Add the request timeout**

In `lib/api.ts`, replace `postDocument`:

```ts
/** Posts one document for OCR candidate extraction. Never writes to the
 * company profile or a run -- the caller decides, per candidate, whether
 * and how to use the returned values (see `components/twin/UploadDropzone.tsx`).
 *
 * Two AI stages run inside this single request (see the backend's
 * `/documents`), so it legitimately takes 10-20s rather than returning
 * fast. The abort below sits above the backend's own 90s parse budget, so
 * a server-side timeout still surfaces as its own 502 rather than being
 * masked by the client giving up first. */
export async function postDocument(
  file: File,
  profile: "site_spec" | "operational",
): Promise<DocumentExtractionResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("profile", profile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${BASE}/documents`, {
      method: "POST",
      headers: await authHeaderOnly(),
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Render the badge and the empty state**

In `components/twin/UploadDropzone.tsx`, inside the candidate row rendering (beside the existing value display), add:

```tsx
{candidate.basis === "derived" && (
  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
    Dihitung, bukan dibaca
  </span>
)}
{candidate.derivation && (
  <p className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
    {candidate.derivation}
  </p>
)}
```

And immediately after the `{candidates.length > 0 && (...)}` block, add the empty state:

```tsx
{hasResult && candidates.length === 0 && (
  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
    Dokumen berhasil dibaca, tetapi tidak ada medan yang dicari ditemukan di
    dalamnya. Masukkan nilai secara manual.
  </p>
)}
```

Add `const [hasResult, setHasResult] = useState(false);` beside the existing state, set it to `true` where `setCandidates(result.candidates)` is called, and back to `false` where `setCandidates([])` resets.

- [ ] **Step 6: Run the frontend suite**

Run: `cd carbonatix/frontend && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all pass. Baseline was 106 tests; three more now.

- [ ] **Step 7: Commit**

```bash
git add carbonatix/frontend/types/emissions.ts carbonatix/frontend/lib/api.ts \
        carbonatix/frontend/components/twin/UploadDropzone.tsx \
        carbonatix/frontend/components/twin/UploadDropzone.test.tsx
git commit -m "feat(web): label derived candidates and add an upload timeout

A computed figure never renders identically to one read off the page, and
the arithmetic that produced it is shown beneath it. Adds the empty state
for a document that parsed cleanly but contained none of the requested
fields, which previously looked the same as a silent failure."
```

---

### Task 7: Configuration and documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.superpowers/sdd/2026-08-04-smartsmelt-web-v2/progress.md`
- Create: `carbonatix/backend/.env.example`

- [ ] **Step 1: Write the env example**

Create `carbonatix/backend/.env.example` (it was deleted, and the variables are currently discoverable only by reading source):

```bash
# Supabase project. The JWKS URL is derived from this; auth.py fetches
# {SUPABASE_URL}/auth/v1/.well-known/jwks.json. There is NO
# SUPABASE_JWT_SECRET -- tokens are ES256, verified against public keys.
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Transaction pooler, port 6543. Session mode (5432) times out and
# db.<ref>.supabase.co is IPv6-only. See db.py's module docstring.
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres

# Elice ML API. ONE key, TWO deployments -- each serverless endpoint serves
# only its own provisioned models, so these two URLs are not
# interchangeable and neither can be pointed at the other.
ELICE_API_KEY=<serverless-api-key>
ELICE_BASE_URL=https://mlapi.run/<advisor-uuid>/v1
HELPY_BASE_URL=https://mlapi.run/<helpy-uuid>

# NOTE: the app does not load this file itself -- there is no dotenv
# dependency. Start the server with:
#   uvicorn app.main:app --env-file .env --reload
```

- [ ] **Step 2: Update CLAUDE.md**

Replace the entire "### Vision OCR (`ingestion/`)" section with:

```markdown
### Ingestion — two AI stages, and Python in between

`POST /documents` runs both stages inside one synchronous request. Neither
stage may write a value: the output is always candidates a human accepts.

**Stage 1 — `document_vision.py`.** Helpy Document Vision (`HELPY_BASE_URL`,
authenticating with the shared `ELICE_API_KEY` — there is no `HELPY_API_KEY`).
Asynchronous: `POST /v1/documents` returns a job id, polled at
`GET /v1/jobs/{id}` under a 90s budget. **Poll on `/v1/jobs/{id}`, not the
`/jobs/{id}` the vendor docs list — that path 404s.** `/healthz` and `/readyz`
also require auth despite being documented as open. Returns a normalized
`ParsedDocument`, never Helpy's own JSON, so a provider swap cannot leak a
response shape downstream. Accepts PDF/PPT/PPTX/PNG/JPEG/JPG — **not XLSX**,
which PRD §10 still promises.

**Stage 2 — `interpret.py`.** `gpt-5.6-sol` over the same Elice gateway as the
advisor, same enforced parameter allowlist. Returns, per field, either verbatim
`evidence` plus the `raw_value` as printed, or — for a field the document does
not print — the `operands` and a named `operation`. **It never returns a
computed number.** Every profile field always comes back, so an omission reads
as "not found" rather than a missing key.

**Verification — `verify.py`.** Pure Python, no client, its own module so it
cannot acquire one. The model chooses which numbers; this does the arithmetic.
A transcribed figure must appear verbatim inside the evidence cited for it; a
derived figure's operands must each appear verbatim, and the value is computed
here. `operation` is matched against a closed set, never `eval`'d. Anything
unverifiable becomes a blank for manual entry — never a guess.

**`mapping.py`** turns verified readings into `Candidate`s. `confidence` is now
Helpy's real element score, but `confidence_is_placeholder` stays `True`: the
score is per element, not per field. `basis`/`derivation` let the UI show a
computed figure differently from one read off the page — the labelling rule
that already governs synthetic forecasts and placeholder citations.
```

In the Commands section's environment paragraph, delete `ANTHROPIC_API_KEY
(vision OCR)` and add `HELPY_BASE_URL` beside the other Elice variables. Also
add the `--env-file .env` flag to the documented `uvicorn` command — without it
the server starts with no database, no gateway and no Supabase. Update the
backend test count in the same section to whatever `pytest -q` reports.

- [ ] **Step 3: Update the ledger**

Add to `.superpowers/sdd/2026-08-04-smartsmelt-web-v2/progress.md`, above the
most recent entry:

```markdown
### TWO-STAGE OCR SHIPPED (plan 2026-08-08)
Helpy Document Vision reads, gpt-5.6-sol identifies fields, verify.py grounds
and computes. `anthropic` and `ANTHROPIC_API_KEY` are GONE — vision.py was
their last consumer, so the project is now one provider and one key.
Vendor-doc corrections, all confirmed by live request:
  * poll `GET /v1/jobs/{id}`; the documented `/jobs/{id}` 404s.
  * `/healthz` and `/readyz` require Authorization despite being documented
    as needing none.
  * elements carry an undocumented per-element `score` (~0.96 measured).
CARRIED OPEN QUESTIONS:
  1. XLSX is still unsupported. Helpy does not accept it and PRD §10 promises
     it. The honest fix is a parser, not a model — a spreadsheet already IS
     structured data.
  2. `confidence_is_placeholder` stays True BY DECISION. The score is per
     element, so a table scoring 0.96 says the table read cleanly, not that
     the nickel-grade cell did. Calling it per-field would be the exact
     overclaim the flag exists to prevent.
STILL UNMEASURED: every test mocks both providers. Helpy has been exercised
once, against a synthetic document; stage 2 has never run live. OCR accuracy
on a real smelter report remains unknown.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md carbonatix/backend/.env.example \
        .superpowers/sdd/2026-08-04-smartsmelt-web-v2/progress.md
git commit -m "docs: record the two-stage OCR pipeline and restore .env.example"
```

---

## Verification

After Task 7, confirm the whole thing:

```bash
cd carbonatix/backend
.venv/Scripts/python.exe -m pytest -q            # expect all passing
.venv/Scripts/python.exe -m ruff check app tests # expect All checks passed!

cd ../frontend
npx vitest run       # expect 109 passing
npx tsc --noEmit
npm run lint
```

Then exercise it live, which the unit tests deliberately cannot:

```bash
cd carbonatix/backend
.venv/Scripts/python.exe -m uvicorn app.main:app --env-file .env --port 8000
# upload a real smelter document at /twin and confirm: candidates appear,
# derived ones are badged, and nothing is written until Terima is clicked.
```

**The remaining honest gap:** every test in this plan mocks both providers. The pipeline has been exercised against Helpy once, with a synthetic document. It has never seen a real smelter report, and stage 2 has never run at all. Until a real document goes through end to end, OCR accuracy is still unmeasured — the plan makes the path correct, not proven.
