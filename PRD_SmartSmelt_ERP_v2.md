# PRD — SmartSmelt ERP Web (v2)

**Versi:** 2.0
**Tanggal:** 3 Agustus 2026
**Menggantikan:** `PRD_SmartSmelt_ERP.md` (v1.0, 1 Agustus 2026)
**Organisasi repo:** CarbonatiX
**Produk:** SmartSmelt ERP
**Konteks:** Proposal BRIN AIdeanation 2026 — Sampoerna University
**Tim:** Audrey Valerie (Sistem Informasi), Darlene Victoria (Manajemen), Embun Kahuripan (Teknik Informatika)

---

## 1. Ringkasan produk

SmartSmelt ERP adalah aplikasi web yang menerima data perusahaan smelter nikel, menghitung proyeksi emisi karbon Scope 1 dan Scope 2 dari proses RKEF dan PLTU captive, memproyeksikan harga nikel LME dan harga kredit karbon IDX Carbon, lalu menghasilkan rekomendasi strategis yang dilandasi klausa regulasi.

Perbedaan mendasar dengan v1: **proyeksi emisi tidak lagi menggunakan model machine learning.** Emisi dihitung dengan algoritma neraca massa dan energi RKEF yang deterministik — setiap angka dapat ditelusuri ke rumusnya. Machine learning hanya dipakai pada dua tempat yang memang membutuhkannya: peramalan harga nikel dan peramalan harga kredit karbon.

Dokumen ini adalah spesifikasi lengkap dan menggantikan v1 seluruhnya.

**Catatan penamaan:** organisasi dan repositori memakai nama `CarbonatiX`, produk yang dipresentasikan bernama `SmartSmelt ERP`. Hubungan keduanya wajib diperjelas dalam materi presentasi.

---

## 2. Perubahan ruang lingkup dari v1

| Aspek | v1 | v2 | Alasan |
|---|---|---|---|
| Proyeksi emisi | XGBoost / LSTM dilatih atas simulasi termodinamika sintetis | **Algoritma deterministik** neraca massa dan energi RKEF | Menghapus satu lapisan ketidakpastian. Model ML yang dilatih atas data sintetis pada akhirnya hanya mempelajari kembali rumus yang menghasilkan data itu, dengan tambahan galat aproksimasi. Rumus langsung lebih akurat, lebih cepat, dan sepenuhnya dapat diaudit |
| Peramalan harga | Prophet / LightGBM | **Tetap**, sebagai artefak model pra-latih | Tidak berubah |
| Lapisan 3 | Qwen2.5-Coder lokal, LangGraph, Qdrant, LoRA, DPO | **Cloud AI API** (Claude), korpus regulasi terkurasi tanpa vector DB | Menghilangkan kebutuhan GPU dan runtime lokal |
| OCR | PaddleOCR untuk poster harian IDX Carbon | **Cloud vision API** untuk dokumen operasional dan spesifikasi situs milik perusahaan | Sumber data harga menjadi dataset historis terpaket; OCR dialihkan ke input pengguna, tempat nilainya jauh lebih besar |
| Edge AI on-premise | Bagian dari arsitektur | **Dihapus dari MVP** | Tetap menjadi arah produk jangka panjang, bukan lingkup sprint |
| Digital Twin 3D | Panel visualisasi pasif | **Antarmuka input utama** | Node pada twin menjadi tempat pengguna memasukkan atau mengunggah data per tahap proses |
| Autentikasi | Tidak ada | **Login / register sederhana** | Pengguna baru mendaftar, data tersimpan per akun |

---

## 3. Latar belakang masalah

Ringkasan Bab 1 proposal. Empat celah yang menjadi dasar produk:

1. **Paradoks nikel Indonesia.** Permintaan logam baterai berdiri di atas pondasi emisi Scope 2 dari PLTU captive batu bara. Industri nikel menyumbang sekitar 76 persen kapasitas PLTU captive nasional, dengan intensitas emisi 7–10 kali lebih tinggi dari rata-rata global.
2. **Tidak ada sistem operasional tersentralisasi.** Mayoritas smelter belum menyatukan data produksi harian dengan proyeksi emisi.
3. **Kepatuhan masih retrospektif.** Perhitungan emisi umumnya tahunan dan terpisah dari sistem operasional harian.
4. **Kesenjangan keahlian trading.** Partisipasi smelter di IDX Carbon rendah karena tidak tersedia alat maupun keahlian analisis pasar karbon di level perusahaan.

Tekanan waktu datang dari dua arah: perluasan regulasi domestik ke sektor captive (Perpres 110/2025) dan fase definitif CBAM Uni Eropa sejak 1 Januari 2026.

---

## 4. Target pengguna

| Peran | Kebutuhan utama | Relevansi MVP |
|---|---|---|
| Sustainability / Compliance Officer | Memantau proyeksi emisi dan status kepatuhan | **Persona utama** |
| Procurement / Production Manager | Menginput data bahan baku dan bauran energi | Pengguna node Digital Twin |
| C-level | Menyetujui eksekusi transaksi karbon | Pembaca panel rekomendasi |

Basis pasar: 49 smelter beroperasi (2024), 35 konstruksi, 36 perencanaan — sekitar 120 perusahaan potensial dalam lima tahun.

---

## 5. Tujuan dan batasan

### 5.1 Tujuan

- **G1.** Alur lengkap tanpa terputus: registrasi → spesifikasi situs → input operasional per node → proyeksi emisi → status kepatuhan → proyeksi harga → rekomendasi strategis.
- **G2.** Setiap angka emisi dapat ditelusuri ke rumus dan konstanta pembentuknya, bukan ke bobot model.
- **G3.** Menurunkan hambatan input data melalui OCR, tanpa pernah menulis nilai hasil ekstraksi tanpa verifikasi pengguna.
- **G4.** Menunjukkan transparansi penalaran AI melalui node graph.
- **G5.** Alur demo dapat diulang secara konsisten.

### 5.2 Bukan tujuan

- Deployment edge on-premise, GPU lokal, runtime vLLM/Ollama.
- Fine-tuning LoRA berbasis nilai perusahaan dan Direct Preference Optimization.
- Skor kepercayaan terkalibrasi penuh dengan Expected Calibration Error.
- Eksekusi transaksi riil ke bursa IDX Carbon. Tombol eksekusi bersifat mock.
- Validasi lapangan dengan data smelter mitra nyata.
- Scraping harian poster IDX Carbon.
- Modul HPAL. MVP hanya mencakup RKEF.
- **Simulator what-if.** Ditunda; lihat Bagian 19.

---

