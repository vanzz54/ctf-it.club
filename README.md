# IT CLUB // LOCAL CTF ARENA

Platform web CTF (Capture The Flag) **lokal & ringan** untuk latihan member IT Club.
Frontend SPA satu file, backend Express, data soal berupa JSON.

## Tech Stack

- Node.js + Express.js (backend & REST API)
- HTML5 + Tailwind CSS (CDN) + Vanilla JS / Fetch API (frontend)
- Tema: Dark Minimalist (`#0b0f19`, aksen cyan `#00d2ff` + biru `#3b82f6`, font Plus Jakarta Sans & JetBrains Mono)

## Cara Menjalankan

```bash
npm install
npm start
```

Buka **http://localhost:8080** di browser.
Port bisa diganti dengan environment variable: `PORT=3000 npm start`.

> **Kenapa 8080, bukan 3000?** Karena salah satu soal (CyberNusa Portal) memang
> butuh `:3000`. Dengan arena di `:8080`, semua port soal tetap persis seperti
> yang tertulis di deskripsi — tidak ada yang perlu diedit.

## Struktur Project

```
web ctf/
├── server.js               # Server Express (API + static file + rate limit)
├── package.json            # Dependencies: express, cors
├── data/
│   ├── challenges.json     # Database soal (judul, poin, deskripsi, FLAG)
│   ├── users.json          # Akun peserta: hash password + skor + riwayat (auto dibuat)
│   ├── auditlog.jsonl      # Riwayat submisi flag untuk Audit Log admin (auto dibuat)
│   └── secret.key          # Kunci HMAC token sesi (auto dibuat, rahasia)
├── challenges/             # File attachment yang diunduh peserta (26 file)
├── public/
│   ├── index.html          # SPA frontend (dark minimalist glassmorphism UI)
│   ├── admin.html          # Admin Control Center — khusus role Admin
│   ├── admin.css           # Gaya dashboard admin (tema sama dengan arena)
│   ├── admin.js            # Logika CRUD soal / peserta / audit log
│   └── logo-itclub.png     # Logo resmi IT Club SMKN 2 Banjar (header)
├── targets/                # Sumber 11 server soal (dipakai Docker, TIDAK diserve)
├── deploy/                 # Orchestrator untuk VPS/server Linux
│   ├── docker-compose.yml  # 13 service sekaligus (arena + 11 soal + MySQL)
│   ├── arena.Dockerfile
│   ├── deploy.sh           # one-shot install Docker + build + UFW
│   ├── verify.ps1          # cek 12 port dari komputer lain
│   ├── .env.example        # SERVER_IP
│   └── README.md           # panduan lengkap deploy & troubleshooting
└── README.md
```

## REST API

| Method | Endpoint           | Deskripsi |
| ------ | ------------------ | --------- |
| POST   | `/api/register`    | Body `{ name, username, password }` → buat akun. Password di-hash scrypt+salt, balasan berisi `token` sesi + `user`. |
| POST   | `/api/login`       | Body `{ username, password }` → balasan berisi `token` sesi (HMAC) + `user`. |
| GET    | `/api/challenges`  | Daftar soal **tanpa field flag**. Tiap item memuat `downloadUrls[]`, `externalUrl`, dan `solved`. `<SERVER_IP>` di deskripsi otomatis diganti IP aktif. Query opsional `?token=<sesi>` menandai soal yang sudah diselesaikan user tersebut. |
| POST   | `/api/submit`      | Body `{ token, challengeId, flag }` — **wajib login** (401 `authRequired` bila tanpa token). Validasi flag, cegah submit ganda, tambah skor. Rate limit 30 request/menit per IP + cooldown 500 ms per user. |
| GET    | `/api/leaderboard` | Ranking peserta terdaftar berdasarkan total poin (descending). Rate limit 300 request/menit per IP. |
| GET    | `/api/health`      | Status server + `serverIp` + `port` + jumlah user. |

File attachment bisa diakses di `http://localhost:8080/challenges/<nama-file>`.
Folder `data/` dan `targets/` **tidak pernah** diserve ke browser.

### Endpoints Admin (khusus role `admin`)

Semua endpoint di bawah menerima token lewat header `Authorization: Bearer <token>`
(sama dengan token `/api/login`) dan menolak non-admin: **401** tanpa token,
**403** bila bukan role Admin. Dipakai oleh halaman `/admin.html`.

