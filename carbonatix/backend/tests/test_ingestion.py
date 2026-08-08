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
from app.ingestion.document_vision import Element, ParsedDocument
from app.ingestion.interpret import FieldReading
from app.ingestion.mapping import NODE_FOR_FIELD, readings_to_candidates, to_candidates
from app.main import app
from app.schemas import CandidateResponse, DocumentExtractionResponse

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


@pytest.mark.parametrize(
    "hostile_value",
    [
        pytest.param("32", id="string"),
        pytest.param({"nested": "object"}, id="nested-object"),
        pytest.param([1, 2, 3], id="list"),
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="positive-infinity"),
        pytest.param(float("-inf"), id="negative-infinity"),
        pytest.param(True, id="bool"),
    ],
)
def test_to_candidates_never_raises_on_hostile_leaf_value(hostile_value):
    """Regression test for a review finding: a string on a fraction field
    (e.g. `"32"`) used to reach `_normalise`'s `value > 1.0` comparison
    unguarded and raise `TypeError: '>' not supported between instances of
    'str' and 'float'`. `NaN`/`Infinity` used to pass straight through as a
    normal-looking value with the same 0.75 confidence as a clean read.
    `to_candidates` must not raise on any of these, and must report every
    one of them as unreadable (value=None, confidence=0.0) rather than a
    confident-looking garbage value -- belt and braces on top of
    `vision.extract`'s own sanitisation, in case a future caller ever
    hands raw, unsanitised model output to this function directly."""
    cands = to_candidates({"moisture_content_pct": hostile_value}, "operational")
    assert cands[0].value is None
    assert cands[0].confidence == 0.0


def test_sanitize_leaf_accepts_only_finite_numbers_or_none():
    from app.ingestion.mapping import sanitize_leaf

    assert sanitize_leaf(None) is None
    assert sanitize_leaf(32) == 32.0
    assert sanitize_leaf(0.32) == 0.32
    assert sanitize_leaf("32") is None
    assert sanitize_leaf(True) is None
    assert sanitize_leaf(False) is None
    assert sanitize_leaf([1, 2]) is None
    assert sanitize_leaf({"a": 1}) is None
    assert sanitize_leaf(float("nan")) is None
    assert sanitize_leaf(float("inf")) is None
    assert sanitize_leaf(float("-inf")) is None


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


@pytest.mark.asyncio
async def test_extract_reports_string_value_as_unreadable_not_a_raise(monkeypatch, anthropic_key):
    """A model that prints a number as a quoted string must not have it
    coerced (`"10000"` -> `10000.0`) -- that is a guess -- and must not
    raise either. It is reported unreadable, same as a `null`."""
    result, _ = await _extract_with_mocked_client(
        monkeypatch, json.dumps({"wet_ore_input_tons": "10000"})
    )
    assert result["wet_ore_input_tons"] is None


@pytest.mark.asyncio
async def test_extract_reports_nested_object_as_unreadable(monkeypatch, anthropic_key):
    result, _ = await _extract_with_mocked_client(
        monkeypatch, json.dumps({"wet_ore_input_tons": {"value": 10000, "unit": "t"}})
    )
    assert result["wet_ore_input_tons"] is None


@pytest.mark.asyncio
async def test_extract_reports_bool_value_as_unreadable(monkeypatch, anthropic_key):
    """`true`/`false` must not be read as `1.0`/`0.0` -- Python's `bool` is
    an `int` subclass and would otherwise slip past a naive numeric check."""
    result, _ = await _extract_with_mocked_client(
        monkeypatch, json.dumps({"wet_ore_input_tons": True})
    )
    assert result["wet_ore_input_tons"] is None


@pytest.mark.asyncio
async def test_extract_reports_nan_as_unreadable(monkeypatch, anthropic_key):
    """`json.loads` accepts the bare `NaN` literal as a non-standard
    extension; a model emitting one must not have it treated as a real
    reading with a normal-looking confidence."""
    result, _ = await _extract_with_mocked_client(monkeypatch, '{"wet_ore_input_tons": NaN}')
    assert result["wet_ore_input_tons"] is None