## 6. Arsitektur sistem

Tiga deployable. Peramban berbicara ke Next.js untuk halaman, dan langsung ke FastAPI untuk komputasi dengan membawa JWT Supabase. FastAPI memverifikasi JWT memakai Supabase JWT secret. Pemanggilan langsung dipilih karena rekomendasi dikirim sebagai stream, dan hop tambahan melalui route handler Next.js tidak memberi manfaat.

```
Next.js (Vercel)          FastAPI (Python)              Supabase
─────────────────         ────────────────              ────────
Digital Twin 3D           emissions/   calculator       auth (email + password)
Dashboard                 emissions/   compliance       Postgres
Node graph                forecasting/ artifacts        Storage (unggahan)
Auth + onboarding         ingestion/   vision, mapping
                          advisor/     corpus, prompt,
                                       pipeline
                                   │
                                   └──► Claude API (teks + vision), satu API key
```

### 6.1 Modul backend

| Modul | Tanggung jawab | Bergantung pada |
|---|---|---|
| `emissions/constants.py` | `ProcessConstants`, `DEFAULT_CONSTANTS`, validasi mandiri saat konstruksi | — |
| `emissions/calculator.py` | `calculate_emissions`, `EmissionResult`, `from_snapshot` | constants |
| `emissions/compliance.py` | Kuota PTBAE-PU, surplus/defisit, paparan rupiah | keluaran calculator + harga forecast |
| `forecasting/service.py` | Memuat artefak `.pkl` sekali saat boot, `predict(horizon)` | artefak |
| `ingestion/vision.py` | Dokumen → medan hasil ekstraksi mentah | Claude vision |
| `ingestion/mapping.py` | Medan mentah → kandidat per node twin, dengan skor keyakinan | schemas |
| `advisor/corpus.py` | Klausa regulasi terkurasi, berversi | — |
| `advisor/prompt.py` | Menyusun prompt, menyuntikkan klausa verbatim dan angka | corpus |
| `advisor/pipeline.py` | Empat tahap rekomendasi, memancarkan event SSE | prompt, keluaran calculator + forecast |

`calculator.py` tetap murni: tidak mengetahui HTTP, basis data, maupun sesi. Konsekuensinya, modul ini dapat dipakai ulang untuk simulator what-if di kemudian hari tanpa perubahan satu baris pun.

### 6.2 Endpoint

| Metode | Path | Fungsi |
|---|---|---|
| `POST` | `/emissions` | Stateless. Menerima delapan parameter, mengembalikan `EmissionResult` penuh. Tanpa tulis basis data |
| `POST` | `/runs` | Commit. Menyimpan snapshot input, hasil, status kepatuhan, dan forecast saat itu |
| `GET` | `/runs/{id}` | Mengambil run tersimpan |
| `GET` | `/runs/{id}/recommendation` | SSE. Memancarkan status tiap tahap pipeline, lalu teks rekomendasi |
| `GET` | `/forecasts` | Proyeksi harga nikel dan IDX Carbon untuk horizon 7–30 hari |
| `POST` | `/documents` | Unggah dokumen, mengembalikan kandidat hasil ekstraksi |
| `GET`/`PUT` | `/company` | Spesifikasi situs |

---

## 7. Mesin emisi

Sumber kebenaran tunggal untuk seluruh angka emisi. Deterministik, murni, tanpa model terlatih.

### 7.1 Batas cakupan

- **Scope 1** (langsung): pembakaran dryer, pemanasan kiln, reduktor kiln.
- **Scope 2** (listrik captive): electric arc furnace.

Seluruh angka emisi dinyatakan dalam tCO₂e untuk satu interval produksi yang dideskripsikan oleh input.

### 7.2 Parameter masukan

Delapan parameter, seluruhnya keyword-only. Argumen posisional ditolak karena beberapa parameter memiliki magnitudo yang berdekatan sehingga tertukar tanpa terdeteksi.

| Parameter | Simbol | Satuan | Pemilik node twin |
|---|---|---|---|
| `wet_ore_input_tons` | V_wet | ton | Stockpile bijih |
| `moisture_content_pct` | MC | fraksi 0–1 | Stockpile bijih |
| `nickel_grade_pct` | Ni | fraksi 0–1, atas basis **kering** | Stockpile bijih |
| `reductant_biocoke_pct` | ρ | fraksi 0–1 | Rotary kiln |
| `sec_eaf_kwh_per_t_alloy` | SEC | kWh per ton **alloy tapped** | Electric arc furnace |
| `power_mix_captive_coal` | φ | fraksi 0–1 | PLTU captive |
| `ef_captive_pltu` | EF_PLTU | tCO₂e/MWh | PLTU captive |
| `dryer_thermal_efficiency` | η_dryer | fraksi (0, 1] | Rotary dryer |

`power_mix_hydro_grid` divalidasi bersama `power_mix_captive_coal` agar berjumlah 1,0, tetapi tidak pernah masuk aritmetika karena diperlakukan nol-emisi.

### 7.3 Konstanta proses

`ProcessConstants` memvalidasi dirinya sendiri saat konstruksi.

| Konstanta | Peran |
|---|---|
| `recovery_yield` | Fraksi perolehan nikel |
| `delta_h_vap` | Entalpi penguapan air |
| `lhv_coal` | Nilai kalor bawah batu bara |
| `ef_coal_thermal` | Faktor emisi batu bara termal, tCO₂e per ton |
| `kiln_thermal_efficiency` | Efisiensi termal kiln |
| `k_heat` | Kebutuhan panas spesifik kiln per ton bijih kering |
| `k_stoic` | Kebutuhan reduktor stoikiometrik per ton nikel |
| `ef_reductant` | Faktor emisi kokas reduktor, tCO₂e per ton |
| `alloy_nickel_grade` | Kadar nikel dalam alloy tapped (NPI ≈ 0,1; ferronikel ≈ 0,3) |

### 7.4 Rumus

```
dry_fraction   = 1 − MC
m_dry          = V_wet × dry_fraction
m_water        = V_wet × MC

m_Ni           = V_wet × dry_fraction × Ni × recovery_yield

coal_dryer     = (m_water × delta_h_vap) / (lhv_coal × η_dryer)
E_dryer        = coal_dryer × ef_coal_thermal

coal_kiln      = (m_dry × k_heat) / (lhv_coal × kiln_thermal_efficiency)
E_kiln_heat    = coal_kiln × ef_coal_thermal

m_reductant    = m_Ni × k_stoic × (1 − ρ)
E_kiln_red     = m_reductant × ef_reductant

m_alloy        = m_Ni / alloy_nickel_grade
MWh            = (m_alloy × SEC) / 1000
E_EAF          = MWh × (φ × EF_PLTU)

E_total        = E_dryer + E_kiln_heat + E_kiln_red + E_EAF
Scope_1        = E_dryer + E_kiln_heat + E_kiln_red
Scope_2        = E_EAF
I              = E_total / m_Ni          (None bila m_Ni = 0)
```

