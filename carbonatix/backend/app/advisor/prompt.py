"""Prompt assembly and the numeral guard.

The model never produces its own figures. Every number it may use appears in
the prompt, and every numeral in its output is checked against that set --
`build_prompt` computes the permitted set, `unsupported_numerals` checks
against it. Together they are the second safety mechanism; the first is
verbatim clause injection (see `corpus.py`).
"""

import re

from ..emissions.calculator import EmissionResult
from ..emissions.compliance import CompliancePosition
from .corpus import PLACEHOLDER_SENTINEL, Clause, has_placeholder_text

__all__ = ["build_prompt", "has_placeholder_text", "unsupported_numerals"]

_NUMERAL = re.compile(r"\d[\d.,]*")

_TEMPLATE = """Anda adalah penasihat kepatuhan karbon untuk smelter nikel RKEF di Indonesia.

ANGKA YANG TERSEDIA (gunakan HANYA angka-angka ini; jangan menghitung atau mengarang angka lain):
{figures}

KLAUSA REGULASI (dikutip verbatim; rujuk dengan nomor pasal):
{regulation_notice}{clauses}

Tugas Anda: susun rekomendasi strategis dalam Bahasa Indonesia yang menimbang
posisi karbon terhadap harga pasar, dengan rujukan pasal yang tepat.

Aturan mutlak:
- Jangan menyebut angka apa pun yang tidak ada dalam daftar di atas.
- Kutip pasal persis seperti tertulis. Jangan memparafrasa klausa hukum.
- Nyatakan secara eksplisit bahwa PLTU captive saat ini di luar cakupan wajib
  PTBAE-PU, sehingga status ini bersifat kesiapan, bukan pelanggaran berlaku.
"""

# Shown in place of a genuine "cite this as law" instruction whenever the
# clauses being injected still carry PLACEHOLDER_SENTINEL. Without this, a
# placeholder clause would sit in the prompt looking exactly like a verbatim
# citation, and the model has no way to tell the difference on its own.
_PLACEHOLDER_WARNING = (
    "PERINGATAN: Setiap teks klausa pada bagian KLAUSA REGULASI di bawah ini "
    "adalah TEKS PLACEHOLDER sementara, BUKAN kutipan pasal yang sah dari "
    "regulasi asli. JANGAN mengutip nomor pasal seolah-olah teks placeholder "
    "ini adalah bunyi hukum yang otoritatif, dan JANGAN mendasarkan isi "
    "rekomendasi Anda pada isi klausa tersebut. Nyatakan secara eksplisit "
    "kepada pengguna bahwa rujukan regulasi dalam jawaban ini belum dapat "
    "diverifikasi karena teks pasal asli belum tersedia.\n\n"
)


def _clauses_are_placeholder(clauses: list[Clause]) -> bool:
    """Whether any of the specific clauses being injected into *this*
    prompt still carry placeholder text, as opposed to the corpus-wide
    `has_placeholder_text()` (which Task 14 uses for the response-level
    flag). The two agree today because the whole corpus is placeholder, but
    this checks the clauses actually selected for this prompt so the
    behaviour stays correct once clauses are fixed one at a time."""
    return any(PLACEHOLDER_SENTINEL in c.text for c in clauses)


