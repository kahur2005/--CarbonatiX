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


def test_article_numbers_in_a_genuine_citation_are_not_flagged():
    """A numeral that is genuinely part of a citation -- the full `ref` text
    appearing verbatim in the output, exactly as the prompt's own clause
    block renders it (`[ref] title`) -- must not be flagged."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    _, permitted = build_prompt(r, p, FORECAST, clauses)
    ref = next(c.ref for c in clauses if c.ref == "Permen ESDM 16/2022 Pasal 18")
    good = f"Sesuai [{ref}], sanksi pemotongan kuota berlaku."
    assert unsupported_numerals(good, permitted) == set()


# -- Citation numerals must not be permitted globally ------------------------


def test_citation_numeral_does_not_launder_a_fabricated_quantity_elsewhere():
    """A regulation year/number (e.g. '2025' from 'Perpres 110/2025', '110'
    from the same ref) must only be exempt where it is genuinely part of a
    citation -- not anywhere in the output. Otherwise a fabricated tonnage
    that happens to match an article number passes for free."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    assert any(c.ref == "Perpres 110/2025" for c in clauses)
    _, permitted = build_prompt(r, p, FORECAST, clauses)

    bad_year = "Kami merekomendasikan pembelian 2025 ton kredit karbon tambahan."
    assert "2025" in unsupported_numerals(bad_year, permitted)

    bad_article = "Kami merekomendasikan pembelian 110 ton kredit karbon tambahan."
    assert "110" in unsupported_numerals(bad_article, permitted)


# -- Indonesian magnitude words and spelled-out numbers -----------------------


def test_digit_followed_by_magnitude_word_is_caught():
    """'50 ribu' claims 50,000 while showing the guard only the two-digit,
    ordinarily-exempt token '50'. The digit+magnitude-word combination must
    be flagged regardless of the digit count."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Kami merekomendasikan pembelian 50 ribu ton kredit karbon."
    assert unsupported_numerals(bad, permitted) != set()


def test_digit_followed_by_miliar_is_caught():
    """'Rp 12 miliar' -- a two-digit figure that the ordinal/date exemption
    would ordinarily wave through -- must still be flagged once a magnitude
    word turns it into a claimed twelve billion rupiah."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Nilai potensial mencapai Rp 12 miliar."
    assert unsupported_numerals(bad, permitted) != set()


def test_fully_spelled_out_number_near_unit_is_caught():
    """'lima puluh ribu ton' contains no digits at all, so the guard must
    recognise the spelled-out quantity next to its unit and flag it as
    unparseable rather than silently pass it through."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Kami merekomendasikan pembelian lima puluh ribu ton kredit karbon."
    assert unsupported_numerals(bad, permitted) != set()


def test_ordinary_prose_without_any_quantity_is_not_flagged():
    """Guard against the fix making the check useless: prose that mentions no
    figure at all, spelled out or otherwise, must not be flagged."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    good = (
        "Posisi karbon perusahaan saat ini berada dalam kondisi defisit dan "
        "memerlukan tindakan strategis segera untuk menjaga kepatuhan."
    )
    assert unsupported_numerals(good, permitted) == set()
