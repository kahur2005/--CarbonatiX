"""Curated regulation clauses, stored verbatim.

No vector database. The corpus is a few dozen clauses, and injecting the
selected ones verbatim is stronger on the no-paraphrase principle than
embedding similarity, which can silently retrieve the wrong clause.

Every `text` below must be copied character-for-character from the source
regulation. Never summarise, never translate, never tidy.

PLACEHOLDER NOTICE -- READ BEFORE TOUCHING THIS FILE
-----------------------------------------------------
Every `text` field below still carries `PLACEHOLDER_SENTINEL` in place of the
real article text. Nobody writing this module has been supplied the actual
regulation text, and inventing an approximation of what an article says would
be worse than shipping no citation at all -- a paraphrased legal threshold
that is subtly wrong carries the authority of a citation while being false.

To fix this for real:
1. Obtain the official gazetted text for each `ref` below (Perpres 98/2021
   Pasal 47; Permen ESDM 16/2022 Pasal 18; Permen ESDM 2/2023; Perpres
   110/2025; the SRN-PPI registration/reporting obligation).
2. Replace the corresponding `text=` value with that article copied
   character-for-character -- no summarising, no translating, no tidying.
3. Do not touch `ref` or `title`; those identifiers are already correct.

Until every `text` field is replaced, `has_placeholder_text()` returns True
and `build_prompt` refuses to present these clauses as authoritative:
**every citation this module produces until then is false.**
"""

from dataclasses import dataclass

__all__ = ["CORPUS", "PLACEHOLDER_SENTINEL", "Clause", "has_placeholder_text", "select_clauses"]

# The one and only marker that identifies placeholder clause text. Detection
# keys off this exact constant rather than a fragile substring guess (e.g.
# scanning for the word "paste" or "TODO", which a real article could
# legitimately contain) so a future edit that leaves even one clause
# unreplaced is still caught deterministically.
PLACEHOLDER_SENTINEL = "PASTE THE VERBATIM ARTICLE TEXT HERE"


@dataclass(frozen=True)
class Clause:
    ref: str  # e.g. "Permen ESDM 16/2022 Pasal 18 ayat (3)"
    title: str
    text: str  # verbatim
    applies_to: str  # "deficit" | "surplus" | "always"


CORPUS: list[Clause] = [
    Clause(
        ref="Perpres 98/2021 Pasal 47",
        title="Nilai Ekonomi Karbon",
        text=(
            f"{PLACEHOLDER_SENTINEL}. Do not paraphrase. "
            "Source: Peraturan Presiden Nomor 98 Tahun 2021, Pasal 47."
        ),
        applies_to="always",
    ),
    Clause(
        ref="Permen ESDM 16/2022 Pasal 18",
        title="Sanksi administratif pemotongan kuota",
        text=(
            f"{PLACEHOLDER_SENTINEL}, including the quota-reduction sanction "
            "for failure to report verified emissions. Source: Peraturan "
            "Menteri ESDM Nomor 16 Tahun 2022, Pasal 18."
        ),
        applies_to="deficit",
    ),
    Clause(
        ref="Permen ESDM 2/2023",
        title="Tata cara perdagangan karbon subsektor pembangkitan",
        text=(f"{PLACEHOLDER_SENTINEL}. Source: Peraturan Menteri ESDM Nomor 2 Tahun 2023."),
        applies_to="always",
    ),
    Clause(
        ref="Perpres 110/2025",
        title="Perluasan cakupan ke sektor captive",
        text=(f"{PLACEHOLDER_SENTINEL}. Source: Peraturan Presiden Nomor 110 Tahun 2025."),
        applies_to="always",
    ),
    Clause(
        ref="SRN-PPI",
        title="Registrasi dan pelaporan pada Sistem Registri Nasional Pengendalian Perubahan Iklim",
        text=(f"{PLACEHOLDER_SENTINEL}. Source: ketentuan registrasi dan pelaporan SRN-PPI."),
        applies_to="always",
    ),
]


def has_placeholder_text() -> bool:
    """True while any clause in CORPUS still carries placeholder text.

    This is the flag Task 14 must surface in the recommendation response
    (the same pattern as `synthetic` on `/forecasts` and
    `confidence_is_placeholder` on `/documents`): a consumer must not be
    able to present a placeholder-backed citation as if it were real law
    without actively ignoring this signal.
    """
    return any(PLACEHOLDER_SENTINEL in c.text for c in CORPUS)


def select_clauses(*, is_compliant: bool) -> list[Clause]:
    """Clauses relevant to the current position."""
    wanted = "surplus" if is_compliant else "deficit"
    return [c for c in CORPUS if c.applies_to in ("always", wanted)]