Tiga hal yang layak ditegaskan tentang rumus ini:

- **Dryer dan kiln memodelkan fisika yang identik.** Keduanya membagi kebutuhan panas dengan efisiensi termal untuk mencapai input bahan bakar. Yang berbeda hanya angka efisiensinya, dan efisiensi kiln tidak tersedia dalam snapshot ERP sehingga diperlakukan sebagai konstanta.
- **Reduktor adalah kokas, bukan batu bara termal**, dan memikul faktor emisi sendiri yang jauh lebih tinggi per ton.
- **SEC dikutip per ton alloy tapped, bukan per ton nikel terkandung.** Industri mengutipnya atas basis produk. Variabel ERP `SEC_EAF_KWH_PER_TNI` salah nama. Konversi ke tonase alloy dilakukan lebih dulu; melewatkan langkah ini akan menyatakan energi tungku terlalu rendah sebesar faktor `1 / alloy_nickel_grade` — faktor sepuluh untuk NPI. Penggantian nama terjadi di batas `from_snapshot`, agar ketidaksesuaian terlihat alih-alih diam-diam memangkas jejak karbon pabrik menjadi separuhnya.

### 7.5 Dua penggerak emisi: bijih dan nikel

Struktur rumus memisahkan empat suku emisi menjadi dua kelompok yang berperilaku berbeda. Pemisahan ini menentukan hampir seluruh keputusan desain produk dan wajib dipahami sebelum membaca bagian mana pun setelahnya.

| Kelompok | Suku | Bergantung pada | Tidak bergantung pada |
|---|---|---|---|
| **Digerakkan bijih** | `dryer_emissions`, `kiln_heat_emissions` | `wet_ore_input_tons`, `moisture_content_pct`, efisiensi termal | kadar nikel, output nikel |
| **Digerakkan nikel** | `kiln_reductant_emissions`, `eaf_emissions` | `nickel_output_tons` | volume bijih secara langsung |

Konsekuensinya:

**Kadar bijih memutus kaitan antara produksi dan emisi.** Pada volume bijih tetap, menaikkan kadar dari 1,2 persen ke 2,6 persen membiarkan suku dryer dan kiln **tidak berubah sama sekali**, sementara output nikel naik dua kali lipat. Intensitas turun dari sekitar 86 ke 56 tCO₂/tNi tanpa satu pun perubahan operasional. Bijih yang lebih kaya adalah keunggulan emisi, dan sistem harus menampilkannya sebagai demikian.

**Emisi bukan kelipatan tetap dari tonase nikel.** Pada output nikel yang dipertahankan konstan, kombinasi lever — biocoke, bauran daya, efisiensi dryer — menghasilkan rentang emisi sekitar 28 persen. Selisih itulah alasan produk ini ada. Bila emisi benar-benar merupakan fungsi tonase semata, tidak ada keputusan yang perlu didukung.

**Elastisitas lever** (perubahan emisi total untuk +10 persen pada tiap masukan):

| Masukan | Δ emisi total |
|---|---|
| `wet_ore_input_tons` | **+10,00%** |
| `nickel_grade_pct` | +4,49% |
| `sec_eaf_kwh_per_t_alloy` | +3,54% |
| `ef_captive_pltu` | +3,54% |
| `power_mix_captive_coal` (−10%) | −3,54% |
| `reductant_biocoke_pct` (0 → 50%) | −4,72% |
| `dryer_thermal_efficiency` | −2,03% |
| `moisture_content_pct` | −1,43% |

Angka-angka ini dihitung dengan konstanta yang belum terkalibrasi dan bersifat indikatif. Yang tidak bergantung pada kalibrasi adalah **elastisitas volume bijih yang tepat 1,0**: emisi total sebanding sempurna terhadap volume bijih. Bagian 8 menjelaskan mengapa fakta ini menentukan bentuk kuota.

**Kelembaban bertanda negatif.** Kelembaban lebih tinggi berarti bahan bakar pengeringan lebih banyak, tetapi pada `wet_ore_input_tons` tetap juga berarti lebih sedikit bijih sesungguhnya, lebih sedikit nikel, dan beban reduktor serta tungku lebih rendah — bersih −1,43 persen. Emisi total turun sementara intensitas per ton nikel naik. Antarmuka wajib menampilkan keduanya pada node stockpile; menampilkan total saja membuat bijih basah tampak seperti perbaikan.

### 7.6 Keluaran

`EmissionResult` mengembalikan hasil beserta seluruh perantara, agar pemanggil dapat melaporkan, memetakan, dan memeriksa ulang perhitungan tanpa mengulanginya.

Produksi: `nickel_output_tons`, `alloy_output_tons`.
Scope 1: `dryer_emissions`, `kiln_heat_emissions`, `kiln_reductant_emissions`.
Scope 2: `eaf_emissions`.
Total: `total_emissions`.
Perantara: `dry_ore_tons`, `dryer_coal_tons`, `kiln_coal_tons`, `reductant_tons`, `eaf_mwh`.
Turunan: `scope_1`, `scope_2`, `intensity_per_tonne_ni`.

`intensity_per_tonne_ni` mengembalikan `None`, bukan `0.0`, ketika tidak ada nikel yang di-tap. Interval yang mengeringkan dan mengkalsinasi bijih tetapi tidak menghasilkan logam tetap mengemisi; mengembalikan `0.0` akan melaporkan intensitas *terbaik yang mungkin* untuk interval *terburuk yang mungkin*, sedangkan `inf` atau `nan` akan meracuni agregat di hilir tanpa terdeteksi.

### 7.7 Mode baseline

`from_snapshot(use_baseline=True)` mensubstitusi lever baseline perusahaan — seluruh daya batu bara, tanpa biocoke — dan membiarkan sisanya tidak berubah. Ini menghasilkan pembanding "sebelum optimasi" yang dipakai dashboard untuk menampilkan delta.

---

## 8. Mesin kepatuhan

### 8.1 Mengapa kuota tidak boleh proporsional terhadap volume bijih

PRD v1 memakai `Cap = V_ore × β_tech`. Rumus itu **dibuang**, dan alasannya bersifat aritmetik, bukan preferensi.

