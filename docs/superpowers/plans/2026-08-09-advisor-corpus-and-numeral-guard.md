# Advisor Corpus + Numeral-Guard Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace placeholder regulation text with verbatim gazetted clauses from official PDFs, correct mis-cited pasal/refs, and stop the numeral guard from false-flagging Indonesian “Nomor … Tahun …” citation forms so a clean advisory can render.

**Architecture:** Keep the existing Layer-3 contract (`retrieve → assemble → synthesise → verify`, verbatim injection, numeral guard). Fix data in `corpus.py`, widen citation-span matching in `prompt.py` without globally permitting article/year digits, flip placeholder tests once every clause is real text, and keep PDFs + extraction notes under `carbonatix/backend/advisor_sources/` as provenance (not served to the browser).

**Tech Stack:** Python 3.11+, existing advisor modules (`corpus.py`, `prompt.py`, `pipeline.py`), pytest. No new dependencies. No live model calls in unit tests.

## Global Constraints

- **Verbatim only.** Clause `text` must be copied character-for-character from the gazetted source. Never summarise, translate, or tidy. OCR glitches in `_extracted/*.txt` must be corrected against the PDF page, not invented.
- **Citation digits stay span-scoped.** Never put `110` / `2025` into the global permitted-figures set. Exemption only inside an actual citation occurrence (existing `_citation_spans` contract).
- **No live model API in tests.** Advisor tests keep monkeypatching `pipeline._call_model`.
- **Provisional labelling.** `placeholderCitations` becomes `false` only when `has_placeholder_text()` is false for the whole corpus.
- **Ruff line length 100.** Backend: `.venv/Scripts/python.exe -m pytest -q` from `carbonatix/backend`.

---

## Findings (why the dashboard flagged)

### A. False-positive numeral guard

Stages all succeeded; `verify.flagged` was set because the model wrote regulation years/numbers outside the exact `ref` string:

| Flagged | Corpus origin |
|--------|----------------|
| `2021` | `Perpres 98/2021 Pasal 47` |
| `2023` | `Permen ESDM 2/2023` (also taught by “Tahun 2023” Source lines) |
| `110`, `2025` | `Perpres 110/2025` |

Reproduced: “Peraturan Presiden Nomor 110 Tahun 2025” → flagged `{110,2025}`; exact `Perpres 110/2025` → clean. Placeholder `Source: … Nomor … Tahun …` lines in `corpus.py` actively teach the paraphrased form.

### B. Corpus refs are partly wrong (found while sourcing PDFs)

Downloaded under `carbonatix/backend/advisor_sources/`:

| File | Source |
|------|--------|
| `perpres-98-2021.pdf` | FAOLEX mirror of LN text (peraturan.go.id / setkab mirrors failed) |
| `permen-esdm-16-2022-alt.pdf` | JDIH Kemenko Infra |
| `permen-esdm-2-2023.pdf` | JDIH (CCS/CCUS migas — **not** power-sector trading) |
| `perpres-110-2025.pdf` | JDIH Kemenko Infra |
| `permen-lhk-p71-2017.pdf` | JDIH (SRN PPI) |

Verified mismatches vs current `CORPUS`:

1. **`Permen ESDM 2/2023`** — actual title is CCS/CCUS on upstream oil & gas, **not** “Tata cara perdagangan karbon subsektor pembangkitan”. Power-sector NEK is **`Permen ESDM 16/2022`**.
2. **`Permen ESDM 16/2022 Pasal 18`** — actual text is SPE-GRK reporting via APPLE-Gatrik, **not** “Sanksi administratif pemotongan kuota”. The 75% PTBAE-PU cut is **`Pasal 28`**.
3. **`Perpres 110/2025` “Pasal for captive”** — corpus title claimed captive expansion; **Pasal 47 in Perpres 110 is Adaptasi Perubahan Iklim**, unrelated. NEK instruments live around **Pasal 55**. Captive / “kepentingan sendiri” PLTU PTBAE timing is already in **Permen ESDM 16/2022 Pasal 5 ayat (2) huruf b**. Perpres 110 **Pasal 101** revokes Perpres 98/2021; Pasal 100 keeps non-conflicting implementing rules.

---

## Recommended corpus remap (approve before coding)

