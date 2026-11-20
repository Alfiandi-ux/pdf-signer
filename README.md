# PDF Signer

Aplikasi web **offline** untuk membubuhkan tanda tangan (gambar) ke file PDF.
Semua proses berjalan di browser — file tidak pernah diunggah ke server mana pun.

![tipe](https://img.shields.io/badge/offline-100%25-4f46e5) ![lisensi](https://img.shields.io/badge/stack-HTML%20%2B%20JS-lightgrey)

## Unduh APK (Android)

APK siap pasang tersedia di halaman **[Releases](https://github.com/Alfiandi-ux/pdf-signer/releases/latest)**
(berkas `pdf-signer-*.apk`). Buka di HP, izinkan "Instal dari sumber tidak
dikenal" bila diminta, lalu pasang. Aplikasi APK berjalan sepenuhnya offline —
semua aset sudah dibundel di dalamnya.

PDF hasil ekspor disimpan ke **Download/PDF Signer/**.

## Fitur

- **Scan dokumen dengan kamera**
  - Ambil foto langsung dari kamera belakang (ada senter & ganti kamera) atau pilih dari galeri.
  - Tarik 4 sudut untuk mengikuti tepi kertas — gambar otomatis diluruskan (koreksi perspektif).
  - Filter **Asli**, **Abu-abu**, dan **Hitam-putih** (ambang adaptif, tahan bayangan).
  - Pindai beberapa halaman, hapus yang gagal, lalu jadikan satu PDF.
  - Hasil scan bisa dibuka sebagai dokumen baru atau **digabungkan ke PDF yang sedang dibuka**.
- **Tiga cara membuat tanda tangan**
  - Gambar langsung dengan jari / mouse (ada undo, tebal pena, warna).
  - Ketik nama dengan font tulisan tangan (Great Vibes / Caveat, tersedia offline).
  - Unggah foto/gambar tanda tangan, dengan opsi menghapus latar putih.
- **Tempel & atur di halaman PDF**
  - Ketuk halaman untuk menempel, geser untuk memindah, tarik bulatan sudut untuk mengubah ukuran.
  - Bisa menempel lebih dari satu tanda tangan, di halaman berbeda.
  - Halaman yang diputar (`/Rotate` 90°, 180°, 270°) didukung.
- **Pratinjau PDF asli** (dirender dengan pdf.js) + navigasi halaman & zoom.
- **Unduh PDF** dengan tanda tangan sudah menyatu di dalam file.
- **Tampilan ramah layar Android** — navigasi bawah, panel geser (bottom sheet), tombol besar, dan aman dari notch/gesture bar.
- **100% offline** setelah file tersedia; tidak ada data yang keluar dari perangkat.
- Library, font, standard font PDF, dan cMap sudah dibundel di `vendor/` & `fonts/`.

## Menjalankan

Aplikasi perlu dibuka lewat `localhost` (bukan `file://`), karena browser
membatasi pemuatan worker/fetch untuk file lokal.

```bash
cd ~/pdf-signer
bash start.sh          # port default 8000
# atau: bash start.sh 8080
```

Lalu buka **http://localhost:8000** di Chrome / browser lain.

Bisa juga manual:

```bash
cd ~/pdf-signer
python3 -m http.server 8000
```

> Ingin dibuka dari HP lain di jaringan yang sama? Ganti `--bind 127.0.0.1`
> menjadi `--bind 0.0.0.0` di `start.sh`, lalu buka `http://IP-HP:8000`.

## Cara pakai

Belum punya file PDF? Buka `contoh.pdf` yang disertakan untuk mencoba.

1. Tekan **Buka PDF** (atau tarik file ke jendela), pilih file `.pdf`.
2. Di panel kiri (di HP: tombol ✍), buat tanda tangan:
   - tab **Gambar** → corat-coret di kotak, atur tebal/warna;
   - tab **Ketik** → isi nama, pilih gaya huruf;
   - tab **Unggah** → pilih foto tanda tangan (centang “Hilangkan latar putih” bila perlu).
3. Tekan **Gunakan tanda tangan ini**.
4. Ketuk halaman PDF tempat tanda tangan ingin diletakkan.
5. Geser untuk memindah; tarik bulatan di sudut kanan-bawah untuk mengubah ukuran.
6. Tekan **Unduh PDF**. Hasil tersimpan sebagai `nama-file-signed.pdf`.

Tombol **Hapus** di toolbar (atau tombol × pada tanda tangan) untuk membuang
tanda tangan yang sudah ditempel.

## Catatan

- Ini adalah **tanda tangan gambar**, bukan *digital signature* berbasis
  sertifikat. Untuk keperluan hukum/verifikasi kriptografis, gunakan
  sertifikat digital (mis. BSrE) dan aplikasi khusus.
- PDF yang terkunci password belum didukung; buka proteksinya terlebih dahulu.
- Menambahkan tanda tangan akan mengubah isi PDF, sehingga tanda tangan digital
  lama (jika ada) tidak lagi valid.
- Ukuran file maksimal 120 MB.
- Font & library dimuat lokal, jadi aplikasi tetap jalan tanpa internet.

## Membangun APK sendiri

APK dibangun otomatis lewat GitHub Actions
(`.github/workflows/build-apk.yml`). Setiap kali workflow dijalankan, APK
diunggah ke halaman Releases dengan tag yang ditentukan.

```bash
# lewat GitHub CLI
gh workflow run build-apk.yml -f version=v1.0.0
```

Untuk build lokal dibutuhkan Android SDK + JDK 17:

```bash
cd android
./gradlew assembleRelease
# hasil: android/app/build/outputs/apk/release/app-release.apk
```

Tanpa keystore rilis, build memakai debug signing agar APK tetap bisa dipasang.
Di CI, keystore diambil dari secret `KEYSTORE_BASE64` (beserta
`KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`).

## Struktur

```
pdf-signer/
├── index.html
├── css/style.css
├── js/
│   ├── app.js
│   └── scanner.js         # scan kamera, potong perspektif, filter
├── fonts/                 # font tulisan tangan (offline)
├── vendor/
│   ├── pdf-lib.min.js     # menulis tanda tangan ke PDF
│   ├── pdf.min.js         # merender pratinjau PDF
│   ├── pdf.worker.min.js
│   ├── standard_fonts/    # font standar PDF (offline)
│   └── cmaps/             # cMap untuk PDF CJK (offline)
├── android/               # pembungkus WebView untuk APK
│   ├── app/               # kode Java, manifest, ikon
│   └── gradlew
├── .github/workflows/     # build APK + Release otomatis
├── contoh.pdf             # contoh dokumen untuk uji coba
├── start.sh
└── README.md
```

## Teknologi

- [pdf-lib](https://pdf-lib.js.org/) — menanam gambar tanda tangan ke PDF.
- [PDF.js](https://mozilla.github.io/pdf.js/) — merender halaman PDF ke canvas.

Keduanya berjalan sepenuhnya di sisi klien.
