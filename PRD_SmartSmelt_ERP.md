# PRD — SmartSmelt ERP (MVP Demo)

**Versi:** 1.0
**Tanggal:** 1 Agustus 2026
**Organisasi repo:** CarbonatiX
**Konteks:** Proposal BRIN AIdeanation 2026 — Sampoerna University
**Tim:** Audrey Valerie (Sistem Informasi), Darlene Victoria (Manajemen), Embun Kahuripan (Teknik Informatika)
**Periode sprint:** 31 Juli – 14 Agustus 2026

---

## 1. Ringkasan produk

SmartSmelt ERP adalah platform *Enterprise Resource Planning* berbasis AI yang mengubah akuntansi karbon smelter nikel dari laporan retrospektif tahunan menjadi parameter keputusan operasional harian. Sistem menerima parameter produksi fisik smelter, memproyeksikan emisi Scope 1 dan Scope 2 terhadap kuota PTBAE-PU, memproyeksikan harga nikel LME dan kredit karbon IDX Carbon, lalu menghasilkan rekomendasi strategis perdagangan karbon yang dapat ditelusuri ke sumber regulasinya.

Dokumen ini mendefinisikan ruang lingkup **MVP untuk keperluan demo kompetisi**, bukan produk komersial penuh. Pembatasan ruang lingkup dijabarkan pada Bagian 4.2 dan Bagian 11.

**Catatan penamaan:** organisasi dan repositori menggunakan nama `CarbonatiX`, sedangkan produk yang dipresentasikan bernama `SmartSmelt ERP`. Hubungan keduanya perlu diperjelas dalam materi presentasi agar tidak membingungkan juri.

---

## 2. Latar belakang masalah

Ringkasan dari Bab 1 proposal, empat celah yang menjadi dasar produk:

1. **Paradoks nikel Indonesia.** Permintaan logam baterai yang tinggi berdiri di atas pondasi emisi Scope 2 dari PLTU captive berbasis batu bara. Industri nikel menyumbang sekitar 76 persen dari total kapasitas PLTU captive nasional, dengan intensitas emisi 7–10 kali lebih tinggi dibanding rata-rata global.
2. **Tidak ada sistem operasional tersentralisasi.** Mayoritas smelter belum menyatukan data produksi harian (volume bijih, kadar nikel, kelembaban, bauran energi) dengan proyeksi emisi secara real-time.
3. **Kepatuhan masih retrospektif.** Perhitungan emisi umumnya dilakukan tahunan dan terpisah dari sistem ERP operasional, sehingga keputusan produksi diambil tanpa visibilitas dampak emisi.
4. **Kesenjangan keahlian trading.** Partisipasi smelter di IDX Carbon rendah bukan karena tidak ada insentif, melainkan karena tidak tersedia alat maupun keahlian analisis pasar karbon di level perusahaan.

Tekanan waktu berasal dari dua arah: perluasan regulasi domestik ke sektor captive (Perpres 110/2025) dan fase definitif CBAM Uni Eropa yang berlaku sejak 1 Januari 2026.

---

## 3. Target pengguna

Sesuai Bab 3.1 proposal, terdapat tiga peran pengguna di dalam organisasi smelter:

| Peran | Kebutuhan utama | Relevansi untuk MVP |
|---|---|---|
| Sustainability / Compliance Officer | Memantau proyeksi emisi dan status kepatuhan terhadap ambang regulasi | **Persona utama demo** |
| Procurement Manager | Menginput data bahan baku dan bauran energi | Diwakili oleh data dummy |
| C-level (Direktur Operasional/Keuangan) | Menyetujui eksekusi transaksi karbon | Diwakili oleh panel rekomendasi |

Basis pasar: 49 smelter beroperasi (2024), 35 dalam konstruksi, 36 dalam perencanaan — sekitar 120 perusahaan potensial dalam lima tahun.

---

## 4. Tujuan dan batasan MVP

### 4.1 Tujuan