| Slot | Old ref / title | New ref / title | Verbatim source |
|------|-----------------|-----------------|-----------------|
| 1 | `Perpres 98/2021 Pasal 47` / NEK | **Keep** same ref; paste Pasal 47 text | `perpres-98-2021.pdf` p.41 |
| 2 | `Permen ESDM 16/2022 Pasal 18` / sanksi kuota | **`Permen ESDM 16/2022 Pasal 28`** / peringatan + alokasi PTBAE-PU 75% | `permen-esdm-16-2022-alt.pdf` (~p.16–17; PDF OCR missed “Pasal 28” header — restore from Klaussa/PDF) |
| 3 | `Permen ESDM 2/2023` / perdagangan pembangkitan | **`Permen ESDM 16/2022 Pasal 5`** / PTBAE fase kesatu incl. kepentingan sendiri (deadline 31 Des 2024) | same PDF p.7 |
| 4 | `Perpres 110/2025` / captive | **`Perpres 110/2025 Pasal 55`** / instrumen NEK (mengganti kerangka Perpres 98) | `perpres-110-2025.pdf` p.42 |
| 5 | `SRN-PPI` (vague) | **`Permen LHK P.71/2017 Pasal 2`** / tujuan & ruang lingkup SRN PPI | `permen-lhk-p71-2017.pdf` p.7 |

Optional later (out of scope unless requested): drop Perpres 98 entirely once product copy no longer needs the revoked parent; add Permen LHK 21/2021 if SRN+NEK linkage needs a newer instrument.

### Draft verbatim texts (to paste after human spot-check against PDF)

**Perpres 98/2021 Pasal 47** (from PDF extract; fix OCR `(21` → `(2)` when pasting):

```
(1) Pelaksanaan penyelenggaraan NEK dilakukan melalui mekanisme:
a. Perdagangan Karbon;
b. Pembayaran Berbasis Kinerja;
c. Pungutan Atas Karbon; dan/atau
d. mekanisme lain sesuai dengan perkembangan ilmu pengetahuan dan teknologi yang ditetapkan oleh Menteri.
(2) Penyelenggaraan NEK sebagaimana dimaksud pada ayat (1) ditetapkan oleh menteri terkait berdasarkan:
a. peta jalan NDC;
b. strategi pencapaian target NDC Sektor;
c. Batas Atas Emisi GRK;
d. keefektifan waktu dan efisiensi biaya; dan
e. perkembangan ilmu pengetahuan, teknologi, dan kapasitas Sektor.
```

**Permen ESDM 16/2022 Pasal 28** (from Klaussa + PDF body; confirm against PDF page):

```
(1) Dalam hal Pelaku Usaha mengikuti Perdagangan Karbon dan tidak menyampaikan laporan Emisi GRK pembangkit tenaga listrik sebagaimana dimaksud dalam Pasal 21 dan Pasal 27 huruf c, transaksi Perdagangan Karbon yang telah dilakukan pada periode Perdagangan Karbon sebelumnya tidak diperhitungkan.
(2) Dalam hal Pelaku Usaha:
a. tidak mengikuti Perdagangan Karbon setelah mendapatkan PTBAE-PU sebagaimana dimaksud dalam Pasal 10 ayat (5); atau
b. dianggap tidak menyampaikan laporan Emisi GRK pembangkit tenaga listrik sebagaimana dimaksud dalam Pasal 24 ayat (3) atau ayat (4),
Menteri melalui Direktur Jenderal memberikan surat peringatan secara tertulis kepada Pelaku Usaha.
(3) Alokasi PTBAE-PU untuk periode Perdagangan Karbon berikutnya bagi Pelaku Usaha sebagaimana dimaksud pada ayat (2) diberikan sebesar 75% (tujuh puluh lima persen).
```

**Permen ESDM 16/2022 Pasal 5** (clean from Klaussa; PDF OCR has `fYI'BAE` etc.):

```
(1) PTBAE untuk setiap jenis pembangkit tenaga listrik pada fase kesatu sebagaimana dimaksud dalam Pasal 4 ayat (3) huruf a hanya berlaku untuk PLTU.
(2) Penetapan PTBAE sebagaimana dimaksud pada ayat (1) untuk fase kesatu terdiri atas:
a. penetapan PTBAE untuk PLTU yang terhubung ke jaringan tenaga listrik PT Perusahaan Listrik Negara (Persero), yang ditetapkan paling lambat 20 (dua puluh) hari kerja terhitung sejak Peraturan Menteri ini diundangkan; dan
b. penetapan PTBAE untuk PLTU di luar wilayah usaha PT Perusahaan Listrik Negara (Persero) dan/atau untuk usaha penyediaan tenaga listrik untuk kepentingan sendiri, yang ditetapkan paling lambat tanggal 31 Desember 2024.
```

