"""Map raw extracted fields onto twin-node candidates.

A candidate is never a value. The user accepts or corrects every one,
because the difference between OCR that speeds up data entry and OCR that
silently fabricates a plant's carbon footprint is exactly this step: there
is no "accepted" field on `Candidate` and no function anywhere in this
package that writes a candidate into a company profile or a run.
"""

import math
from dataclasses import dataclass

__all__ = ["FIELDS_BY_PROFILE", "NODE_FOR_FIELD", "Candidate", "sanitize_leaf", "to_candidates"]

# Every one of the nine inputs belongs to exactly one process stage in the
# 3D digital twin (PRD 13.1). The twin is the input interface: clicking a
# node opens the panel that holds that node's parameters, so a field absent
# from this map could never be entered by a user, and a field mapped twice
# would be ambiguous about which panel it belongs to. `test_ingestion.py`
# guards both directions.
NODE_FOR_FIELD: dict[str, str] = {
    "wet_ore_input_tons": "stockpile",
    "moisture_content_pct": "stockpile",
    "nickel_grade_pct": "stockpile",
    "dryer_thermal_efficiency": "dryer",
    "reductant_biocoke_pct": "kiln",
    "sec_eaf_kwh_per_t_alloy": "eaf",
    "power_mix_captive_coal": "pltu",
    "power_mix_hydro_grid": "pltu",
    "ef_captive_pltu": "pltu",
}

# Single source of truth for which fields belong to which document profile.
# vision.py imports this rather than keeping its own list, so the fields the
# model is ever asked for can never drift from the fields that have a twin
# node to land in -- a field with nowhere to go would otherwise be extracted
# and then silently dropped by `to_candidates` below.
FIELDS_BY_PROFILE: dict[str, list[str]] = {
    "operational": [
        "wet_ore_input_tons",
        "moisture_content_pct",
        "nickel_grade_pct",
        "reductant_biocoke_pct",
        "power_mix_captive_coal",
        "power_mix_hydro_grid",
    ],
    "site_spec": [
        "ef_captive_pltu",
        "dryer_thermal_efficiency",
        "sec_eaf_kwh_per_t_alloy",
    ],
}

# Fields a document may express as "32%" but which the API needs as 0.32.
_FRACTION_FIELDS = frozenset(
    {
        "moisture_content_pct",
        "nickel_grade_pct",
        "reductant_biocoke_pct",
        "power_mix_captive_coal",
        "power_mix_hydro_grid",
        "dryer_thermal_efficiency",
    }
)


@dataclass(frozen=True)
class Candidate:
    """One extracted field awaiting user verification.

    Deliberately has no `accepted` field: acceptance is a user action that
    happens elsewhere (the twin-node panel), never a state this object can
    carry or flip itself.
    """

    field: str
    value: float | None
    confidence: float
    node: str
    source_hint: str = ""


def sanitize_leaf(value: object) -> float | None:
    """Reduce a raw extracted leaf to a finite number or `None`, never
    anything else.

    A leaf coming out of a JSON parse is not guaranteed to be the number
    this module expects: a hostile or malformed model response can hand
    back a string, a nested object, a list, `NaN`/`Infinity` (both of
    which `json.loads` accepts as an extension), or a bare `bool` (`True`/
    `False` are `int` subclasses in Python and would otherwise slip past an
    `isinstance(x, (int, float))` check as `1`/`0`). None of those are a
    reading. Coercing one -- turning the string `"32"` into `32.0` -- is
    exactly the kind of guess this module refuses to make, so every one of
    them is treated identically to a field the model did not report:
    `None`. This is what keeps `_normalise`'s `value > 1.0` comparison safe
    from ever seeing a non-number.
    """
    if value is None or isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return numeric if math.isfinite(numeric) else None


def _normalise(field: str, value: float | None) -> float | None:
    """Convert a percentage to a fraction when the document used one.

    A value above 1.0 on a fraction field can only be a percentage: no
    physical fraction exceeds 1. Below (or at) 1.0 it is already a fraction
    and is left untouched, since dividing it again would silently corrupt a
    correctly-reported value. Callers must pass a value already run through
    `sanitize_leaf` -- this function assumes `value` is `None` or a finite
    number and does not itself guard against anything else.
    """
    if value is None or field not in _FRACTION_FIELDS:
        return value
    return value / 100.0 if value > 1.0 else value


def to_candidates(
    raw: dict[str, object],
    profile: str,
    *,
    confidences: dict[str, float] | None = None,
    hints: dict[str, str] | None = None,
) -> list[Candidate]:
    """Turn a raw extraction into candidates awaiting user review.

    A field with no twin node (i.e. not in `NODE_FOR_FIELD`) is dropped: it
    could never be placed in the twin UI and so could never be reviewed. A
    field the model could not read, or reported as something other than a
    finite number (see `sanitize_leaf`), is kept with `value=None` and
    `confidence=0.0` -- it is surfaced for the user to fill in by hand,
    never guessed, never fabricated by coercion, and never silently
    omitted. This sanitisation runs here as well as in `vision.extract`
    (belt and braces): this function must not raise no matter what a
    caller hands it in `raw`, since a crash here would surface as a 500 on
    `/documents` for one malformed field in an otherwise-readable document.
    """
    confidences = confidences or {}
    hints = hints or {}
    out: list[Candidate] = []
    for field, raw_value in raw.items():
        node = NODE_FOR_FIELD.get(field)
        if node is None:
            continue
        value = sanitize_leaf(raw_value)
        out.append(
            Candidate(
                field=field,
                value=_normalise(field, value),
                confidence=0.0 if value is None else confidences.get(field, 0.75),
                node=node,
                source_hint=hints.get(field, ""),
            )
        )
    return out
