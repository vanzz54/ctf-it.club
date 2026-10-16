"""
================================================================================
  DASHBOARD LIVE XAU/USD — WEBSOCKET TICK-BY-TICK + TRADINGVIEW LIGHTWEIGHT CHARTS
  ---------------------------------------------------------------------------------
  ARSITEKTUR (alur data):

    1. FEED (background thread, `websocket-client`)
         Gate.io WS (spot.book_ticker PAXG/USDT) / TwelveData WS (XAU/USD)
         / polling yfinance (GC=F)
         -> TickBus (harga, bid/ask, timestamp, seq) di memori proses Python.
              ~5 tick/detik pada mode Gate.io (best bid/ask berubah terus).

    2. API LOKAL (background thread HTTP, 127.0.0.1:8765..8775)
         GET /tick?since=N   -> tick baru sejak urutan N  (dipakai grafik JS)
         GET /prediction     -> overlay prediksi (garis + band) (dipakai grafik JS)
         GET /status         -> status feed
         Semua balasan disertai header CORS (Access-Control-Allow-Origin: *).

    3. PREDIKSI (background thread terpisah)
         Dijalankan tiap N detik ATAU setiap candle baru ditutup (mana dulu),
         memakai Prophet (Meta) / Moving Average -> payload JSON disimpan.

    4. GRAFIK (`streamlit.components.v1.html`)
         TradingView Lightweight Charts (JS, CDN): menerima tick dari API lokal
         lalu memanggil candleSeries.update() -> lilin bergerak mulus
         TANPA re-render halaman Streamlit.

    5. METRIK LIVE (`@st.fragment(run_every=...)`)
         Hanya blok metrik/sinyal yang di-render ulang tiap detik;
         grafik & sidebar TIDAK ikut di-refresh (tanpa kedip/reload).

  CATATAN: konfigurasi antar sesi memakai "last writer wins" (aplikasi lokal
  single-user). API key TIDAK diperlukan untuk mode Gate.io (default).

  CARA MENJALANKAN:
      pip install -r requirements.txt
      python -m streamlit run app.py       # buka http://localhost:8501

  SUMBER DATA:
      * Gate.io    — PAXG/USDT (1 PAXG = 1 troy oz emas), TANPA API key.
      * TwelveData — XAU/USD asli, butuh API key GRATIS:
                     daftar https://twelvedata.com/register
                     lalu ambil key di https://twelvedata.com/account/api-keys
      * Polling    — Yahoo Finance GC=F tanpa WebSocket (update tiap ~5 detik).
================================================================================
"""

import datetime as dt
import json
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
import websocket
import yfinance as yf