@pytest.mark.asyncio
async def test_extract_reports_infinity_as_unreadable(monkeypatch, anthropic_key):
    result, _ = await _extract_with_mocked_client(monkeypatch, '{"wet_ore_input_tons": Infinity}')
    assert result["wet_ore_input_tons"] is None


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
    # Confidence is a flat constant, not model-derived -- the response says
    # so explicitly rather than letting a frontend mistake 0.75 for a real
    # per-field reliability score.
    assert body["confidenceIsPlaceholder"] is True


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


@pytest.mark.parametrize(
    "hostile_value",
    [
        pytest.param("32", id="string"),
        pytest.param({"nested": "object"}, id="nested-object"),
        pytest.param([1, 2, 3], id="list"),
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="positive-infinity"),
        pytest.param(True, id="bool"),
    ],
)
def test_documents_survives_hostile_leaf_value_from_extract(monkeypatch, hostile_value):
    """Review finding, reproduced live: a malformed model response used to
    reach `_normalise`'s `value > 1.0` comparison unguarded. A response of
    `{"moisture_content_pct": "32", ...}` made that comparison raise
    `TypeError: '>' not supported between instances of 'str' and 'float'`
    *outside* the route's `try/except ExtractionFailed` (`to_candidates`
    used to be called after the try block), so it propagated as a bare
    500. Separately, a `NaN` value used to sail through `to_candidates`
    with the same 0.75 confidence as a clean reading.

    This test bypasses `vision.extract`'s own sanitisation entirely by
    mocking `app.main.extract` to hand back the hostile value directly --
    simulating "extract() has a bug" or "a future change reopens the raw
    path" -- to prove the route's own defence (`to_candidates` inside the
    try, `mapping.sanitize_leaf` inside that) holds independently. Must be
    a 200 with the offending field marked unreadable, never a 500, and
    never a confident-looking garbage value.
    """

    async def _fake_extract(file_bytes, media_type, profile):
        return {
            "wet_ore_input_tons": 10000.0,
            "moisture_content_pct": hostile_value,
            "nickel_grade_pct": None,
            "reductant_biocoke_pct": None,
            "power_mix_captive_coal": None,
            "power_mix_hydro_grid": None,
        }

    monkeypatch.setattr("app.main.extract", _fake_extract)

    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "operational"},
    )

    assert r.status_code == 200, r.text
    body = r.json()
    hostile = next(c for c in body["candidates"] if c["field"] == "moisture_content_pct")
    assert hostile["value"] is None
    assert hostile["confidence"] == 0.0
    clean = next(c for c in body["candidates"] if c["field"] == "wet_ore_input_tons")
    assert clean["value"] == 10000.0
    assert clean["confidence"] == 0.75


# --- readings -> candidates (two-stage pipeline) -------------------------


def _twostage_doc(*, first_score: float = 0.96, second_score: float = 0.82) -> ParsedDocument:
    return ParsedDocument(
        elements=[
            Element(
                label="table",
                text="Bijih basah | 10.000 | ton",
                table_rows=None,
                score=first_score,
                page=0,
            ),
            Element(
                label="table",
                text="Bijih kering setara | 6.800 | ton",
                table_rows=None,
                score=second_score,
                page=0,
            ),
        ],
        page_count=1,
    )


def test_transcribed_reading_becomes_candidate_with_element_score_node_and_evidence():
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
        )
    }

    [candidate] = readings_to_candidates(readings, _twostage_doc())

    assert candidate.value == 10000.0
    assert candidate.confidence == pytest.approx(0.96)
    assert candidate.node == "stockpile"
    assert candidate.basis == "transcribed"
    assert candidate.evidence == "Bijih basah | 10.000 | ton"
    assert candidate.derivation == ""


def test_transcribed_reading_ignores_extraneous_derivation_fields():
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
            operands=["10.000", "6.800"],
            operation="ratio",
        )
    }

    [candidate] = readings_to_candidates(readings, _twostage_doc())

    assert candidate.value == 10000.0
    assert candidate.basis == "transcribed"
    assert candidate.derivation == ""


def test_derived_reading_carries_python_result_minimum_score_and_exact_derivation():
    readings = {
        "moisture_content_pct": FieldReading(
            basis="derived",
            evidence="Kadar air dihitung dari bijih basah dan kering",
            operands=["10.000", "6.800"],
            operation="difference_over_total",
            note="kadar air dari selisih basah dan kering",
        )
    }

    [candidate] = readings_to_candidates(readings, _twostage_doc())

    assert candidate.value == pytest.approx(0.32)
    assert candidate.confidence == pytest.approx(0.82)
    assert candidate.basis == "derived"
    assert candidate.evidence == "Kadar air dihitung dari bijih basah dan kering"
    assert candidate.source_hint == "kadar air dari selisih basah dan kering"
    assert candidate.derivation == "(10.000 − 6.800) / 10.000"


