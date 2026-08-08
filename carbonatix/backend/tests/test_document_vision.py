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


async def _no_sleep(_seconds: float) -> None:
    """Polling sleeps are skipped so the bounded-polling test is instant."""
    return


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