**Perpres 110/2025 Pasal 55** (from PDF extract; fix OCR `dan/ a tau` → `dan/atau`):

```
(1) Instrumen NEK dilakukan untuk turut mendukung pencapaian target NDC.
(2) Instrumen NEK sebagaimana dimaksud pada ayat (1) terdiri atas:
a. Perdagangan Karbon;
b. Pembayaran Berbasis Kinerja;
c. Pungutan Atas Karbon; dan/atau
d. instrumen lain sesuai dengan perkembangan ilmu pengetahuan, teknologi, dan ketentuan peraturan perundang-undangan.
(3) Instrumen NEK sebagaimana dimaksud pada ayat (1) dilaksanakan pada Sektor dan Sub Sektor.
```

**Permen LHK P.71/2017 Pasal 2** (from PDF extract; minor spacing cleanup only where PDF has clear spaces):

```
(1) Penyelenggaraan SRN PPI bertujuan untuk:
a. pendataan aksi dan sumber daya adaptasi dan mitigasi perubahan iklim;
b. pengakuan pemerintah atas kontribusi berbagai pihak terhadap upaya pengendalian perubahan iklim yang terdiri atas adaptasi, mitigasi, pendanaan, teknologi, dan capacity building;
c. penyediaan data dan informasi kepada publik tentang aksi dan sumber daya serta capaiannya; dan
d. menghindari penghitungan ganda (double counting) terhadap aksi dan sumber daya adaptasi dan mitigasi sebagai bagian pengelolaan prinsip clarity, transparency dan understanding (CTU).
(2) Ruang lingkup yang diatur dalam Peraturan Menteri ini meliputi:
a. pelaku penyelenggaraan SRN PPI;
b. jenis aksi dan sumber daya;
c. prosedur penyelenggaraan SRN PPI;
d. monitoring, evaluasi, dan pelaporan; dan
e. pemberian apresiasi.
```

---

## Numeral-guard approach (recommended)

**Do both (narrow + prompt), not a global permit:**

1. **Citation aliases** — for each `Clause.ref`, also register span-matchable aliases such as:
   - `Peraturan Presiden Nomor 98 Tahun 2021` ↔ `Perpres 98/2021…`
   - `Peraturan Menteri Energi dan Sumber Daya Mineral Nomor 16 Tahun 2022` / short `Permen ESDM Nomor 16 Tahun 2022`
   - Same pattern for 110/2025 and P.71/2017
2. **Prompt rule** — require citing with the exact `ref` string from the clause block; forbid inventing alternative citation spellings.
3. **Remove** English `Source: …` / `PASTE THE…` lines so the model is not taught paraphrases.
4. **Keep** the anti-laundering test: bare `110 ton` / `2025 ton` outside any citation span must still flag.

Rejected alternatives:
- Globally permitting years/article numbers → lets fabricated tonnages through.
- Only prompt change, no aliases → models still paraphrase and false-flag in demos.

---

## File structure

| File | Responsibility |
|------|----------------|
| `carbonatix/backend/advisor_sources/*.pdf` | Official PDFs already downloaded (provenance). |
| `carbonatix/backend/advisor_sources/SOURCES.md` (new) | URL + date + which pasal was extracted. |
| `app/advisor/corpus.py` | Remap refs/titles; paste verbatim texts; drop sentinel. |
| `app/advisor/prompt.py` | Citation aliases + stricter cite-exact-ref instruction. |
| `tests/test_advisor.py` | Flip placeholder tests; add alias / tahun-form tests; update ref assertions. |
| `tests/test_advisor_pipeline.py` | Expect `placeholderCitations: false` once corpus is real. |
| Frontend advisor tests | Only if they hardcode `placeholderCitations: true` as production expectation beyond fixtures. |

---

### Task 1: Provenance note for downloaded PDFs

**Files:**
- Create: `carbonatix/backend/advisor_sources/SOURCES.md`
- Keep: existing PDFs in that folder (do not commit huge binaries if `.gitignore` already excludes them — if not ignored, ask human before `git add`; prefer documenting URLs over committing multi‑MB scans)

**Interfaces:**
- Produces: human-readable map URL → local file → pasal used in CORPUS

