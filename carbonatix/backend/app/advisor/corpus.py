"""Curated regulation clauses, stored verbatim.

No vector database. The corpus is a few dozen clauses, and injecting the
selected ones verbatim is stronger on the no-paraphrase principle than
embedding similarity, which can silently retrieve the wrong clause.

Every `text` below must be copied character-for-character from the source
regulation. Never summarise, never translate, never tidy.

Provenance (PDFs + URLs): `carbonatix/backend/advisor_sources/SOURCES.md`.
Perpres 110/2025 Pasal 101 revokes Perpres 98/2021; Pasal 100 keeps
non-conflicting implementing rules. Perpres 98/2021 Pasal 47 remains in
this corpus as the NEK-mechanism citation still referenced by Permen ESDM
16/2022.
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
    ref: str  # e.g. "Permen ESDM 16/2022 Pasal 28"
    title: str
    text: str  # verbatim
    applies_to: str  # "deficit" | "surplus" | "always"


CORPUS: list[Clause] = [
    Clause(
        ref="Perpres 98/2021 Pasal 47",
        title="Mekanisme penyelenggaraan Nilai Ekonomi Karbon",
        text=(
            "(1) Pelaksanaan penyelenggaraan NEK dilakukan melalui mekanisme:\n"
            "a. Perdagangan Karbon;\n"
            "b. Pembayaran Berbasis Kinerja;\n"
            "c. Pungutan Atas Karbon; dan/atau\n"
            "d. mekanisme lain sesuai dengan perkembangan ilmu pengetahuan "
            "dan teknologi yang ditetapkan oleh Menteri.\n"
            "(2) Penyelenggaraan NEK sebagaimana dimaksud pada ayat (1) "
            "ditetapkan oleh menteri terkait berdasarkan:\n"
            "a. peta jalan NDC;\n"
            "b. strategi pencapaian target NDC Sektor;\n"
            "c. Batas Atas Emisi GRK;\n"
            "d. keefektifan waktu dan efisiensi biaya; dan\n"
            "e. perkembangan ilmu pengetahuan, teknologi, dan kapasitas Sektor."
        ),
        applies_to="always",
    ),
    Clause(
        ref="Permen ESDM 16/2022 Pasal 28",
        title="Peringatan dan pengurangan alokasi PTBAE-PU",
        text=(
            "(1) Dalam hal Pelaku Usaha mengikuti Perdagangan Karbon dan "
            "tidak menyampaikan laporan Emisi GRK pembangkit tenaga listrik "
            "sebagaimana dimaksud dalam Pasal 21 dan Pasal 27 huruf c, "
            "transaksi Perdagangan Karbon yang telah dilakukan pada periode "
            "Perdagangan Karbon sebelumnya tidak diperhitungkan.\n"
            "(2) Dalam hal Pelaku Usaha:\n"
            "a. tidak mengikuti Perdagangan Karbon setelah mendapatkan "
            "PTBAE-PU sebagaimana dimaksud dalam Pasal 10 ayat (5); atau\n"
            "b. dianggap tidak menyampaikan laporan Emisi GRK pembangkit "
            "tenaga listrik sebagaimana dimaksud dalam Pasal 24 ayat (3) "
            "atau ayat (4),\n"
            "Menteri melalui Direktur Jenderal memberikan surat peringatan "
            "secara tertulis kepada Pelaku Usaha.\n"
            "(3) Alokasi PTBAE-PU untuk periode Perdagangan Karbon "
            "berikutnya bagi Pelaku Usaha sebagaimana dimaksud pada ayat (2) "
            "diberikan sebesar 75% (tujuh puluh lima persen)."
        ),
        applies_to="deficit",
    ),
    Clause(
        ref="Permen ESDM 16/2022 Pasal 5",
        title="PTBAE fase kesatu untuk PLTU termasuk kepentingan sendiri",
        text=(
            "(1) PTBAE untuk setiap jenis pembangkit tenaga listrik pada "
            "fase kesatu sebagaimana dimaksud dalam Pasal 4 ayat (3) huruf a "
            "hanya berlaku untuk PLTU.\n"
            "(2) Penetapan PTBAE sebagaimana dimaksud pada ayat (1) untuk "
            "fase kesatu terdiri atas:\n"
            "a. penetapan PTBAE untuk PLTU yang terhubung ke jaringan tenaga "
            "listrik PT Perusahaan Listrik Negara (Persero), yang ditetapkan "
            "paling lambat 20 (dua puluh) hari kerja terhitung sejak "
            "Peraturan Menteri ini diundangkan; dan\n"
            "b. penetapan PTBAE untuk PLTU di luar wilayah usaha PT "
            "Perusahaan Listrik Negara (Persero) dan/atau untuk usaha "
            "penyediaan tenaga listrik untuk kepentingan sendiri, yang "
            "ditetapkan paling lambat tanggal 31 Desember 2024."
        ),
        applies_to="always",
    ),
    Clause(
        ref="Perpres 110/2025 Pasal 55",
        title="Instrumen Nilai Ekonomi Karbon",
        text=(
            "(1) Instrumen NEK dilakukan untuk turut mendukung pencapaian "
            "target NDC.\n"
            "(2) Instrumen NEK sebagaimana dimaksud pada ayat (1) terdiri atas:\n"
            "a. Perdagangan Karbon;\n"
            "b. Pembayaran Berbasis Kinerja;\n"
            "c. Pungutan Atas Karbon; dan/atau\n"
            "d. instrumen lain sesuai dengan perkembangan ilmu pengetahuan, "
            "teknologi, dan ketentuan peraturan perundang-undangan.\n"
            "(3) Instrumen NEK sebagaimana dimaksud pada ayat (1) "
            "dilaksanakan pada Sektor dan Sub Sektor."
        ),
        applies_to="always",
    ),
    Clause(
        ref="Permen LHK P.71/2017 Pasal 2",
        title="Tujuan dan ruang lingkup SRN PPI",
        text=(
            "(1) Penyelenggaraan SRN PPI bertujuan untuk:\n"
            "a. pendataan aksi dan sumber daya adaptasi dan mitigasi "
            "perubahan iklim;\n"
            "b. pengakuan pemerintah atas kontribusi berbagai pihak terhadap "
            "upaya pengendalian perubahan iklim yang terdiri atas adaptasi, "
            "mitigasi, pendanaan, teknologi, dan capacity building;\n"
            "c. penyediaan data dan informasi kepada publik tentang aksi dan "
            "sumber daya serta capaiannya; dan\n"
            "d. menghindari penghitungan ganda (double counting) terhadap "
            "aksi dan sumber daya adaptasi dan mitigasi sebagai bagian "
            "pengelolaan prinsip clarity, transparency dan understanding "
            "(CTU).\n"
            "(2) Ruang lingkup yang diatur dalam Peraturan Menteri ini "
            "meliputi:\n"
            "a. pelaku penyelenggaraan SRN PPI;\n"
            "b. jenis aksi dan sumber daya;\n"
            "c. prosedur penyelenggaraan SRN PPI;\n"
            "d. monitoring, evaluasi, dan pelaporan; dan\n"
            "e. pemberian apresiasi."
        ),
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
