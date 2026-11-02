# sunscraping

> Audit engagement kampanye influencer di Instagram & TikTok — batch, berkala, dan tanpa API berbayar.
> Chrome Extension + Flask Backend, berjalan sepenuhnya di perangkat sendiri.
>
> Sebelumnya bernama *Social Auditor*. Nama folder root masih `social-auditor` secara sengaja
> (alasan dan konsekuensinya di bagian Struktur direktori); launcher, database, dan merek di UI sudah sunscraping.

---

## Fitur

- **Audit per kampanye** — Setiap upload menjadi satu *audit* dengan nama sendiri; target, snapshot, dan laporan tidak tercampur.
- **Cek berkala otomatis** — Atur "Ulang (hari)" per audit. Saat antrean kosong, audit yang jatuh tempo otomatis dijadwalkan ulang.
- **Audit ulang manual** — Tombol **Audit ulang** membuat siklus baru tanpa mengunggah file lagi.
- **Manajemen target** — Tab **Target** mendukung pencarian, filter status/platform, sorting semua metrik, dan pagination server-side.
- **Ulangi yang gagal** — Tombol **Ulangi gagal** menjadwalkan ulang hanya target dengan hasil terakhir `FAILED`.
- **Riwayat & tren** — Setiap siklus menyimpan snapshot; modal riwayat menampilkan delta likes, followers, dan ER plus grafik tren.
- **Batch processing** — Upload CSV/Excel berisi link Instagram/TikTok, worker mengambil metrik satu per satu. File baru juga bisa **ditambahkan ke audit terpilih** tanpa membuat audit baru.
- **Tanpa API berbayar** — Data diambil dari halaman publik melalui browser yang sudah login, bukan Meta/TikTok API atau penyedia berbayar.
- **Error taxonomy** — `PERMANENT` / `THROTTLED` / `AUTH` tidak diulang sia-sia; hanya `TRANSIENT` yang retry (maks. 3x).
- **Hemat resource** — Satu tab worker dipakai ulang, follower lookup di tab yang sama, cache follower 7 hari, dan prioritas platform dari antrean.
- **Live dashboard** — SSE real-time dengan fallback polling 5 detik, indikator worker heartbeat, dan banner offline yang persisten.
- **Export Excel per audit** — Filter status OK/sebagian/gagal, kolom delta, engagement rate, error code, dan retry count, plus proteksi formula injection.
- **Best-effort safety throttling** — Session break, daily limit, warm-up, fatigue, dwell time, dan alternasi platform.

## Arsitektur

```
social-auditor/                     # nama folder root dipertahankan — lihat catatan di bawah
├── sunscraping.hta                 # Control Panel harian: start/stop, health, API key
├── INSTALL_sunscraping.bat         # pasang sekali: Python + dependencies, lalu buka panel
├── START_sunscraping.bat           # jalankan server manual, tanpa panel
├── run_hidden.bat                  # runner headless yang dipanggil Control Panel
├── README.md  .env.example  .gitignore
├── assets-src/
│   └── icon.svg                    # master artwork logo
├── backend/                        # Flask Backend (Python)
│   ├── app.py                      # REST API, SSE, route dashboard, export
│   ├── database.py                 # SQLite data layer (audits/runs/targets/snapshots)
│   ├── requirements.txt            # Python dependencies
│   ├── templates/
│   │   └── dashboard.html          # markup dashboard (Jinja hanya untuk URL aset)
│   ├── static/
│   │   ├── dashboard.css           # styling dashboard
│   │   └── dashboard.js            # logic dashboard (IIFE, tanpa framework/CDN)
│   ├── sunscraping.db              # data — tidak ikut git
│   └── runtime/                    # state hasil eksekusi — tidak ikut git
│       ├── server_log.txt          # log stdout/stderr server
│       └── uploads/exports/        # file sementara & hasil export
├── chrome-extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json               # Extension config
│   ├── config.js                   # satu sumber alamat backend untuk semua permukaan
│   ├── background.js               # Service Worker — queue, tab worker, pause/backoff
│   ├── content/
│   │   ├── common.js               # helper yang dipakai kedua scraper
│   │   ├── ig-scraper.js           # Instagram content script (berlapis)
│   │   └── tk-scraper.js           # TikTok content script (berlapis)
│   ├── icons/                      # icon16/48/128.png
│   ├── popup/
│   │   ├── popup.html              # Popup status worker
│   │   ├── popup.js                # Popup logic (mode, kuota, start/stop)
│   │   ├── popup.css
│   │   ├── options.html            # Settings (pairing API key)
│   │   └── options.js
│   └── utils/
│       └── rate-limiter.js         # Safety throttling engine
└── tests/
    └── test_api_smoke.py           # Smoke test API dengan DB sementara
```