# ------------------------------------------------------------------------------
# 0. KONFIGURASI HALAMAN (harus menjadi perintah Streamlit pertama)
# ------------------------------------------------------------------------------
st.set_page_config(
    page_title="XAU/USD LIVE WebSocket Dashboard",
    page_icon="🥇",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ------------------------------------------------------------------------------
# 1. KONSTANTA APLIKASI
# ------------------------------------------------------------------------------
TRAIN_ROW_CAP = 3000          # batas baris latihan Prophet
HISTORY_TTL = 30.0            # cache riwayat (detik) — dipakai UI & thread prediksi
API_PORT_RANGE = range(8765, 8776)   # port API lokal untuk grafik JS

# Riwayat historis (jumlah bar yang diambil dari provider)
RIWAYAT_MAP = {"200 bar": 200, "500 bar": 500, "1000 bar": 1000}
RIWAYAT_DEFAULT = "500 bar"

# Opsi zoom candle di grafik (None = semua)
DISPLAY_MAP = {
    "Semua data": None,
    "960 bar": 960,
    "480 bar": 480,
    "240 bar": 240,
    "120 bar": 120,
}
DISPLAY_DEFAULT = "480 bar"

# Interval live update metrik (detik) dan interval prediksi ulang (detik)
LIVE_INTERVALS = [1, 2, 5, 10]
PREDICT_INTERVALS = [30, 60, 120, 300]

# Opsi interval candle — semua provider diwajibkan mendukung mapping ini:
#   freq     : freq pandas untuk forecast (Prophet / Moving Average)
#   seconds  : panjang 1 bar dalam detik (bucket candle tick di JS & Python)
#   gate     : nama interval di API Gate.io (1m/5m/15m/1h/1d)
#   td       : nama interval di API TwelveData (1min/5min/15min/1h/1day)
#   yf       : nama interval di yfinance + period untuk polling
#   max_bars : batas horizon prediksi yang wajar per interval
INTERVAL_OPTIONS = {
    "1 Menit (1m)": {
        "key": "1m", "freq": "1min", "minutes": 1, "intraday": True,
        "seconds": 60, "gate": "1m", "td": "1min", "yf": "1m", "yf_period": "5d",
        "max_bars": 120, "default_bars": 30,
    },
    "5 Menit (5m)": {
        "key": "5m", "freq": "5min", "minutes": 5, "intraday": True,
        "seconds": 300, "gate": "5m", "td": "5min", "yf": "5m", "yf_period": "1mo",
        "max_bars": 96, "default_bars": 24,
    },
    "15 Menit (15m)": {
        "key": "15m", "freq": "15min", "minutes": 15, "intraday": True,
        "seconds": 900, "gate": "15m", "td": "15min", "yf": "15m", "yf_period": "60d",
        "max_bars": 64, "default_bars": 24,
    },
    "1 Jam (1h)": {
        "key": "1h", "freq": "60min", "minutes": 60, "intraday": True,
        "seconds": 3600, "gate": "1h", "td": "1h", "yf": "1h", "yf_period": "60d",
        "max_bars": 48, "default_bars": 12,
    },
    "1 Hari (1d) - Harian": {
        "key": "1d", "freq": "B", "minutes": 1440, "intraday": False,
        "seconds": 86400, "gate": "1d", "td": "1day", "yf": "1d", "yf_period": "5y",
        "max_bars": 14, "default_bars": 7,
    },
}

# Sumber harga tick (provider live)
PROVIDER_OPTIONS = {
    "Gate.io — PAXG/USDT (WebSocket, tanpa API key)": "gate",
    "TwelveData — XAU/USD (WebSocket, butuh API key gratis)": "twelvedata",
    "Polling yfinance — GC=F (tanpa WebSocket)": "poll",
}
PROVIDER_META = {
    "gate": {
        "instrument": "XAU/USD · Gate.io PAXG/USDT",
        "short": "Gate.io PAXG_USDT",
        "detail": "Token PAXG (1 token = 1 troy oz emas) di Gate.io — proxy harga emas, tanpa API key.",
    },
    "twelvedata": {
        "instrument": "XAU/USD · TwelveData",
        "short": "TwelveData XAU/USD",
        "detail": "Pasangan XAU/USD asli. Butuh API key GRATIS: daftar di twelvedata.com/register, "
                  "lalu ambil key di twelvedata.com/account/api-keys dan tempel di sidebar.",
    },
    "poll": {
        "instrument": "XAU/USD · Yahoo GC=F",
        "short": "Yahoo GC=F",
        "detail": "Tanpa WebSocket: harga berjangka GC=F diambil ulang tiap ~5 detik (gerak lebih pelan).",
    },
}

# Opsi model prediksi
MODEL_OPTIONS = {
    "Otomatis (Prophet jika tersedia)": "auto",
    "Prophet (Meta)": "prophet",
    "Moving Average + Volatilitas": "ma",
}

# Warna tema grafik
COLOR_UP = "#00C853"
COLOR_DOWN = "#FF3D57"
COLOR_FORECAST = "#FFD700"

# Peta z-score sederhana untuk confidence interval model Moving Average
Z_SCORE = {0.80: 1.282, 0.90: 1.645, 0.95: 1.960, 0.99: 2.576}

EPOCH = pd.Timestamp("1970-01-01")

# CSS statis (dirender sekali di luar fragment -> tidak ikut di-refresh tiap detik)
LIVE_CSS = """
<style>
  .signal-box { padding: 18px 22px; border-radius: 14px; border-left: 7px solid;
                background: rgba(255,255,255,0.04); margin-bottom: 6px; }
  .signal-label { font-size: 34px; font-weight: 800; letter-spacing: 2px; }
  .signal-sub { font-size: 14px; opacity: 0.75; }
  .mini { font-size: 13px !important; }
  /* ===== Metrik LIVE berukuran besar (baris 2 kolom di area utama) ===== */
  div[data-testid="stHorizontalBlock"]:has(> div[data-testid="stColumn"]:nth-child(2):last-child)
    [data-testid="stMetricValue"] {
      font-size: 46px !important; font-weight: 800 !important; line-height: 1.15 !important;
    }
  div[data-testid="stHorizontalBlock"]:has(> div[data-testid="stColumn"]:nth-child(2):last-child)
    [data-testid="stMetricDelta"] { font-size: 20px !important; font-weight: 600 !important; }
  div[data-testid="stHorizontalBlock"]:has(> div[data-testid="stColumn"]:nth-child(2):last-child)
    [data-testid="stMetricLabel"] { font-size: 15px !important; opacity: 0.85; letter-spacing: 0.06em; }
</style>
"""


# ==============================================================================
# 2. FUNGSI INDIKATOR TEKNIKAL
# ==============================================================================
def add_sma(df: pd.DataFrame, periods: list[int]) -> pd.DataFrame:
    """Tambahkan kolom Simple Moving Average (SMA) untuk setiap periode."""
    out = df.copy()
    for p in periods:
        out[f"SMA{p}"] = out["Close"].rolling(window=p, min_periods=p).mean()
    return out


def compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """RSI metode Wilder (exponential smoothing), skala 0-100."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi = rsi.fillna(100.0).where(~avg_gain.isna(), np.nan)
    return rsi.round(2)


def format_duration(minutes: int) -> str:
    """Ubah durasi menit -> teks mudah dibaca (menit / jam / hari)."""
    if minutes < 60:
        return f"{minutes} menit"
    hours, mins = divmod(minutes, 60)
    if hours < 24:
        return f"{hours} jam" + (f" {mins} menit" if mins else "")
    days, hours = divmod(hours, 24)
    return f"{days} hari" + (f" {hours} jam" if hours else "")


def epoch_to_wib(ts_epoch: int | float, with_time: bool = True) -> str:
    """Epoch (UTC) -> teks WIB."""
    stamp = pd.Timestamp(int(ts_epoch), unit="s", tz="UTC").tz_convert("Asia/Jakarta")
    return stamp.strftime("%a, %d %b %Y %H:%M WIB" if with_time else "%d %b %Y")


def _attach_epoch(df: pd.DataFrame) -> pd.DataFrame:
    """Tambahkan kolom epoch (detik UTC) — asumsi Date sudah tz-naive UTC."""
    df = df.copy()
    df["epoch"] = ((df["Date"] - EPOCH) // pd.Timedelta(seconds=1)).astype("int64")
    return df


# ==============================================================================
# 3. PENGAMBILAN RIWAYAT HARGA (per provider)
# ==============================================================================
def _http_json(url: str, timeout: int = 15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_gate_history(interval_cfg: dict, bars: int) -> pd.DataFrame:
    """
    Riwayat candle dari REST Gate.io (PAXG_USDT), tanpa API key.
    Format baris Gate: [t, vol_quote, close, high, low, open, vol_base, closed]
    (urutan: ASCENDING). Parameter `to` dipakai untuk maju ke halaman lebih lama.
    """
    want = min(int(bars), 5000)
    rows: list = []
    to_param = None
    pages = 0
    while len(rows) < want and pages < 6:
        url = ("https://api.gateio.ws/api/v4/spot/candlesticks"
               f"?currency_pair=PAXG_USDT&interval={interval_cfg['gate']}&limit=1000")
        if to_param:
            url += f"&to={to_param}"
        data = _http_json(url)
        pages += 1
        if not data:
            break
        rows = list(data) + rows
        if len(data) < 1000:
            break
        to_param = int(data[0][0]) - 1
    rows = rows[-want:]
    if len(rows) < 15:
        raise RuntimeError(f"Gate.io: data terlalu sedikit ({len(rows)} bar)")

    df = pd.DataFrame({
        "Date": pd.to_datetime([int(r[0]) for r in rows], unit="s"),
        "Open": [float(r[5]) for r in rows],
        "High": [float(r[3]) for r in rows],
        "Low": [float(r[4]) for r in rows],
        "Close": [float(r[2]) for r in rows],
        "Volume": [float(r[6]) for r in rows],
    })
    return _finalize_history(df, "Gate.io PAXG/USDT")


def fetch_twelvedata_history(interval_cfg: dict, bars: int, api_key: str) -> pd.DataFrame:
    """Riwayat candle XAU/USD dari REST TwelveData (butuh API key)."""
    if not api_key:
        raise RuntimeError("API key TwelveData kosong — daftar gratis di "
                           "https://twelvedata.com/register lalu tempel key-nya di sidebar.")
    url = ("https://api.twelvedata.com/time_series"
           f"?symbol=XAU%2FUSD&interval={interval_cfg['td']}"
           f"&outputsize={min(int(bars), 5000)}&timezone=UTC&order=asc"
           f"&apikey={urllib.parse.quote(api_key)}")
    data = _http_json(url)
    if isinstance(data, dict) and data.get("status") == "error":
        raise RuntimeError(f"TwelveData: {data.get('message', data)}")
    values = (data or {}).get("values") or []
    if len(values) < 15:
        raise RuntimeError(f"TwelveData: data terlalu sedikit ({len(values)} bar)")

    df = pd.DataFrame({
        "Date": pd.to_datetime([v["datetime"] for v in values]),
        "Open": [float(v["open"]) for v in values],
        "High": [float(v["high"]) for v in values],
        "Low": [float(v["low"]) for v in values],
        "Close": [float(v["close"]) for v in values],
        "Volume": [float(v.get("volume") or 0) for v in values],
    })
    return _finalize_history(df, "TwelveData XAU/USD")


def fetch_yfinance_history(interval_cfg: dict, bars: int) -> pd.DataFrame:
    """Riwayat candle GC=F dari Yahoo Finance (mode polling / cadangan)."""
    raw = yf.download(
        "GC=F", period=interval_cfg["yf_period"], interval=interval_cfg["yf"],
        auto_adjust=True, progress=False, threads=False,
    )
    if raw is None or raw.empty:
        raise RuntimeError("Yahoo Finance: data kosong (GC=F)")
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)
    raw = raw.rename(columns={c: str(c).strip().title() for c in raw.columns})
    if not all(c in raw.columns for c in ("Open", "High", "Low", "Close")):
        raise RuntimeError("Yahoo Finance: kolom OHLC tidak lengkap")

    idx = pd.to_datetime(raw.index)
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_convert("America/New_York").tz_localize(None)
    # Semua sumber dinormalisasi ke tz-naive UTC agar sejajar dengan epoch tick
    idx = idx.tz_localize("America/New_York").tz_convert("UTC").tz_localize(None)

    df = pd.DataFrame({
        "Date": idx,
        "Open": raw["Open"].to_numpy(dtype="float64"),
        "High": raw["High"].to_numpy(dtype="float64"),
        "Low": raw["Low"].to_numpy(dtype="float64"),
        "Close": raw["Close"].to_numpy(dtype="float64"),
        "Volume": (raw["Volume"].to_numpy(dtype="float64")
                   if "Volume" in raw.columns else np.zeros(len(raw))),
    })
    df = df.sort_values("Date").tail(int(bars)).reset_index(drop=True)
    return _finalize_history(df, "Yahoo Finance GC=F")


def _finalize_history(df: pd.DataFrame, source_name: str) -> pd.DataFrame:
    """Bersihkan + normalisasi akhir (tz-naive UTC, epoch, urutan naik)."""
    df = df.dropna(subset=["Close"]).drop_duplicates(subset=["Date"], keep="last")
    df = df.sort_values("Date").reset_index(drop=True)
    if len(df) < 15:
        raise RuntimeError(f"{source_name}: data terlalu sedikit ({len(df)} bar)")
    df = _attach_epoch(df)
    df.attrs["source_name"] = source_name
    return df


# Cache riwayat (dipakai Streamlit DAN thread prediksi -> tanpa st.cache_data
# agar aman dijalankan dari thread background)
_HISTORY_CACHE: dict[tuple, tuple[float, pd.DataFrame]] = {}
_HISTORY_LOCK = threading.Lock()


def get_history(cfg: dict, ttl: float = HISTORY_TTL, force: bool = False) -> pd.DataFrame:
    """Ambil riwayat OHLC sesuai provider (TTL cache, thread-safe)."""
    key = (cfg["provider"], cfg["key"], cfg["bars"], cfg["td_api_key"])
    now = time.time()
    with _HISTORY_LOCK:
        entry = _HISTORY_CACHE.get(key)
        if entry and (now - entry[0]) < ttl and not force:
            return entry[1]

        if cfg["provider"] == "gate":
            df = fetch_gate_history(cfg, cfg["bars"])
        elif cfg["provider"] == "twelvedata":
            df = fetch_twelvedata_history(cfg, cfg["bars"], cfg["td_api_key"])
        else:
            df = fetch_yfinance_history(cfg, cfg["bars"])

        if len(_HISTORY_CACHE) > 12:  # batasi pemakaian memori
            _HISTORY_CACHE.clear()
        _HISTORY_CACHE[key] = (now, df)
        return df


def get_history_with_indicators(cfg: dict, ttl: float = HISTORY_TTL) -> pd.DataFrame:
    """Riwayat + SMA 20/50 + RSI (dihitung per panggilan, murah)."""
    df = get_history(cfg, ttl=ttl)
    df = add_sma(df, [20, 50])
    df["RSI"] = compute_rsi(df["Close"], cfg["rsi_period"])
    return df


# ==============================================================================
# 4. FUNGSI PREDIKSI (FORECASTING) — dipakai thread prediksi & UI
# ==============================================================================
def forecast_prophet(
    hist: pd.DataFrame, horizon: int, confidence: float,
    freq: str, intraday: bool, minutes_per_bar: int,
) -> pd.DataFrame:
    """Prediksi Prophet (Meta) dalam SATUAN BAR (ds, yhat, yhat_lower, yhat_upper)."""
    from prophet import Prophet  # import lokal agar app tetap jalan tanpa prophet

    train = hist[["Date", "Close"]].rename(columns={"Date": "ds", "Close": "y"})
    if intraday and len(train) > TRAIN_ROW_CAP:
        train = train.tail(TRAIN_ROW_CAP).reset_index(drop=True)

    n = len(train)
    bars_per_day = max(1, round(1440 / minutes_per_bar))
    model = Prophet(
        interval_width=confidence,
        daily_seasonality=bool(intraday and n >= 2 * bars_per_day),
        weekly_seasonality=False,
        yearly_seasonality=(not intraday) and n >= 730,
        seasonality_mode="additive",
        changepoint_prior_scale=0.08,
    )
    if not intraday and n >= 60:
        model.add_seasonality(name="monthly", period=30.5, fourier_order=4)
    model.fit(train)

    future = model.make_future_dataframe(periods=horizon, freq=freq)
    pred = model.predict(future)
    last_date = train["ds"].max()
    out = pred.loc[
        pred["ds"] > last_date, ["ds", "yhat", "yhat_lower", "yhat_upper"]
    ].reset_index(drop=True)
    if intraday and not out.empty:
        out = out[out["ds"].dt.weekday < 5].reset_index(drop=True)
    return out


def forecast_moving_average(
    hist: pd.DataFrame, horizon: int, confidence: float, freq: str, intraday: bool
) -> pd.DataFrame:
    """Drift (rata-rata return per bar) + band volatilitas ~ akar(waktu)."""
    close = hist["Close"]
    returns = close.pct_change().dropna()
    drift = float(returns.mean())
    vol = float(returns.std())
    last_close = float(close.iloc[-1])
    last_date = pd.Timestamp(hist["Date"].iloc[-1])
    z = Z_SCORE.get(round(confidence, 2), 1.960)

    if intraday:
        candidates = pd.date_range(start=last_date, periods=horizon * 3 + 8, freq=freq)[1:]
        dates = pd.DatetimeIndex([d for d in candidates if d.weekday() < 5][:horizon])
    else:
        dates = pd.bdate_range(start=last_date + pd.Timedelta(days=1), periods=horizon)

    rows = []
    for i, day in enumerate(dates, start=1):
        yhat = last_close * ((1.0 + drift) ** i)
        band = np.exp(z * vol * np.sqrt(i))
        rows.append({"ds": day, "yhat": yhat, "yhat_lower": yhat / band, "yhat_upper": yhat * band})
    return pd.DataFrame(rows)


def run_forecast(
    hist: pd.DataFrame, model_choice: str, horizon: int, confidence: float,
    freq: str, intraday: bool, minutes_per_bar: int,
    warn=None,
) -> tuple[pd.DataFrame, str]:
    """Jalankan model sesuai pilihan user, dengan fallback otomatis ke MA."""
    if model_choice in ("prophet", "auto"):
        try:
            fc = forecast_prophet(hist, horizon, confidence, freq, intraday, minutes_per_bar)
            if not fc.empty:
                return fc, "Prophet (Meta)"
        except Exception as exc:
            if model_choice == "prophet":
                raise RuntimeError(
                    f"Prophet gagal dijalankan: {exc}\n"
                    "Solusi: pilih model 'Moving Average' di sidebar, "
                    "atau jalankan: pip install prophet"
                ) from exc
            if warn:
                warn(f"Prophet tidak tersedia ({type(exc).__name__}) -> fallback ke Moving Average.")

    fc = forecast_moving_average(hist, horizon, confidence, freq, intraday)
    if fc.empty:
        raise RuntimeError("Prediksi kosong (periksa horizon/interval)")
    return fc, "Moving Average + Volatilitas"


# ==============================================================================
# 5. FUNGSI SINYAL TRADING
# ==============================================================================
def build_trading_signal(
    last_close: float, predicted_close: float, rsi: float, sma20: float, sma50: float
) -> dict:
    """
    Skor sinyal dari 3 faktor (+1 bullish / -1 bearish / 0 netral):
      1. Arah prediksi AI   2. Zona RSI   3. Tren SMA20 vs SMA50
    Skor >= +2 => BUY, <= -2 => SELL, selain itu => HOLD.
    """
    forecast_pct = (predicted_close / last_close - 1.0) * 100.0 if last_close else 0.0
    score = 0
    reasons = []

    if forecast_pct > 0.15:
        score += 1
        reasons.append(f"Prediksi AI naik {forecast_pct:+.2f}% dalam horizon prediksi → bullish.")
    elif forecast_pct < -0.15:
        score -= 1
        reasons.append(f"Prediksi AI turun {forecast_pct:+.2f}% dalam horizon prediksi → bearish.")
    else:
        reasons.append(f"Prediksi AI relatif datar ({forecast_pct:+.2f}%) → netral.")

    if rsi < 30:
        score += 1
        reasons.append(f"RSI {rsi:.1f} < 30 (oversold) → potensi pantulan naik.")
    elif rsi > 70:
        score -= 1
        reasons.append(f"RSI {rsi:.1f} > 70 (overbought) → potensi koreksi turun.")
    else:
        reasons.append(f"RSI {rsi:.1f} di zona normal (30-70) → netral.")

    trend_up = sma20 > sma50
    price_above = last_close > sma20
    if trend_up and price_above:
        score += 1
        reasons.append("Harga di atas SMA20 & SMA20 > SMA50 → tren naik.")
    elif (not trend_up) and (not price_above):
        score -= 1
        reasons.append("Harga di bawah SMA20 & SMA20 < SMA50 → tren turun.")
    else:
        reasons.append("Posisi harga vs SMA tidak selaras → tren bercampur.")

    if score >= 2:
        label, color, icon = "BUY", "#00C853", "🟢"
    elif score <= -2:
        label, color, icon = "SELL", "#FF3D57", "🔴"
    else:
        label, color, icon = "HOLD", "#FFB300", "🟡"
    return {"label": label, "score": score, "color": color, "icon": icon, "reasons": reasons}


# ==============================================================================
# 6. TICK BUS + RUNTIME (thread feed, thread prediksi, API lokal)
# ==============================================================================
class TickBus:
    """Penampung tick thread-safe: harga, bid/ask, timestamp, sekuens."""

    def __init__(self, maxlen: int = 20000):
        self._lock = threading.Lock()
        self._ticks: deque = deque(maxlen=maxlen)
        self._seq = 0
        self._latest: dict | None = None
        self._count = 0

    def push(self, price: float, t: int, bid: float | None = None, ask: float | None = None) -> None:
        with self._lock:
            self._seq += 1
            self._count += 1
            item = {"s": self._seq, "t": int(t), "p": float(price),
                    "b": float(bid) if bid is not None else None,
                    "a": float(ask) if ask is not None else None}
            self._ticks.append(item)
            self._latest = item

    @property
    def seq(self) -> int:
        with self._lock:
            return self._seq

    def since(self, seq: int, cap: int = 2000) -> list[dict]:
        with self._lock:
            out = [t for t in self._ticks if t["s"] > seq]
        return out[:cap]

    def latest(self) -> dict | None:
        with self._lock:
            return dict(self._latest) if self._latest else None

    def ref_price(self, window_sec: int = 60) -> float | None:
        """Harga sekitar N detik lalu (untuk delta metrik live)."""
        cutoff = time.time() - window_sec
        with self._lock:
            if not self._ticks:
                return None
            for t in self._ticks:
                if t["t"] >= cutoff:
                    return t["p"]
            return self._ticks[0]["p"]

    def age(self) -> float | None:
        with self._lock:
            if not self._latest:
                return None
            return max(0.0, time.time() - self._latest["t"])

    def tps(self, window_sec: float = 10.0) -> float:
        cutoff = time.time() - window_sec
        with self._lock:
            n = sum(1 for t in self._ticks if t["t"] >= cutoff)
        return n / window_sec

    @property
    def count(self) -> int:
        with self._lock:
            return self._count

    def current_bucket(self, interval_sec: int) -> int:
        latest = self.latest()
        if not latest:
            return -1
        return latest["t"] - (latest["t"] % interval_sec)


class LiveRuntime:
    """
    Singleton runtime lokal:
      * thread feed WebSocket/polling  -> TickBus
      * thread prediksi                -> payload JSON overlay grafik
      * thread API HTTP lokal          -> /tick /prediction /status (untuk grafik JS)
    """

    def __init__(self):
        self.bus = TickBus()
        self._cfg_lock = threading.Lock()
        self._cfg: dict | None = None
        self._status_lock = threading.Lock()
        self._status = {
            "mode_label": "memulai…", "connected": False,
            "detail": "", "error": None, "last_tick": 0.0, "ticks": 0,
        }
        self._pred_lock = threading.Lock()
        self._prediction: dict = {
            "ok": False, "generated_at": 0, "model": None,
            "points": [], "anchor": None, "error": "belum dihitung",
        }
        self._forecast_frame: pd.DataFrame | None = None
        self._pred_last = 0.0
        self._pred_bucket = -1
        self._stop = threading.Event()
        self._feed_kick = threading.Event()
        self._pred_force = threading.Event()
        self.port: int | None = None
        self._started = False
        self._httpd: ThreadingHTTPServer | None = None

    # ---------------------------------------------------------------- startup
    def start(self) -> None:
        if self._started:
            return
        self._started = True
        self._start_api()
        for fn in (self._feed_loop, self._pred_loop):
            threading.Thread(target=fn, daemon=True, name=fn.__name__).start()

    def stop(self) -> None:
        self._stop.set()
        self._feed_kick.set()
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None

    # ---------------------------------------------------------------- cfg
    def update_cfg(self, cfg: dict) -> None:
        """Terima konfigurasi terbaru dari Streamlit (last writer wins)."""
        with self._cfg_lock:
            old = self._cfg
            self._cfg = dict(cfg)
        if old is None:
            self._pred_force.set()
            self._feed_kick.set()
            return
        watch = ("provider", "td_api_key", "key", "bars", "horizon", "confidence",
                 "model", "freq", "predict_secs")
        if any(old.get(k) != cfg.get(k) for k in watch):
            self._pred_force.set()
        if old.get("provider") != cfg.get("provider") or old.get("td_api_key") != cfg.get("td_api_key"):
            self._feed_kick.set()

    def cfg(self) -> dict | None:
        with self._cfg_lock:
            return dict(self._cfg) if self._cfg else None

    # ---------------------------------------------------------------- status
    def set_status(self, **kw) -> None:
        with self._status_lock:
            self._status.update(kw)
            if kw.get("error") is None and "error" in kw:
                self._status["error"] = None
            self._status["ticks"] = self.bus.count

    def status(self) -> dict:
        with self._status_lock:
            out = dict(self._status)
        out["ticks"] = self.bus.count
        out["age"] = self.bus.age()
        out["tps"] = round(self.bus.tps(), 2)
        return out

    # ---------------------------------------------------------------- prediksi
    def get_prediction(self) -> dict:
        with self._pred_lock:
            return json.loads(json.dumps(self._prediction, default=str))

    def get_forecast_frame(self) -> pd.DataFrame | None:
        with self._pred_lock:
            return None if self._forecast_frame is None else self._forecast_frame.copy()

    # ---------------------------------------------------------------- API lokal
    def _start_api(self) -> None:
        runtime = self

        class ApiServer(ThreadingHTTPServer):
            # Windows SO_REUSEADDR mengizinkan dua proses memperebutkan port
            # yang sama → status runtime bisa tertukar antar sesi. Nonaktifkan
            # supaya port scan 8765-8775 benar-benar jalan.
            allow_reuse_address = False

        class Handler(BaseHTTPRequestHandler):
            def _cors(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Cache-Control", "no-store")

            def _send_json(self, obj, code: int = 200) -> None:
                body = json.dumps(_clean_json(obj)).encode("utf-8")
                self.send_response(code)
                self._cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self) -> None:  # preflight CORS
                self.send_response(204)
                self._cors()
                self.end_headers()

            def do_GET(self) -> None:
                try:
                    parsed = urllib.parse.urlparse(self.path)
                    qs = urllib.parse.parse_qs(parsed.query)
                    if parsed.path == "/tick":
                        since = int(qs.get("since", ["0"])[0] or 0)
                        obj = {
                            "seq": runtime.bus.seq,
                            "ticks": runtime.bus.since(since),
                            "latest": runtime.bus.latest(),
                            "status": runtime.status(),
                        }
                    elif parsed.path == "/prediction":
                        obj = runtime.get_prediction()
                    elif parsed.path == "/status":
                        obj = runtime.status()
                    else:
                        self._send_json({"error": "not found"}, 404)
                        return
                    self._send_json(obj)
                except BrokenPipeError:
                    pass
                except Exception as exc:  # pragma: no cover - defensive
                    try:
                        self._send_json({"error": str(exc)}, 500)
                    except Exception:
                        pass

            def log_message(self, *args) -> None:  # bisu (jangan penuhi log)
                return

        for port in API_PORT_RANGE:
            try:
                self._httpd = ApiServer(("127.0.0.1", port), Handler)
                self.port = port
                break
            except OSError:
                continue
        if self.port is None:
            raise RuntimeError("Semua port API lokal (8765-8775) sibuk")
        self._httpd.daemon_threads = True
        threading.Thread(target=self._httpd.serve_forever, daemon=True,
                         name="local_api").start()

    # ---------------------------------------------------------------- feed
    def _feed_loop(self) -> None:
        backoff = 2.0
        while not self._stop.is_set():
            cfg = self.cfg()
            if cfg is None:
                self._stop.wait(0.5)
                continue
            self._feed_kick.clear()
            mode = cfg["provider"]
            try:
                if mode == "gate":
                    self._feed_gate(cfg)
                elif mode == "twelvedata":
                    self._feed_twelvedata(cfg)
                else:
                    self._feed_poll(cfg)
                backoff = 2.0  # sesi berakhir normal (mis. pergantian provider)
            except Exception as exc:
                self.set_status(connected=False, error=str(exc)[:300])
                self._stop.wait(backoff)
                backoff = min(30.0, backoff * 2)

    def _feed_gate(self, cfg: dict) -> None:
        """Gate.io spot.book_ticker: best bid/ask PAXG_USDT (±5 tick/detik)."""
        pair = "PAXG_USDT"
        self.set_status(mode_label=f"Gate.io WS · {pair}", connected=False,
                        detail="menghubungkan…", error=None)
        ws = websocket.create_connection("wss://api.gateio.ws/ws/v4/", timeout=10)
        try:
            ws.send(json.dumps({"time": int(time.time()), "channel": "spot.book_ticker",
                                "event": "subscribe", "payload": [pair]}))
            last_recv = time.time()
            next_ping = time.time() + 20
            while not self._stop.is_set() and not self._feed_kick.is_set():
                ws.settimeout(1.0)
                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    if time.time() - last_recv > 60:
                        raise RuntimeError("Gate.io: tidak ada data >60 detik (reconnect)")
                    if time.time() >= next_ping:
                        ws.ping()
                        next_ping = time.time() + 20
                    continue
                last_recv = time.time()
                msg = json.loads(raw)
                if msg.get("event") == "error":
                    raise RuntimeError(f"Gate.io: {msg}")
                if msg.get("channel") == "spot.book_ticker" and msg.get("event") == "update":
                    r = msg["result"]
                    bid, ask = float(r["b"]), float(r["a"])
                    mid = round((bid + ask) / 2.0, 2)
                    self.bus.push(mid, int(r["t"]) // 1000, bid, ask)
                    self.set_status(mode_label=f"Gate.io WS · {pair}", connected=True,
                                    detail="best bid/ask real-time", error=None,
                                    last_tick=time.time())
        finally:
            ws.close()

    def _feed_twelvedata(self, cfg: dict) -> None:
        """TwelveData quotes/price WS: XAU/USD (butuh API key)."""
        key = (cfg.get("td_api_key") or "").strip()
        if not key:
            self.set_status(mode_label="TwelveData WS", connected=False, detail="",
                            error="API key kosong — daftar gratis di twelvedata.com/register "
                                  "lalu tempel key di sidebar.")
            while not self._stop.is_set() and not self._feed_kick.is_set():
                self._stop.wait(1.0)
            return

        self.set_status(mode_label="TwelveData WS · XAU/USD", connected=False,
                        detail="menghubungkan…", error=None)
        ws = websocket.create_connection(
            f"wss://ws.twelvedata.com/v1/quotes/price?apikey={urllib.parse.quote(key)}",
            timeout=10,
        )
        try:
            ws.send(json.dumps({"action": "subscribe", "params": {"symbols": "XAU/USD"}}))
            next_hb = time.time() + 10
            next_ping = time.time() + 20
            last_recv = time.time()
            while not self._stop.is_set() and not self._feed_kick.is_set():
                ws.settimeout(1.0)
                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    now = time.time()
                    if now - last_recv > 60:
                        raise RuntimeError("TwelveData: tidak ada data >60 detik (reconnect)")
                    if now >= next_hb:
                        ws.send(json.dumps({"action": "heartbeat"}))
                        next_hb = now + 10
                    if now >= next_ping:
                        ws.ping()
                        next_ping = now + 20
                    continue
                last_recv = time.time()
                msg = json.loads(raw)
                event = msg.get("event")
                if event == "price" and msg.get("symbol") in ("XAU/USD", "XAU/USD:forex"):
                    price = float(msg["price"])
                    bid = float(msg.get("bid") or price)
                    ask = float(msg.get("ask") or price)
                    t = int(msg.get("timestamp") or time.time())
                    self.bus.push(price, t, bid, ask)
                    self.set_status(mode_label="TwelveData WS · XAU/USD", connected=True,
                                    detail="tick XAU/USD real-time", error=None,
                                    last_tick=time.time())
                elif event == "subscribe-status":
                    fails = msg.get("fails") or []
                    if msg.get("status") != "ok" or fails:
                        raise RuntimeError(f"TwelveData subscribe gagal: {msg}")
                    self.set_status(detail="subscribe OK", error=None)
                elif event == "error":
                    raise RuntimeError(f"TwelveData: {msg}")
        finally:
            ws.close()

    def _feed_poll(self, cfg: dict) -> None:
        """Fallback tanpa WebSocket: ambil harga GC=F tiap 5 detik."""
        self.set_status(mode_label="Polling yfinance · GC=F", connected=False,
                        detail="mengambil harga…", error=None)
        while not self._stop.is_set() and not self._feed_kick.is_set():
            try:
                fast = yf.Ticker("GC=F").fast_info
                try:
                    price = fast["last_price"]
                except Exception:
                    price = getattr(fast, "last_price", None)
                if price:
                    p = float(price)
                    now = int(time.time())
                    self.bus.push(p, now, p, p)
                    self.set_status(mode_label="Polling yfinance · GC=F", connected=True,
                                    detail="refresh tiap 5 detik", error=None,
                                    last_tick=time.time())
            except Exception as exc:
                self.set_status(connected=False, error=f"yfinance: {exc}")
            self._feed_kick.wait(5.0)
            self._feed_kick.clear()

    # ---------------------------------------------------------------- prediksi
    def _pred_loop(self) -> None:
        """Prediksi di background: tiap N detik ATAU saat candle baru ditutup."""
        while not self._stop.is_set():
            cfg = self.cfg()
            if cfg is None:
                self._stop.wait(0.5)
                continue
            now = time.time()
            bucket = self.bus.current_bucket(cfg["seconds"])
            due = (
                self._pred_force.is_set()
                or (now - self._pred_last) >= cfg["predict_secs"]
                or (bucket > self._pred_bucket >= 0)
            )
            if not due:
                self._stop.wait(1.0)
                continue

            self._pred_force.clear()
            self._pred_bucket = bucket
            try:
                hist = get_history(cfg, ttl=max(20.0, cfg["predict_secs"] / 2.0))
                warnings: list[str] = []
                fc, model_name = run_forecast(
                    hist, cfg["model"], cfg["horizon"], cfg["confidence"],
                    cfg["freq"], cfg["intraday"], cfg["minutes"],
                    warn=warnings.append,
                )
                payload = self._build_prediction_payload(hist, fc, model_name, cfg, warnings)
                with self._pred_lock:
                    self._prediction = payload
                    self._forecast_frame = fc
                self._pred_last = time.time()
            except Exception as exc:
                with self._pred_lock:
                    broken = dict(self._prediction)
                    broken["error"] = str(exc)[:400]
                    broken["ok"] = False
                    self._prediction = broken
                self._pred_last = time.time() + 15.0  # jangan loop error terlalu cepat

    @staticmethod
    def _build_prediction_payload(
        hist: pd.DataFrame, fc: pd.DataFrame, model_name: str, cfg: dict, warnings: list[str],
    ) -> dict:
        last = hist.iloc[-1]
        anchor = {"t": int(last["epoch"]), "c": float(last["Close"])}
        ds = pd.to_datetime(fc["ds"])
        times = ((ds - EPOCH) // pd.Timedelta(seconds=1)).astype("int64")
        points = [
            {"t": int(t), "y": float(y), "lo": float(lo), "hi": float(hi)}
            for t, y, lo, hi in zip(times, fc["yhat"], fc["yhat_lower"], fc["yhat_upper"])
            if np.isfinite(y)
        ]
        return {
            "ok": True,
            "generated_at": int(time.time()),
            "model": model_name,
            "instrument": PROVIDER_META[cfg["provider"]]["instrument"],
            "interval_sec": cfg["seconds"],
            "interval_label": cfg["interval_label"],
            "horizon": cfg["horizon"],
            "confidence": cfg["confidence"],
            "anchor": anchor,
            "points": points,
            "error": None,
            "warnings": warnings,
            "history_bars": int(len(hist)),
        }


def _clean_json(obj):
    """Ganti NaN/Inf dengan null agar JSON valid untuk JSON.parse di browser."""
    if isinstance(obj, dict):
        return {k: _clean_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean_json(v) for v in obj]
    if isinstance(obj, (float, np.floating)):
        return float(obj) if np.isfinite(obj) else None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    return obj


@st.cache_resource(show_spinner=False)
def get_runtime() -> LiveRuntime:
    """Singleton runtime (thread + API lokal tetap hidup antar rerun Streamlit)."""
    runtime = LiveRuntime()
    runtime.start()
    return runtime


# ==============================================================================
# 7. GRAFIK TRADINGVIEW LIGHTWEIGHT CHARTS (streamlit.components.v1.html)
# ==============================================================================
CHART_TEMPLATE = """<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<style>
  html, body { margin:0; padding:0; background:#0d1117; color:#c9d1d9;
               font-family:"Segoe UI", system-ui, sans-serif; }
  #status { display:flex; gap:14px; align-items:center; font-size:12.5px;
            padding:7px 10px; border-bottom:1px solid rgba(255,255,255,.08); }
  #dot { width:9px; height:9px; border-radius:50%; background:#888; display:inline-block; }
  #banner { display:none; background:#5a1d1d; color:#ffd7d7; font-size:12.5px;
            padding:6px 10px; border-bottom:1px solid rgba(255,255,255,.08); }
  #legend { display:flex; gap:16px; font-size:12px; padding:5px 10px 2px; flex-wrap:wrap; }
  #legend span i { display:inline-block; width:14px; height:3px; border-radius:2px;
                   margin-right:6px; vertical-align:middle; }
  #chart { height:620px; }
  #rsi { height:170px; border-top:1px solid rgba(255,255,255,.08); }