Emisi total sebanding sempurna terhadap volume bijih — elastisitas tepat 1,0 (Bagian 7.5). Bila kuota juga sebanding terhadap volume bijih, maka volume produksi **saling meniadakan pada kedua sisi pertidaksamaan**. Menaikkan produksi 5 persen menaikkan emisi 5 persen dan menaikkan kuota 5 persen; margin kepatuhan tidak bergerak sedikit pun.

Dua konsekuensi mematikan:

1. **Kuota proporsional hanya dapat dilanggar oleh efisiensi lever, tidak pernah oleh keputusan produksi.** Padahal keputusan produksi adalah justru yang ingin didukung sistem ini.
2. **Skenario demo utama menjadi mustahil secara aritmetik.** Alur "naikkan produksi ke 105 persen overdrive → emisi melampaui kuota → beli kredit karbon" tidak dapat terjadi ketika kuota ikut tumbuh 5 persen bersama throughput-nya.

Verifikasi numerik menunjukkan hal ketiga: dengan β = 0,85 tCO₂ per ton bijih basah, dua belas dari dua belas konfigurasi wajar berstatus surplus dengan margin sekitar 36 persen yang tidak dapat ditutup oleh lever mana pun. Membaca β atas basis bijih kering dan mengoreksi SEC ke nilai yang wajar secara fisik membalik hasilnya menjadi 24 dari 27 konfigurasi defisit. Status kepatuhan ternyata ditentukan oleh konvensi basis dan kalibrasi konstanta, bukan oleh tindakan operator. Selalu hijau dan selalu merah sama-sama tidak berguna.

### 8.2 Kuota sebagai alokasi absolut

```
Cap          = alokasi_periode                    (tCO2e, medan spesifikasi situs)
Status       = patuh bila E_total ≤ Cap
Posisi       = E_total − Cap                      (positif = defisit, negatif = surplus)
Nilai        = |Posisi| × harga_karbon_forecast_IDR
```

Kuota adalah **angka absolut dalam tCO₂e untuk satu periode**, dimasukkan pengguna sebagai bagian dari spesifikasi situs. Bukan rumus turunan.

Ini juga lebih akurat secara regulasi. PTBAE-PU yang sesungguhnya adalah **alokasi yang diterbitkan Kementerian ESDM kepada satu pelaku usaha bernama**, bukan angka yang dihitung sendiri oleh vendor perangkat lunak dari volume bijihnya. Perusahaan memasukkan alokasi yang dipegangnya; sistem membandingkan proyeksi terhadap alokasi itu.

Dengan kuota absolut, kedua sisi panel perdagangan dapat dicapai: overdrive menghasilkan defisit, perbaikan lever menghasilkan surplus.

### 8.3 Pembantu "turunkan dari baseline"

Bagi pengguna yang belum memiliki angka alokasi, medan kuota menyediakan pembantu:

```
Cap_saran = E_baseline × (1 − target_reduksi)
```

`E_baseline` dihitung memakai jalur `use_baseline=True` yang sudah ada pada calculator — seluruh daya batu bara, tanpa biocoke. Ini adalah alokasi berbasis *grandfathering*, cara yang dipakai mayoritas skema cap-and-trade nyata untuk mengalokasikan kuota awal.

Pembantu ini mengisi medan, lalu pengguna dapat menyuntingnya. Nilai tersimpan tetap berupa angka absolut. β benchmark per teknologi (RKEF ≈ 0,85 tCO₂ per ton bijih **kering**) dipertahankan hanya sebagai saran nilai kedua, dengan basis bijih dinyatakan eksplisit — ambiguitas basah versus kering pada v1 adalah galat sebesar faktor 1,5.

**Pengungkapan wajib:** PLTU captive saat ini berada **di luar** cakupan wajib skema PTBAE-PU. Badge "TIDAK PATUH" menyatakan status **hipotetis** di bawah rezim yang diperluas, bukan pelanggaran hukum yang berlaku hari ini. Antarmuka wajib menyatakan hal ini pada panel kepatuhan itu sendiri. Sistem diposisikan sebagai alat kesiapan regulasi.

---

## 9. Mesin peramalan harga

Dua model terpisah, dilatih di luar aplikasi dan dikirim sebagai artefak. Tidak ada pelatihan saat request.

| Model | Target | Satuan | Kelas model |
|---|---|---|---|
| Nikel LME | Harga nikel global | `lmeUsdPerTon` | Prophet (alternatif LightGBM) |
| IDX Carbon | Harga kredit karbon domestik | `limitPriceIdr` | Prophet (alternatif LightGBM) |

Horizon 7–30 hari, disertai interval kepercayaan. Artefak `.pkl` disimpan dalam repo dan dimuat sekali saat boot.

**Invariant satuan mata uang.** Nilai USD dan IDR tidak pernah dicampur. Penamaan medan data wajib mengkodekan satuannya secara eksplisit. Tidak ada objek response yang memuat nilai USD dan IDR sekaligus di bawah nama tanpa sufiks satuan.

**Sumber data.** Deret historis harga nikel LME dan harga IDX Carbon dikumpulkan sekali, disimpan sebagai tabel `price_history` terpaket, dan dipakai baik untuk pelatihan maupun untuk menggambar konteks historis pada grafik. Tidak ada scraping saat runtime.

---

## 10. Pipeline ingestion (OCR)

### 10.1 Dua profil dokumen

Pembedaan antara "data operasional" dan "spesifikasi situs" bersifat nyata dan mengikuti seberapa sering nilainya berubah.

**Spesifikasi situs** — ditetapkan sekali saat onboarding, jarang berubah:
`ef_captive_pltu`, `dryer_thermal_efficiency`, `sec_eaf_kwh_per_t_alloy`, `alloy_nickel_grade`, `kiln_thermal_efficiency`, teknologi (RKEF), dan **alokasi kuota periode** (tCO₂e absolut, Bagian 8.2).

**Data operasional** — per interval, lever harian:
`wet_ore_input_tons`, `moisture_content_pct`, `nickel_grade_pct`, `reductant_biocoke_pct`, `power_mix_captive_coal` / `power_mix_hydro_grid`.

Keduanya memiliki target ekstraksi berbeda dan titik unggah berbeda: spesifikasi situs diunggah saat onboarding, laporan operasional diunggah pada node twin.

### 10.2 Aturan yang tidak boleh dilanggar

**OCR tidak pernah menulis nilai secara otomatis.** Setiap medan hasil ekstraksi tiba sebagai *kandidat*, disertai skor keyakinan dan potongan gambar wilayah sumbernya. Pengguna menerima atau mengoreksi. Keyakinan rendah ditandai. Medan yang tidak terbaca dibiarkan kosong, bukan ditebak.

