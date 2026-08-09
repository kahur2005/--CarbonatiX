"""One-off generator for a synthetic IMIP Morowali site-spec PDF used for OCR tests."""

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

out = Path(__file__).with_name("site-spec-imip-morowali.pdf")

rows = [
    ("Faktor emisi PLTU captive", "1,0", "tCO2e/MWh"),
    ("Efisiensi termal dryer", "55", "%"),
    ("Energi spesifik EAF", "2.400", "kWh/ton alloy"),
    ("Kadar nikel alloy", "10", "%"),
    ("Efisiensi termal kiln", "55", "%"),
    ("Kuota karbon absolut (periode)", "7.600", "tCO2e"),
]

with PdfPages(out) as pdf:
    fig = plt.figure(figsize=(8.27, 11.69))
    fig.patch.set_facecolor("white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    ax.add_patch(plt.Rectangle((0, 0.88), 1, 0.12, color="#1f3d2b"))
    ax.text(
        0.06,
        0.95,
        "PT IMIP MOROWALI",
        color="white",
        fontsize=16,
        fontweight="bold",
        va="center",
    )
    ax.text(
        0.06,
        0.905,
        "Spesifikasi Teknis Site — RKEF Nickel Pig Iron",
        color="#d7e8dc",
        fontsize=10,
        va="center",
    )

    ax.text(0.06, 0.84, "Dokumen: STS-SITE-2026-08-08", fontsize=9, color="#333")
    ax.text(
        0.06,
        0.815,
        "Lokasi: Kawasan Industri Morowali, Sulawesi Tengah",
        fontsize=9,
        color="#333",
    )
    ax.text(
        0.06,
        0.79,
        "Teknologi proses: RKEF (Rotary Kiln Electric Furnace)",
        fontsize=9,
        color="#333",
    )

    ax.text(0.06, 0.74, "1. Identitas Perusahaan", fontsize=12, fontweight="bold", color="#1f3d2b")
    ax.text(0.08, 0.71, "Nama perusahaan", fontsize=9, color="#555")
    ax.text(0.42, 0.71, "IMIP Morowali", fontsize=10, fontweight="bold")
    ax.text(0.08, 0.685, "Teknologi", fontsize=9, color="#555")
    ax.text(0.42, 0.685, "RKEF", fontsize=10, fontweight="bold")

    ax.text(
        0.06,
        0.64,
        "2. Parameter Site Specifikasi",
        fontsize=12,
        fontweight="bold",
        color="#1f3d2b",
    )
    ax.text(
        0.06,
        0.615,
        "Nilai di bawah adalah spesifikasi site yang dipakai untuk perhitungan emisi.",
        fontsize=8,
        color="#666",
    )

    y0 = 0.57
    col_x = [0.08, 0.52, 0.72]
    header_h = 0.035
    ax.add_patch(plt.Rectangle((0.06, y0), 0.88, header_h, color="#2f6b4f"))
    ax.text(
        col_x[0],
        y0 + header_h / 2,
        "Parameter",
        color="white",
        fontsize=9,
        fontweight="bold",
        va="center",
    )
    ax.text(
        col_x[1],
        y0 + header_h / 2,
        "Nilai",
        color="white",
        fontsize=9,
        fontweight="bold",
        va="center",
    )
    ax.text(
        col_x[2],
        y0 + header_h / 2,
        "Satuan",
        color="white",
        fontsize=9,
        fontweight="bold",
        va="center",
    )

    y = y0
    row_h = 0.038
    for i, (param, nilai, satuan) in enumerate(rows):
        y -= row_h
        bg = "#f3f7f4" if i % 2 == 0 else "white"
        ax.add_patch(plt.Rectangle((0.06, y), 0.88, row_h, color=bg, ec="#c9d5cc"))
        ax.text(col_x[0], y + row_h / 2, param, fontsize=9, va="center")
        ax.text(
            col_x[1],
            y + row_h / 2,
            nilai,
            fontsize=10,
            fontweight="bold",
            va="center",
        )
        ax.text(col_x[2], y + row_h / 2, satuan, fontsize=9, va="center", color="#333")

    note_y = y - 0.06
    ax.text(0.06, note_y, "Catatan OCR / uji sistem", fontsize=11, fontweight="bold", color="#1f3d2b")
    notes = [
        "• Angka memakai format Indonesia: ribuan dengan titik (2.400), desimal dengan koma (1,0).",
        "• Profil dokumen onboarding (site_spec) mengekstrak: EF PLTU, efisiensi dryer, SEC EAF,",
        "  kadar nikel alloy, efisiensi kiln, dan kuota karbon absolut.",
        "• Kuota karbon adalah alokasi absolut per periode (bukan intensitas).",
        "• Dokumen sintetik untuk uji SmartSmelt — bukan data operasional resmi IMIP.",
    ]
    for j, line in enumerate(notes):
        ax.text(0.06, note_y - 0.03 - j * 0.025, line, fontsize=8, color="#444")

    ax.text(
        0.06,
        0.08,
        "Disusun untuk uji unggah onboarding SmartSmelt ERP",
        fontsize=8,
        color="#888",
    )
    ax.text(0.06, 0.055, "Halaman 1 dari 1", fontsize=8, color="#888")

    pdf.savefig(fig, dpi=200)
    plt.close(fig)

print(out)
print(f"bytes={out.stat().st_size}")
