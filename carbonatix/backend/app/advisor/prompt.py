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

# Marks a `permitted` entry as a citation reference rather than a supplied
# figure. Never collides with a real numeral: entries produced from figures
# are pure digit/separator strings, so a letter-prefixed marker is always
# distinguishable. See `unsupported_numerals` for how these gate citation
# spans instead of permitting the ref's digits everywhere in the output.
_CITATION_PREFIX = "ref::"

# Indonesian magnitude words. A digit immediately followed by one of these
# multiplies its plain value by 1,000/1,000,000/etc., so "50 ribu" claims
# 50,000 while only ever showing the guard the two-digit, ordinarily-exempt
# token "50". Any occurrence is flagged outright -- none of this module's own
# figures are ever expressed this way, so there is no legitimate use to
# protect.
_MAGNITUDE_WORDS = ("ribu", "juta", "miliar", "triliun")

# Indonesian digit/compounding words, for detecting a quantity spelled out
# entirely in words (e.g. "lima puluh ribu" = "fifty thousand") next to a
# unit. Deliberately not parsed into a value -- rejecting an unparseable
# spelled-out quantity and escalating to a human is the correct outcome.
_DIGIT_WORDS = (
    "nol",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
)
_NUMBER_WORD_PARTS = (*_DIGIT_WORDS, "puluh", "ratus", "belas", *_MAGNITUDE_WORDS)
_UNIT_WORDS = ("tco2e", "ton", "rupiah", "rp")

# A short, bounded run of whitespace and/or dash-family characters -- the
# punctuation Indonesian actually uses to join a digit to the word right
# after it (hyphenated compounds like "50-ribu" are ordinary, not exotic).
# `\s` already covers space/tab/newline/non-breaking space; the dash
# characters are added explicitly since they are not whitespace. Bounded to
# at most 3 characters and excluding sentence punctuation (period, comma
# used as a separator is already consumed by the digit run itself, "!",
# "?") so this can join a digit to an *immediately adjacent* word, never
# leap across a clause or sentence boundary to a coincidental, unrelated
# occurrence of a magnitude word.
_DIGIT_MAGNITUDE_JOINER = r"[\s\-‐‑‒–—―]{0,3}"

_DIGIT_THEN_MAGNITUDE = re.compile(
    r"\d[\d.,]*" + _DIGIT_MAGNITUDE_JOINER + r"(?:" + "|".join(_MAGNITUDE_WORDS) + r")\b",
    re.IGNORECASE,
)
# A run of 1-8 number-word tokens immediately followed by a unit -- e.g.
# "lima puluh ribu ton". Requiring unit-adjacency (rather than flagging any
# lone digit word) keeps ordinary prose containing "dua" or "satu" as an
# ordinal/pronoun from being flagged.
_SPELLED_OUT_NUMBER_NEAR_UNIT = re.compile(
    r"(?:\b(?:" + "|".join(_NUMBER_WORD_PARTS) + r")\b[\s,]*){1,8}"
    r"(?:" + "|".join(_UNIT_WORDS) + r")\b",
    re.IGNORECASE,
)

_TEMPLATE = """Anda adalah penasihat kepatuhan karbon untuk smelter nikel RKEF di Indonesia.

ANGKA YANG TERSEDIA (gunakan HANYA angka-angka ini; jangan menghitung atau mengarang angka lain):
{figures}

KLAUSA REGULASI (dikutip verbatim; rujuk dengan nomor pasal):
{regulation_notice}{clauses}

Tugas Anda: susun rekomendasi strategis dalam Bahasa Indonesia yang menimbang
posisi karbon terhadap harga pasar, dengan rujukan pasal yang tepat.

Aturan mutlak:
- Jangan menyebut angka apa pun yang tidak ada dalam daftar di atas.
- Tulis setiap kuantitas sebagai digit mentah saja (contoh: 50000), TANPA
  kata pengali seperti "ribu", "juta", "miliar", atau "triliun", dan TANPA
  angka yang dieja dengan huruf (contoh: "lima puluh ribu"). Bentuk selain
  digit mentah akan ditolak sistem.
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
        # A one-digit leading group (e.g. "0,125") is ambiguous: it reads
        # equally well as a thousands-shaped grouping or as a leading zero
        # before a decimal fraction. This treats it as grouping, which can
        # only cause a genuinely tiny fractional value to be over-flagged as
        # unsupported -- never the reverse, since over-flagging never lets a
        # fabricated figure through -- so it is left as documented behaviour
        # rather than special-cased.
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
    # Article numbers appearing in a citation (e.g. "16" and "2022" in
    # "Permen ESDM 16/2022") are legitimate numerals when they are actually
    # part of that citation -- but permitting them everywhere in the output
    # would let a fabricated quantity that happens to match an article
    # number (e.g. a made-up "110 ton") launder through unchecked. So the
    # ref text itself is recorded here, tagged with `_CITATION_PREFIX`, and
    # `unsupported_numerals` only exempts a numeral that falls inside an
    # actual occurrence of the ref text in the output -- never globally.
    for c in clauses:
        permitted.add(f"{_CITATION_PREFIX}{c.ref}")

    text = _TEMPLATE.format(
        figures=figures_block,
        regulation_notice=regulation_notice,
        clauses=clauses_block,
    )
    return text, permitted


def _citation_spans(output: str, permitted: set[str]) -> list[tuple[int, int]]:
    """Character ranges in `output` that are an actual occurrence of a
    clause's `ref` text, so numerals that are genuinely part of a citation
    (e.g. "18" in "...Pasal 18") are excluded from the numeral scan without
    exempting that digit sequence anywhere else it appears."""
    refs = [p[len(_CITATION_PREFIX) :] for p in permitted if p.startswith(_CITATION_PREFIX)]
    spans = []
    for ref in refs:
        start = 0
        while (idx := output.find(ref, start)) != -1:
            spans.append((idx, idx + len(ref)))
            start = idx + len(ref)
    return spans


def _within_any_span(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(s <= start and end <= e for s, e in spans)


def unsupported_numerals(output: str, permitted: set[str]) -> set[str]:
    """Numerals in the output that were not supplied. Non-empty means the
    recommendation is flagged, not shipped as advice.

    Three checks, all outside any genuine citation span (see
    `_citation_spans`):

    1. A digit sequence with no supplied match, three or more digits long
       (see the length-skip note below).
    2. A digit immediately followed by an Indonesian magnitude word
       ("ribu"/"juta"/"miliar"/"triliun") -- flagged regardless of digit
       count, since this is exactly how a fabricated figure hides behind
       the two-digit exemption (e.g. "50 ribu" reads as the harmless "50").
    3. A quantity spelled out entirely in Indonesian number words next to a
       unit (e.g. "lima puluh ribu ton") -- flagged as a whole rather than
       parsed, since an unparseable spelled-out quantity should be rejected
       and escalated to a human, not guessed at.
    """
    figures = {p for p in permitted if not p.startswith(_CITATION_PREFIX)}
    spans = _citation_spans(output, permitted)
    found: set[str] = set()

    for match in _DIGIT_THEN_MAGNITUDE.finditer(output):
        if not _within_any_span(match.start(), match.end(), spans):
            found.add(match.group().strip())

    for match in _SPELLED_OUT_NUMBER_NEAR_UNIT.finditer(output):
        if not _within_any_span(match.start(), match.end(), spans):
            found.add(match.group().strip())

    for match in _NUMERAL.finditer(output):
        if _within_any_span(match.start(), match.end(), spans):
            continue
        token = match.group()
        canonical = _canonical(token)
        if token in figures or canonical in figures:
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
