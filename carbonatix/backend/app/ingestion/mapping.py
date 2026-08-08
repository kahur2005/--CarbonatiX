"""Map verified field readings onto twin-node candidates.

A candidate is never a value. The user accepts or corrects every one,
because the difference between OCR that speeds up data entry and OCR that
silently fabricates a plant's carbon footprint is exactly this step: there
is no "accepted" field on `Candidate` and no function anywhere in this
package that writes a candidate into a company profile or a run.
"""

from dataclasses import dataclass

__all__ = [
    "FIELDS_BY_PROFILE",
    "NODE_FOR_FIELD",
    "Candidate",
    "readings_to_candidates",
]

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
# interpret.py imports this rather than keeping its own list, so the fields the
# model is ever asked for can never drift from the fields that have a twin
# node to land in.
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


def _normalise(field: str, value: float | None) -> float | None:
    """Convert a percentage to a fraction when the document used one.

    A value above 1.0 on a fraction field can only be a percentage: no
    physical fraction exceeds 1. Below (or at) 1.0 it is already a fraction
    and is left untouched, since dividing it again would silently corrupt a
    correctly-reported value. Verification supplies either `None` or a finite
    number; this function does not itself repeat those checks.
    """
    if value is None or field not in _FRACTION_FIELDS:
        return value
    return value / 100.0 if value > 1.0 else value


_OPERATION_TEMPLATES = {
    "difference_over_total": "({a} − {b}) / {a}",
    "ratio": "{a} / {b}",
    "percentage_of_total": "({a} / {b}) × 100",
}


def _derivation_text(reading) -> str:
    """Render a two-operand derivation for display beside its value."""
    template = _OPERATION_TEMPLATES.get(reading.operation)
    if template is None or len(reading.operands) != 2:
        return ""
    return template.format(a=reading.operands[0], b=reading.operands[1])


def readings_to_candidates(readings: dict, doc) -> list[Candidate]:
    """Convert verified stage-2 readings into user-review candidates.

    Verification runs before candidate construction. An ungrounded figure
    becomes a blank candidate for manual entry rather than a guessed value.
    The import stays local because `interpret` imports this module's profile
    field map.
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
                derivation=(
                    _derivation_text(reading)
                    if value is not None and reading.basis == "derived"
                    else ""
                ),
            )
        )
    return out
