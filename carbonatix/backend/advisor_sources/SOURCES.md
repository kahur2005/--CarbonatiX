# Advisor regulation sources

Local PDFs are provenance for `app/advisor/corpus.py`. They are gitignored
(multi‑MB scans); re-fetch from the URLs below if missing.

Fetched: 2026-08-09.

| Local file | Instrument | Corpus slot | Fetch URL |
|---|---|---|---|
| `perpres-98-2021.pdf` | Perpres 98/2021 | Pasal 47 | https://faolex.fao.org/docs/pdf/ins210632.pdf (peraturan.go.id / setkab mirrors failed that day) |
| `permen-esdm-16-2022-alt.pdf` | Permen ESDM 16/2022 | Pasal 28, Pasal 5 | https://jdih.kemenkoinfra.go.id/cfind/source/files/permenesdm/2022/permen-esdm-nomor-16-tahun-2022.pdf |
| `perpres-110-2025.pdf` | Perpres 110/2025 | Pasal 55 | https://jdih.kemenkoinfra.go.id/cfind/source/files/perpres/2025/perpres-no.-110-tahun-2025.pdf |
| `permen-lhk-p71-2017.pdf` | Permen LHK P.71/2017 | Pasal 2 | https://jdih.kemenkoinfra.go.id/cfind/source/files/permen-lhk/permenlhk-nomor-p.71-tahun-2017.pdf |

## Downloaded but not used in CORPUS

| Local file | Why not used |
|---|---|
| `permen-esdm-2-2023.pdf` | CCS/CCUS on upstream oil & gas — not power-sector carbon trading. Previous corpus title was wrong. |

## Notes

- Perpres 110/2025 Pasal 101 revokes Perpres 98/2021; Pasal 100 keeps non-conflicting implementing rules. CORPUS keeps Pasal 47 of Perpres 98 as the historical NEK-mechanism citation still referenced by Permen ESDM 16/2022.
- PDF text extraction under `_extracted/` is OCR-noisy; clause bodies in `corpus.py` were spot-checked against the PDF pages and cleaned only for clear OCR artifacts (never paraphrased).