</style>
<script src="https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
<div id="status">
  <span id="dot"></span>
  <span id="stat">Menghubungkan ke API lokal…</span>
  <span id="meta"></span>
</div>
<div id="banner"></div>
<div id="legend"></div>
<div id="chart"></div>
<div id="rsi"></div>
<script>
"use strict";
const CFG = __CFG_JSON__;

const $ = (id) => document.getElementById(id);
const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const pad2 = (n) => String(n).padStart(2, "0");

function fmtWIB(t, withTime) {
  const d = new Date((t + 7 * 3600) * 1000);
  const date = d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  if (!withTime) return date;
  return date + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
}

const isDaily = CFG.intervalSec >= 86400;

const chart = LightweightCharts.createChart($("chart"), {
  autoSize: true,
  layout: { background: { type: "solid", color: "#0d1117" }, textColor: "#8b949e",
            fontFamily: "Segoe UI, system-ui, sans-serif", fontSize: 12 },
  grid: { vertLines: { color: "rgba(255,255,255,0.055)" },
          horzLines: { color: "rgba(255,255,255,0.055)" } },
  rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
  timeScale: { borderColor: "rgba(255,255,255,0.12)", timeVisible: !isDaily,
               secondsVisible: false,
               tickMarkFormatter: (t) => fmtWIB(t, !isDaily) },
  localization: { timeFormatter: (t) => fmtWIB(t, true) + " WIB",
                  priceFormatter: (p) => "$" + p.toFixed(2) },
  watermark: { visible: true, text: CFG.instrument, color: "rgba(255,215,0,0.07)",
               fontSize: 32, horzAlign: "center", vertAlign: "center" },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: COLOR_UP_PLACEHOLDER, downColor: COLOR_DOWN_PLACEHOLDER,
  borderVisible: false, wickUpColor: COLOR_UP_PLACEHOLDER,
  wickDownColor: COLOR_DOWN_PLACEHOLDER,
  priceFormat: { type: "price", precision: 2, minMove: 0.01 },
});