@pytest.mark.parametrize(
    ("operation", "expected"),
    [
        pytest.param("ratio", "10.000 / 6.800", id="ratio"),
        pytest.param(
            "percentage_of_total",
            "(10.000 / 6.800) × 100",
            id="percentage-of-total",
        ),
    ],
)
def test_derived_reading_uses_exact_derivation_template(operation, expected):
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="derived",
            operands=["10.000", "6.800"],
            operation=operation,
        )
    }

    [candidate] = readings_to_candidates(readings, _twostage_doc())

    assert candidate.derivation == expected


@pytest.mark.parametrize(
    "reading",
    [
        pytest.param(
            FieldReading(
                basis="derived",
                operands=["10.000", "6.800"],
                operation="unknown_operation",
            ),
            id="unknown-operation",
        ),
        pytest.param(
            FieldReading(
                basis="derived",
                operands=["10.000"],
                operation="ratio",
            ),
            id="wrong-operand-count",
        ),
    ],
)
def test_invalid_derivation_has_no_rendered_derivation(reading):
    [candidate] = readings_to_candidates(
        {"wet_ore_input_tons": reading},
        _twostage_doc(),
    )

    assert candidate.value is None
    assert candidate.derivation == ""


def test_ungrounded_reading_becomes_blank_candidate_not_a_guess():
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
    assert candidate.derivation == ""


def test_readings_candidate_has_no_accepted_member():
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
        )
    }

    [candidate] = readings_to_candidates(readings, _twostage_doc())

    assert not hasattr(candidate, "accepted")


@pytest.mark.parametrize(
    ("printed_value", "expected"),
    [
        pytest.param("15", 0.15, id="percentage-normalised"),
        pytest.param("1", 1.0, id="one-unchanged"),
        pytest.param("0,32", 0.32, id="below-one-unchanged"),
    ],
)
def test_readings_percentage_normalisation_preserves_boundary(printed_value, expected):
    evidence = f"Substitusi biokokas | {printed_value} | %"
    doc = ParsedDocument(
        elements=[
            Element(
                label="table",
                text=evidence,
                table_rows=None,
                score=0.9,
                page=0,
            )
        ],
        page_count=1,
    )
    readings = {
        "reductant_biocoke_pct": FieldReading(
            basis="transcribed",
            evidence=evidence,
            raw_value=printed_value,
        )
    }

    [candidate] = readings_to_candidates(readings, doc)

    assert candidate.value == pytest.approx(expected)


def test_readings_unknown_field_is_dropped():
    readings = {
        "totally_unknown_field": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
        )
    }

    assert readings_to_candidates(readings, _twostage_doc()) == []


def test_non_finite_helpy_score_maps_to_fail_safe_zero_confidence():
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
        )
    }

    [candidate] = readings_to_candidates(
        readings,
        _twostage_doc(first_score=float("nan")),
    )

    assert candidate.value == 10000.0
    assert candidate.confidence == 0.0


def test_candidate_response_serialises_new_members_with_camel_case_aliases():
    response = CandidateResponse(
        field="wet_ore_input_tons",
        value=10000.0,
        confidence=0.96,
        node="stockpile",
        source_hint="tercetak",
        basis="transcribed",
        evidence="Bijih basah | 10.000 | ton",
        derivation="",
    )

    assert response.model_dump(by_alias=True) == {
        "field": "wet_ore_input_tons",
        "value": 10000.0,
        "confidence": 0.96,
        "node": "stockpile",
        "sourceHint": "tercetak",
        "basis": "transcribed",
        "evidence": "Bijih basah | 10.000 | ton",
        "derivation": "",
    }
    assert "accepted" not in response.model_dump(by_alias=True)


def test_document_extraction_confidence_remains_conservatively_placeholder():
    response = DocumentExtractionResponse(candidates=[])

    assert response.model_dump(by_alias=True)["confidenceIsPlaceholder"] is True