**Kenapa folder root masih `social-auditor`?** Nama itu sudah dipakai sebagai path absolut di
beberapa pintasan dan skrip pihak pengguna, sedangkan tidak satu pun kode di dalam project
yang membaca namanya. Memindah hanya merusak pintasan tanpa memperbaiki struktur. Launcher
sengaja berada di root: titik masuk pengguna di root, implementasi di subfolder.

**Regenerate ikon PNG.** `assets-src/icon.svg` adalah artwork master; `chrome-extension/icons/`
hanyalah hasil ekspor. Setelah mengubah logo, ekspor ulang ke 16/48/128 px (mis. dengan
`magick -background none assets-src/icon.svg -resize 128x128 chrome-extension/icons/icon128.png`
atau lewat browser + canvas) sebelum memuat ulang extension.

## Cara menjalankan

| Kebutuhan | Pakai |
|---|---|
| Mesin baru / clone pertama, sekali saja | `INSTALL_sunscraping.bat` — pasang Python + dependencies lalu membuka Control Panel |
| Menyalakan server tanpa panel (mis. dari terminal) | `START_sunscraping.bat` |
| Kontrol harian: start, stop, health, salin API key, buka dashboard | `sunscraping.hta` |
| Menyalakan server tanpa jendela sama sekali | `run_hidden.bat` (dipanggil panel; bukan untuk diklik langsung) |

Semua launcher berjalan dari direktori project dan mencari `backend\app.py` secara absolut,
jadi shortcut di desktop pun tetap bekerja setelah folder dipindah, selama nama folder induknya
ikut berubah di shortcut tersebut.

## Quick Start

### Cara 1: Auto Install (Recommended)

1. Double-click `INSTALL_sunscraping.bat`
2. Script memasang Python (jika belum ada) + dependencies
3. Control Panel terbuka otomatis

### Cara 2: Manual

```bash
cd backend
python -m pip install -r requirements.txt
python app.py

# Di Chrome:
# chrome://extensions → aktifkan Developer mode
# Load unpacked → pilih folder chrome-extension/
```

## Pairing Extension

Backend membuat API key lokal otomatis saat pertama kali dijalankan (`backend/.api_key`).
Key ditampilkan (disamarkan) di Control Panel dengan tombol **Salin**.

1. Buka popup extension → **Settings**
2. Isi **API Base** (`http://localhost:5000`) dan **API Key**
3. Klik **Uji koneksi** (memakai nilai formulir, belum menyimpan), lalu **Simpan** jika valid

Angka `5000` di atas bukan hiasan: popup, options, dan service worker sama-sama membacanya dari
`chrome-extension/config.js`, dan daftar origin CORS backend diturunkan dari `SA_PORT`. Ubah port
di satu sisi tanpa sisi lainnya membuat extension menolak terhubung dengan pesan yang terlihat
seperti masalah API key.

Popup menampilkan status backend dari `/api/health`, memakai base URL yang disimpan, dan
menonaktifkan **Mulai worker** saat backend offline atau API key belum diatur. Tombol
**Dashboard** mengikuti alamat backend yang dikonfigurasi.

Key hanya disimpan di `chrome.storage.local` dan dikirim melalui header `X-API-Key`.
Dashboard memakai session cookie `HttpOnly` + `SameSite=Strict`, bukan API key di URL.

## Alur Penggunaan

1. **Mulai server** — Control Panel (`sunscraping.hta`) atau `START_sunscraping.bat`.
2. **Impor target** — Buka dashboard, unggah CSV/XLSX, isi **Nama audit** dan **Ulang (hari)** (0 = manual). Gunakan **Template CSV** atau centang **Tambahkan ke audit terpilih** untuk menggabungkan file ke audit yang sudah ada.
3. **Mulai worker** — Klik ikon extension → **Mulai worker**; biarkan Chrome tetap terbuka.
4. **Pantau** — Dashboard menampilkan antrean, snapshot terbaru, delta, dan status koneksi (Live/Polling).
5. **Audit ulang** — Klik **Audit ulang** kapan saja, atau biarkan jadwal otomatis berjalan.
6. **Riwayat** — Klik baris target untuk melihat seluruh snapshot dan trennya.
7. **Tangani kegagalan** — Tab target memfilter status gagal; klik **Ulangi gagal** untuk menjadwalkan ulang target tersebut.
8. **Export** — Pilih status (semua/OK/sebagian/gagal), lalu unduh audit terpilih atau semua audit ke `.xlsx`.

