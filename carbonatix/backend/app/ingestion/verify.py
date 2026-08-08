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

_ID_NUMBER = re.compile(r"-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?%?")


def parse_id_number(text: str) -> float | None:
    """An Indonesian-formatted number as a float, or None if it is not one.

    Indonesian groups thousands with '.' and marks decimals with ',' -- the
    reverse of Python's literal syntax, which is why `float()` cannot be
    used directly and why `10.000` must never come back as 10.0.
    """
    if not isinstance(text, str):
        return None
    token = text.strip()
    if _ID_NUMBER.fullmatch(token) is None:
        return None
    token = token.removesuffix("%").replace(".", "").replace(",", ".")
    try:
        value = float(token)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _contains_number_token(needle: str, haystack: str) -> bool:
    """Whether a complete Indonesian numeral token occurs in `haystack`."""
    if parse_id_number(needle) is None:
        return False
    escaped = re.escape(needle)
    if needle.endswith("%"):
        suffix = r"(?![\w.,+-]|[.,]\d)"
    else:
        # A bare numeral may ground against an immediately attached percent sign,
        # but must not be carved out of a longer number such as `115%`.
        suffix = r"(?:%|)(?![\w%]|[.,]\d)"
    pattern = re.compile(rf"(?<![\w.,%+-]){escaped}{suffix}")
    return pattern.search(haystack) is not None


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
        if not reading.raw_value or not _contains_number_token(
            reading.raw_value, reading.evidence
        ):
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
            if not _contains_number_token(operand, text):
                return None, 0.0
            parsed = parse_id_number(operand)
            if parsed is None:
                return None, 0.0
            values.append(parsed)
        result = _compute(reading.operation, values)
        if result is None:
            return None, 0.0
        return result, min(_score_for_number(o, doc) for o in reading.operands)

    return None, 0.0


def _score_for(needle: str, doc: Any) -> float:
    """The score of the element the text came from.

    Element-level, not field-level: a table scoring 0.96 says the table was
    read cleanly, not that this particular cell was. That caveat is why
    `confidence_is_placeholder` stays True on the wire (see schemas.py).
    """
    for element in doc.elements:
        if needle in element.text:
            return element.score if math.isfinite(element.score) else 0.0
    return 0.0


def _score_for_number(needle: str, doc: Any) -> float:
    for element in doc.elements:
        if _contains_number_token(needle, element.text):
            return element.score if math.isfinite(element.score) else 0.0
    return 0.0
