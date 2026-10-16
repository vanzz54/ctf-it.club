# 🥇 Dashboard Prediksi Harga Emas (XAU/USD) — WebSocket LIVE + TradingView Charts

Aplikasi web berbasis **Streamlit** untuk memantau harga emas (XAU/USD)
**secara LIVE tick-by-tick** dan **memprediksi harga N bar ke depan**
(1 menit / 5 menit / 15 menit / 1 jam / 1 hari) menggunakan **Prophet (Meta)**
atau **Moving Average + Volatilitas**, lengkap dengan grafik candlestick
**TradingView Lightweight Charts**, indikator teknikal (SMA 20/50, RSI),
panel sinyal **BUY / SELL / HOLD**, dan prediksi overlay (garis + band 90%).

Grafik bergerak **per tick tanpa reload halaman Streamlit**: thread Python
background menerima WebSocket → API HTTP lokal → JavaScript di dalam iframe
memanggil `candleSeries.update()` setiap ~300 ms.

## Struktur Folder

```
fores/
├── app.py                  # Seluruh logika aplikasi (UI + feed + model + grafik)
├── requirements.txt        # Daftar library yang dibutuhkan
├── README.md               # Dokumentasi ini
└── .streamlit/
    └── config.toml         # Tema dark & pengaturan server Streamlit
```

## Cara Menjalankan (Plug & Play)

```bash
# 1. (Opsional) buat virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux

# 2. Install semua library
pip install -r requirements.txt

# 3. Jalankan aplikasi
python -m streamlit run app.py
```

Buka browser ke **http://localhost:8501**

> Pakai `python -m streamlit run app.py` (bukan `streamlit run app.py`) jika
> perintah `streamlit` tidak dikenal di terminal Anda.
>
> Jika `pip install prophet` gagal di sistem Anda, aplikasi **tetap berjalan**:
> pilih model **"Moving Average + Volatilitas"** di sidebar.

## Arsitektur LIVE (tick-by-tick)

```
┌────────────────────────── Python (background thread) ─────────────────────────┐
│  Feed thread        : WebSocket Gate.io / TwelveData  (atau polling yfinance) │
│       │                    ↓ push(bid, ask)                                  │
│  TickBus (memori)  : seq, deque tick, harga terakhir, tick-per-detik          │
│       ├── API lokal HTTP 127.0.0.1:8765-8775 → /tick /prediction /status     │
│  Prediksi thread   : Prophet / Moving Average tiap N detik ATAU candle baru   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ fetch() tiap 300 ms (tick) & 5 s (prediksi)
┌────────────────────────── Browser (iframe grafik) ────────────────────────────┐
│  TradingView Lightweight Charts: candleSeries.update(tick) → lilin bergerak   │
│  garis SMA20/SMA50, overlay prediksi + band, panel RSI sinkron, status bar    │
└───────────────────────────────────────────────────────────────────────────────┘

Streamlit (utama): sidebar + metrik besar + panel sinyal → @st.fragment(run_every)
                   hanya blok METRIK yang di-render ulang; grafik TIDAK ikut.
```

## Sumber Harga (Provider) & API Key

| Provider | Instrumen | API key | Keterangan |
|---|---|---|---|
| **Gate.io WebSocket** (default) | PAXG/USDT (proxy emas, 1 PAXG = 1 troy oz) | **Tidak perlu** | ~5 tick/detik via `spot.book_ticker` |
| **TwelveData WebSocket** | XAU/USD asli | **Gratis** (daftar) | Butuh key; lihat langkah di bawah |
| **Polling yfinance** | GC=F | Tidak perlu | Tanpa WebSocket, gerak lebih pelan |

### Cara dapat API key TwelveData (GRATIS, ±2 menit)

1. Buka **https://twelvedata.com/register** → daftar (email/Google).
2. Setelah login, buka **https://twelvedata.com/account/api-keys** → salin API key.
3. Di sidebar aplikasi: tempel key pada kolom **"API key TwelveData (opsional)"**.
4. Pilih provider **"TwelveData — XAU/USD"**. Jika subscribe gagal (free plan
   terbatas symbol trial), gunakan kembali **Gate.io**.

> Gate.io tidak butuh key sama sekali dan menjadi default karena PAXG/USDT
> bergerak sangat dekat dengan XAU/USD.

## Fitur

| Fitur | Keterangan |
|---|---|
| Tick LIVE | WebSocket menerima bid/ask → harga tengah diperbarui per tick (grafik) & per detik (metrik) |
| Grafik | TradingView **Lightweight Charts** di iframe: candle + SMA + overlay prediksi + band 90% + RSI sinkron, zoom/pan, watermark WIB |
| Auto metrik | `@st.fragment(run_every=…)` merender ulang **hanya metrik + sinyal** tiap 1/2/5 detik (bisa dimatikan) |
| Prediksi background | Thread terpisah menjalankan Prophet/Moving Average tiap **N detik** atau setiap **candle baru ditutup**, hasilnya dikirim sebagai garis prediksi ke grafik |
| Interval Waktu | 1 Menit / 5 Menit / 15 Menit / 1 Jam / 1 Hari — menentukan ukuran candle dari tick live |
| Horizon Prediksi | Dalam satuan **BAR** (1–120 bar, dibatasi maks per interval), estimasi durasi & waktu target |
| Indikator Teknikal | SMA 20, SMA 50, RSI (periode 7–21), bisa di-toggle |
| Sinyal Trading | Panel BUY / SELL / HOLD dari kombinasi prediksi + RSI + tren SMA |
| Tabel & Export | Tabel prediksi per waktu + tombol unduh CSV |
| API lokal | Endpoint `http://127.0.0.1:8765+`: `/tick?since=N`, `/prediction`, `/status` (CORS terbuka untuk iframe) |

### Riwayat data (indikator & latihan model)

| Provider | Sumber riwayat | Maksimum wajar |
|---|---|---|
| Gate.io | Candlestick REST Gate.io | 1000 bar (sesuai interval) |
| TwelveData | `time_series` REST (butuh key) | ikut paket free plan |
| Polling | Yahoo Finance GC=F (via `yfinance`) | 1m: 7 hari · 5m/15m/1h: 60 hari · 1d: 5 tahun |

## Strategi Sinyal (Skor)

1. **Arah prediksi AI** — bar berikutnya vs harga sekarang → ±1
2. **Zona RSI** — `<30` (oversold) → +1, `>70` (overbought) → −1
3. **Tren SMA** — harga > SMA20 dan SMA20 > SMA50 → +1, kebalikannya → −1

Skor **≥ +2 → BUY**, **≤ −2 → SELL**, selain itu **HOLD**.

> ⚠️ **Disclaimer:** Dashboard ini untuk edukasi/backtesting, **bukan nasihat
> keuangan**. Prediksi deret waktu bersifat probabilistik — selalu gunakan
> manajemen risiko (stop-loss & position sizing) pada trading riil.
