# Deploy ke VPS / Server Lab Linux

Semua server soal (11 container) + arena dijalankan **satu perintah** dengan
Docker Compose. Portnya sengaja **sama persis** dengan yang tertulis di deskripsi
soal, jadi tidak ada deskripsi yang perlu diedit.

## Prasyarat

- VPS Linux (Ubuntu 22.04/24.04 direkomendasikan), **4 vCPU / 8 GB RAM / 20 GB disk**
  → 8 GB penting: MySQL + Next.js + 4 app Python + 3 biner + 3 checker makan ~4 GB.
- Akses SSH sebagai root/sudo.
- **Repo bersifat PRIVAT** — folder `targets/` dan `data/` memuat semua flag.
  Jangan di-push ke repo publik, jangan ikut ke image yang dibagikan.

## Langkah

```bash
# 1. salin project ke VPS (dari mesin kamu)
scp -r "<folder web ctf>" root@IP_VPS:/opt/ctf

# 2. deploy (install Docker + build + buka firewall + isi SERVER_IP)
cd /opt/ctf/deploy
chmod +x deploy.sh
sudo ./deploy.sh
```

`deploy.sh` akan:
1. memasang Docker Engine bila belum ada,
2. mengisi `SERVER_IP` di `deploy/.env` otomatis dari IP publik VPS,
3. `docker compose up -d --build` (12 service),
4. membuka UFW: `8080 3000 4000 5000 6060 9001 9002 9003 1337 10001 10002 10003` —
   **3306 (MySQL) sengaja TIDAK dibuka** karena `init.sql` berisi flag.

## Verifikasi (dari komputer lain / internet)

```powershell
powershell -ExecutionPolicy Bypass -File deploy\verify.ps1 -Target <IP_VPS>
```

Harus keluar: 12 port `UP`, `35 soal`, `field flag bocor: False`, `sisa placeholder <SERVER_IP>: 0`.

Cek manual:
- Arena: `http://IP_VPS:8080` → login / daftar akun (modal Masuk Arena) → daftar soal → submit flag
- `nc IP_VPS 9001` (pwn), `nc IP_VPS 10001` (forensics), `http://IP_VPS:3000` (portal)

## Perintah operasional

| Kegiatan | Perintah |
| --- | --- |
| Lihat status | `docker compose ps` |
| Log semua | `docker compose logs -f --tail=100` |
| Log 1 soal | `docker compose logs -f pwn-01-admin-panel` |
| Restart arena | `docker compose restart arena` |
| Matikan semua | `docker compose down` |
| Update soal/flag | edit `data/challenges.json` lalu `docker compose restart arena` — **atau** lewat Admin Dashboard (`/admin.html` → tab Soal), langsung tersimpan tanpa restart |
| Tambah lampiran | taruh di `challenges/` (langsung terbaca, tanpa rebuild) |
| Reset skor | Admin Dashboard → tab Peserta → tombol **Reset Leaderboard** (akun tetap, poin & riwayat kosong) |

## Ganti `<SERVER_IP>` di deskripsi

Arena otomatis mengganti `<SERVER_IP>` di deskripsi dengan nilai env `SERVER_IP`
(saat runtime, tanpa mengedit JSON). Atur di `deploy/.env`:

```
SERVER_IP=203.0.113.10
```

lalu `docker compose restart arena`.
Kalau kosong, arena memakai IP hasil deteksi rute default.

## Admin Dashboard & kredensial admin

Arena menyediakan halaman admin di `http://<IP>:8080/admin.html` (gerbang login
khusus role Admin). Akun admin **dibuat otomatis saat boot pertama** — sebelum live,
isi kredensialnya di `deploy/.env`:

```
ADMIN_USER=admin
ADMIN_PASSWORD=ganti_dengan_password_kuat
```

lalu `docker compose restart arena`. Catatan:

- `ADMIN_PASSWORD` hanya berlaku saat akun admin **pertama kali dibuat**
  (`data/users.json` masih kosong). Kalau akun sudah ada, ganti password lewat
  dashboard (tab Peserta → Reset Password) atau hapus baris admin di
  `data/users.json` lalu restart.
- Tanpa env, akun default-nya `admin / admin123` — **jangan dibiarkan di VPS publik**.
- Fitur dashboard: CRUD soal (tambah/edit/nonaktifkan/hapus + upload lampiran),
  kelola peserta (reset password/hapus akun), Reset Leaderboard, dan Audit Log
  submisi flag. Detail endpoint: `README.md` → "Admin Dashboard".

## Troubleshooting

| Gejala | Penyebab / solusi |
| --- | --- |
| `COPY src/...: file not found` saat build | context salah. 4 soal (pwn×3, portal) memang butuh context = folder `targets/<id>`, sudah diatur di `deploy/docker-compose.yml` — jangan ubah jadi `build: .` |
| `port is already allocated` | port dipakai layanan lain di VPS (`ss -tlnp \| grep 3000`) |
| Kontainer `restarting` terus | `docker compose logs <nama>` — biasanya aplikasi butuh volume/db belum siap |
| Port terbuka di container tapi tidak dari luar | UFW/provider firewall → `ufw status`; di panel VPS buka juga security group/firewall |
| Arena jalan tapi deskripsi tetap `<SERVER_IP>` | `SERVER_IP` kosong di `.env` dan deteksi gagal → isi manual |
| RAM habis | turunkan `mem_limit` di compose atau sewa VPS 8 GB |

## Setelah live: ceklis tugas tersisa

- [ ] Isi 9 flag Boot2Root (sekarang `ITCLUB{GANTI_FLAG_...}`) di `data/challenges.json`
- [ ] (Opsional) HTTPS untuk arena pakai Caddy di depan `:8080`
- [ ] (Opsional) indikator live/dead tiap soal di kartu arena