const sma20Series = chart.addLineSeries({
  color: "#4FC3F7", lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
  crosshairMarkerVisible: false, visible: CFG.showSMA20,
});
const sma50Series = chart.addLineSeries({
  color: "#FF8A65", lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
  crosshairMarkerVisible: false, visible: CFG.showSMA50,
});
const predSeries = chart.addLineSeries({
  color: "#FFD700", lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed,
  priceLineVisible: false, crosshairMarkerVisible: false, title: "Prediksi",
});
const loSeries = chart.addLineSeries({
  color: "rgba(255,215,0,0.45)", lineWidth: 1,
  lineStyle: LightweightCharts.LineStyle.Dotted,
  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
});
const hiSeries = chart.addLineSeries({
  color: "rgba(255,215,0,0.45)", lineWidth: 1,
  lineStyle: LightweightCharts.LineStyle.Dotted,
  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
});

let rsiSeries = null;
if (CFG.showRSI) {
  const rsiChart = LightweightCharts.createChart($("rsi"), {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0d1117" }, textColor: "#8b949e",
              fontFamily: "Segoe UI, system-ui, sans-serif", fontSize: 12 },
    grid: { vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.04)" } },
    rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
    timeScale: { borderColor: "rgba(255,255,255,0.12)", timeVisible: !isDaily,
                 secondsVisible: false,
                 tickMarkFormatter: (t) => fmtWIB(t, !isDaily) },
    localization: { timeFormatter: (t) => fmtWIB(t, true) + " WIB" },
  });
  rsiSeries = rsiChart.addLineSeries({
    color: "#AB47BC", lineWidth: 2, priceLineVisible: false,
    priceFormat: { type: "price", precision: 1, minMove: 0.1 },
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
  });
  rsiSeries.createPriceLine({ price: 70, color: "#FF3D57", lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: "OB" });
  rsiSeries.createPriceLine({ price: 30, color: "#00C853", lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: "OS" });
  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
  });
} else {
  $("rsi").style.display = "none";
}

