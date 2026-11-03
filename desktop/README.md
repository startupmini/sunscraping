# sunscraping desktop

Aplikasi Electron yang menjalankan audit tanpa Chrome extension: backend Flask
tetap dipakai sebagai proses lokal, sementara scraping dilakukan oleh jendela
tersembunyi Electron dengan session yang login-nya Anda simpan sendiri.

> Jalankan **salah satu** worker saja — extension Chrome atau aplikasi ini.
> Keduanya memakan antrean dan budget kunjungan yang sama.

## Prasyarat

1. Python 3.10–3.12 + dependencies backend (`INSTALL_sunscraping.bat` sekali, atau
   `python -m pip install -r backend/requirements.txt`).
2. Node 20+ dan npm.

## Menjalankan

```bash
cd desktop
npm install
npm start
```

Urutan yang terjadi saat start:

1. Kalau `/api/health` belum menjawab, aplikasi men-spawn `python backend/app.py`
   dengan `SA_PORT` yang sama dan menunggu sampai sehat.
2. `backend/.api_key` dibaca (dibuat backend pada start pertama).
3. Dashboard `http://127.0.0.1:5000` dimuat di jendela utama.
4. Ikon tray muncul: **Mulai/Hentikan worker**, **Login Instagram**, **Login TikTok**.

Login sekali di jendela login (termasuk menyelesaikan challenge/captcha secara
manual), lalu **Mulai worker**. Session disimpan di partisi `persist:sunscraping`
di dalam `userData`, jadi tidak hilang saat aplikasi ditutup.

## Yang dipakai ulang apa adanya

| Berkas | Peran di desktop |
|---|---|
| `chrome-extension/content/common.js` | `parseCount`, `metricFromLabel`, `recentPosts`, `truncateText` |
| `chrome-extension/content/ig-scraper.js` | Scraper Instagram, dijalankan di isolated world |
| `chrome-extension/content/tk-scraper.js` | Scraper TikTok |
| `chrome-extension/utils/rate-limiter.js` | Budget kunjungan, warm-up, fatigue, session break |
| `chrome-extension/utils/task-cache.js` | Memakai angka hasil kunjungan profil tanpa navigasi |
| `backend/` | SQLite, antrean, dashboard, export — tanpa perubahan |

Content script dipakai verbatim: `worker/sessions.js` mendaftarkan
`chrome.runtime.onMessage` lewat shim, lalu memanggil handler-nya dari proses
utama. Karena itu perbaikan scraper cukup dilakukan di satu tempat.

`rate-limiter.js` didefinisikan dengan `const RateLimiter` (tanpa export), jadi
`worker/legacy.js` mengevaluasinya di konteks terpisah dengan `chrome.storage.local`
yang di-backup ke `userData/worker-state.json`.

## Struktur

```
desktop/
├── main.js              # lifecycle, tray, spawn backend, jendela
├── package.json
├── worker/
│   ├── backend.js       # spawn + health check + API key
│   ├── api.js           # klien HTTP lokal (X-API-Key)
│   ├── core.js          # loop worker: klaim, budget, circuit breaker
│   ├── policy.js        # allowlist host, taksonomi error, keputusan per hasil
│   ├── legacy.js        # chrome.storage shim + loader rate limiter
│   └── sessions.js      # BrowserWindow persisten, inject content script, scrape
└── test/
    ├── worker.test.js        # node --test, tanpa Electron
    ├── sessions.harness.js   # driver Electron untuk sessions.js
    ├── sessions.test.js      # pembungkus node --test
    └── fixtures/             # halaman DOM lokal (post, profil, payload profil)
```

## Perbedaan dengan extension

| Aspek | Extension (MV3) | Desktop |
|---|---|---|
| Tab worker | `chrome.tabs` + `chrome.alarms` | `BrowserWindow` tersembunyi + `setTimeout` |
| Storage state | `chrome.storage.local` | `userData/worker-state.json` |
| Notifikasi | `chrome.notifications` | `Notification` Electron |
| Isolasi | isolated world content script | `executeJavaScriptInIsolatedWorld(999)` |
| User agent | UA Chrome asli | UA Chrome tanpa token `Electron/…` |

## Batasan yang perlu diketahui

- **Belum ada packaging.** `electron-builder` tidak dipakai; distribusi ke mesin
  lain masih butuh Node, Python, dan `npm install`. Langkah berikutnya:
  PyInstaller untuk backend + `electron-builder` per OS (plus code signing).
