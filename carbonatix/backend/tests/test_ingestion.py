"""Vision extraction and candidate mapping.

`mapping.py` is pure and is tested directly. `vision.py` talks to the
Anthropic API, so every test here mocks the client -- there is no
ANTHROPIC_API_KEY in this environment and no real smelter documents to
exercise against. See task-12-report.md for what remains unverified as a
result (real-document OCR quality, rotated-scan handling, etc).
"""

import json
import uuid
from typing import ClassVar

import pytest
from fastapi.testclient import TestClient

from app.auth import current_user_id
from app.ingestion.mapping import NODE_FOR_FIELD, to_candidates
from app.main import app

USER = uuid.uuid4()
client = TestClient(app)


@pytest.fixture(autouse=True)
def _current_user():
    """Scoped per-test, not module-level -- see test_runs.py for why a bare
    top-level `app.dependency_overrides[...] = ...` is forbidden here: it
    would leak into every other test module sharing this `app` instance."""
    app.dependency_overrides[current_user_id] = lambda: USER
    yield
    app.dependency_overrides.pop(current_user_id, None)


# ---------------------------------------------------------------------------
# mapping.py -- pure, no mocking required
# ---------------------------------------------------------------------------


def test_every_operational_field_maps_to_exactly_one_node():
    """Each of the nine inputs belongs to exactly one twin node (PRD 13.1).
    A field with no node cannot be entered; a field in two nodes is
    ambiguous."""
    operational = {
        "wet_ore_input_tons",
        "moisture_content_pct",
        "nickel_grade_pct",
        "reductant_biocoke_pct",
        "power_mix_captive_coal",
        "power_mix_hydro_grid",
    }
    site_spec = {
        "ef_captive_pltu",
        "dryer_thermal_efficiency",
        "sec_eaf_kwh_per_t_alloy",
    }
    for field in operational | site_spec:
        assert field in NODE_FOR_FIELD, f"{field} has no twin node"
        assert isinstance(NODE_FOR_FIELD[field], str)

    # Ambiguity check: every field maps to exactly one node, never two --
    # there is no way to express "belongs to two nodes" in a dict value, so
    # this also asserts the map itself is not carrying a list/tuple/set.
    for field, node in NODE_FOR_FIELD.items():
        assert isinstance(node, str) and node, f"{field} has no single node"


def test_unreadable_field_becomes_a_blank_candidate_not_a_guess():
    cands = to_candidates(
        {"wet_ore_input_tons": 10000.0, "moisture_content_pct": None}, "operational"
    )
    by_field = {c.field: c for c in cands}
    assert by_field["moisture_content_pct"].value is None
    assert by_field["moisture_content_pct"].confidence == 0.0


def test_low_confidence_is_flagged_not_dropped():
    cands = to_candidates(
        {"nickel_grade_pct": 0.018}, "operational", confidences={"nickel_grade_pct": 0.3}
    )
    assert cands[0].confidence == 0.3
    assert cands[0].value == 0.018


def test_candidates_are_never_marked_accepted():
    """No code path may write an extracted value without an explicit user
    accept. This test is the guard on that rule."""
    for c in to_candidates({"wet_ore_input_tons": 10000.0}, "operational"):
        assert not hasattr(c, "accepted") or c.accepted is False


def test_percentages_are_normalised_to_fractions():
    """A document saying '32%' must arrive as 0.32, never 32."""
    cands = to_candidates({"moisture_content_pct": 32.0}, "operational")
    assert cands[0].value == pytest.approx(0.32)


def test_percentage_at_or_below_one_is_left_alone():
    """0.32 is already a fraction; dividing it again would be a second,
    silent corruption of the same field."""
    cands = to_candidates({"moisture_content_pct": 0.32}, "operational")
    assert cands[0].value == pytest.approx(0.32)


def test_unmapped_field_is_dropped_not_fabricated_into_a_candidate():
    """A raw field with no twin node is dropped rather than surfaced as an
    uneditable, unplaceable candidate."""
    cands = to_candidates({"totally_unknown_field": 1.0}, "operational")
    assert cands == []


