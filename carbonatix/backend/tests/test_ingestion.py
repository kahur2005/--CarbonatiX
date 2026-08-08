"""Two-stage document ingestion and candidate mapping."""

import math
import uuid
from io import BytesIO

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

from app.auth import current_user_id
from app.ingestion.document_vision import Element, ExtractionFailed, ParsedDocument
from app.ingestion.interpret import FieldReading
from app.ingestion.mapping import NODE_FOR_FIELD, Candidate, readings_to_candidates
from app.main import app, post_document
from app.schemas import CandidateResponse, DocumentExtractionResponse

USER = uuid.uuid4()
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
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
    [candidate] = readings_to_candidates(
        {"moisture_content_pct": FieldReading()},
        ParsedDocument(elements=[], page_count=1),
    )

    assert candidate.value is None
    assert candidate.confidence == 0.0


def test_low_confidence_is_flagged_not_dropped():
    evidence = "Kadar nikel | 0,018"
    doc = ParsedDocument(
        elements=[Element("table", evidence, None, 0.3, 0)],
        page_count=1,
    )
    [candidate] = readings_to_candidates(
        {
            "nickel_grade_pct": FieldReading(
                basis="transcribed",
                evidence=evidence,
                raw_value="0,018",
            )
        },
        doc,
    )

    assert candidate.confidence == 0.3
    assert candidate.value == 0.018


def test_candidates_are_never_marked_accepted():
    """No code path may write an extracted value without an explicit user
    accept. This test is the guard on that rule."""
    [candidate] = readings_to_candidates(
        {"wet_ore_input_tons": FieldReading()},
        ParsedDocument(elements=[], page_count=1),
    )
    assert not hasattr(candidate, "accepted")


def test_percentages_are_normalised_to_fractions():
    """A document saying '32%' must arrive as 0.32, never 32."""
    evidence = "Kadar air | 32 | %"
    doc = ParsedDocument(
        elements=[Element("table", evidence, None, 0.9, 0)],
        page_count=1,
    )
    [candidate] = readings_to_candidates(
        {
            "moisture_content_pct": FieldReading(
                basis="transcribed",
                evidence=evidence,
                raw_value="32",
            )
        },
        doc,
    )
    assert candidate.value == pytest.approx(0.32)


def test_percentage_at_or_below_one_is_left_alone():
    """0.32 is already a fraction; dividing it again would be a second,
    silent corruption of the same field."""
    evidence = "Kadar air | 0,32"
    doc = ParsedDocument(
        elements=[Element("table", evidence, None, 0.9, 0)],
        page_count=1,
    )
    [candidate] = readings_to_candidates(
        {
            "moisture_content_pct": FieldReading(
                basis="transcribed",
                evidence=evidence,
                raw_value="0,32",
            )
        },
        doc,
    )
    assert candidate.value == pytest.approx(0.32)


def test_unmapped_field_is_dropped_not_fabricated_into_a_candidate():
    """A reading with no twin node is dropped rather than surfaced as an
    uneditable, unplaceable candidate."""
    assert (
        readings_to_candidates(
            {"totally_unknown_field": FieldReading()},
            ParsedDocument(elements=[], page_count=1),
        )
        == []
    )


def test_candidate_has_no_accepted_field_at_all():
    """The dataclass itself carries no acceptance flag -- there is nothing
    to flip to True by mistake."""
    field_names = {f for f in Candidate.__dataclass_fields__}
    assert "accepted" not in field_names


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


def test_documents_rejects_unknown_profile_without_provider_calls(monkeypatch):
    async def _must_not_parse(*args, **kwargs):
        pytest.fail("parse must not run for an unknown profile")

    async def _must_not_interpret(*args, **kwargs):
        pytest.fail("interpret must not run for an unknown profile")

    monkeypatch.setattr("app.main.parse_document", _must_not_parse, raising=False)
    monkeypatch.setattr("app.main.interpret_fields", _must_not_interpret, raising=False)

    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "not_a_real_profile"},
    )
    assert r.status_code == 422