### Format File Input

| Kolom | Wajib | Deskripsi |
|---|---|---|
| `Link` / `URL` | ✅ | URL postingan Instagram/TikTok |
| `Akun` / `User` | ❌ | Username akun (opsional, bisa terdeteksi dari halaman) |
| `Tema` / `Title` | ❌ | Label/kategori kampanye |

Maksimal **10.000 baris** per upload (file ≤ 10 MB). Duplikat link di dalam satu file atau di
audit tujuan dilewati. URL yang sama boleh dipakai lagi pada audit baru. CSV mendukung pemisah
koma/titik-koma dan BOM UTF-8; preview client-side tersedia untuk CSV.

## Model Data

```text
audits        satu kampanye / daftar influencer (nama, repeat_days, last_run_at)
  └── runs    satu siklus pengecekan (upload / manual / auto)
        └── targets   URL unik per audit
              └── snapshots   hasil tiap siklus + delta historis
tasks         antrean kerja untuk worker
accounts      cache follower (platform + username, TTL 7 hari)
```

Dashboard menghitung KPI dari **run terakhir** setiap audit, sehingga angka tidak membengkak
ketika audit yang sama diperiksa berulang kali.

## Konfigurasi

| Environment Variable | Default | Deskripsi |
|---|---|---|
| `SA_API_KEY` | auto-generated | Override API key; jika kosong, key dibuat di `backend/.api_key` |
| `SA_PORT` | `5000` | Port server backend (bind ke `127.0.0.1` saja); Control Panel membaca nilai ini otomatis, begitu juga daftar origin CORS — dan `chrome-extension/config.js` harus memakai port yang sama |
| `SA_DB_PATH` | `backend/sunscraping.db` | Lokasi database SQLite |
| `FLASK_DEBUG` | `false` | Debug mode (jangan dipakai untuk operasional) |

`backend/.env.example` berisi salinan variabel yang sama, tapi backend tidak memuat `.env` secara
otomatis — export di shell, atau set lewat `run_hidden.bat` / `START_sunscraping.bat`.

State runtime tidak ikut version control dan aman dihapus kapan saja (server membuatnya ulang):
`backend/runtime/` (log, upload, export), `backend/server.pid`, `backend/.api_key`, dan
`backend/.session_secret`. Menghapus dua yang terakhir memaksa pairing ulang: key baru dibuat dan
session dashboard semua browser aktif terputus.