- [ ] **Step 1: Write `SOURCES.md`** listing each PDF, fetch URL, fetch date (2026-08-09), and corpus slot it feeds. Note that `permen-esdm-2-2023.pdf` was downloaded for verification and is **not** used in CORPUS.

- [ ] **Step 2: Confirm git policy** — if PDFs would be committed, stop and ask; otherwise leave them local-only / gitignored.

---

### Task 2: Failing tests for cleaned corpus + tahun-form citations

**Files:**
- Modify: `carbonatix/backend/tests/test_advisor.py`
- Modify: `carbonatix/backend/tests/test_advisor_pipeline.py` (placeholder event assertions)

**Interfaces:**
- Consumes: `CORPUS`, `has_placeholder_text`, `build_prompt`, `unsupported_numerals`, `select_clauses`
- Produces: tests that fail on today’s placeholder corpus and today’s guard

- [ ] **Step 1: Replace placeholder presence tests**

```python
def test_corpus_has_no_placeholder_text():
    assert has_placeholder_text() is False
    assert all(PLACEHOLDER_SENTINEL not in c.text for c in CORPUS)


def test_prompt_has_no_placeholder_warning_when_corpus_is_real():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    text, _ = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    assert "PLACEHOLDER" not in text
    assert PLACEHOLDER_SENTINEL not in text
```

- [ ] **Step 2: Lock remapped refs**

```python
def test_corpus_refs_match_remapped_instruments():
    refs = {c.ref for c in CORPUS}
    assert "Perpres 98/2021 Pasal 47" in refs
    assert "Permen ESDM 16/2022 Pasal 28" in refs
    assert "Permen ESDM 16/2022 Pasal 5" in refs
    assert "Perpres 110/2025 Pasal 55" in refs
    assert "Permen LHK P.71/2017 Pasal 2" in refs
    assert "Permen ESDM 2/2023" not in refs
```

- [ ] **Step 3: Add tahun-form citation guard test**

```python
def test_indonesian_nomor_tahun_citation_form_is_not_flagged():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    clauses = select_clauses(is_compliant=False)
    _, permitted = build_prompt(r, p, FORECAST, clauses)
    prose = (
        "Sesuai Peraturan Presiden Nomor 98 Tahun 2021 Pasal 47 dan "
        "Peraturan Presiden Nomor 110 Tahun 2025 Pasal 55, serta "
        "Permen ESDM Nomor 16 Tahun 2022 Pasal 28, posisi defisit "
        f"sebesar {abs(p.position_tco2e):.1f} tCO2e perlu ditutup."
    )
    assert unsupported_numerals(prose, permitted) == set()


def test_bare_article_year_as_quantity_still_flagged():
    r = calculate_emissions(**NOMINAL)
    p = assess(r, cap_tco2e=r.total_emissions - 500, carbon_price_idr_per_ton=35200.0)
    _, permitted = build_prompt(r, p, FORECAST, select_clauses(is_compliant=False))
    assert "110" in unsupported_numerals("Beli 110 ton kredit.", permitted)
    assert "2025" in unsupported_numerals("Beli 2025 ton kredit.", permitted)
```

- [ ] **Step 4: Run tests — expect FAIL on placeholder / missing refs / tahun form**

Run: `.venv/Scripts/python.exe -m pytest tests/test_advisor.py -k "placeholder or remapped or nomor_tahun or bare_article" -q`

Expected: FAIL until Tasks 3–4 land.

- [ ] **Step 5: Update pipeline tests** that assume `placeholderCitations is True` to expect `False` after corpus fix (same commit as Task 3, or a follow-up step in Task 5).

---

### Task 3: Paste verbatim corpus

**Files:**
- Modify: `carbonatix/backend/app/advisor/corpus.py`

**Interfaces:**
- Produces: `CORPUS` with five remapped `Clause`s; `has_placeholder_text()` → `False`
- Consumes: human-approved verbatim strings from this plan (spot-checked against PDF)

- [ ] **Step 1: Rewrite module header** — remove “every text is PLACEHOLDER” notice; document PDF provenance path + that Perpres 98 is revoked by Perpres 110 Pasal 101 but kept as historical NEK mechanism citation still referenced by implementing Permen.

- [ ] **Step 2: Replace `CORPUS` entries** with the remap table above. Titles must match the real pasal subject (not the old wrong titles).

- [ ] **Step 3: Delete every `PLACEHOLDER_SENTINEL` occurrence from clause texts. Keep the constant + `has_placeholder_text()` so a future regression is still detectable.