def _canonical(token: str) -> str:
    """Normalise a numeral so locale-varied renderings of the same value
    compare equal, without conflating a genuine fraction with an unrelated
    integer.

    Indonesian convention groups thousands with '.' and marks the decimal
    with ',' -- the reverse of the plain `:.1f`/`:.0f` formatting this module
    uses when it writes the permitted-figures block. A single separator is
    only treated as a thousands grouping when every group it produces has
    the classic shape (a 1-3 digit leading group, then one or more exact
    3-digit groups) -- the pattern this module itself never produces as a
    genuine fraction, since every figure it emits carries zero or one
    fractional digit. Anything else is treated as a decimal point, so
    "1234.5" keeps its fraction and is never silently fused into the
    unrelated integer "12345".
    """
    if not token:
        return "0"

    def is_thousands_grouping(parts: list[str]) -> bool:
        if len(parts) < 2 or not all(p.isdigit() for p in parts):
            return False
        return len(parts[0]) in (1, 2, 3) and all(len(p) == 3 for p in parts[1:])

    if "." in token and "," in token:
        # Whichever separator sits closer to the end of the string is the
        # decimal point; the other one is grouping thousands.
        decimal_char = "." if token.rindex(".") > token.rindex(",") else ","
        thousands_char = "," if decimal_char == "." else "."
        token = token.replace(thousands_char, "")
        if decimal_char == ",":
            token = token.replace(",", ".")
    elif "," in token and is_thousands_grouping(token.split(",")):
        token = token.replace(",", "")
    elif "," in token:
        token = token.replace(",", ".")
    elif "." in token and is_thousands_grouping(token.split(".")):
        token = token.replace(".", "")
    # else: a lone '.' that is not a 3-digit grouping is already a decimal
    # point in the format this module itself emits, so it is left alone.

    if "." in token:
        whole, _, frac = token.partition(".")
        frac = frac.rstrip("0")
        token = f"{whole}.{frac}" if frac else whole

    whole, sep, frac = token.partition(".")
    whole = whole.lstrip("0") or "0"
    return f"{whole}.{frac}" if sep else whole


def build_prompt(
    result: EmissionResult,
    position: CompliancePosition,
    forecast: dict,
    clauses: list[Clause],
) -> tuple[str, set[str]]:
    """Assemble the prompt and the set of numerals the model may use."""
    figures = {
        "Total emisi (tCO2e)": f"{result.total_emissions:.1f}",
        "Scope 1 (tCO2e)": f"{result.scope_1:.1f}",
        "Scope 2 (tCO2e)": f"{result.scope_2:.1f}",
        "Produksi nikel (ton)": f"{result.nickel_output_tons:.1f}",
        "Kuota (tCO2e)": f"{position.cap_tco2e:.1f}",
        "Posisi karbon (tCO2e)": f"{position.position_tco2e:.1f}",
        "Nilai posisi (IDR)": f"{position.position_value_idr:.0f}",
        "Harga karbon IDX (IDR/ton)": f"{forecast['idxCarbonIdrPerTon'][0]:.0f}",
        "Harga nikel LME (USD/ton)": f"{forecast['lmeUsdPerTon'][0]:.0f}",
    }
    if result.intensity_per_tonne_ni is not None:
        figures["Intensitas (tCO2e/tNi)"] = f"{result.intensity_per_tonne_ni:.1f}"

    figures_block = "\n".join(f"- {k}: {v}" for k, v in figures.items())
    clauses_block = "\n\n".join(f"[{c.ref}] {c.title}\n{c.text}" for c in clauses)
    regulation_notice = _PLACEHOLDER_WARNING if _clauses_are_placeholder(clauses) else ""

    permitted = {v for v in figures.values()}
    permitted |= {_canonical(v) for v in figures.values()}
    # Article numbers appearing in the citations (e.g. "16" and "2022" in
    # "Permen ESDM 16/2022") are legitimate numerals the model may repeat
    # when naming a clause, and must not be flagged.
    for c in clauses:
        permitted |= {_canonical(m) for m in _NUMERAL.findall(c.ref)}

    text = _TEMPLATE.format(
        figures=figures_block,
        regulation_notice=regulation_notice,
        clauses=clauses_block,
    )
    return text, permitted


def unsupported_numerals(output: str, permitted: set[str]) -> set[str]:
    """Numerals in the output that were not supplied. Non-empty means the
    recommendation is flagged, not shipped as advice."""
    found = set()
    for token in _NUMERAL.findall(output):
        canonical = _canonical(token)
        if token in permitted or canonical in permitted:
            continue
        # Single- and double-digit numbers are ordinals, dates and list
        # markers far more often than fabricated quantities. Counted on
        # digits alone (a decimal point in `canonical` must not inflate the
        # count and let a two-digit fraction like "1.5" slip past as if it
        # were three digits long).
        if len(canonical.replace(".", "")) <= 2:
            continue
        found.add(token)
    return found
