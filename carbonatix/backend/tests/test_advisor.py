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
from app.advisor.prompt import (
    _DIGIT_THEN_MAGNITUDE,
    _NUMERAL,
    _spelled_out_number_matches,
    build_prompt,
    unsupported_numerals,
)
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
    assert _DIGIT_THEN_MAGNITUDE.search(bad) is not None
    assert unsupported_numerals(bad, permitted) != set()


def test_digit_followed_by_miliar_is_caught():
    """'Rp 12 miliar' -- a two-digit figure that the ordinal/date exemption
    would ordinarily wave through -- must still be flagged once a magnitude
    word turns it into a claimed twelve billion rupiah."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Nilai potensial mencapai Rp 12 miliar."
    assert _DIGIT_THEN_MAGNITUDE.search(bad) is not None
    assert unsupported_numerals(bad, permitted) != set()


def test_fully_spelled_out_number_near_unit_is_caught():
    """'lima puluh ribu ton' contains no digits at all, so the guard must
    recognise the spelled-out quantity next to its unit and flag it as
    unparseable rather than silently pass it through."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Kami merekomendasikan pembelian lima puluh ribu ton kredit karbon."
    assert list(_spelled_out_number_matches(bad))
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


# -- Digit-magnitude-word joiner: a hyphen *with no surrounding whitespace*
# -- is an ordinary Indonesian compound ("50-ribu") and must be caught; a
# -- dash *with* surrounding whitespace is clause punctuation ("12 - ribu",
# -- an article number followed by an unrelated clause) and must not be
# -- mistaken for one. Round 3 found the first joiner widening conflated the
# -- two; these tests pin both directions down, asserting on
# -- `_DIGIT_THEN_MAGNITUDE`/`_spelled_out_number_matches` directly where
# -- possible so a match credited to the wrong rule cannot pass silently
# -- again. -------------------------------------------------------------


def test_hyphenated_digit_and_magnitude_word_is_caught_kredit_karbon():
    """Round-2 repro #1: a hyphen with no surrounding whitespace between the
    digit and the magnitude word must not defeat the guard."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Kami merekomendasikan pembelian 50-ribu kredit karbon tambahan."
    assert _DIGIT_THEN_MAGNITUDE.search(bad) is not None
    assert unsupported_numerals(bad, permitted) != set()


def test_hyphenated_digit_and_magnitude_word_is_caught_rp_miliar():
    """Round-2 repro #2."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Nilai potensial mencapai Rp 12-miliar untuk proyek ini."
    assert _DIGIT_THEN_MAGNITUDE.search(bad) is not None
    assert unsupported_numerals(bad, permitted) != set()


def test_hyphenated_digit_and_magnitude_word_is_caught_no_unit_word():
    """Round-2 repro #3 -- critically, this sentence has no trailing unit
    word ("ton"/"rupiah"/etc.) for the spelled-out-number rule to latch onto,
    so it can only be caught if `_DIGIT_THEN_MAGNITUDE` itself is
    separator-robust, not by a coincidental second match."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Sebanyak 50-ribu akan dibeli."
    assert _DIGIT_THEN_MAGNITUDE.search(bad) is not None
    assert not list(_spelled_out_number_matches(bad))
    assert unsupported_numerals(bad, permitted) != set()


def test_en_dash_digit_and_magnitude_word_is_caught():
    """The dash-family character class covers more than the ASCII hyphen --
    an en dash with no surrounding whitespace must be caught the same way."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Kami merekomendasikan pembelian 50–ribu kredit karbon tambahan."
    assert _DIGIT_THEN_MAGNITUDE.search(bad) is not None
    assert unsupported_numerals(bad, permitted) != set()


def test_double_space_digit_and_magnitude_word_is_caught():
    """The whitespace form of the joiner allows up to three spaces/tabs, not
    just exactly one."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    bad = "Kami merekomendasikan pembelian 50  ribu ton kredit karbon."
    assert _DIGIT_THEN_MAGNITUDE.search(bad) is not None
    assert unsupported_numerals(bad, permitted) != set()


def test_spaced_dash_after_article_number_is_not_a_compound():
    """Round-3 false positive #1: 'Pasal 12 - ribu ...' is an article number
    followed by dash-punctuation and an unrelated clause, not a '12-ribu'
    compound. The surrounding spaces on the dash must disqualify it."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    good = "Sesuai Pasal 12 - ribu pelaku usaha akan mendapat sanksi administratif."
    assert _DIGIT_THEN_MAGNITUDE.search(good) is None
    assert unsupported_numerals(good, permitted) == set()