- [ ] **Step 4: Run**

`.venv/Scripts/python.exe -m pytest tests/test_advisor.py -k "corpus or placeholder or remapped" -q`

Expected: corpus/placeholder/ref tests PASS; tahun-form still FAIL until Task 4.

---

### Task 4: Citation aliases in the numeral guard

**Files:**
- Modify: `carbonatix/backend/app/advisor/prompt.py`
- Modify: `carbonatix/backend/tests/test_advisor.py` (already written in Task 2)

**Interfaces:**
- Consumes: `Clause.ref`
- Produces: additional `ref::…` permitted entries for aliases; `_citation_spans` unchanged mechanically

- [ ] **Step 1: Add alias helper**

```python
def _citation_aliases(ref: str) -> list[str]:
    """Exact-ref plus Indonesian long forms the model commonly emits.

    Only full phrases are returned — never bare years — so spans cannot
    launder a fabricated quantity.
    """
    aliases = [ref]
    # Explicit map keyed by the short refs we ship in CORPUS.
    # ... populate for 98/2021, 16/2022 Pasal 28 & 5, 110/2025 Pasal 55, P.71/2017
    return aliases
```

- [ ] **Step 2: In `build_prompt`, register every alias**

```python
for c in clauses:
    for alias in _citation_aliases(c.ref):
        permitted.add(f"{_CITATION_PREFIX}{alias}")
```

- [ ] **Step 3: Tighten prompt template** — after the existing “Kutip pasal persis” bullet, add: cite using the `ref` string exactly as shown in `[ref]`; long “Nomor … Tahun …” forms are acceptable only when they name the same instrument.

- [ ] **Step 4: Run**

`.venv/Scripts/python.exe -m pytest tests/test_advisor.py -q`

Expected: PASS including tahun-form and bare-quantity laundering tests.

---

### Task 5: Pipeline + frontend honesty flags

**Files:**
- Modify: `carbonatix/backend/tests/test_advisor_pipeline.py`
- Modify frontend tests only if they assert production `placeholderCitations: true` outside fixtures

**Interfaces:**
- Consumes: `has_placeholder_text()` already wired into pipeline events

- [ ] **Step 1: Flip pipeline assertions** from `placeholderCitations is True` to `False`.

- [ ] **Step 2: Run full backend suite**

`.venv/Scripts/python.exe -m pytest -q`

Expected: all green.

- [ ] **Step 3: Manual smoke** (human): with backend + frontend up, open a run’s recommendation stream — four green nodes, body visible, citation chips without “Belum terverifikasi” / placeholder note, no flagged warning for years inside citations.

---

### Task 6: Commit (only when user asks)

```bash
git add carbonatix/backend/app/advisor/corpus.py \
        carbonatix/backend/app/advisor/prompt.py \
        carbonatix/backend/tests/test_advisor.py \
        carbonatix/backend/tests/test_advisor_pipeline.py \
        carbonatix/backend/advisor_sources/SOURCES.md \
        docs/superpowers/plans/2026-08-09-advisor-corpus-and-numeral-guard.md
# PDFs only if explicitly approved
git commit -m "$(cat <<'EOF'
fix(advisor): paste real regulation clauses and allow Tahun citation forms

Replace placeholder corpus text with gazetted pasal wording, correct
mis-cited ESDM instruments, and span-match Indonesian Nomor/Tahun
citations so verify stops false-flagging regulation years.
EOF
)"
```

---

## Self-review

1. **Spec coverage:** false-flag fix + real corpus + wrong-ref correction all have tasks.
2. **No TBD steps:** verbatim drafts included; human must still eye-check PDF before paste.
3. **Anti-laundering preserved:** bare `110`/`2025` ton tests remain.
4. **Out of scope:** re-training the LLM, expanding citation chip to show full pasal body over SSE, dropping Perpres 98 entirely.

---

## Approval gate (you check this)

Please confirm or edit:

1. **Corpus remap table** — especially replacing `Permen ESDM 2/2023` with `16/2022 Pasal 5`, and moving “sanksi kuota” from Pasal 18 → Pasal 28.
2. **Keep Perpres 98/2021 Pasal 47** alongside Perpres 110/2025 Pasal 55 (recommended), vs drop 98 now that Pasal 101 revoked it.
3. **Commit PDFs** into the repo vs local-only + URL list in `SOURCES.md` (recommended: local/URL only; PDFs are ~13 MB total).

After you approve, implementation can proceed task-by-task.