- **Belum ada auto-update.**
- **Profil baru = tanpa riwayat.** Electron memakai profil bersih; extension
  memakai browser yang sudah lama dipakai. Pola akses yang “manusiawi” sebagian
  berasal dari riwayat itu, jadi risiko challenge bisa lebih tinggi.
- **Login dan challenge tetap manual.** Tidak ada penyelesaian captcha otomatis.
- **Log hanya ke berkas.** `userData/app.log` (dipotong di 2 MB saat start) dan
  stdout; tidak ada panel log di aplikasi.
- **Tanpa auto-recovery sesi.** Kalau login kedaluwarsa, worker berhenti setelah
  3 kegagalan `AUTH`; login ulang manual lewat tray.
- **Satu worker.** Jangan jalankan extension dan aplikasi ini bersamaan.

## Keamanan

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` di semua
  `BrowserWindow`; tidak ada preload/IPC ke halaman.
- Allowlist host diperiksa **sebelum** navigasi di `worker/sessions.js`, bukan
  hanya pada event `will-navigate`. Host dicocokkan persis, jadi
  `notinstagram.com` ditolak.
- Kanal worker ↔ content script memakai slot
  `Symbol.for('sunscraping.channel.v1')`; fungsi `invoke`-nya non-writable dan
  mengikat handler hasil injeksi, sehingga skrip halaman tidak bisa mengganti
  angka yang kita baca. Bila halaman sudah memakai slot itu lebih dulu, injeksi
  gagal dan task dianggap gagal — halaman tidak dipercaya.
- Permission request (kamera, mikrofon, notifikasi web) ditolak.
- Tautan `target=_blank` di dashboard dibuka di browser luar, bukan di window
  ber-privilese; popup dari jendela login hanya boleh ke host Instagram/TikTok.
- Backend yang dijalankan aplikasi ini dicatat di `userData/backend-owner.json`.
  Backend yatim dari crash sebelumnya diadopsi dan dihentikan saat keluar,
  setelah `/api/health` memastikan PID-nya memang proses yang sama. Proses yang
  tidak pernah dijalankan aplikasi ini tidak disentuh.
- API key hanya dikirim ke `http://127.0.0.1:<SA_PORT>`, sama seperti extension.

## Pengujian

```bash
cd desktop
npm test              # semua lapis; Electron di-skip bila tidak tersedia
npm run test:electron # harness saja, dengan output terlihat
```

Tiga lapis:

1. **`test/worker.test.js`** — tanpa Electron dan tanpa jaringan: `rate-limiter.js`
asli lewat shim, counter yang bertahan setelah restart, refill budget per siklus,
allowlist host, dan taksonomi error.
2. **`test/worker.test.js` (loop)** — `worker/core.js` dengan `api`, `sessions`,
`limiter`, dan timer palsu: budget habis → berhenti tanpa kunjungan, hasil sukses
ditagih sekali dan dilaporkan, cache hit tidak ditagih, tiga blok berturut-turut
→ berhenti, URL di luar allowlist gagal permanen tanpa navigasi, dan API key
ditolak → berhenti. Tes yang sama memeriksa `chrome-extension/background.js` dan
gagal bila konstanta allowlist/jeda/circuit breaker-nya melenceng dari
`worker/policy.js`.
3. **`test/sessions.test.js` → `test/sessions.harness.js`** — menjalankan
`worker/sessions.js` sungguhan di Electron: `BrowserWindow` dibuat, halaman
dimuat, content script diinjeksi ke isolated world lewat shim
`chrome.runtime.onMessage`, lalu `scrapePost`/`scrapeProfile` dipanggil seperti
worker memanggilnya.

Harness merutekan URL sosial ke fixture lokal (`test/fixtures/`), jadi tidak ada
permintaan ke Instagram/TikTok dan tidak perlu login:

| Kasus | Fixture | Yang dijaga |
|---|---|---|
| Post TikTok | `tk-post.html` | Counter berlabel → likes/comments/shares/views, caption |
| Profil Instagram | `ig-profile.html` | Meta + timeline JSON → follower/following/post, `taken_at`, URL reel/p |
| Payload profil di URL post | `tk-profile-as-post.html` | Tidak boleh berstatus `OK`; wajib `FAILED`/`TRANSIENT` |
| Host di luar allowlist | — (tidak dimuat) | `notinstagram.com` ditolak sebelum navigasi |

Fixture sengaja kecil dan deterministik: aturan parsing sudah dikunci tes DOM
Chrome (`tests/js/`), sedangkan harness ini mengunci plumbing-nya. Tes di-skip
bila paket `electron` belum dipasang atau (di Linux) tidak ada `DISPLAY`.