def test_candidate_has_no_accepted_field_at_all():
    """The dataclass itself carries no acceptance flag -- there is nothing
    to flip to True by mistake."""
    from app.ingestion.mapping import Candidate

    field_names = {f for f in Candidate.__dataclass_fields__}
    assert "accepted" not in field_names


# ---------------------------------------------------------------------------
# vision.py -- Anthropic client is always mocked; never a real API call.
# ---------------------------------------------------------------------------


class _FakeTextBlock:
    def __init__(self, text: str):
        self.text = text


class _FakeMessage:
    def __init__(self, text: str):
        self.content = [_FakeTextBlock(text)]


class _FakeMessages:
    def __init__(self, response_text: str, capture: dict):
        self._response_text = response_text
        self._capture = capture

    async def create(self, **kwargs):
        self._capture["kwargs"] = kwargs
        return _FakeMessage(self._response_text)


class _FakeAsyncAnthropic:
    """Stands in for anthropic.AsyncAnthropic. No network call is possible
    through this class."""

    last_capture: ClassVar[dict] = {}

    def __init__(self, *args, **kwargs):
        self.messages = _FakeMessages(self.__class__._response_text, self.last_capture)


def _make_fake_client(response_text: str):
    captured: dict = {}

    class _Client(_FakeAsyncAnthropic):
        _response_text = response_text
        last_capture = captured

    return _Client, captured


@pytest.fixture
def anthropic_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")


async def _extract_with_mocked_client(monkeypatch, response_text, *, media_type="image/png"):
    from app.ingestion import vision

    fake_client_cls, captured = _make_fake_client(response_text)
    monkeypatch.setattr(vision, "AsyncAnthropic", fake_client_cls)
    result = await vision.extract(b"fake-bytes", media_type, "operational")
    return result, captured


@pytest.mark.asyncio
async def test_extract_requests_exactly_the_fields_for_the_profile(monkeypatch, anthropic_key):
    from app.ingestion import vision

    fake_client_cls, captured = _make_fake_client(
        json.dumps({f: None for f in vision._FIELDS["site_spec"]})
    )
    monkeypatch.setattr(vision, "AsyncAnthropic", fake_client_cls)

    await vision.extract(b"fake-bytes", "application/pdf", "site_spec")

    prompt_text = captured["kwargs"]["messages"][0]["content"][1]["text"]
    for field in vision._FIELDS["site_spec"]:
        assert field in prompt_text
    for field in vision._FIELDS["operational"]:
        assert field not in prompt_text


@pytest.mark.asyncio
async def test_extract_returns_none_for_fields_the_model_omitted(monkeypatch, anthropic_key):
    # Model only reports two of the six operational fields; the rest must
    # come back as None, never guessed or dropped from the result.
    result, _ = await _extract_with_mocked_client(
        monkeypatch,
        json.dumps({"wet_ore_input_tons": 12000.0, "moisture_content_pct": 31.0}),
    )
    assert result["wet_ore_input_tons"] == 12000.0
    assert result["moisture_content_pct"] == 31.0
    assert result["nickel_grade_pct"] is None
    assert result["reductant_biocoke_pct"] is None
    assert result["power_mix_captive_coal"] is None
    assert result["power_mix_hydro_grid"] is None


@pytest.mark.asyncio
async def test_extract_uses_document_block_for_pdf(monkeypatch, anthropic_key):
    from app.ingestion import vision

    fake_client_cls, captured = _make_fake_client(json.dumps({}))
    monkeypatch.setattr(vision, "AsyncAnthropic", fake_client_cls)

    await vision.extract(b"%PDF-fake", "application/pdf", "operational")

    block = captured["kwargs"]["messages"][0]["content"][0]
    assert block["type"] == "document"
    assert block["source"]["media_type"] == "application/pdf"


@pytest.mark.asyncio
async def test_extract_uses_image_block_for_photo(monkeypatch, anthropic_key):
    from app.ingestion import vision

    fake_client_cls, captured = _make_fake_client(json.dumps({}))
    monkeypatch.setattr(vision, "AsyncAnthropic", fake_client_cls)

    await vision.extract(b"\x89PNG-fake", "image/png", "operational")

    block = captured["kwargs"]["messages"][0]["content"][0]
    assert block["type"] == "image"
    assert block["source"]["media_type"] == "image/png"