$("legend").innerHTML =
  '<span><i style="background:#00C853"></i>Naik</span>' +
  '<span><i style="background:#FF3D57"></i>Turun</span>' +
  (CFG.showSMA20 ? '<span><i style="background:#4FC3F7"></i>SMA 20</span>' : '') +
  (CFG.showSMA50 ? '<span><i style="background:#FF8A65"></i>SMA 50</span>' : '') +
  '<span><i style="background:#FFD700"></i>Prediksi ' + CFG.horizon + ' bar</span>' +
  '<span><i style="background:rgba(255,215,0,0.45)"></i>Band ' +
  Math.round(CFG.confidence * 100) + '%</span>' +
  (CFG.showRSI ? '<span><i style="background:#AB47BC"></i>RSI ' + CFG.rsiPeriod + '</span>' : '');

// ---------------- data awal (riwayat dari Python) ----------------
let candles = CFG.candles.map((r) => (
  { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }
));

function computeDerived() {
  const n = candles.length;
  const sma20 = [], sma50 = [], rsi = [];
  const p20 = 20, p50 = 50, pr = CFG.rsiPeriod;
  let s20 = 0, s50 = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i].close;
    s20 += c; s50 += c;
    if (i >= p20) s20 -= candles[i - p20].close;
    if (i >= p50) s50 -= candles[i - p50].close;
    if (i >= p20 - 1) sma20.push({ time: candles[i].time, value: s20 / p20 });
    if (i >= p50 - 1) sma50.push({ time: candles[i].time, value: s50 / p50 });
  }
  if (n > pr) {
    let g = 0, l = 0;
    for (let i = 1; i <= pr; i++) {
      const d = candles[i].close - candles[i - 1].close;
      if (d >= 0) g += d; else l -= d;
    }
    let ag = g / pr, al = l / pr;
    const toVal = () => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    rsi.push({ time: candles[pr].time, value: toVal() });
    for (let i = pr + 1; i < n; i++) {
      const d = candles[i].close - candles[i - 1].close;
      const up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
      ag = (ag * (pr - 1) + up) / pr;
      al = (al * (pr - 1) + dn) / pr;
      rsi.push({ time: candles[i].time, value: toVal() });
    }
  }
  return { sma20: sma20, sma50: sma50, rsi: rsi };
}

