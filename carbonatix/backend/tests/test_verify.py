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


@pytest.mark.parametrize("malformed", ["12.34", "1,234.56", "abc123xyz"])
def test_malformed_or_non_indonesian_numbers_are_rejected(malformed):
    assert verify.parse_id_number(malformed) is None


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


def test_transcribed_value_cannot_be_carved_from_a_larger_printed_number():
    evidence = "Bijih basah diterima | 10.000 | ton"
    reading = _Reading(basis="transcribed", evidence=evidence, raw_value="1")
    assert verify.verified_value(reading, _doc(evidence)) == (None, 0.0)


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


def test_derived_operand_cannot_be_carved_from_a_larger_printed_number():
    doc = _doc("Bijih basah | 10.000 | ton")
    reading = _Reading(
        basis="derived",
        operands=["1", "10.000"],
        operation="ratio",
    )
    assert verify.verified_value(reading, doc) == (None, 0.0)


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


@pytest.mark.parametrize("score", [math.nan, math.inf, -math.inf])
def test_non_finite_element_confidence_fails_safe_to_zero(score):
    evidence = "Kadar air umpan | 85 | %"
    doc = ParsedDocument(
        elements=[
            Element(
                label="text",
                text=evidence,
                table_rows=None,
                score=score,
                page=0,
            )
        ],
        page_count=1,
    )
    reading = _Reading(basis="transcribed", evidence=evidence, raw_value="85")
    assert verify.verified_value(reading, doc) == (85.0, 0.0)