Inilah pembeda antara OCR yang mempercepat entri data dan OCR yang diam-diam mengarang jejak karbon sebuah pabrik.

Format yang didukung: PDF, JPG/PNG (termasuk foto ponsel dan hasil pindai miring), XLSX.

---

## 11. Advisor (Layer 3)

Cloud AI API. Empat tahap, masing-masing menjadi satu node pada node graph dengan status berjalan, selesai, atau gagal.

1. **Retrieve** — memilih klausa regulasi yang relevan dari korpus terkurasi berdasarkan status kepatuhan.
2. **Assemble** — merangkai seluruh angka: breakdown emisi, posisi terhadap kuota, kedua proyeksi harga.
3. **Synthesise** — memanggil Claude API dengan klausa verbatim dan angka tersuntik.
4. **Verify** — memeriksa bahwa setiap angka pada keluaran berasal dari himpunan angka yang disuplai.

### 11.1 Korpus regulasi

Diindeks verbatim tanpa parafrasa, disimpan sebagai berkas berversi:

- Perpres 98/2021 tentang Nilai Ekonomi Karbon
- Perpres 110/2025
- Permen ESDM 16/2022 (PTBAE-PU, termasuk sanksi pemotongan kuota 25 persen)
- Permen ESDM 2/2023 (tata cara)
- Pedoman SRN-PPI

Tidak memakai vector database. Korpus berjumlah beberapa puluh klausa, dan penyuntikan verbatim atas klausa yang dipilih justru lebih kuat terhadap prinsip anti-parafrasa proposal dibanding retrieval berbasis kemiripan embedding, yang dapat mengambil klausa keliru tanpa terdeteksi.

### 11.2 Prinsip yang tidak boleh dilanggar

- **LLM tidak boleh menghasilkan angka emisi maupun harga sendiri.** Seluruh angka disuplai dalam prompt. Tahap Verify mengekstrak numeral dari keluaran dan mencocokkannya; angka yang tidak cocok menandai rekomendasi alih-alih menyajikannya sebagai saran.
- **Klausa hukum disuntikkan verbatim** dan dikutip dengan nomor pasal.
- **Skor kepercayaan sederhana** menyertai setiap rekomendasi. Rekomendasi di bawah ambang dieskalasi ke pengguna, bukan disajikan sebagai saran eksekusi.

Sistem adalah **decision support**, bukan pengganti otoritas manusia.

---

## 12. Model data

| Tabel | Isi |
|---|---|
| `auth.users` | Dikelola Supabase |
| `companies` | Satu per pengguna. Nama, teknologi, medan spesifikasi situs, alokasi kuota periode (tCO₂e), override konstanta |
| `calculation_runs` | Snapshot commit yang immutable: input, `EmissionResult`, kepatuhan, forecast saat itu |
| `recommendations` | `run_id`, jejak tahap untuk node graph, teks, sitasi, id model |
| `documents` | Referensi storage, profil (site-spec / operational), JSON ekstraksi, flag diterima |
| `price_history` | Deret historis `lme_usd_per_ton`, `idx_carbon_idr_per_ton` |
| `forecasts` | Keluaran harian ter-cache |

`calculation_runs` **menyimpan** forecast yang dipakainya, bukan melakukan join ke tabel forecast saat dibaca. Tanpa itu, membuka kembali run kemarin akan menampilkan emisi kemarin terhadap harga karbon hari ini, dan angka rupiah di layar berhenti cocok dengan angka yang diberikan ke AI.

---

## 13. Antarmuka pengguna

Bahasa antarmuka: Indonesia. Penamaan kode dan medan data: Inggris dengan sufiks satuan.

### 13.1 Digital Twin 3D — antarmuka input utama

Twin bukan dekorasi. Twin adalah tempat data masuk. Adegan Three.js menampilkan lini RKEF dengan node yang dapat diklik. Setiap satu dari delapan parameter dimiliki tepat oleh satu node.

| Node | Parameter yang dimiliki | Emisi yang ditampilkan |
|---|---|---|
| Stockpile bijih | `wet_ore_input_tons`, `moisture_content_pct`, `nickel_grade_pct` | — (menggerakkan `nickel_output_tons`) |
| Rotary dryer | `dryer_thermal_efficiency` | `dryer_emissions` (S1) |
| Rotary kiln | `reductant_biocoke_pct` | `kiln_heat_emissions` + `kiln_reductant_emissions` (S1) |
| Electric arc furnace | `sec_eaf_kwh_per_t_alloy` | `eaf_emissions` (S2) |
| PLTU captive | `power_mix_captive_coal` / `power_mix_hydro_grid`, `ef_captive_pltu` | memasok faktor EAF |

Klik node membuka panel dengan dua jalur masuk: ketik manual, atau unggah dokumen dan biarkan OCR mengisi awal. Pengguna memverifikasi dan menyesuaikan. Nilai dapat diubah kapan saja setelahnya.

Badge emisi pada tiap node diperbarui langsung setiap parameter berubah.

### 13.2 Dashboard emisi

Pembagian Scope 1 dan Scope 2, batang per tahap (dryer / panas kiln / reduktor / EAF), intensitas tCO₂e per tNi, posisi terhadap kuota, surplus atau defisit dalam ton dan rupiah, perbandingan terhadap baseline.

Batang per tahap **wajib dikelompokkan sebagai digerakkan-bijih versus digerakkan-nikel** (Bagian 7.5), bukan sekadar empat batang berdampingan. Pengelompokan itulah yang menjelaskan mengapa bijih berkadar lebih tinggi menurunkan intensitas, dan mengapa dua pabrik dengan output nikel identik dapat mengemisi berbeda 28 persen.

**Total dan intensitas selalu ditampilkan berpasangan**, tidak pernah salah satu saja. Keduanya dapat bergerak berlawanan arah — kelembaban lebih tinggi menurunkan total sekaligus menaikkan intensitas — dan menampilkan salah satu saja akan menyesatkan.

### 13.3 Panel proyeksi harga

Proyeksi nikel LME (USD/ton) dan IDX Carbon (IDR/ton), masing-masing dengan pita kepercayaan dan konteks historis.

### 13.4 Node graph

Memvisualkan empat tahap pipeline advisor beserta statusnya secara real-time. Menjawab keberatan "AI black box".

### 13.5 Panel rekomendasi

Teks rekomendasi, sitasi pasal yang dapat diklik ke teks verbatim, skor kepercayaan, tombol eksekusi (mock).