let derived = computeDerived();

function paintFull() {
  if (CFG.showSMA20) sma20Series.setData(derived.sma20);
  if (CFG.showSMA50) sma50Series.setData(derived.sma50);
  if (rsiSeries) rsiSeries.setData(derived.rsi);
}

function paintLast() {
  if (CFG.showSMA20 && derived.sma20.length) sma20Series.update(derived.sma20[derived.sma20.length - 1]);
  if (CFG.showSMA50 && derived.sma50.length) sma50Series.update(derived.sma50[derived.sma50.length - 1]);
  if (rsiSeries && derived.rsi.length) rsiSeries.update(derived.rsi[derived.rsi.length - 1]);
}

candleSeries.setData(candles);
paintFull();

// ---------------- overlay prediksi (background thread -> API lokal) ----------------
let predGenerated = 0;

function setPrediction(d) {
  if (!d || !d.ok || !d.points || !d.points.length || !d.anchor) return;
  predGenerated = d.generated_at;
  const a = { time: d.anchor.t, value: d.anchor.c };
  predSeries.setData([a].concat(d.points.map((p) => ({ time: p.t, value: p.y }))));
  loSeries.setData([a].concat(d.points.map((p) => ({ time: p.t, value: p.lo }))));
  hiSeries.setData([a].concat(d.points.map((p) => ({ time: p.t, value: p.hi }))));
}

if (CFG.initialPrediction) setPrediction(CFG.initialPrediction);

async function pollPrediction() {
  try {
    const res = await fetch(CFG.api + "/prediction");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    if (d.generated_at && d.generated_at !== predGenerated) setPrediction(d);
    predError = d.error || null;
  } catch (e) { predError = null; /* status API lokal yang menangani */ }
}

// ---------------- tick real-time dari thread Python (API lokal) ----------------
let seq = 0, apiFail = 0, pollBusy = false;
let serverStatus = null, lastPrice = null, lastBid = null, lastAsk = null;
let predError = null;
const tickStamps = [];

function applyTick(t, p) {
  const bucket = t - (t % CFG.intervalSec);
  const last = candles[candles.length - 1];
  if (bucket < last.time) return;
  let candle;
  if (bucket === last.time) {
    last.close = p;
    if (p > last.high) last.high = p;
    if (p < last.low) last.low = p;
    candle = last;
  } else {
    candle = { time: bucket, open: p, high: p, low: p, close: p };
    candles.push(candle);
  }
  candleSeries.update(candle);
  derived = computeDerived();
  paintLast();
  tickStamps.push(performance.now());
}

function setBanner(text, show) {
  const b = $("banner");
  if (show) { b.textContent = text; b.style.display = "block"; }
  else b.style.display = "none";
}

function refreshBanner() {
  const msgs = [];
  if (apiFail >= 3) {
    msgs.push("API lokal " + CFG.api + " tidak terjangkau — grafik menampilkan "
              + "data statis terakhir. (Cek proses Streamlit / port API.)");
  }
  if (predError) msgs.push("Prediksi terakhir gagal: " + predError);
  if (msgs.length) setBanner(msgs.join("   •   "), true);
  else setBanner("", false);
}

async function pollTicks() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const res = await fetch(CFG.api + "/tick?since=" + seq);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    apiFail = 0;
    serverStatus = data.status || null;
    if (data.latest) {
      lastPrice = data.latest.p;
      lastBid = data.latest.b;
      lastAsk = data.latest.a;
    }
    for (const tk of (data.ticks || [])) {
      if (tk.s > seq) seq = tk.s;
      applyTick(tk.t, tk.p);
      lastPrice = tk.p;
      if (tk.b !== null && tk.b !== undefined) { lastBid = tk.b; lastAsk = tk.a; }
    }
  } catch (e) {
    apiFail++;
  } finally {
    pollBusy = false;
  }
}

// ---------------- baris status ----------------------------------------------
function refreshStatus() {
  const now = performance.now();
  while (tickStamps.length && tickStamps[0] < now - 10000) tickStamps.shift();
  const tps = tickStamps.length / 10;
  const age = serverStatus && serverStatus.age !== null && serverStatus.age !== undefined
    ? serverStatus.age : null;
  const dot = $("dot");
  let color = "#888", state = "menunggu feed…";
  if (age !== null && age < 5) { color = "#00C853"; state = "LIVE"; }
  else if (age !== null && age < 30) { color = "#FFB300"; state = "DATA" + " (delay " + Math.round(age) + "s)"; }
  else if (age !== null) { color = "#FF3D57"; state = "STALE " + Math.round(age) + "s"; }
  dot.style.background = color;
  const mode = serverStatus ? (serverStatus.mode_label || "") : CFG.instrument;
  const detail = serverStatus && serverStatus.detail ? serverStatus.detail : "";
  $("stat").textContent = state + " · " + mode + (detail ? " · " + detail : "");
  let meta = tps.toFixed(1) + " tick/detik";
  if (lastPrice !== null) meta += " · $" + lastPrice.toFixed(2);
  if (lastBid !== null && lastAsk !== null) meta += " · bid " + lastBid.toFixed(2)
    + " / ask " + lastAsk.toFixed(2) + " (spread " + (lastAsk - lastBid).toFixed(2) + ")";
  if (serverStatus && serverStatus.error) meta += " · ⚠ " + serverStatus.error;
  meta += " · grafik " + CFG.intervalLabel + " · API " + CFG.api;
  $("meta").textContent = meta;
  refreshBanner();
}

