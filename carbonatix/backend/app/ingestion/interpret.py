"""Stage 2: identify which printed document figures map to requested fields.

GPT-5.6 Sol points to verbatim figures only. It never computes a value:
derived readings contain printed operands and a closed operation name for the
pure-Python verification stage to evaluate later.
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
# Compact schema-constrained JSON only; truncation fails loudly rather than
# returning partial fields. This is a cost ceiling, not a live-measured fit.
_MAX_COMPLETION_TOKENS = 8000
_TIMEOUT_SECONDS = 60.0


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
   "raw_value": angkanya PERSIS seperti tercetak (contoh: "10.000", "1,8",
   "15%", atau "15" bila satuan % terpisah).
2. "derived" — angkanya tidak tercetak, tetapi dapat dihitung. Sertakan
   "operands": daftar angka PERSIS seperti tercetak di dokumen, dan
   "operation": salah satu dari "difference_over_total", "ratio",
   "percentage_of_total". JANGAN menghitung hasil derivasi.
3. null — medan tidak ada di dokumen atau Anda tidak yakin.

Aturan mutlak:
- Setiap "evidence", "raw_value", dan setiap operand HARUS disalin karakter
  demi karakter dari dokumen di atas.
- JANGAN mengarang angka. JANGAN menghitung hasil derivasi.
- Bila ragu, kembalikan null. Medan kosong lebih baik daripada medan salah.

Balas HANYA JSON dengan objek tingkat atas "fields" dalam bentuk:
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

    operands = raw.get("operands")
    if not isinstance(operands, list) or not all(
        isinstance(operand, str) for operand in operands
    ):
        operands = []

    evidence = raw.get("evidence")
    raw_value = raw.get("raw_value")
    operation = raw.get("operation")
    note = raw.get("note")
    return FieldReading(
        basis=basis,
        evidence=evidence if isinstance(evidence, str) else "",
        raw_value=raw_value if isinstance(raw_value, str) else None,
        operands=operands,
        operation=operation if isinstance(operation, str) else "",
        note=note if isinstance(note, str) else "",
    )


async def interpret(doc: ParsedDocument, profile: str) -> dict[str, FieldReading]:
    """Return exactly one fail-safe reading for every field in `profile`."""
    fields = FIELDS_BY_PROFILE[profile]

    api_key = os.environ.get("ELICE_API_KEY")
    if not api_key:
        raise ExtractionFailed(
            "Document interpretation is not configured: ELICE_API_KEY is not set"
        )
    base_url = os.environ.get("ELICE_BASE_URL")
    if not base_url:
        raise ExtractionFailed(
            "Document interpretation is not configured: ELICE_BASE_URL is not set"
        )

    prompt = _TEMPLATE.format(
        document=doc.full_text(),
        fields="\n".join(f"- {name}" for name in fields),
    )

    try:
        async with AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=_TIMEOUT_SECONDS,
        ) as client:
            response = await client.chat.completions.create(
                model=_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_completion_tokens=_MAX_COMPLETION_TOKENS,
                reasoning_effort=_REASONING_EFFORT,
                response_format={"type": "json_object"},
            )

        choice = response.choices[0]
        if choice.finish_reason == "length":
            raise ValueError(
                f"Model output was truncated at {_MAX_COMPLETION_TOKENS} tokens"
            )
        content = choice.message.content
        if not content:
            raise ValueError("Model returned an empty completion")

        payload = json.loads(content)
        if not isinstance(payload, dict):
            raise TypeError("Model reply was not a JSON object")
        raw_fields = payload.get("fields")
        if not isinstance(raw_fields, dict):
            raise TypeError("Model reply had no top-level 'fields' object")
    except ExtractionFailed:
        raise
    except Exception as exc:
        raise ExtractionFailed(str(exc)) from exc

    return {name: _reading_from(raw_fields.get(name)) for name in fields}