---

## 14. Alur data end-to-end

1. Register atau login (Supabase).
2. Onboarding: buat perusahaan, isi spesifikasi situs — diketik, atau unggah dokumen spesifikasi → kandidat OCR → verifikasi.
3. Halaman twin dimuat. Klik node → panel. Ketik, atau unggah dokumen operasional → OCR mengembalikan kandidat dengan keyakinan dan potongan sumber → pengguna menerima atau mengoreksi.
4. Setiap perubahan medan → `POST /emissions` (stateless, tanpa tulis) → breakdown penuh kembali dalam milidetik satu digit → dashboard dan badge node diperbarui langsung.
5. **Commit** → `POST /runs` → menyimpan input dan hasil, menghitung posisi kuota, melampirkan forecast hari itu.
6. `GET /runs/{id}/recommendation` (SSE) → node graph menganimasikan tiap tahap saat selesai.
7. Dashboard menampilkan hasil lengkap dengan rekomendasi dan sitasi.

---

## 15. Persyaratan fungsional

### 15.1 Fondasi

| ID | Persyaratan | Kriteria penerimaan |
|---|---|---|
| F-01 | Autentikasi email dan kata sandi | Pengguna baru dapat mendaftar dan masuk; sesi bertahan; rute terlindungi menolak akses tanpa JWT valid |
| F-02 | Profil perusahaan dan spesifikasi situs | Spesifikasi situs tersimpan per pengguna dan dapat disunting |
| F-03 | Kontrak API disepakati sebelum kerja paralel | Skema request dan response terdokumentasi |

### 15.2 Mesin emisi

| ID | Persyaratan | Kriteria penerimaan |
|---|---|---|
| F-04 | `calculate_emissions` sebagai fungsi murni | Menerima delapan skalar keyword-only, mengembalikan breakdown penuh; tanpa I/O |
| F-05 | Validasi input | Setiap jalur `ValueError` menyala; NaN ditolak pada setiap medan numerik; 32 ditolak di tempat 0,32 dimaksud |
| F-06 | Endpoint `/emissions` stateless | Response memuat seluruh medan `EmissionResult` termasuk perantara |
| F-07 | Mode baseline | `use_baseline=True` menghasilkan total ≥ total live |
| F-08 | Kuota absolut dan status kepatuhan | Kuota adalah medan spesifikasi situs dalam tCO₂e; tidak patuh bila `E_total > Cap`; menaikkan volume bijih **harus** dapat menyeberangkan status dari patuh ke defisit |
| F-08a | Pembantu turunkan kuota dari baseline | `Cap_saran = E_baseline × (1 − target_reduksi)` mengisi medan; nilai tersimpan tetap absolut dan dapat disunting |

### 15.3 Peramalan harga

| ID | Persyaratan | Kriteria penerimaan |
|---|---|---|
| F-09 | Deret historis harga terkumpul | `price_history` terisi untuk kedua seri |
| F-10 | Artefak model nikel LME | Model terlatih tersimpan; `predict` mengembalikan seri dengan interval kepercayaan |
| F-11 | Artefak model IDX Carbon | Sama, dalam IDR/ton |
| F-12 | Endpoint `/forecasts` | Satu response memuat kedua proyeksi dengan satuan mata uang eksplisit |

### 15.4 Ingestion

| ID | Persyaratan | Kriteria penerimaan |
|---|---|---|
| F-13 | Unggah dan ekstraksi dokumen | PDF, gambar, dan XLSX menghasilkan kandidat medan |
| F-14 | Kandidat, bukan komit | Tidak ada jalur kode yang menulis nilai hasil ekstraksi tanpa penerimaan eksplisit pengguna |
| F-15 | Keyakinan dan sumber | Tiap kandidat menyertakan skor keyakinan dan potongan wilayah sumber |

### 15.5 Advisor

| ID | Persyaratan | Kriteria penerimaan |
|---|---|---|
| F-16 | Korpus regulasi terkurasi | Klausa tersimpan verbatim, berversi |
| F-17 | Pipeline empat tahap dengan SSE | Tiap tahap memancarkan status berjalan, selesai, atau gagal |
| F-18 | Rekomendasi tersitasi | Keluaran menyertakan angka rupiah dan rujukan pasal yang dapat ditelusuri |
| F-19 | Pemeriksaan angka | Angka yang tidak ada dalam himpunan suplai menandai rekomendasi |
| F-20 | Skor kepercayaan | Rekomendasi di bawah ambang dieskalasi, bukan disajikan sebagai saran eksekusi |

### 15.6 Antarmuka

| ID | Persyaratan | Kriteria penerimaan |
|---|---|---|
| F-21 | Digital Twin 3D dengan node input | Kelima node dapat diklik dan membuka panel parameter miliknya |
| F-22 | Rekalkulasi langsung | Perubahan parameter memperbarui dashboard dan badge node tanpa reload |
| F-23 | Dashboard emisi | Menampilkan Scope 1/2, breakdown per tahap, intensitas, posisi kuota |
| F-24 | Panel proyeksi harga | Kedua proyeksi dengan pita kepercayaan |
| F-25 | Node graph | Menampilkan status tiap tahap advisor secara real-time |
| F-26 | Pengungkapan asumsi tampil di layar | Ketiga pengungkapan Bagian 17 tampil pada dashboard, bukan hanya dokumentasi |

---

## 16. Penanganan galat

**Jebakan fraksi.** `_validate` menolak 32 untuk `moisture_content_pct`, tetapi penolakan di API adalah tempat yang buruk untuk menemukannya. Input dilabeli dan dimasukkan sebagai persen di UI, lalu dikonversi ke fraksi pada tepat satu batas — serializer request. Satu titik konversi, diuji sekali. `ValueError` dari calculator karenanya berarti nilai benar-benar di luar rentang, bukan salah satuan, dan muncul sebagai 422 yang menyebut nama medan; twin mewarnai node pemiliknya merah.

**NaN.** Sudah tertangani: setiap perbandingan dalam `_validate` ditulis agar NaN gagal melewatinya. API menampilkannya sebagai 422 yang sama, sehingga pembacaan sensor yang hilang pada spreadsheet unggahan tidak dapat mencapai dashboard sebagai `total_emissions = nan`.

**Bauran daya.** `from_snapshot` menolak share yang tidak berjumlah 1, dan alasannya penting: share hidro tidak pernah masuk aritmetika, sehingga genset diesel 15 persen yang tidak tercatat akan menghasilkan keluaran identik dengan pabrik yang tercatat penuh. Node PLTU menampilkan sisa berjalan — "tercatat 85%, belum tercatat 15%" — dan memblokir commit hingga mencapai 100 persen. Pemeriksaan berada di batas tempat kedua share masih terlihat.