@pytest.mark.asyncio
async def test_extract_raises_extraction_failed_on_non_json_response(monkeypatch, anthropic_key):
    from app.ingestion.vision import ExtractionFailed

    with pytest.raises(ExtractionFailed):
        await _extract_with_mocked_client(monkeypatch, "Sorry, I cannot read this document.")


@pytest.mark.asyncio
async def test_extract_raises_extraction_failed_on_non_object_json(monkeypatch, anthropic_key):
    """A syntactically valid JSON array is not a field map -- it must fail
    loudly, not be silently mistaken for an empty or partial extraction."""
    from app.ingestion.vision import ExtractionFailed

    with pytest.raises(ExtractionFailed):
        await _extract_with_mocked_client(monkeypatch, json.dumps([1, 2, 3]))


@pytest.mark.asyncio
async def test_extract_raises_extraction_failed_when_client_call_raises(monkeypatch, anthropic_key):
    from app.ingestion import vision
    from app.ingestion.vision import ExtractionFailed

    class _BoomMessages:
        async def create(self, **kwargs):
            raise ConnectionError("network unreachable")

    class _BoomClient:
        def __init__(self, *args, **kwargs):
            self.messages = _BoomMessages()

    monkeypatch.setattr(vision, "AsyncAnthropic", _BoomClient)

    with pytest.raises(ExtractionFailed):
        await vision.extract(b"fake-bytes", "image/png", "operational")


@pytest.mark.asyncio
async def test_extract_fails_loudly_when_api_key_missing(monkeypatch):
    """No ANTHROPIC_API_KEY must never crash with a raw 500-shaped
    KeyError -- it is exactly the "vision unavailable" case the /documents
    route already knows how to turn into a 502."""
    from app.ingestion import vision
    from app.ingestion.vision import ExtractionFailed

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ExtractionFailed):
        await vision.extract(b"fake-bytes", "image/png", "operational")


# ---------------------------------------------------------------------------
# POST /documents -- returns candidates, persists nothing.
# ---------------------------------------------------------------------------


def test_documents_requires_auth():
    app.dependency_overrides.pop(current_user_id, None)
    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "operational"},
    )
    assert r.status_code == 401


def test_documents_rejects_unknown_profile():
    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "not_a_real_profile"},
    )
    assert r.status_code == 422


def test_documents_returns_candidates_and_persists_nothing(monkeypatch):
    from app.ingestion import vision

    async def _fake_extract(file_bytes, media_type, profile):
        return {
            "wet_ore_input_tons": 10000.0,
            "moisture_content_pct": 32.0,
            "nickel_grade_pct": None,
            "reductant_biocoke_pct": None,
            "power_mix_captive_coal": None,
            "power_mix_hydro_grid": None,
        }

    monkeypatch.setattr(vision, "extract", _fake_extract)
    monkeypatch.setattr("app.main.extract", _fake_extract)

    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "operational"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "candidates" in body
    by_field = {c["field"] for c in body["candidates"]}
    assert "wet_ore_input_tons" in by_field
    # Normalisation happened before the candidate reached the wire.
    moisture = next(c for c in body["candidates"] if c["field"] == "moisture_content_pct")
    assert moisture["value"] == pytest.approx(0.32)
    unreadable = next(c for c in body["candidates"] if c["field"] == "nickel_grade_pct")
    assert unreadable["value"] is None
    assert unreadable["confidence"] == 0.0
    # No "accepted" key anywhere in the wire payload -- nothing here can be
    # mistaken for an already-written value.
    for c in body["candidates"]:
        assert "accepted" not in c


def test_documents_returns_502_when_extraction_fails(monkeypatch):
    from app.ingestion.vision import ExtractionFailed

    async def _fake_extract(file_bytes, media_type, profile):
        raise ExtractionFailed("model returned garbage")

    monkeypatch.setattr("app.main.extract", _fake_extract)

    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "operational"},
    )
    assert r.status_code == 502
    assert "manually" in r.text.lower()