def test_spaced_dash_with_bare_juta_rupiah_is_not_flagged():
    """Round-3 false positive #2: 'ayat 18 - juta rupiah ...' must not match
    the digit+magnitude rule (spaced dash is punctuation, not a compound),
    and 'juta rupiah' alone -- a bare magnitude word next to its unit, with
    no counting word -- must not be treated as a genuine spelled-out
    quantity either."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    good = "Merujuk pada ayat 18 - juta rupiah adalah nilai pasar acuan yang berbeda konteks."
    assert _DIGIT_THEN_MAGNITUDE.search(good) is None
    assert not list(_spelled_out_number_matches(good))
    assert unsupported_numerals(good, permitted) == set()


def test_paragraph_break_does_not_bridge_digit_to_magnitude_word():
    """A blank line between a digit and a magnitude word is a paragraph
    break, not a compound -- the old unbounded `\\s*` joiner let `"5000"`
    and `"juta rupiah"` on either side of it be read as one fabricated
    figure. `permitted` is crafted here (rather than taken from a real
    `build_prompt` call) so the check isolates this one behaviour: whether
    "5000" -- a value assumed supplied -- gets wrongly linked across the
    blank line to the unrelated "juta rupiah" that follows it."""
    permitted = {"5000", "5000.0"}
    text = "Total produksi mencapai 5000\n\njuta rupiah dialokasikan untuk program CSR."
    assert _DIGIT_THEN_MAGNITUDE.search(text) is None
    assert not list(_spelled_out_number_matches(text))
    assert unsupported_numerals(text, permitted) == set()


def test_suffixed_magnitude_word_is_not_flagged_by_word_boundary():
    """'jutaan' ('millions', with the '-an' suffix) is not the bare word
    'juta', and must not match either the digit+magnitude rule or the
    spelled-out-number rule. Locked in as its own test so a future widening
    of either pattern cannot silently reintroduce a match here."""
    permitted = {"2024"}
    text = "pada 2024 pemerintah menaikkan target hingga jutaan ton"
    assert _DIGIT_THEN_MAGNITUDE.search(text) is None
    assert not list(_spelled_out_number_matches(text))
    assert unsupported_numerals(text, permitted) == set()


def test_unrelated_digit_and_magnitude_word_far_apart_are_not_linked():
    """A deliberate false-positive check: a genuine, unrelated digit and a
    genuine, unrelated magnitude word can both appear in the same sentence
    without being flagged as a single fabricated quantity, as long as they
    are not actually adjacent (joined by only whitespace/dash punctuation).
    The joiner is bounded to 3 characters precisely so it cannot leap across
    a whole clause to link two unrelated numbers -- a guard that fires on
    ordinary Indonesian prose is worse than a leaky one."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    good = (
        "Total emisi tercatat 12 pada laporan awal, sedangkan investasi "
        "diperkirakan mencapai puluhan juta untuk proyek berikutnya."
    )
    assert _DIGIT_THEN_MAGNITUDE.search(good) is None
    assert unsupported_numerals(good, permitted) == set()


# -- Trailing punctuation must not be read as part of a numeral --------------
#
# Both cases below are taken verbatim from the first recommendation the live
# Fable gateway produced (2026-08-06). The guard flagged that recommendation
# as containing fabricated figures. It did not: `_NUMERAL` was swallowing the
# punctuation after each number, so the resulting token matched neither the
# supplied figure nor the citation span it sat inside.
#
# A false accusation here is not a cosmetic bug. `flagged` is what stops a
# recommendation being presented as advice, so a guard that fires on correct
# output trains everyone to ignore it -- and it fires on the most ordinary
# shape there is, a figure at the end of a sentence.


def test_supplied_figure_at_end_of_sentence_is_not_flagged():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    _, permitted = build_prompt(r, p, FORECAST, clauses)

    total = f"{r.total_emissions:.1f}"
    assert unsupported_numerals(f"Total emisi tercatat {total}.", permitted) == set()
    assert unsupported_numerals(f"Total emisi tercatat {total}, naik.", permitted) == set()


def test_comma_separated_citation_list_is_not_flagged():
    """The exact list the model wrote: several refs separated by commas. Each
    ref's digits sit inside a genuine citation span, and the comma that
    follows belongs to the sentence, not to the year."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    _, permitted = build_prompt(r, p, FORECAST, clauses)

    refs = [c.ref for c in clauses]
    assert "Permen ESDM 2/2023" in refs and "Perpres 110/2025" in refs
    prose = (
        "Rekomendasi ini wajib divalidasi terhadap teks resmi: "
        "Perpres 98/2021 Pasal 47, Permen ESDM 16/2022 Pasal 18, "
        "Permen ESDM 2/2023, Perpres 110/2025, dan ketentuan SRN-PPI."
    )
    assert unsupported_numerals(prose, permitted) == set()


def test_fabricated_figure_at_end_of_sentence_is_still_flagged():
    """The fix trims trailing punctuation; it must not also stop the guard
    catching a genuinely invented number in the same position."""
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    _, permitted = build_prompt(r, p, FORECAST, clauses)

    assert "999888" in unsupported_numerals("Beli kredit sebanyak 999888.", permitted)
    assert "999888" in unsupported_numerals("Beli kredit sebanyak 999888, lalu.", permitted)


def test_indonesian_decimal_and_thousands_separators_still_parse():
    """The trailing-separator fix must leave internal separators alone --
    "1.234,5" is one numeral, not "1" and "234" and "5"."""
    assert _NUMERAL.findall("nilai 1.234,5 ton") == ["1.234,5"]
    assert _NUMERAL.findall("2023, 2025.") == ["2023", "2025"]
    assert _NUMERAL.findall("total 72074.8.") == ["72074.8"]