setInterval(pollTicks, 300);
setInterval(pollPrediction, 5000);
setInterval(refreshStatus, 1000);
pollTicks();
refreshStatus();
</script>
</body>
</html>
"""


def build_chart_html(cfg: dict, hist: pd.DataFrame, prediction: dict | None, port: int) -> str:
    """Susun HTML grafik Lightweight Charts dengan konfigurasi + riwayat terinjeksi."""
    display = cfg["display_bars"]
    shown = hist if display is None else hist.tail(display)
    candles = [
        [int(r["epoch"]), float(r["Open"]), float(r["High"]),
         float(r["Low"]), float(r["Close"])]
        for _, r in shown.iterrows()
    ]
    payload = {
        "api": f"http://127.0.0.1:{port}",
        "intervalSec": cfg["seconds"],
        "intervalLabel": cfg["interval_label"],
        "instrument": PROVIDER_META[cfg["provider"]]["instrument"],
        "candles": candles,
        "horizon": cfg["horizon"],
        "confidence": cfg["confidence"],
        "showSMA20": cfg["show_sma20"],
        "showSMA50": cfg["show_sma50"],
        "showRSI": cfg["show_rsi"],
        "rsiPeriod": cfg["rsi_period"],
        "initialPrediction": prediction,
    }
    html = CHART_TEMPLATE.replace(
        "COLOR_UP_PLACEHOLDER", json.dumps(COLOR_UP)
    ).replace(
        "COLOR_DOWN_PLACEHOLDER", json.dumps(COLOR_DOWN)
    ).replace(
        "__CFG_JSON__", json.dumps(_clean_json(payload))
    )
    return html


# ==============================================================================
# 8. SIDEBAR (di luar fragment -> tidak ikut dirender ulang tiap live update)
# ==============================================================================
def render_sidebar() -> None:
    st.sidebar.header("⚙️ Pengaturan Dashboard LIVE")

    st.sidebar.subheader("1. Sumber Harga Tick (WebSocket)")
    st.sidebar.selectbox(
        "Provider live", list(PROVIDER_OPTIONS), index=0, key="provider",
        help="Gate.io (default): PAXG/USDT, tanpa API key, ~5 tick/detik. "
             "TwelveData: XAU/USD asli, butuh key gratis. "
             "Polling yfinance: tanpa WebSocket (lebih pelan).",
    )
    provider = PROVIDER_OPTIONS[st.session_state["provider"]]
    st.sidebar.text_input(
        "API key TwelveData (opsional)", key="td_api_key", type="password",
        help="GRATIS: daftar https://twelvedata.com/register → "
             "https://twelvedata.com/account/api-keys → tempel key di sini. "
             "Hanya dipakai jika provider = TwelveData. Jika subscribe-status "
             "gagal (free plan terbatas trial symbol), gunakan Gate.io.",
    )
    st.sidebar.caption(PROVIDER_META[provider]["detail"])

    st.sidebar.subheader("2. Interval Waktu (Live)")
    st.sidebar.selectbox(
        "Interval candle", list(INTERVAL_OPTIONS), index=1, key="interval",
        help="1m/5m/15m/1h = intraday; 1d = harian. Interval menentukan ukuran "
             "candle yang dibentuk dari tick live.",
    )
    interval_cfg = INTERVAL_OPTIONS[st.session_state["interval"]]

    st.sidebar.subheader("3. Riwayat & Horizon Prediksi")
    if st.session_state.get("riwayat") not in RIWAYAT_MAP:
        st.session_state["riwayat"] = RIWAYAT_DEFAULT
    st.sidebar.selectbox(
        "Riwayat (jumlah bar)", list(RIWAYAT_MAP), key="riwayat",
        help="Jumlah candle historis yang diunduh dari provider (maks 1000). "
             "Dipakai untuk indikator & latihan model.",
    )
    # min/max/step slider masuk ke ID widget -> HARUS konstan antar interval,
    # kalau berubah nilai tersimpan di-reset ke default. Batas per-interval
    # (max_bars) ditegakkan lewat validasi session_state di bawah.
    HORIZON_MIN, HORIZON_MAX = 1, 120
    horizon = st.session_state.get("horizon")
    if not isinstance(horizon, int) or not (HORIZON_MIN <= horizon <= interval_cfg["max_bars"]):
        st.session_state["horizon"] = interval_cfg["default_bars"]
    st.sidebar.slider(
        "Berapa bar ke depan?", min_value=HORIZON_MIN, max_value=HORIZON_MAX,
        step=1, key="horizon",
        help=f"1 bar = {format_duration(interval_cfg['minutes'])} pada interval "
             f"{st.session_state['interval']}. Maks wajar untuk interval ini: "
             f"{interval_cfg['max_bars']} bar.",
    )
    st.sidebar.caption(
        f"⏱ {st.session_state['horizon']} bar ≈ "
        f"{format_duration(interval_cfg['minutes'] * st.session_state['horizon'])} "
        "dari bar terakhir."
    )
    if "confidence" not in st.session_state:
        st.session_state["confidence"] = 0.90
    st.sidebar.select_slider(
        "Confidence interval", options=[0.80, 0.90, 0.95], key="confidence",
        help="Lebar pita probabilitas batas atas/bawah prediksi.",
    )

    st.sidebar.subheader("4. Model Prediksi")
    st.sidebar.selectbox(
        "Algoritma", list(MODEL_OPTIONS), index=0, key="model",
        help="Prediksi dihitung di BACKGROUND THREAD tiap N detik atau setiap "
             "candle baru ditutup, lalu dikirim ke grafik sebagai overlay garis.",
    )

    st.sidebar.subheader("5. Indikator Teknikal")
    st.sidebar.checkbox("SMA 20", value=True, key="show_sma20")
    st.sidebar.checkbox("SMA 50", value=True, key="show_sma50")
    st.sidebar.checkbox("RSI", value=True, key="show_rsi")
    st.sidebar.slider("Periode RSI", 7, 21, 14, key="rsi_period")

    st.sidebar.subheader("6. Tampilan Grafik (Zoom Candle)")
    if st.session_state.get("display") not in DISPLAY_MAP:
        st.session_state["display"] = DISPLAY_DEFAULT
    st.sidebar.selectbox(
        "Jumlah candle tampil", list(DISPLAY_MAP), key="display",
        help="'480 bar' menjaga candle tetap lebar; 'Semua data' = seluruh riwayat.",
    )

    st.sidebar.subheader("7. Live Update & Prediksi")
    st.sidebar.checkbox(
        "Update metrik live otomatis", value=True, key="live_on",
        help="Metrik harga + sinyal di-render ulang in-place tiap N detik "
             "(tanpa reload halaman). Grafik TIDAK ikut di-render ulang.",
    )
    st.sidebar.selectbox(
        "Refresh metrik (detik)", LIVE_INTERVALS, index=0, key="live_secs",
        help="1 detik = metrik ikut bergerak tiap detik (ringan, tanpa jaringan).",
    )
    st.sidebar.selectbox(
        "Prediksi dihitung ulang (detik)", PREDICT_INTERVALS, index=1, key="predict_secs",
        help="Selalu juga dihitung ulang setiap candle baru ditutup.",
    )

    st.sidebar.divider()
    st.sidebar.caption(
        "⚠️ Dashboard ini untuk edukasi/backtesting, **bukan nasihat keuangan**. "
        "Prediksi berbasis statistik masa lalu, bukan jaminan masa depan."
    )
    st.sidebar.caption(
        f"🔌 API lokal grafik: `127.0.0.1:8765+` · Tick cache di memori · "
        f"Riwayat di-cache {int(HISTORY_TTL)} dtk."
    )


def read_config() -> dict:
    """Kumpulkan semua input sidebar (via session_state) untuk thread & UI."""
    interval_label = st.session_state["interval"]
    cfg = dict(INTERVAL_OPTIONS[interval_label])
    cfg["interval_label"] = interval_label

    provider = PROVIDER_OPTIONS[st.session_state["provider"]]
    cfg["provider"] = provider
    cfg["provider_label"] = st.session_state["provider"]
    cfg["instrument_label"] = PROVIDER_META[provider]["instrument"]
    cfg["td_api_key"] = (st.session_state.get("td_api_key") or "").strip()

    riwayat_label = st.session_state.get("riwayat")
    cfg["riwayat_label"] = riwayat_label if riwayat_label in RIWAYAT_MAP else RIWAYAT_DEFAULT
    cfg["bars"] = RIWAYAT_MAP[cfg["riwayat_label"]]

    cfg["horizon"] = int(st.session_state["horizon"])
    cfg["confidence"] = float(st.session_state["confidence"])
    cfg["model"] = MODEL_OPTIONS[st.session_state["model"]]
    cfg["show_sma20"] = bool(st.session_state["show_sma20"])
    cfg["show_sma50"] = bool(st.session_state["show_sma50"])
    cfg["show_rsi"] = bool(st.session_state["show_rsi"])
    cfg["rsi_period"] = int(st.session_state["rsi_period"])
    cfg["display"] = st.session_state["display"]
    cfg["display_bars"] = DISPLAY_MAP[cfg["display"]]
    cfg["live_on"] = bool(st.session_state["live_on"])
    cfg["live_secs"] = int(st.session_state["live_secs"])
    cfg["predict_secs"] = int(st.session_state["predict_secs"])
    return cfg


# ==============================================================================
# 9. KONTEN LIVE (fragment 1: metrik + sinyal, dirender ulang tiap N detik)
# ==============================================================================
def render_live_metrics(cfg: dict, hist: pd.DataFrame, rt: LiveRuntime) -> None:
    """Metrik live + sinyal — hanya blok ini yang di-render ulang (in-place)."""
    status = rt.status()
    last = hist.iloc[-1]
    last_close = float(last["Close"])
    prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else last_close

    latest = rt.bus.latest()
    price = float(latest["p"]) if latest else last_close
    price_source = "tick WebSocket" if latest else "close candle terakhir (feed belum siap)"
    tick_ref = rt.bus.ref_price(60)
    if tick_ref is not None:
        ref_price, ref_label = tick_ref, "60 detik lalu"
    else:
        ref_price, ref_label = prev_close, "close sebelumnya"
    delta = price - ref_price
    delta_pct = (price / ref_price - 1.0) * 100.0 if ref_price else 0.0

    rsi_now = float(last["RSI"]) if not pd.isna(last["RSI"]) else 50.0
    sma20_now = float(last["SMA20"]) if not pd.isna(last["SMA20"]) else last_close
    sma50_now = float(last["SMA50"]) if not pd.isna(last["SMA50"]) else last_close

    pred = rt.get_prediction()
    points = pred.get("points") or []
    pred_next = float(points[0]["y"]) if points else price
    pred_last = points[-1] if points else None
    model_name = pred.get("model") or "belum ada"

    signal = build_trading_signal(price, pred_next, rsi_now, sma20_now, sma50_now)

    # --- baris status (bukan kolom -> tidak kena CSS metrik besar) ---
    age = status.get("age")
    if age is None:
        dot, age_txt = "⚪", "menunggu feed"
    elif age < 5:
        dot, age_txt = "🟢", f"{age:.1f} dtk lalu"
    elif age < 30:
        dot, age_txt = "🟡", f"{age:.0f} dtk lalu"
    else:
        dot, age_txt = "🔴", f"{age:.0f} dtk lalu"
    status_line = (
        f"{dot} **{status['mode_label']}** · tick terakhir **{age_txt}** · "
        f"**{status.get('tps', 0):.1f}** tick/detik · API lokal `127.0.0.1:{rt.port}` · "
        f"Riwayat **{len(hist)} bar** · Model **{model_name}** · "
        f"Prediksi {'tiap ' + str(cfg['predict_secs']) + ' dtk + tiap candle baru' }"
    )
    if status.get("error"):
        status_line += f" · ⚠️ {status['error']}"
    st.caption(status_line)

    # --- METRIK LIVE BESAR (harga real-time + sinyal): baris TEPAT 2 kolom ---
    live_col, signal_col = st.columns([2, 1])
    with live_col:
        st.metric(
            f"HARGA EMAS LIVE ({price_source})",
            f"${price:,.2f}",
            delta=(0 if abs(delta) < 0.005 else f"{delta:+,.2f} USD"),
            delta_description=f"({delta_pct:+.2f}%) vs {ref_label}",
            delta_color="normal",
        )
    with signal_col:
        score = signal["score"]
        st.metric(
            "SINYAL TRADING",
            f"{signal['icon']} {signal['label']}",
            delta=(f"{score:+d}" if score != 0 else 0),
            delta_description="skor (maks ±3)",
            delta_color="normal" if abs(score) >= 2 else "off",
        )

    # --- metrik detail (5 kolom -> tidak kena CSS metrik besar) ---
    bar_change = (last_close / prev_close - 1.0) * 100.0 if prev_close else 0.0
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Close Candle Terakhir", f"${last_close:,.2f}", f"{bar_change:+.2f}%")
    if pred_last:
        pred_pct = (float(pred_last["y"]) / price - 1.0) * 100.0 if price else 0.0
        c2.metric(f"Prediksi +{cfg['horizon']} bar", f"${float(pred_last['y']):,.2f}",
                  f"{pred_pct:+.2f}%")
        c3.metric(
            f"Rentang {cfg['confidence'] * 100:.0f}%",
            f"${float(pred_last['lo']):,.2f} – ${float(pred_last['hi']):,.2f}",
        )
    else:
        c2.metric(f"Prediksi +{cfg['horizon']} bar", "—", "menunggu hitung")
        c3.metric(f"Rentang {cfg['confidence'] * 100:.0f}%", "—")
    c4.metric(
        f"RSI ({cfg['rsi_period']})", f"{rsi_now:.1f}",
        "Overbought" if rsi_now > 70 else ("Oversold" if rsi_now < 30 else "Normal"),
    )
    if latest and latest.get("b") and latest.get("a"):
        c5.metric("Bid / Ask", f"{latest['b']:,.2f} / {latest['a']:,.2f}",
                  f"{latest['a'] - latest['b']:.2f}", delta_color="off",
                  delta_description="spread")
    else:
        c5.metric("Pembaruan", dt.datetime.now().strftime("%H:%M:%S"),
                  f"tiap {cfg['live_secs']} dtk" if cfg["live_on"] else "manual",
                  delta_color="off")

    # --- estimasi waktu target prediksi ---
    if pred_last:
        target_t = int(pred_last["t"])
        st.caption(
            f"🎯 Estimasi waktu target prediksi: **{epoch_to_wib(target_t)}** · "
            f"🎧 {price_source.capitalize()} · 🕒 {dt.datetime.now():%d %b %Y %H:%M:%S} WIB"
        )

    # --- panel sinyal trading ---
    reasons_html = "".join(f"<li class='mini'>{r}</li>" for r in signal["reasons"])
    st.markdown(
        f"""
        <div class="signal-box" style="border-left-color: {signal['color']};">
          <span class="signal-label" style="color: {signal['color']};">
            {signal['icon']} {signal['label']}
          </span>
          <span class="signal-sub">
            &nbsp;&nbsp; Sinyal dari prediksi AI + RSI + tren SMA (skor {signal['score']:+d})
          </span>
          <ul style="margin: 10px 0 0 2px;">{reasons_html}</ul>
        </div>
        """,
        unsafe_allow_html=True,
    )


# ==============================================================================
# 10. PANEL PREDIKSI (fragment 2: tabel + info, dirender ulang tiap N detik)
# ==============================================================================
def render_prediction_panel(cfg: dict, rt: LiveRuntime) -> None:
    pred = rt.get_prediction()
    frame = rt.get_forecast_frame()
    tab_table, tab_info = st.tabs(["🗓️ Tabel Prediksi", "🧠 Tentang Model"])

    with tab_table:
        if pred.get("error"):
            st.warning(f"⚠️ Prediksi terakhir gagal: {pred['error']}")
        if frame is None or frame.empty:
            st.info("Belum ada hasil prediksi — sedang dihitung di background thread…")
        else:
            tbl = frame.copy()
            tbl["Waktu"] = (
                pd.to_datetime(tbl["ds"]).dt.tz_localize("UTC")
                .dt.tz_convert("Asia/Jakarta").dt.strftime("%a, %d %b %Y %H:%M WIB")
            )
            last_price = float(pred["anchor"]["c"]) if pred.get("anchor") else float(
                frame["yhat"].iloc[0]
            )
            tbl["Prediksi ($)"] = tbl["yhat"].map(lambda v: f"{v:,.2f}")
            tbl["Batas Bawah ($)"] = tbl["yhat_lower"].map(lambda v: f"{v:,.2f}")
            tbl["Batas Atas ($)"] = tbl["yhat_upper"].map(lambda v: f"{v:,.2f}")
            tbl["Perubahan (%)"] = ((tbl["yhat"] / last_price - 1) * 100).map(lambda v: f"{v:+.2f}%")
            st.dataframe(
                tbl[["Waktu", "Prediksi ($)", "Batas Bawah ($)", "Batas Atas ($)", "Perubahan (%)"]],
                width="stretch", hide_index=True,
            )
            st.download_button(
                "⬇️ Unduh Prediksi (CSV)",
                data=tbl.to_csv(index=False).encode("utf-8"),
                file_name=f"forecast_xauusd_{cfg['key']}_{dt.date.today()}.csv",
                mime="text/csv",
            )

    with tab_info:
        st.subheader("Ringkasan Model & Arsitektur")
        m1, m2, m3 = st.columns(3)
        m1.metric("Model", pred.get("model") or "belum ada")
        m2.metric("Riwayat Latihan", f"{pred.get('history_bars', 0):,} bar")
        m3.metric(
            "Prediksi Terakhir",
            epoch_to_wib(pred["generated_at"]) if pred.get("generated_at") else "—",
        )
        if pred.get("warnings"):
            for w in pred["warnings"]:
                st.caption(f"⚠️ {w}")
        st.markdown(
            f"""
            **Cara kerja:**
            1. **Tick live** — thread Python background menerima WebSocket dari
               **{PROVIDER_META[cfg['provider']]['short']}** (bid/ask → harga tengah ±5 tick/detik)
               dan menyimpannya ke memori (TickBus).
            2. **API lokal** — thread HTTP `127.0.0.1:{rt.port}` menyediakan `/tick`,
               `/prediction`, `/status` untuk grafik.
            3. **Grafik** — TradingView Lightweight Charts (JavaScript di dalam
               `components.html`) memanggil `candleSeries.update()` per tick:
               lilin bergerak mulus **tanpa re-render halaman Streamlit**.
            4. **Prediksi** — thread terpisah menjalankan Prophet/Moving Average
               tiap **{cfg['predict_secs']} detik** atau setiap candle baru ditutup,
               hasilnya dikirim sebagai overlay garis + band ke grafik.
            5. **Sinyal** — skor gabungan arah prediksi, zona RSI, tren SMA 20/50
               (≥ +2 → BUY, ≤ −2 → SELL, selain itu HOLD).
            6. **Risiko** — prediksi deret waktu bersifat probabilistik; gunakan
               manajemen risiko (stop-loss & position sizing) pada trading riil.
            """
        )
        st.caption(
            "ℹ️ Mode Gate.io memakai token PAXG/USDT sebagai proxy harga emas "
            "(1 PAXG = 1 troy oz, harga sangat dekat dengan XAU/USD). "
            "Untuk XAU/USD asli, pilih provider TwelveData + API key gratis."
        )


# ==============================================================================
# 11. PIPELINE UTAMA
# ==============================================================================
def main() -> None:
    # Sidebar + CSS + judul dirender di LUAR fragment (statis antar live update)
    render_sidebar()
    st.markdown(LIVE_CSS, unsafe_allow_html=True)
    st.title("🥇 Dashboard Live XAU/USD — WebSocket + TradingView Charts")

    cfg = read_config()
    rt = get_runtime()
    rt.update_cfg(cfg)

    # Riwayat untuk indikator (dihitung ulang saat interval/provider berubah)
    try:
        hist = get_history_with_indicators(cfg)
    except Exception as exc:
        st.error(f"❌ Gagal mengambil riwayat harga ({PROVIDER_META[cfg['provider']]['short']}): {exc}")
        st.caption(f"🔌 Feed tetap berjalan di background · API lokal `127.0.0.1:{rt.port}`")
        return

    if len(hist) < 60:
        st.warning(
            f"⚠️ Data hanya {len(hist)} bar pada interval {cfg['interval_label']} "
            "→ SMA 50/model bisa kurang akurat."
        )

    # --- Fragment 1: metrik live + sinyal (tanpa re-render grafik) ---
    run_every = f"{cfg['live_secs']}s" if cfg["live_on"] else None

    @st.fragment(run_every=run_every, key="live_metrics")
    def live_metrics() -> None:
        render_live_metrics(cfg, hist, rt)

    live_metrics()

    # --- Grafik TradingView (statis antar full rerun; digerakkan JS via API lokal)
    try:
        html = build_chart_html(cfg, hist, rt.get_prediction(), rt.port)
        height = 900 if cfg["show_rsi"] else 710
        if hasattr(st, "iframe"):  # Streamlit >= 1.65 (components.html akan dihapus)
            st.iframe(html, height=height)
        else:
            components.html(html, height=height)
    except Exception as exc:
        st.error(f"❌ Grafik gagal dirender: {exc}")

    # --- Fragment 2: tabel prediksi + info (refresh ikut jadwal prediksi)
    @st.fragment(run_every=f"{cfg['predict_secs']}s", key="prediction_panel")
    def prediction_panel() -> None:
        render_prediction_panel(cfg, rt)

    prediction_panel()


if __name__ == "__main__":
    main()