| Method | Endpoint | Deskripsi |
| ------ | -------- | --------- |
| GET    | `/api/admin/challenges` | Semua soal **lengkap** (termasuk `flag` & status `disabled`). |
| POST   | `/api/admin/challenges` | Tambah soal `{ title, category, difficulty, points, description, flag, file?, url? }` — ID dibuat otomatis per kategori, flag wajib `ITCLUB{...}`, langsung tersimpan ke `data/challenges.json` tanpa restart. |
| PUT    | `/api/admin/challenges/:id` | Edit field soal (parsial diperbolehkan; `file: ''` = lepas lampiran). |
| POST   | `/api/admin/challenges/:id/toggle` | Nonaktifkan / aktifkan — soal nonaktif **hilang** dari `/api/challenges` dan submit-nya ditolak (403). |
| DELETE | `/api/admin/challenges/:id` | Hapus soal (file lampiran tetap aman di disk). |
| PUT    | `/api/admin/upload/:namafile` | Upload lampiran (raw body, maks 50 MB, whitelist ekstensi — `.html`/`.svg` ditolak). |
| GET    | `/api/admin/users` | Daftar peserta: username, nama lengkap, poin, soal diselesaikan, role. |
| POST   | `/api/admin/users/:username/reset-password` | Body `{ password }` (min 6) → reset password peserta. |
| DELETE | `/api/admin/users/:username` | Hapus akun peserta (akun Admin ditolak). |
| POST   | `/api/admin/leaderboard/reset` | Kosongkan poin & riwayat semua akun → sesi kompetisi baru. |
| GET    | `/api/admin/audit` | 300 submisi flag terakhir: siapa, soal apa, Correct/Incorrect, waktu. |

## Admin Dashboard (`/admin.html`)

Halaman terpisah **Admin Control Center** untuk mengelola arena tanpa edit file:

- **Akses & keamanan** — login khusus **role Admin** (username + password). Akun
  admin dibuat otomatis saat boot pertama: default **`admin / admin123`**, ubah lewat
  env `ADMIN_USER` / `ADMIN_PASSWORD` **sebelum dipakai di VPS**. Tanpa login, halaman
  hanya menampilkan gerbang login; seluruh data berada di belakang API yang dicek
  server (bukan sekadar sembunyikan UI).
- **Manajemen soal (CRUD)** — form tambah/edit: judul, kategori (dropdown 7), level
  kesulitan, poin, deskripsi (markdown), upload file **atau** link eksternal, dan
  kunci flag `ITCLUB{...}`. Tabel daftar soal dengan tombol **Edit**,
  **Nonaktifkan/Sembunyikan**, dan **Hapus** (ada konfirmasi modal).
- **Peserta & leaderboard** — tabel Username, Nama Lengkap, Total Poin, dan Soal
  yang Sudah Diselesaikan; tombol **Reset Password Peserta**, **Hapus Akun Peserta**,
  dan **Reset Leaderboard** (untuk sesi kompetisi baru — akun tetap tersimpan).
- **Audit log submisi** — riwayat setiap submit flag: siapa yang submit, soal apa,
  status **Correct/Incorrect**, dan waktu. Disimpan di `data/auditlog.jsonl`
  (otomatis dibatasi 500 entri terakhir).
- **Tema** — identik dengan arena: dark minimalist `#0b0f19`, aksen cyan `#00d2ff` +
  biru `#3b82f6`, Plus Jakarta Sans / JetBrains Mono, kartu glass, toast, dan modal
  konfirmasi ala cyber UI.

## Deploy Live (VPS / server lab Linux)

Panduan lengkap: **[deploy/README.md](deploy/README.md)**. Ringkasnya:

```bash
scp -r . root@IP_VPS:/opt/ctf
cd /opt/ctf/deploy && chmod +x deploy.sh && sudo ./deploy.sh
```

Dari komputer lain, verifikasi:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\verify.ps1 -Target <IP_VPS>
```

## Cara Menambah Soal

> **Cara termudah:** lewat **Admin Dashboard** di `http://localhost:8080/admin.html`
> (login role Admin) — form tambah soal + upload lampiran langsung tersimpan ke
> `data/challenges.json`, **tanpa restart server**. Cara manual di bawah tetap valid.

1. Taruh file attachment di folder `challenges/` (pakai prefix id soal agar nama tidak tabrakan).
2. Tambah entry baru di `data/challenges.json`:

```json
{
  "id": "web-07",
  "title": "Judul Soal",
  "category": "Web",
  "points": 100,
  "difficulty": "Medium",
  "description": "Deskripsi tantangan.\\nGunakan \\n\\n untuk baris baru.",
  "file": "web-07-lampiran.zip",
  "flag": "ITCLUB{flag_baru_disini}"
}
```

3. Restart server (`Ctrl+C` lalu `npm start`).

### Varian field lampiran

| Field  | Fungsi |
| ------ | ------ |
| `"file"` | Satu file lampiran (cara paling singkat). |
| `"files": ["a.zip", "b.txt"]` | Beberapa file untuk satu soal → tombol download per file. |
| `"url"` | Link eksternal (mis. OVA Google Drive) → tombol **LINK OVA / WEBSITE**. Tidak ada `file`/`files` pun tidak masalah. |

> **Catatan keamanan:** field `flag` hanya dibaca oleh `server.js` dan **tidak pernah**
> dikirim ke frontend — `/api/challenges` selalu melepas field tersebut.
> (Sudah diuji: seluruh 35 flag tidak ada yang muncul di respons API.)
>
> Aturan format flag: **semua soal kini memakai `ITCLUB{...}`** (konversi penuh dari
> format lama; isi dalam kurung tidak berubah).
> Format tiap soal otomatis tertera di placeholder input submit dan dibantu
> server saat submit dengan format salah.

## Aturan Main