**Intensitas tak terdefinisi.** Dashboard menampilkan "—" dengan tooltip, tidak pernah `0`. Agregat lintas run membagi jumlah emisi dengan jumlah nikel, bukan merata-ratakan intensitas per run, sehingga baris `None` tidak dapat mendistorsi tren.

**Artefak forecast tidak tersedia.** 503 dari service; dashboard menampilkan forecast ter-cache terakhir dengan banner kedaluwarsa; advisor diberi tahu bahwa forecast tidak tersedia alih-alih dibiarkan mengarang harga.

**Kegagalan AI.** Rekomendasi adalah satu-satunya keluaran yang tidak esensial. Bila Claude timeout atau gagal, node tersebut menjadi merah dan panel emisi, kepatuhan, serta forecast tetap berdiri sendiri. Tidak ada yang dikarang di sisi klien untuk menutup lubang.

---

## 17. Asumsi dan pengungkapan wajib

Ketiga hal berikut **menekan angka emisi yang dilaporkan** dan wajib tampil di layar, bukan hanya di dokumentasi. Juri yang menemukan asumsi tak terungkap menemukan masalah; juri yang membacanya di layar menemukan kejujuran.

1. **Biocoke diperlakukan nol-emisi** (karbon biogenik). Hanya share fosil `1 − reductant_biocoke_pct` yang dihitung.
2. **Share hidro dan grid diperlakukan nol-emisi.** `power_mix_hydro_grid` tidak pernah masuk aritmetika.
3. **`DEFAULT_CONSTANTS` adalah placeholder yang belum tervalidasi**, menunggu kalibrasi.

Pengungkapan tambahan:

4. Data operasional yang dipakai demo adalah **data dummy**, bukan data smelter nyata.
5. PLTU captive **di luar cakupan wajib PTBAE-PU** saat ini; badge kepatuhan menyatakan status hipotetis, bukan pelanggaran hukum berlaku.
6. Eksekusi perdagangan bersifat **mock**, tidak terhubung ke bursa IDX Carbon.
7. Sistem adalah **decision support**, bukan pengganti otoritas manusia.

### 17.1 Gerbang kalibrasi

Tidak satu pun angka absolut boleh tampil pada slide, materi presentasi, atau nilai default yang dikirim ke pengguna sebelum konstanta berikut memiliki sumber tertulis. Gerbang ini wajib dilewati sebelum Bagian 21 dapat diselesaikan.

| Konstanta | Mengapa menjadi gerbang |
|---|---|
| `sec_eaf_kwh_per_t_alloy` | **Prioritas tertinggi.** Menentukan porsi Scope 2, dan karenanya menentukan apakah narasi PLTU captive produk ini berdiri. Pada 550 kWh/t alloy, Scope 2 hanya 11 persen dari total dan batu bara termal untuk pengeringan serta kalsinasi mendominasi — bertentangan langsung dengan rumusan masalah produk. Pada 2.400 kWh/t alloy, Scope 2 menjadi 36 persen. Batas bawah fisik dari entalpi peleburan kalsin berada di kisaran 2.700–4.200 kWh/t alloy bergantung kadar. **Basis wajib dinyatakan eksplisit**: per ton alloy tapped, pada kadar alloy berapa |
| `k_stoic` | Menggerakkan suku reduktor secara linear, dan kokas memikul faktor emisi tertinggi dalam model |
| `ef_reductant` | Sama; bersama `k_stoic` menentukan seluruh suku reduktor |
| `k_heat` | Menggerakkan suku panas kiln, salah satu penyumbang Scope 1 terbesar |
| `ef_coal_thermal`, `lhv_coal` | Muncul pada dua suku sekaligus, dryer dan kiln |
| `recovery_yield`, `alloy_nickel_grade` | Menentukan konversi nikel ke alloy; kesalahan di sini menggeser seluruh sisi digerakkan-nikel |

SEC telah menjebak dua kali: sekali sebagai variabel ERP yang salah nama (Bagian 7.4), sekali sebagai galat magnitudo yang menyembunyikan porsi Scope 2. Perlakukan medan ini dengan kecurigaan yang setimpal.

---

## 18. Strategi pengujian

### 18.1 Golden test mesin emisi

Seluruh mesin adalah aritmetika deterministik, jadi tidak ada alasan untuk tidak mengetahui jawaban benarnya.

| Kasus | Ekspektasi |
|---|---|
| Interval RKEF nominal | Cocok dengan perhitungan tangan hingga 1e-9 |
| `wet_ore_input_tons = 0` | Seluruh suku 0, `intensity` bernilai `None` |
| `nickel_grade_pct = 0` | Dryer dan panas kiln tetap mengemisi; reduktor dan EAF 0; `intensity` `None` |
| `reductant_biocoke_pct = 1.0` | `kiln_reductant_emissions == 0` |
| `power_mix_captive_coal = 0` | `eaf_emissions == 0`, Scope 1 tidak berubah |
| `use_baseline=True` | Total ≥ total live |

### 18.2 Uji validasi

Setiap jalur `ValueError` menyala. NaN disuntikkan ke tiap medan numerik satu per satu. `32` ditolak di tempat `0,32` dimaksud. Bauran daya yang tidak berjumlah 1 ditolak.

### 18.3 Property test

- Emisi monoton tidak menurun terhadap `wet_ore_input_tons`.
- `kiln_reductant_emissions` monoton tidak menaik terhadap `reductant_biocoke_pct`.
- `alloy_output_tons == nickel_output_tons / alloy_nickel_grade` untuk seluruh input valid. Properti terakhir menjaga bug per-tNi versus per-ton-alloy yang akan menyatakan jejak karbon terlalu rendah sebesar faktor sepuluh untuk NPI.

### 18.4 Uji struktural mesin emisi

Tiga uji yang menjaga temuan Bagian 7.5 dan 8.1 agar tidak hilang saat konstanta dikalibrasi ulang:

