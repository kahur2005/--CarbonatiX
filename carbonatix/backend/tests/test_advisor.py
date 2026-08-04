"""Tests for the regulation corpus and the numeral-guarded prompt.

Two anti-hallucination mechanisms are exercised here:

1. Verbatim clause injection (`corpus.py` / `build_prompt`) -- a paraphrased
   legal threshold that is subtly wrong is worse than no citation, because it
   carries the authority of a citation.
2. The numeral guard (`unsupported_numerals`) -- the model may only use
   figures that appear in the prompt; anything else is a fabricated number
   that must not reach a compliance decision.

The corpus currently ships with placeholder clause text (see the notice at
the top of `app/advisor/corpus.py`): nobody writing this module had access to
the real regulation text, and approximating it would be worse than shipping
nothing. `test_corpus_currently_has_placeholder_text` and
`test_prompt_warns_while_corpus_is_placeholder` pin down that this state is
detected and surfaced rather than silently passed through as real law.
"""

from app.advisor.corpus import CORPUS, PLACEHOLDER_SENTINEL, has_placeholder_text, select_clauses
from app.advisor.prompt import build_prompt, unsupported_numerals
from app.emissions.calculator import calculate_emissions
from app.emissions.compliance import assess

NOMINAL = {
    "wet_ore_input_tons": 10_000.0,
    "moisture_content_pct": 0.32,
    "nickel_grade_pct": 0.018,
    "reductant_biocoke_pct": 0.0,
    "sec_eaf_kwh_per_t_alloy": 2400.0,
    "power_mix_captive_coal": 1.0,
    "ef_captive_pltu": 1.0,
    "dryer_thermal_efficiency": 0.55,
}
FORECAST = {"idxCarbonIdrPerTon": [35200.0], "lmeUsdPerTon": [16500.0]}


def test_corpus_clauses_carry_a_traceable_reference():
    assert CORPUS
    for c in CORPUS:
        assert c.ref and c.text
        assert any(k in c.ref for k in ("Perpres", "Permen", "SRN"))


def test_deficit_selects_at_least_one_clause():
    assert select_clauses(is_compliant=False)


def test_surplus_selects_at_least_one_clause():
    assert select_clauses(is_compliant=True)


def test_prompt_contains_clause_text_verbatim():
    """Verbatim injection is the whole anti-hallucination mechanism. If a
    clause is summarised on the way into the prompt, the citation is a lie."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    text, _ = build_prompt(r, p, FORECAST, clauses)
    for c in clauses:
        assert c.text in text, f"clause {c.ref} was not injected verbatim"


def test_permitted_numerals_include_every_supplied_figure():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    assert f"{r.total_emissions:.1f}" in permitted
    assert f"{p.position_tco2e:.1f}" in permitted


def test_invented_figure_is_caught():
    _, permitted = build_prompt(
        calculate_emissions(**NOMINAL),
        assess(
            calculate_emissions(**NOMINAL),
            cap_tco2e=1000.0,
            carbon_price_idr_per_ton=35200.0,
        ),
        FORECAST,
        select_clauses(is_compliant=False),
    )
    bad = "Kami merekomendasikan pembelian 999888 ton kredit karbon."
    assert "999888" in unsupported_numerals(bad, permitted)


def test_supplied_figure_passes_the_check():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    good = f"Posisi defisit sebesar {p.position_tco2e:.1f} tCO2e."
    assert unsupported_numerals(good, permitted) == set()


# -- Placeholder detection --------------------------------------------------


def test_corpus_currently_has_placeholder_text():
    """Pinned RED until every clause's `text` is replaced with the real
    gazetted article. If this ever flips to False without a corresponding
    rewrite of every clause body, something has gone quietly wrong."""
    assert has_placeholder_text() is True
    assert any(PLACEHOLDER_SENTINEL in c.text for c in CORPUS)


def test_prompt_warns_while_corpus_is_placeholder():
    """While placeholder text is in play, the prompt must say so plainly and
    must not let the model treat placeholder text as authoritative law."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    assert any(PLACEHOLDER_SENTINEL in c.text for c in clauses)

    text, _ = build_prompt(r, p, FORECAST, clauses)
    assert "PLACEHOLDER" in text
    assert "otoritatif" in text.lower()


# -- Numeral canonicalisation: Indonesian thousands/decimal formatting ------


def test_canonical_indonesian_thousands_separator_matches_plain():
    """'.' groups thousands in Indonesian formatting: '35.200' must be
    recognised as the already-permitted figure '35200'."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    good = "Harga karbon IDX sebesar Rp35.200 per ton."
    assert unsupported_numerals(good, permitted) == set()


def test_canonical_indonesian_decimal_comma_matches_plain():
    """',' marks the decimal in Indonesian formatting: a supplied figure such
    as '1234.5' rewritten as '1234,5' must still be recognised as supplied,
    not mangled into an unrelated integer."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    indonesian_style = f"{p.position_tco2e:.1f}".replace(".", ",")
    good = f"Posisi karbon sebesar {indonesian_style} tCO2e."
    assert unsupported_numerals(good, permitted) == set()


def test_fabricated_number_in_indonesian_thousands_format_is_still_caught():
    """Reformatting a fabricated figure Indonesian-style must not launder it
    past the guard -- '999.888' and '999888' must canonicalise identically,
    and neither is a supplied figure."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Kami merekomendasikan pembelian 999.888 ton kredit karbon."
    assert unsupported_numerals(bad, permitted) != set()


def test_article_numbers_in_citation_are_not_flagged():
    """Article/regulation numbers (e.g. '2022' in 'Permen ESDM 16/2022') are
    legitimate numerals the model may repeat when naming a clause."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    _, permitted = build_prompt(r, p, FORECAST, clauses)
    good = "Lihat Permen ESDM 16/2022 mengenai sanksi kuota."
    assert unsupported_numerals(good, permitted) == set()