def test_documents_runs_two_stage_pipeline_and_returns_enriched_unaccepted_candidates(
    monkeypatch,
):
    calls = []
    parsed = ParsedDocument(
        elements=[Element("table", "Bijih basah | 10.000 | ton", None, 0.96, 0)],
        page_count=1,
    )
    readings = {
        "wet_ore_input_tons": FieldReading(
            basis="transcribed",
            evidence="Bijih basah | 10.000 | ton",
            raw_value="10.000",
            note="tabel produksi",
        )
    }

    async def _fake_parse(file_bytes, media_type, filename):
        calls.append(("parse", file_bytes, media_type, filename))
        return parsed

    async def _fake_interpret(doc, profile):
        calls.append(("interpret", doc, profile))
        return readings

    def _fake_mapping(actual_readings, doc):
        calls.append(("map", actual_readings, doc))
        return [
            Candidate(
                field="wet_ore_input_tons",
                value=10000.0,
                confidence=0.96,
                node="stockpile",
                source_hint="tabel produksi",
                basis="transcribed",
                evidence="Bijih basah | 10.000 | ton",
                derivation="",
            )
        ]

    async def _must_not_write(*args, **kwargs):
        pytest.fail("document route must not persist candidates")

    monkeypatch.setattr("app.main.parse_document", _fake_parse, raising=False)
    monkeypatch.setattr("app.main.interpret_fields", _fake_interpret, raising=False)
    monkeypatch.setattr("app.main.readings_to_candidates", _fake_mapping, raising=False)
    monkeypatch.setattr("app.companies.save", _must_not_write)
    monkeypatch.setattr("app.runs.commit", _must_not_write)

    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "operational"},
    )
    assert r.status_code == 200
    body = r.json()
    assert [call[0] for call in calls] == ["parse", "interpret", "map"]
    assert calls[0][1:] == (b"fake", "image/png", "report.png")
    assert calls[1][1:] == (parsed, "operational")
    assert calls[2][1:] == (readings, parsed)
    assert body["candidates"] == [
        {
            "field": "wet_ore_input_tons",
            "value": 10000.0,
            "confidence": 0.96,
            "node": "stockpile",
            "sourceHint": "tabel produksi",
            "basis": "transcribed",
            "evidence": "Bijih basah | 10.000 | ton",
            "derivation": "",
        }
    ]
    assert math.isfinite(body["candidates"][0]["confidence"])
    assert "accepted" not in body["candidates"][0]
    assert body["confidenceIsPlaceholder"] is True


@pytest.mark.asyncio
async def test_documents_uses_parse_fallbacks_for_missing_content_type_and_filename(monkeypatch):
    captured = {}

    async def _fake_parse(file_bytes, media_type, filename):
        captured["args"] = (file_bytes, media_type, filename)
        return ParsedDocument(elements=[], page_count=0)

    async def _fake_interpret(doc, profile):
        return {}

    monkeypatch.setattr("app.main.parse_document", _fake_parse, raising=False)
    monkeypatch.setattr("app.main.interpret_fields", _fake_interpret, raising=False)
    monkeypatch.setattr("app.main.readings_to_candidates", lambda readings, doc: [], raising=False)

    response = await post_document(
        file=UploadFile(file=BytesIO(b"fake"), filename=None),
        profile="operational",
        user_id=USER,
    )

    assert response.candidates == []
    assert captured["args"] == (b"fake", "application/pdf", "document")


def test_documents_rejects_upload_above_20_mb_before_provider_calls(monkeypatch):
    async def _must_not_parse(*args, **kwargs):
        pytest.fail("parse must not run for an oversized upload")

    async def _must_not_interpret(*args, **kwargs):
        pytest.fail("interpret must not run for an oversized upload")

    monkeypatch.setattr("app.main.parse_document", _must_not_parse, raising=False)
    monkeypatch.setattr("app.main.interpret_fields", _must_not_interpret, raising=False)

    r = client.post(
        "/documents",
        files={"file": ("report.pdf", b"x" * (MAX_UPLOAD_BYTES + 1), "application/pdf")},
        data={"profile": "operational"},
    )

    assert r.status_code == 413
    assert r.json() == {"detail": "Dokumen terlalu besar. Maksimum 20 MB."}


def test_documents_allows_upload_of_exactly_20_mb(monkeypatch):
    captured = {}

    async def _fake_parse(file_bytes, media_type, filename):
        captured["size"] = len(file_bytes)
        return ParsedDocument(elements=[], page_count=0)

    async def _fake_interpret(doc, profile):
        return {}

    monkeypatch.setattr("app.main.parse_document", _fake_parse, raising=False)
    monkeypatch.setattr("app.main.interpret_fields", _fake_interpret, raising=False)
    monkeypatch.setattr("app.main.readings_to_candidates", lambda readings, doc: [], raising=False)

    r = client.post(
        "/documents",
        files={"file": ("report.pdf", b"x" * MAX_UPLOAD_BYTES, "application/pdf")},
        data={"profile": "operational"},
    )

    assert r.status_code == 200
    assert captured["size"] == MAX_UPLOAD_BYTES


def test_documents_returns_502_when_parse_fails(monkeypatch):
    async def _fake_parse(file_bytes, media_type, filename):
        raise ExtractionFailed("Helpy returned garbage")

    async def _must_not_interpret(*args, **kwargs):
        pytest.fail("interpret must not run after parse failure")

    monkeypatch.setattr("app.main.parse_document", _fake_parse, raising=False)
    monkeypatch.setattr("app.main.interpret_fields", _must_not_interpret, raising=False)

    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "operational"},
    )
    assert r.status_code == 502
    assert "manually" in r.text.lower()


def test_documents_returns_502_when_interpretation_fails(monkeypatch):
    async def _fake_parse(file_bytes, media_type, filename):
        return ParsedDocument(elements=[], page_count=1)

    async def _fake_interpret(doc, profile):
        raise ExtractionFailed("model returned garbage")

    monkeypatch.setattr("app.main.parse_document", _fake_parse, raising=False)
    monkeypatch.setattr("app.main.interpret_fields", _fake_interpret, raising=False)

    r = client.post(
        "/documents",
        files={"file": ("report.png", b"fake", "image/png")},
        data={"profile": "operational"},
    )

    assert r.status_code == 502
    assert "manually" in r.text.lower()


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