## API Endpoints

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/` | Session | Dashboard (session cookie HttpOnly) |
| `GET` | `/api/health` | ❌ | Health check + ringkasan task |
| `GET` | `/api/auth/check` | ✅ | Validasi API key (Settings extension) |
| `GET` | `/api/stats?audit_id=` | ✅ | Statistik, opsional per audit |
| `GET` | `/api/latest?audit_id=&limit=` | ✅ | Snapshot terbaru per target |
| `GET` | `/api/audits` | ✅ | Daftar audit + jumlah target/antrean |
| `POST` | `/api/audits/<id>/rerun` | ✅ | Jadwalkan siklus baru |
| `POST` | `/api/audits/<id>/retry-failed` | ✅ | Jadwalkan ulang target dengan hasil terakhir gagal |
| `POST` | `/api/audits/<id>/settings` | ✅ | Ubah nama / `repeat_days` (0–365) |
| `POST` | `/api/audits/<id>/delete` | ✅ | Hapus audit beserta riwayatnya |
| `GET` | `/api/targets?audit_id=&status=&platform=&q=&sort=&dir=&limit=&offset=` | ✅ | Daftar target terfilter, tersortir, dan terpaginasi |
| `GET` | `/api/history?target_id=` | ✅ | Riwayat snapshot satu target |
| `GET` | `/api/events?audit_id=` | Session/Key | Server-Sent Events untuk dashboard |
| `POST` | `/api/upload` | Session/Key | Upload CSV/XLSX + nama audit + jadwal; kirim `audit_id` untuk append |
| `GET` | `/api/task/next?prefer=` | ✅ | Ambil task berikutnya |
| `POST` | `/api/task/result` | ✅ | Kirim hasil scrape |
| `GET` | `/api/export?audit_id=&status=` | ✅ | Export Excel, filter status `OK`/`PARTIAL`/`FAILED` (+ delta & sanitasi formula) |
| `POST` | `/api/clear` | ✅ | Hapus semua audit, target, snapshot, antrean |

✅ = header `X-API-Key` **atau** session dashboard.

## Efisiensi Worker

- **Satu tab persisten** — Tab worker dipakai ulang untuk semua target; hanya navigasi, bukan buka/tutup tab.
- **Follower lookup di tab yang sama** — Tidak membuka tab baru untuk profil.
- **Follower dari halaman post** — Jika metrik follower sudah tertanam di halaman post, kunjungan profil dilewati.
- **Cache follower 7 hari** — Dikirim bersama task berikutnya agar tidak fetch berulang.
- **Prioritas platform** — Worker mengambil task dari platform yang sama dengan tab aktif lebih dulu.
- **Auto-enqueue saat kosong** — Audit berkala hanya dijadwalkan ketika tidak ada PENDING/RUNNING, jadi kampanye besar tidak dibanjiri beberapa siklus sekaligus.
- **SSE** — Dashboard menerima perubahan tanpa polling konstan; fallback polling 5 detik hanya saat SSE terputus.

## Error Taxonomy & Pause

| Kode | Arti | Perilaku |
|---|---|---|
| `PERMANENT` | Post/akun privat, dihapus, atau tidak tersedia | Final, tanpa retry |
| `TRANSIENT` | Timeout, jaringan, halaman gagal dimuat | Retry maks. 3x |
| `THROTTLED` | Rate limit / "try again later" | Final untuk task; worker pause 10 menit |
| `AUTH` | Login/challenge/session kedaluwarsa | Final untuk task; worker pause 20 menit |

Tiga respons terblokir berturut-turut memicu circuit breaker dan menghentikan worker.
Notifikasi Chrome ditampilkan saat pause, batas harian, atau circuit breaker aktif.

## Safety Throttling

> Catatan realitas: mekanisme ini hanya mengurangi agresivitas akses. Instagram/TikTok tetap dapat membatasi, menantang login, atau memblokir akun/sesi jika pola akses dianggap otomatis.

| Layer | Mekanisme |
|---|---|
| 1 | **Session Break** — Istirahat 3–5 menit setiap 30–50 task |
| 2 | **Daily Limit** — Maks. 500 task/hari (persisted) |
| 3 | **Auto Speed** — Mode otomatis berdasarkan jumlah pending |
| 4 | **Dwell Time** — 1–4 detik simulasi baca halaman |
| 5 | **Warm-up** — 5 task pertama 3x lebih lambat |
| 6 | **Fatigue** — Delay progresif setiap 10 task |
| 7 | **Alternation** — Bergantian Instagram ↔ TikTok |

## Pengujian

Smoke test API memakai database dan folder upload sementara, jadi tidak menyentuh data live:

```bash
python -m unittest tests.test_api_smoke -v
```

Cakupan: health/auth, upload + append + deduplikasi, hasil OK/PARTIAL/FAILED, filter/sort/pagination
target, retry gagal, heartbeat, dan export dengan filter status.

## Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| Control Panel "Offline" padahal server jalan | Port 5000 dipakai proses lain. Set `SA_PORT` sebelum membuka Control Panel; endpoint di panel mengikuti nilai tersebut. Sesuaikan API Base extension jika port berubah. |
| Extension "API key ditolak" | Key di Settings berbeda dari `backend/.api_key`. Salin ulang dari Control Panel. |
| Dashboard berstatus "Polling" | SSE terputus sementara; dashboard otomatis memakai polling 5 detik dan mencoba SSE lagi. |
| Audit tidak berjalan otomatis | Isi **Ulang (hari)** > 0 atau klik **Audit ulang**. Penjadwalan otomatis hanya aktif saat antrean kosong. |
| Task stuck di RUNNING | Task otomatis kembali ke PENDING setelah 5 menit (maks. 3 retry untuk error transient). |
| Halaman minta login | Instagram/TikTok membatasi akses anonim. Login manual di Chrome, lalu lanjutkan worker. |
| Upload gagal | Cek kolom `Link`, ukuran file (≤ 10 MB), dan maksimal 10.000 baris. |
| Export kosong | Audit belum punya snapshot; jalankan worker sampai minimal satu target selesai. |

## Disclaimer

Tool ini ditujukan untuk audit data publik secara etis. Pengguna bertanggung jawab mematuhi
Terms of Service Instagram/TikTok dan hukum yang berlaku. Jangan gunakan untuk spam,
scraping data privat, atau pelanggaran privasi.

## Tech Stack

- **Backend:** Python 3.10–3.12, Flask 3.x, SQLite (WAL), Pandas, openpyxl
- **Extension:** Chrome Manifest V3, Service Worker, chrome.alarms
- **Launcher:** Windows HTA + Batch scripts

---

*sunscraping v3.5 · Extension v1.4 — periodic campaign & influencer auditing, local only.*