- **G1.** Mendemonstrasikan alur lengkap dari parameter operasional → proyeksi emisi → status kepatuhan → proyeksi harga → rekomendasi perdagangan, tanpa terputus.
- **G2.** Membuktikan bahwa arsitektur tiga lapisan memisahkan penalaran kuantitatif-fisik, kuantitatif-finansial, dan strategis-kualitatif, sehingga setiap keluaran dapat diaudit terpisah.
- **G3.** Menunjukkan transparansi penalaran AI melalui node graph, sebagai jawaban atas kekhawatiran "AI black box".
- **G4.** Menyelesaikan seluruh alur demo dalam kondisi dapat diulang (replayable) untuk presentasi.

### 4.2 Bukan tujuan (out of scope MVP)

Item berikut ada di proposal tetapi **tidak dikerjakan dalam sprint ini**:

- Deployment edge on-premise dengan GPU RTX 4090 dan runtime vLLM/Ollama terkuantisasi.
- Fine-tuning berbasis nilai perusahaan (LoRA) dan Direct Preference Optimization.
- Skor kepercayaan terkalibrasi penuh dengan Expected Calibration Error — MVP hanya memakai *confidence heuristic* sederhana (#19).
- Eksekusi transaksi riil ke bursa IDX Carbon. Tombol eksekusi bersifat mock.
- Validasi lapangan dan fine-tuning dengan data smelter mitra nyata.
- Modul simulasi skenario dekarbonisasi (what-if slider) — tidak muncul di board sprint ini.

---

## 5. Arsitektur sistem

Tiga repositori terpisah:

| Repo | Cakupan |
|---|---|
| `carbonatix-be` | Backend, database, API contract, CI, integrasi end-to-end |
| `carbonatix-ml` | Layer 1, Layer 2, Layer 3, seluruh pipeline data dan model |
| `carbonatix-fe` | Dashboard, digital twin, panel visualisasi, materi demo |

Arsitektur orkestrasi tiga lapisan (Bab 2.2 proposal):

- **Layer 1 — Quantitative Emission Engine.** XGBoost (opsi pelengkap LSTM). Menerima vektor parameter fisik-operasional, memproyeksikan emisi Scope 1 (reduksi karbotermik dan kalsinasi rotary kiln) dan Scope 2 (listrik dari PLTU captive).
- **Layer 2 — Market Quant Engine.** Prophet (alternatif LightGBM). Memproyeksikan harga nikel LME (USD/ton) dan harga kredit karbon IDX Carbon (IDR/ton).
- **Layer 3 — Cognitive Orchestrator.** Qwen2.5-Coder via LangGraph dengan RAG di atas Qdrant. Mensintesis keluaran Layer 1 dan 2 menjadi rekomendasi strategis yang dilandasi klausa regulasi.

---

## 6. Persyaratan fungsional

Setiap persyaratan dipetakan ke nomor issue di GitHub Project.

### 6.1 Fondasi (M0)

| ID | Persyaratan | Issue | Kriteria penerimaan |
|---|---|---|---|
| F-01 | GitHub Project board tersedia dengan milestone dan penugasan | #3 | Board terisi seluruh item; **status: Done** |
| F-02 | Docker Compose menjalankan seluruh service, kontrak API disepakati | #2 | `docker compose up` menjalankan semua service; skema API disepakati sebelum kerja paralel dimulai |
| F-03 | Riset pemilihan model prediksi | #28 | Keputusan kelas model untuk Layer 1 dan Layer 2 terdokumentasi |

### 6.2 Lapisan data (M1)

| ID | Persyaratan | Issue | Kriteria penerimaan |
|---|---|---|---|
| F-04 | Data operasional perusahaan (dummy) tersedia | #8 | Dataset memuat volume bijih, kadar Ni, kelembaban MC, konsumsi daya, temperatur kiln, bauran energi, rasio bio-coke |
| F-05 | Database dan migrasi tabel siap | #10 (be) | Tabel operasional, harga, dan emisi dapat di-query dari backend |
| F-06 | Data harga nikel internasional terkumpul | #9 | Deret waktu harga LME dalam USD/ton tersedia untuk pelatihan |
| F-07 | Data harga IDX Carbon terkumpul via scraping + OCR | #10 (ml) | Angka harga dan volume transaksi terekstrak menjadi JSON terstruktur |
| F-08 | Data berita nikel terfabrikasi tersedia | #29 | Dataset berita tersedia sebagai fitur eksogen; **wajib ditandai sebagai data fabrikasi** dalam dokumentasi dan presentasi |
| F-09 | CI lint dan test berjalan | #4 | Pipeline CI hijau saat push ke branch utama |

**Invariant satuan mata uang (Bab 2.2.2 proposal):** nilai USD dan IDR tidak pernah dicampur. Penamaan medan data wajib mengkodekan satuannya secara eksplisit, contoh `lmeUsdPerTon`, `limitPriceIdr`.

### 6.3 Layer 1 — mesin emisi

| ID | Persyaratan | Issue | Kriteria penerimaan |
|---|---|---|---|
| F-10 | Simulasi termodinamika sintetis RKEF | #12 | Dataset pasangan (parameter operasional → emisi) dihasilkan dari model neraca massa dan energi, mencakup skenario ekstrem |
| F-11 | Endpoint prediksi emisi perusahaan | #20 | Endpoint mengembalikan proyeksi emisi harian (tCO₂e/hari) dan intensitas (tCO₂/tNi) |
| F-12 | Perhitungan kuota PTBAE-PU dan status surplus/defisit | #18 | Menghitung `Cap = V_ore × β_tech`; status tidak patuh bila `E_proj > Cap`. Benchmark awal RKEF ≈ 0,85 dan HPAL ≈ 1,10 tCO₂ per ton bijih, diperlakukan sebagai parameter yang dapat dikalibrasi |
| F-13 | Testing dan integrasi Layer 1 | #21 | Skenario uji terdokumentasi dan lulus |

### 6.4 Layer 2 — mesin pasar

| ID | Persyaratan | Issue | Kriteria penerimaan |
|---|---|---|---|
| F-14 | Model prediksi harga nikel | #13 | Forecast harga LME dengan interval kepercayaan untuk horizon 7–30 hari |
| F-15 | Model prediksi harga IDX Carbon | #14 | Forecast harga kredit karbon IDR/ton untuk horizon yang sama |
| F-16 | Endpoint prediksi harga nikel dan IDX Carbon | #15 | Satu response memuat kedua proyeksi harga dengan satuan mata uang eksplisit |
| F-17 | Testing skenario Layer 2 | #23 | Skenario uji terdokumentasi dan lulus |

### 6.5 Layer 3 — orkestrator kognitif

| ID | Persyaratan | Issue | Kriteria penerimaan |
|---|---|---|---|
| F-18 | Kurasi dan indexing regulasi ke vector DB | #16 | Perpres 98/2021, Permen ESDM 16/2022, Permen ESDM 2/2023, dan Pedoman SRN-PPI terindeks verbatim tanpa parafrasa di Qdrant |
| F-19 | LangGraph workflow | #24 | Setiap tahap penalaran (retrieval → sintesis LLM → trade tool) menjadi node eksplisit dengan status berjalan, selesai, atau gagal |
| F-20 | Prompt engineering rekomendasi strategis | #25 | Output mengevaluasi trade-off antara keuntungan marginal overdrive produksi dan liabilitas karbon, menyertakan angka rupiah dan rujukan pasal |
| F-21 | Endpoint rekomendasi strategis | #26 | Endpoint mengembalikan rekomendasi lengkap dengan jejak audit ke sumber data dan regulasi |
| F-22 | Confidence heuristic sederhana | #19 | Setiap rekomendasi disertai skor kepercayaan; rekomendasi di bawah ambang dieskalasi ke pengguna, bukan disajikan sebagai saran eksekusi |
| F-23 | Testing dan integrasi Layer 3 | #27 | Skenario uji terdokumentasi dan lulus |

**Prinsip yang tidak boleh dilanggar:** klausa hukum disuntikkan verbatim ke konteks prompt. Penyebutan jangkar regulasi dikutip persis, tidak diparafrase. LLM tidak boleh menghasilkan angka emisi sendiri — angka selalu berasal dari Layer 1 dan Layer 2.

### 6.6 Antarmuka pengguna

| ID | Persyaratan | Issue | Kriteria penerimaan |
|---|---|---|---|
| F-24 | Digital Twin 3D | #1 | Model placeholder dapat ditampilkan, node dapat diklik untuk inspeksi unit proses |
| F-25 | Panel monitoring emisi perusahaan | #2 (fe) | Menampilkan total emisi, intensitas tCO₂/tNi, dan posisi terhadap kuota. Tahap awal memakai mock data |
| F-26 | Panel proyeksi harga nikel | #3 (fe) | Menampilkan proyeksi harga dengan band kepercayaan. Tahap awal memakai mock data |
| F-27 | Wiring ke API real, panel rekomendasi, node graph | #8 (be) | Seluruh panel terhubung ke endpoint asli; node graph menampilkan alur penalaran Layer 3 |

### 6.7 Integrasi dan demo (M3)

| ID | Persyaratan | Issue | Kriteria penerimaan |
|---|---|---|---|
| F-28 | Support integrasi end-to-end | #6 (be) | Alur dari input dummy sampai rekomendasi tampil tanpa error |
| F-29 | Storyline data demo (skenario overdrive) | #4 (fe) | Skenario dapat diputar ulang secara konsisten |
| F-30 | Storyline harga demo | #5 (fe) | Data harga demo konsisten dengan storyline emisi |
| F-31 | Testing UI end-to-end bersama tim | #7 (fe) | Seluruh anggota memverifikasi alur pada perangkat masing-masing |
| F-32 | Support demo dan Q&A teknis | #6 (fe) | Penanggung jawab ditunjuk untuk menjawab pertanyaan teknis juri |
| F-33 | Rekam video demo cadangan | #8 (fe) | Video 2–3 menit siap diputar bila live demo gagal |
| F-34 | Gladi resik | #9 (fe) | Presentasi dijalankan penuh minimal satu kali sebelum hari-H |

---

## 7. Skenario demo acuan

Diambil dari contoh output pada Bab 4.7 proposal dan prototipe dashboard:

> Harga nikel LME naik 8,5 persen, sistem menyarankan menaikkan produksi ke 105 persen (overdrive). Emisi melampaui batas kuota 45.000 ton, tetapi harga karbon IDX Carbon sedang rendah (Rp35.200 per ton). Sistem siap mengeksekusi pembelian 120.750 ton kredit karbon untuk mengeliminasi denda pajak Rp1,35 miliar, sekaligus menghasilkan net margin tambahan Rp19,8 miliar.

Angka acuan pada prototipe dashboard: total 525.000 tCO₂e YTD, intensitas 52,5 tCO₂/tNi, target kuota 480.000 tCO₂e, net carbon position −45.000 tCO₂e.

**Konsistensi angka antara demo, PRD, dan proposal wajib diverifikasi sebelum presentasi.** Perbedaan angka antara slide dan aplikasi adalah temuan yang mudah dilihat juri.

---

## 8. Milestone dan jadwal

| Milestone | Jumlah item | Rentang tanggal |
|---|---|---|
| M0 — Fondasi | 3 | 31 Juli – 4 Agustus |
| M1 — Data dan model inti | 15 | 3 – 7 Agustus |
| M2 — Orkestrasi dan integrasi | 11 | 5 – 9 Agustus |
| M3 — Demo dan polish | 6 | 11 – 14 Agustus |

Total 35 item kerja.

---

## 9. Pembagian tanggung jawab

| Anggota | Fokus utama | Jumlah penugasan |
|---|---|---|
| kahur2005 | Layer 1, sebagian Layer 3, panel frontend, digital twin | 16 item (tertinggi) |
| ichlasulhsnt | Layer 3 (LangGraph, prompt, endpoint), storyline demo | 9 item |
| indah0503 | Backend, database, CI, wiring API, integrasi | 6 item |
| irma5hourglass | Layer 2 (harga nikel) | 5 item |
| KyrieleisonFrans | Layer 2 (harga IDX Carbon) | 5 item |

Sebagian item dikerjakan berpasangan (ditandai penugasan ganda pada board).

---

## 10. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Beban kerja kahur2005 tidak seimbang** — 16 dari 35 item, mencakup tiga repo sekaligus | Satu orang menjadi bottleneck seluruh proyek | Distribusikan ulang minimal item frontend (#1, #2, #3) ke anggota lain; lihat Bagian 12 |
| Tiga item M3 belum punya penanggung jawab dan tanggal (#6, #8, #9) | Gladi resik dan video cadangan berpotensi tidak terjadi | Tetapkan pemilik dan tanggal sebelum 8 Agustus |
| Testing UI berakhir 14 Agustus, sedangkan gladi resik belum terjadwal | Tidak ada waktu perbaikan setelah testing | Majukan testing ke 12 Agustus, sisakan 13–14 untuk perbaikan dan gladi resik |
| OCR IDX Carbon gagal atau tidak akurat (#10 ml) | Layer 2 kehilangan sumber harga karbon | Siapkan fallback berupa data harga yang dikumpulkan manual |
| Layer 3 bergantung pada selesainya Layer 1 dan Layer 2 | Keterlambatan berantai ke rekomendasi | Sepakati kontrak API Layer 1 dan 2 di awal (#2) agar Layer 3 dapat dibangun dengan mock response |
| Data operasional, termodinamika, dan berita seluruhnya sintetis atau fabrikasi | Kredibilitas dipertanyakan bila tidak diungkap | Nyatakan terbuka sebagai proyeksi ilmiah dan hipotesis terukur, sebagaimana posisi yang sudah diambil proposal |

---

## 11. Asumsi dan keterbatasan yang wajib diungkap

Proposal sudah memposisikan seluruh capaian sebagai proyeksi ilmiah dan hipotesis terukur, bukan klaim empiris yang tervalidasi lapangan. MVP ini harus konsisten dengan posisi tersebut:

1. Data operasional perusahaan adalah **data dummy**, bukan data smelter nyata.
2. Data pelatihan Layer 1 berasal dari **simulasi termodinamika sintetis**, dikalibrasi terhadap benchmark publik regional.
3. Data berita nikel adalah **data yang difabrikasi** untuk keperluan demo.
4. Eksekusi perdagangan bersifat **mock**, tidak terhubung ke bursa IDX Carbon sesungguhnya.
5. Nilai benchmark intensitas per teknologi adalah **parameter yang dapat dikalibrasi**, bukan konstanta tetap.
6. Sistem diposisikan sebagai **decision support**, bukan pengganti otoritas manusia. Rekomendasi di bawah ambang kepercayaan dieskalasi ke pengambil keputusan.

---

## 12. Rekomendasi tindak lanjut sebelum eksekusi

1. Tetapkan penanggung jawab dan tanggal untuk #6, #8, dan #9 (M3).
2. Isi kolom Estimate — seluruh milestone saat ini menunjukkan `Estimate: 0`, sehingga beban kerja tidak dapat diukur objektif.
3. Redistribusi beban kahur2005, terutama item frontend yang dapat dikerjakan paralel oleh anggota lain.
4. Majukan jadwal testing UI agar ada ruang perbaikan sebelum gladi resik.
5. Perjelas hubungan penamaan CarbonatiX dan SmartSmelt ERP di seluruh materi.
