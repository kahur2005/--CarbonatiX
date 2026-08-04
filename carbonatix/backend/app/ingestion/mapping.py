"""Map raw extracted fields onto twin-node candidates.

A candidate is never a value. The user accepts or corrects every one,
because the difference between OCR that speeds up data entry and OCR that
silently fabricates a plant's carbon footprint is exactly this step: there
is no "accepted" field on `Candidate` and no function anywhere in this
package that writes a candidate into a company profile or a run.
"""

from dataclasses import dataclass

__all__ = ["FIELDS_BY_PROFILE", "NODE_FOR_FIELD", "Candidate", "to_candidates"]

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


def _normalise(field: str, value: float | None) -> float | None:
    """Convert a percentage to a fraction when the document used one.

    A value above 1.0 on a fraction field can only be a percentage: no
    physical fraction exceeds 1. Below (or at) 1.0 it is already a fraction
    and is left untouched, since dividing it again would silently corrupt a
    correctly-reported value.
    """
    if value is None or field not in _FRACTION_FIELDS:
        return value
    return value / 100.0 if value > 1.0 else value


def to_candidates(
    raw: dict[str, float | None],
    profile: str,
    *,
    confidences: dict[str, float] | None = None,
    hints: dict[str, str] | None = None,
) -> list[Candidate]:
    """Turn a raw extraction into candidates awaiting user review.

    A field with no twin node (i.e. not in `NODE_FOR_FIELD`) is dropped: it
    could never be placed in the twin UI and so could never be reviewed. A
    field the model could not read is kept, with `value=None` and
    `confidence=0.0` -- it is surfaced for the user to fill in by hand, never
    guessed and never silently omitted.
    """
    confidences = confidences or {}
    hints = hints or {}
    out: list[Candidate] = []
    for field, value in raw.items():
        node = NODE_FOR_FIELD.get(field)
        if node is None:
            continue
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