- Saat pertama kali dibuka, **Auth Gateway otomatis tampil** — modal **Login / Daftar**
  (2 tab) langsung mengunci arena (backdrop blur, tanpa tombol ×) sampai user login
  atau daftar lewat tab **"Daftar Akun Baru"**. Sesi (`token`) disimpan di
  `localStorage`/`sessionStorage` sehingga tidak perlu login ulang tiap refresh, dan
  **Logout** otomatis memunculkan kembali modal Auth yang terkunci.
- Download file soal → analisis → submit flag (**wajib login** — tanpa login submit
  ditolak dengan pemicu otomatis modal login; semua soal memakai format `ITCLUB{...}` —
  placeholder input tiap soal menampilkan formatnya).
- Setiap soal hanya bisa menambah poin **satu kali** per akun (anti double-submit).
- Riwayat pengerjaan & skor per akun disimpan di `data/users.json` (bertahan saat
  server restart); leaderboard di-refresh otomatis setiap 5 detik.
- **Akun Admin tidak ikut kompetisi:** username/role Admin disaring dari Live
  Leaderboard (filter di server *dan* di JS `loadLeaderboard()`), submit flag oleh
  Admin hanya dicatat (kartu ✓ + audit log) dengan poin **0**, dan header
  menampilkan penanda **🛡️ ADMIN** sebagai penanda Mode Admin.

## Isi Soal Saat Ini (35 soal, total 22.905 poin)

### Jeopardy — LKS Cyber Security Jabar 2026 (17 soal, flag asli)

| ID | Kategori | Soal | Poin | Lampiran |
| --- | --- | --- | --- | --- |
| web-03 | Web Exploitation | CyberNusa Official Landing Page | 500 | `web-03-cybernusa-landing_dist.zip` |
| web-04 | Web Exploitation | CyberNusa Portal | 998 | target live `:3000` |
| web-05 | Web Exploitation | CyberNusa Swag Store | 980 | `web-05-cybernusa-swag_dist.zip` |
| web-06 | Web Exploitation | MerchTech Custom Studio | 980 | `web-06-merchtech_dist.zip` |
| pwn-01 | Binary Exploitation | Admin Panel | 980 | `pwn-01-admin-panel_chall` |
| pwn-02 | Binary Exploitation | Feedback Portal | 992 | `pwn-02-feedback-portal_chall` |
| pwn-03 | Binary Exploitation | Weapon Shop | 565 | `pwn-03-weapon-shop_chall` |
| df-01 | Digital Forensics | Get Tracked | 998 | `df-01-get-tracked_server_evidence.rar` |
| df-02 | Digital Forensics | Silent Cipher | 998 | `df-02-silent-cipher_server_evidence.rar` |
| df-03 | Digital Forensics | The Exfiltration Route | 732 | `df-03-exfiltration-route_traffic.pcap` |
| df-04 | Digital Forensics | The Missing Phantom | 965 | `df-04-missing-phantom_phantom_repo.zip` |
| cr-03 | Cryptography | The Twin Anomaly | 992 | `cr-03-twin-anomaly_validator.py` |
| cr-04 | Cryptography | Pesan Berantai | 625 | `cr-04-pesan-berantai_bundle.zip` |
| cr-05 | Cryptography | Pesan di Balik Sisa Bagi | 965 | `cr-05-sisa-bagi_bundle.zip` |
| rv-02 | Reverse Engineering | LKS-Crypter | 965 | `rv-02-lks-crypter_ransomware.elf` + `.enc` |
| rv-03 | Reverse Engineering | The Forgotten Vault | 945 | `rv-03-forgotten-vault_vault.exe` |
| rv-04 | Reverse Engineering | The Phishing App | 945 | `rv-04-phishing-app_dist.zip` |

### Boot2Root — LKS (9 soal, **flag masih PLACEHOLDER**)

| ID | Soal | Poin |
| --- | --- | --- |
| b2r-1-low / med / high | Challenge 1: The Dev Portal | 500 / 750 / 1000 |
| b2r-2-low / med / high | Challenge 2: Legacy Maintenance | 500 / 750 / 1000 |
| b2r-3-low / med / high | Challenge 3: Cloud Beta (The Forgotten Path) | 500 / 750 / 1000 |

Semuanya memakai link OVA Google Drive yang sama (tombol **LINK OVA / WEBSITE**),
password zip `S4y@s14pLKS!!`.

> **TODO wajib:** flag 9 soal ini masih `ITCLUB{GANTI_FLAG_...}` karena flag aslinya ada
> di dalam masing-masing VM/OVA. Ganti nilainya di `data/challenges.json` lalu restart
> server setelah kamu mengambil flag dari VM.

### Soal latihan internal (9 soal, format `ITCLUB{...}`)

web-01 Welcome Aboard (50), web-02 Robo.txt (80), cr-01 Caesar Never Sleeps (100),
cr-02 Broken Hash (150), fr-01 Ghost In The Picture (120), fr-02 The Lost Chat Log (180),
rv-01 Strings Attached (200), ms-01 Binary Whisper (60), ms-02 Nothing To See Here (90).