- **Pemisahan penggerak.** Pada `wet_ore_input_tons` tetap, mengubah `nickel_grade_pct` **tidak boleh** mengubah `dryer_emissions` maupun `kiln_heat_emissions` sedikit pun. Uji ini akan gagal bila seseorang kelak menyambungkan kadar ke suku bijih.
- **Elastisitas volume sama dengan satu.** Menggandakan `wet_ore_input_tons` menggandakan `total_emissions` tepat, dengan seluruh masukan lain tetap. Properti inilah yang membuat kuota proporsional tidak bermakna; bila ia berhenti berlaku, alasan Bagian 8.1 perlu ditinjau ulang.
- **Kuota dapat diseberangi.** Dengan kuota absolut dan konfigurasi nominal, terdapat kenaikan volume bijih yang membalik status dari patuh menjadi defisit, dan terdapat kombinasi lever yang membalikkannya kembali. Uji ini menjaga agar kedua sisi panel perdagangan tetap dapat dicapai.
- **Koridor porsi Scope 2.** Pada konfigurasi baseline, `eaf_emissions / total_emissions` berada dalam 25–45 persen. Gagal berarti SEC atau faktor emisi keluar kalibrasi, dan narasi PLTU captive produk ini runtuh diam-diam.

### 18.5 Uji lain

- **Batas kepatuhan:** `E_total` tepat sama dengan `Cap` berstatus patuh, sekali, secara sengaja.
- **Invariant mata uang:** setiap medan moneter berakhiran sufiks satuan; tidak ada objek response memuat nilai USD dan IDR di bawah nama tanpa sufiks.
- **Ingestion:** dokumen fixture (PDF bersih, foto ponsel, pindaian miring) menghasilkan kandidat yang diharapkan; asertif bahwa tidak ada jalur kode menulis nilai tanpa penerimaan eksplisit.
- **Advisor:** prompt yang tersusun memuat teks klausa verbatim; response fixture berisi angka karangan ditolak oleh pemeriksaan numeral.
- **E2E:** register → onboarding → input node → commit → rekomendasi tampil.

---

## 19. Ditunda

**Simulator what-if.** Slider untuk rasio biocoke, bauran daya, volume bijih, dan kelembaban yang menghitung ulang emisi dan dampak rupiah secara langsung. Ditunda dari sprint ini, tetapi arsitektur sudah menyiapkannya: endpoint `/emissions` yang stateless **adalah** mesin what-if, dan `calculate_emissions` yang murni dapat dipanggil berulang tanpa efek samping. Menambahkannya nanti berarti membangun UI slider, bukan membangun mesin.

Ditunda lainnya: modul HPAL, edge deployment, LoRA dan DPO, ECE terkalibrasi penuh, eksekusi bursa riil, scraping IDX Carbon harian.

---

## 20. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| `DEFAULT_CONSTANTS` belum terkalibrasi menghasilkan angka absolut yang tidak realistis | Kredibilitas angka dipertanyakan | Gerbang kalibrasi Bagian 17.1; ungkap sebagai placeholder di layar |
| `sec_eaf_kwh_per_t_alloy` terkalibrasi terlalu rendah | Scope 2 tampak sepele (11 persen), bertentangan dengan rumusan masalah produk sendiri. Juri yang menghitung sendiri akan menemukannya | Kalibrasi terhadap batas bawah fisik entalpi peleburan; uji regresi yang menyatakan gagal bila porsi Scope 2 keluar dari koridor 25–45 persen pada konfigurasi baseline |
| Kuota diisi pengguna dengan angka sembarang | Status kepatuhan menjadi tak bermakna | Pembantu turunkan-dari-baseline sebagai default; tampilkan kuota sebagai intensitas tersirat (tCO₂e per ton bijih) agar nilai yang tidak masuk akal terlihat |
| Akurasi OCR rendah pada dokumen nyata | Entri data melambat, bukan tepercaya | Kandidat selalu diverifikasi manusia; entri manual selalu tersedia sebagai jalur penuh, bukan fallback |
| Cloud AI API gagal atau lambat saat demo | Panel rekomendasi kosong | Panel emisi, kepatuhan, dan forecast berdiri sendiri; siapkan run tersimpan yang sudah memiliki rekomendasi sebagai cadangan demo |
| Digital Twin 3D memakan waktu melebihi perkiraan | Antarmuka input utama tidak siap | Bangun panel input berbasis form lebih dulu sebagai jalur setara; twin menjadi lapisan navigasi di atasnya, bukan prasyaratnya |
| Angka pada slide berbeda dengan angka pada aplikasi | Temuan yang paling mudah dilihat juri | Verifikasi konsistensi angka antara demo, PRD, dan proposal sebelum presentasi |
| API key tertanam di klien | Kebocoran kredensial | Seluruh pemanggilan Claude terjadi di FastAPI; key tidak pernah mencapai peramban |

---

## 21. Angka acuan skenario demo

Dari Bab 4.7 proposal:

> Harga nikel LME naik 8,5 persen, sistem menyarankan menaikkan produksi ke 105 persen. Emisi melampaui kuota 45.000 ton, tetapi harga karbon IDX Carbon sedang rendah (Rp35.200 per ton). Sistem siap mengeksekusi pembelian 120.750 ton kredit karbon untuk mengeliminasi denda pajak Rp1,35 miliar, sekaligus menghasilkan net margin tambahan Rp19,8 miliar.

Angka prototipe dashboard: total 525.000 tCO₂e YTD, intensitas 52,5 tCO₂/tNi, target kuota 480.000 tCO₂e, net carbon position −45.000 tCO₂e.

**Angka-angka ini berasal dari v1 dan belum diverifikasi ulang terhadap mesin emisi v2.** Sebelum presentasi, jalankan skenario melalui `calculate_emissions` dengan konstanta terkalibrasi (gerbang Bagian 17.1) dan perbarui seluruh materi agar cocok. Angka demo wajib merupakan keluaran sistem, bukan angka yang ditulis terpisah.

Dua koreksi sudah diketahui sekarang dan harus ditangani saat menyusun ulang skenario:

1. **Skenario overdrive memerlukan kuota absolut.** Di bawah rumus v1, menaikkan produksi ke 105 persen tidak dapat menciptakan defisit karena kuota ikut naik 5 persen. Alur ini hanya berjalan setelah perubahan Bagian 8.2.
2. **Angka "net margin tambahan Rp19,8 miliar" tidak dapat diproduksi sistem ini.** Mesin v2 menghitung emisi, harga karbon, dan harga nikel. Tidak ada model pendapatan, biaya produksi, maupun margin. Pilihannya dua: menambahkan modul biaya-pendapatan ke lingkup (belum dilakukan pada PRD ini), atau menghapus klaim margin dari materi dan membatasi angka finansial pada yang benar-benar dihitung sistem — yaitu **nilai posisi karbon**, `|E_total − Cap| × harga_karbon_forecast`. Rekomendasi: opsi kedua, karena angka yang ditulis tangan ke dalam demo adalah persis temuan yang paling mudah dilihat juri.
