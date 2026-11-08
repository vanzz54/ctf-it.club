/**
 * ============================================================
 *  IT CLUB // LOCAL CTF ARENA  -  Main Backend Server
 * ============================================================
 *  Stack    : Node.js + Express.js
 *  Data     : data/challenges.json (soal) + in-memory leaderboard
 *  Run      : npm install && npm start
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();

// Port arena: default 8080 supaya tidak bentrok dengan CyberNusa Portal (:3000)
const PORT = Number(process.env.PORT) || 8080;

/* ---------------------------------------------------------------
 * IP yang ditampilkan ke peserta (menggantikan <SERVER_IP>).
 * Prioritas: env SERVER_IP > IP source rute default > heuristik nama
 * ------------------------------------------------------------- */
let SERVER_IP = '127.0.0.1';

function detectViaRoute(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let sock = null;
    let settled = false;

    const finish = (addr) => {
      if (settled) return;
      settled = true;
      try {
        if (sock) sock.close();
      } catch (e) {
        /* abaikan */
      }
      resolve(addr && addr !== '127.0.0.1' ? addr : null);
    };

    try {
      // Socket UDP tidak mengirim paket apa pun â€” kernel hanya memilih
      // IP source untuk rute menuju 8.8.8.8. Itulah IP yang benar-benar
      // dipakai mesin ini untuk keluar ke jaringan.
      sock = require('dgram').createSocket('udp4');
      sock.on('error', () => finish(null));
      sock.connect(53, '8.8.8.8', () => {
        try {
          finish(sock.address().address);
        } catch (e) {
          finish(null);
        }
      });
      setTimeout(() => finish(null), timeoutMs);
    } catch (e) {
      finish(null);
    }
  });
}

function detectHeuristic() {
  const skip = /virtualbox|vmware|vbox|vethernet|docker|br-|veth|tun|tap|loopback|isatap|teredo|wsl|hyper-v|npcap/i;
  // Tier: nirkabel dulu, lalu kabel bernama "Ethernet" polos,
  // lalu yang lain. "Ethernet 2" (seringkali adapter VM) jadi pilihan
  // terakhir supaya tidak salah menampilkan IP yang tak terjangkau.
  const tiers = [/^(wi-?fi|wi fi|wlan)/i, /^ethernet$/i, /^(eth|en[0-9]|lan)/i, /^(ethernet|eth)/i];

  const candidates = [];
  for (const name of Object.keys(os.networkInterfaces())) {
    for (const iface of os.networkInterfaces()[name] || []) {
      const family = iface.family === 'IPv4' || iface.family === 4;
      if (family && !iface.internal) candidates.push({ name: name.trim(), addr: iface.address });
    }
  }

  const usable = candidates.filter((c) => !skip.test(c.name));
  for (const tier of tiers) {
    const hit = usable.find((c) => tier.test(c.name));
    if (hit) return hit.addr;
  }
  if (usable.length) return usable[0].addr;
  if (candidates.length) return candidates[0].addr;
  return '127.0.0.1';
}

async function initServerIp() {
  const env = String(process.env.SERVER_IP || '').trim();
  if (env) {
    SERVER_IP = env;
    return;
  }
  SERVER_IP = (await detectViaRoute()) || detectHeuristic();
}

const resolveHost = (text) => String(text).split('<SERVER_IP>').join(SERVER_IP);

/* ---------------------------------------------------------------
 * 1. Konfigurasi Path & Muat Data Soal
 * ------------------------------------------------------------- */
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHALLENGES_DIR = path.join(__dirname, 'challenges');
const DATA_FILE = path.join(__dirname, 'data', 'challenges.json');

/**
 * Mencari lokasi fisik file soal di dalam CHALLENGES_DIR.
 * Mendukung pencarian di root challenges maupun di dalam subfolder (crypto, web, pwn, osint, forensics).
 * Dilengkapi proteksi path traversal.
 */
function findChallengeFile(targetName) {
  if (!targetName || typeof targetName !== 'string') return null;
  const decoded = decodeURIComponent(targetName).trim();
  const safeBase = path.basename(decoded);
  if (!safeBase || safeBase === '.' || safeBase.includes('..')) return null;

  // 1. Cek langsung di root folder challenges
  const directPath = path.join(CHALLENGES_DIR, safeBase);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }

  // 2. Cek jika path yang diminta berupa subpath relatif yang valid
  const directRelPath = path.join(CHALLENGES_DIR, decoded);
  if (directRelPath.startsWith(CHALLENGES_DIR) && fs.existsSync(directRelPath) && fs.statSync(directRelPath).isFile()) {
    return directRelPath;
  }

  // 3. Pencarian rekursif di seluruh subfolder (web, crypto, forensics, osint, pwn)
  function searchDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = searchDir(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name.toLowerCase() === safeBase.toLowerCase()) {
        return fullPath;
      }
    }
    return null;
  }

  return searchDir(CHALLENGES_DIR);
}

let CHALLENGES = [];

function loadChallenges() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error('Format data/challenges.json harus berupa array.');
    }

    CHALLENGES = parsed.map((c) => {
      // "file" tunggal atau "files" (array) â€” keduanya didukung
      let files = Array.isArray(c.files) ? c.files.filter(Boolean) : [];
      if (!files.length && c.file) files = [c.file];

      return {
        id: String(c.id),
        title: String(c.title),
        category: String(c.category || 'Misc'),
        points: Number(c.points) || 0,
        difficulty: c.difficulty || 'Easy',
        description: String(c.description || ''),
        files,
        // cara asli field ditulis di file ('file' tunggal / 'files' array / null)
        srcFiles: Array.isArray(c.files) ? 'files' : c.file ? 'file' : null,
        disabled: c.disabled === true, // soal disembunyikan dari peserta bila true
        url: c.url || null, // link eksternal, mis. OVA di Google Drive
        flag: String(c.flag || ''),
        // Petunjuk format flag untuk UI â€” hanya prefix, bukan isi flag.
        // Semua soal kini memakai format ITCLUB (konversi penuh dari format lama).
        flagFormat: /^ITCLUB\{/i.test(String(c.flag || '')) ? 'ITCLUB' : 'LKS',
      };
    });

    console.log(`[DATA] ${CHALLENGES.length} challenge dimuat dari data/challenges.json`);
  } catch (err) {
    console.error('[DATA] Gagal memuat data/challenges.json ->', err.message);
    process.exit(1);
  }
}

loadChallenges();

/* ---------------------------------------------------------------
 * 2. Auth & User Store (persisten di data/users.json)
 *    - Password di-hash dengan scrypt + salt acak (tidak pernah disimpan plain).
 *    - Token sesi = "<user-key>.<HMAC-SHA256(secret, user-key|salt)>" â€”
 *      stateless, sehingga tetap valid walau server di-restart.
 *    - Leaderboard kini bersumber dari user terdaftar.
 * ------------------------------------------------------------- */
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SECRET_FILE = path.join(__dirname, 'data', 'secret.key');

let SESSION_SECRET = (process.env.SESSION_SECRET || '').trim();
if (!SESSION_SECRET) {
  try {
    SESSION_SECRET = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
  } catch (e) {
    SESSION_SECRET = 'ctf-arena-secret-key-smkn2banjar-2026';
    try {
      fs.writeFileSync(SECRET_FILE, SESSION_SECRET, { mode: 0o600 });
    } catch (e2) {}
  }
}

/* Masa berlaku token sesi (sliding). Bisa diatur lewat env SESSION_TTL_HOURS.
 * Default 7 hari — cukup panjang untuk kompetisi, tapi tetap punya expiry. */
const TOKEN_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 24 * 7) * 60 * 60 * 1000;

/* --- Upstash Redis Cloud Integration (untuk Vercel Serverless Sync) --- */
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const isUpstashEnabled = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

if (isUpstashEnabled) {
  console.log('[REDIS] Upstash Redis terdeteksi - sinkronisasi Live Leaderboard cloud aktif.');
} else {
  console.log('[LOCAL] Upstash Redis tidak diset - menggunakan data/users.json lokal.');
}

async function redisCommand(commandArray) {
  if (!isUpstashEnabled) return null;
  try {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + UPSTASH_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commandArray),
    });
    const data = await res.json();
    return data && data.result !== undefined ? data.result : null;
  } catch (err) {
    console.error('[REDIS] Komunikasi ke Upstash gagal:', err.message);
    return null;
  }
}

async function syncUsersFromRedis() {
  if (!isUpstashEnabled) return;
  try {
    const raw = await redisCommand(['GET', 'ctf:users']);
    if (!raw) return;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const sourceUsers = parsed.users || parsed;
      for (const [key, u] of Object.entries(sourceUsers)) {
        const lowerKey = key.toLowerCase();
        const existing = users.get(lowerKey);
        // Jangan pernah menimpa salt/hash lokal dengan nilai kosong dari Redis.
        // Salt kosong membuat authFrom() menolak token yang sebenarnya valid
        // (gejala: peserta ter-logout otomatis saat submit flag).
        const salt = String(u.salt || (existing && existing.salt) || '');
        const hash = String(u.hash || (existing && existing.hash) || '');
        users.set(lowerKey, {
          username: String(u.username || (existing && existing.username) || lowerKey),
          name: String(u.name || u.username || (existing && existing.name) || lowerKey),
          salt,
          hash,
          score: Number.isFinite(Number(u.score)) ? Number(u.score) : (existing ? existing.score : 0),
          solved: new Set(Array.isArray(u.solved) ? u.solved.map(String) : (existing ? existing.solved : [])),
          role: u.role === 'admin' || (existing && existing.role === 'admin') ? 'admin' : 'user',
          createdAt: Number(u.createdAt) || (existing ? existing.createdAt : Date.now()),
          lastSubmit: existing ? existing.lastSubmit : 0,
        });
      }
    }
  } catch (err) {
    console.error('[REDIS] Gagal membaca data users dari Upstash:', err.message);
  }
}

async function saveUsersToRedis() {
  if (!isUpstashEnabled) return;
  try {
    const obj = { users: {} };
    for (const [key, u] of users) {
      obj.users[key] = {
        username: u.username,
        name: u.name,
        salt: u.salt,
        hash: u.hash,
        score: u.score,
        solved: [...u.solved],
        role: u.role === 'admin' ? 'admin' : undefined,
        createdAt: u.createdAt,
      };
    }
    await redisCommand(['SET', 'ctf:users', JSON.stringify(obj)]);
  } catch (err) {
    console.error('[REDIS] Gagal menyimpan data users ke Upstash:', err.message);
  }
}

const USER_RE = /^[A-Za-z0-9_]{3,24}$/;
const users = new Map(); // key (lowercase) -> { username, name, salt, hash, score, solved:Set, createdAt, lastSubmit }

function loadUsers() {
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    for (const [key, u] of Object.entries(raw.users || {})) {
      users.set(key, {
        username: String(u.username || key),
        name: String(u.name || u.username || key),
        salt: String(u.salt || ''),
        hash: String(u.hash || ''),
        score: Number(u.score) || 0,
        solved: new Set(Array.isArray(u.solved) ? u.solved.map(String) : []),
        role: u.role === 'admin' ? 'admin' : 'user',
        createdAt: Number(u.createdAt) || Date.now(),
        lastSubmit: 0,
      });
    }
  } catch (e) {
    /* file belum ada â€” mulai dengan user kosong */
  }
  console.log(`[AUTH] ${users.size} user terdaftar dimuat dari data/users.json`);
}

async function saveUsers() {
  const obj = { users: {} };
  for (const [key, u] of users) {
    obj.users[key] = {
      username: u.username,
      name: u.name,
      salt: u.salt,
      hash: u.hash,
      score: u.score,
      solved: [...u.solved],
      role: u.role === 'admin' ? 'admin' : undefined,
      createdAt: u.createdAt,
    };
  }
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2) + '\n');
  } catch (e) {
    // Di Vercel serverless, filesystem read-only diabaikan
  }
  if (isUpstashEnabled) {
    await saveUsersToRedis();
  }
}

loadUsers();

/* Bootstrap akun Admin untuk Admin Dashboard (/admin.html).
 * Bisa dioverride lewat env ADMIN_USER / ADMIN_PASSWORD. */
function ensureAdmin() {
  for (const u of users.values()) {
    if (u.role === 'admin') return;
  }
  const adminUser = (process.env.ADMIN_USER || 'admin').trim() || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const key = adminUser.toLowerCase();

  if (users.has(key)) {
    // username sudah dipakai peserta biasa â†’ naikkan role-nya
    const u = users.get(key);
    u.role = 'admin';
    saveUsers();
    console.warn(`[ADMIN] user "${u.username}" dinaikkan role-nya menjadi Admin.`);
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  users.set(key, {
    username: adminUser,
    name: 'Administrator',
    salt,
    hash: hashPassword(adminPass, salt),
    score: 0,
    solved: new Set(),
    role: 'admin',
    createdAt: Date.now(),
    lastSubmit: 0,
  });
  saveUsers();
  console.warn(
    `[ADMIN] akun Admin dibuat -> username: ${adminUser}, password: ${adminPass} ` +
    '(UBAH lewat env ADMIN_PASSWORD sebelum dipakai di VPS).'
  );
}

const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');

/* ensureAdmin() sengaja TIDAK dipanggil di sini. Pada deployment dengan
 * Upstash Redis, memanggilnya sebelum syncUsersFromRedis() bisa menulis
 * ulang Redis hanya berisi akun admin dan menghapus akun peserta — yang
 * berujung pada token peserta menjadi tidak valid (auto-logout saat submit).
 * Pemanggilan dipindah ke bootstrapUsers() saat server start. */

function signToken(key, salt, exp) {
  const payload = exp ? `${key}|${salt}|${exp}` : `${key}|${salt}`;
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}
const makeToken = (key, salt) => {
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${key}.${exp}.${signToken(key, salt, exp)}`;
};

const safeEqualHex = (a, b) => {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch (e) {
    return false;
  }
};

const pubUser = (u) => ({
  username: u.username,
  name: u.name,
  score: u.score,
  solvedCount: u.solved.size,
  role: u.role === 'admin' ? 'admin' : 'user', // dipakai gerbang Admin Dashboard
});

/** Ambil token dari body / Authorization: Bearer / ?token=. */
function extractToken(req) {
  let token = '';
  const body = req.body || {};
  if (typeof body.token === 'string') token = body.token.trim();
  if (!token) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) token = h.slice(7).trim();
  }
  if (!token && typeof req.query.token === 'string') token = req.query.token.trim();
  return token;
}

/**
 * Validasi token dan kembalikan alasan kegagalannya.
 * Format baru : <key>.<exp>.<hmac>   (punya masa berlaku)
 * Format lama : <key>.<hmac>         (tetap diterima agar sesi lama tidak putus)
 * reason: 'missing' | 'malformed' | 'unknown_user' | 'bad_signature' | 'expired' | null
 */
function authInfo(req) {
  const token = extractToken(req);
  if (!token) return { user: null, key: null, reason: 'missing' };

  const parts = token.split('.');
  let key = '';
  let sig = '';
  let exp = 0;

  if (parts.length === 3) {
    key = parts[0].toLowerCase();
    exp = Number(parts[1]);
    sig = parts[2];
    if (!key || !sig || !Number.isFinite(exp) || exp <= 0) {
      return { user: null, key: null, reason: 'malformed' };
    }
    if (Date.now() > exp) {
      return { user: null, key, reason: 'expired', expired: true };
    }
  } else if (parts.length === 2) {
    key = parts[0].toLowerCase();
    sig = parts[1];
    if (!key || !sig) return { user: null, key: null, reason: 'malformed' };
  } else {
    return { user: null, key: null, reason: 'malformed' };
  }

  const user = users.get(key);
  if (!user || !user.salt) return { user: null, key, reason: 'unknown_user' };

  const expected = exp ? signToken(key, user.salt, exp) : signToken(key, user.salt);
  if (!safeEqualHex(sig, expected)) {
    return { user: null, key, reason: 'bad_signature' };
  }
  return { user, key, reason: null, exp };
}

/** Ambil user dari token (body.token / Authorization: Bearer / ?token=). */
function authFrom(req) {
  return authInfo(req).user;
}

/**
 * Middleware autentikasi untuk route yang WAJIB login.
 * Membaca token dari Authorization: Bearer, body.token, atau ?token=.
 * Menempelkan req.player + req.auth agar handler tidak parse ulang.
 */
function requireAuth(req, res, next) {
  const auth = authInfo(req);
  if (!auth.user) {
    const expired = ['malformed', 'bad_signature', 'unknown_user', 'expired'].includes(auth.reason);
    return res.status(401).json({
      success: false,
      authRequired: true,
      sessionExpired: expired,
      authReason: auth.reason,
      message: auth.reason === 'expired'
        ? 'Sesi akun sudah kedaluwarsa. Silakan login ulang.'
        : expired
          ? 'Sesi login tidak valid. Silakan login ulang.'
          : 'Token sesi tidak dikirim. Silakan login terlebih dahulu.',
    });
  }
  req.auth = auth;
  req.player = auth.user;
  next();
}

/** Middleware: hydrate user dari Redis sebelum validasi token (bila aktif). */
async function syncUsersMiddleware(req, res, next) {
  try {
    if (isUpstashEnabled) await syncUsersFromRedis();
    next();
  } catch (err) {
    next(err);
  }
}

/* ---------------------------------------------------------------
 * 3. Middleware
 * ------------------------------------------------------------- */
app.use(cors());
// Batas JSON dinaikkan: form admin CRUD menyertakan deskripsi markdown panjang.
app.use(express.json({ limit: '256kb' }));

// Static: frontend SPA
app.use(express.static(PUBLIC_DIR));

// Rute download lampiran soal (diakses sebagai /challenges/<nama-file>)
// Mendukung pencarian file dinamis baik langsung di root maupun dalam subfolder kategori
app.get('/challenges/:filename(*)', (req, res) => {
  const reqFile = req.params.filename;
  if (!reqFile) return res.status(404).send('File tidak ditemukan.');

  const resolved = findChallengeFile(reqFile);
  if (!resolved) {
    return res.status(404).send('File lampiran soal tidak ditemukan di server.');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=0');
  return res.download(resolved, path.basename(resolved), (err) => {
    if (err && !res.headersSent) {
      res.status(500).send('Gagal mengunduh file.');
    }
  });
});

// Logger sederhana
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[REQ] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

/* ---------------------------------------------------------------
 * Rate limit sederhana (in-memory) â€” arena dipublikasikan ke
 * internet, jadi jangan biarkan skrip membanjiri API.
 * ------------------------------------------------------------- */
const rateBuckets = new Map();

function rateLimit(windowMs, max) {
  return (req, res, next) => {
    // Key wajib menyertakan identitas limiter ini, karena bisa ada
    // lebih dari satu rateLimit untuk path yang sama (mis. /api + /api/submit)
    const key = `${req.ip}|${windowMs}:${max}|${req.baseUrl}${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message: 'Terlalu banyak request, coba lagi sebentar.',
      });
    }
    next();
  };
}

// Bersihkan bucket lama tiap menit supaya Map tidak membengkak
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.start > 120000) rateBuckets.delete(key);
  }
}, 60000).unref();

// API umum: 300 req/menit per IP â€” submit: 30 req/menit per IP
app.use('/api', rateLimit(60000, 300));
app.use('/api/submit', rateLimit(60000, 30));

/* ---------------------------------------------------------------
 * 4. API: GET /api/challenges
 *    Mengembalikan daftar soal TANPA field flag.
 *    Query opsional ?user=<nickname> untuk menandai soal yg sudah selesai.
 * ------------------------------------------------------------- */
app.get('/api/challenges', async (req, res) => {
  if (isUpstashEnabled) await syncUsersFromRedis();
  const player =
    authFrom(req) ||
    (typeof req.query.user === 'string' && req.query.user.trim()
      ? users.get(req.query.user.trim().toLowerCase()) || null
      : null);

  const list = CHALLENGES.filter((c) => !c.disabled).map((c) => {
    const downloadUrls = c.files.map((f) => `/challenges/${encodeURIComponent(f)}`);
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      points: c.points,
      difficulty: c.difficulty,
      description: resolveHost(c.description), // ganti <SERVER_IP> dengan IP aktif
      files: c.files,
      downloadUrls,
      file: c.files[0] || null,
      downloadUrl: downloadUrls[0] || null,
      externalUrl: c.url, // link eksternal (Google Drive dsb.)
      flagFormat: c.flagFormat, // selalu 'ITCLUB' â€” hanya prefix, isi flag tidak ikut
      solved: player ? player.solved.has(c.id) : false,
    };
  });

  res.json({ success: true, challenges: list });
});

/* ---------------------------------------------------------------
 * 5a. API: POST /api/register  { name, username, password }
 * ------------------------------------------------------------- */
app.post('/api/register', async (req, res) => {
  if (isUpstashEnabled) await syncUsersFromRedis();
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (name.length < 2 || name.length > 40) {
    return res.status(400).json({ success: false, message: 'Nama lengkap harus 2â€“40 karakter.' });
  }
  if (!USER_RE.test(username)) {
    return res.status(400).json({
      success: false,
      message: 'Username: 3â€“24 karakter, hanya huruf, angka, dan underscore.',
    });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ success: false, message: 'Password minimal 6 karakter.' });
  }
  if (users.has(username.toLowerCase())) {
    return res.status(409).json({
      success: false,
      message: 'Username sudah terdaftar. Gunakan tab Login.',
    });
  }

  const key = username.toLowerCase();
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    username,
    name,
    salt,
    hash: hashPassword(password, salt),
    score: 0,
    solved: new Set(),
    createdAt: Date.now(),
    lastSubmit: 0,
  };
  users.set(key, user);
  await saveUsers();

  console.log(`[AUTH] register ${username} (${name})`);
  res.status(201).json({
    success: true,
    message: `Akun dibuat. Selamat datang di arena, ${name}!`,
    token: makeToken(key, salt),
    user: pubUser(user),
  });
});

/* ---------------------------------------------------------------
 * 5b. API: POST /api/login  { username, password }
 * ------------------------------------------------------------- */
app.post('/api/login', async (req, res) => {
  if (isUpstashEnabled) await syncUsersFromRedis();
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  const key = username.toLowerCase();
  const user = users.get(key);
  if (!user || !user.hash || !safeEqualHex(hashPassword(password, user.salt), user.hash)) {
    return res.status(401).json({ success: false, message: 'Username atau password salah.' });
  }

  console.log(`[AUTH] login ${user.username}`);
  res.json({
    success: true,
    message: `Selamat datang kembali, ${user.name}.`,
    token: makeToken(key, user.salt),
    user: pubUser(user),
  });
});

/* ---------------------------------------------------------------
 * 5c. API: POST /api/submit
 *    Body: { token, challengeId, flag } â€” WAJIB login (token sesi).
 * ------------------------------------------------------------- */
app.post('/api/submit', syncUsersMiddleware, requireAuth, async (req, res) => {
  const body = req.body || {};
  const player = req.player;

  const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
  const flag = typeof body.flag === 'string' ? body.flag.trim() : '';

  if (!challengeId || !flag) {
    return res.status(400).json({
      success: false,
      message: 'challengeId dan flag wajib diisi.',
    });
  }

  const challenge = CHALLENGES.find((c) => c.id === challengeId);
  if (!challenge) {
    return res.status(404).json({
      success: false,
      message: 'Challenge tidak ditemukan.',
    });
  }
  if (challenge.disabled) {
    return res.status(403).json({
      success: false,
      message: 'Soal ini sedang dinonaktifkan admin.',
    });
  }

  // Anti double-submit: soal yang sama tidak boleh menambah poin berulang.
  if (player.solved.has(challenge.id)) {
    logAudit({
      username: player.username,
      challengeId: challenge.id,
      title: challenge.title,
      status: flag === challenge.flag ? 'correct' : 'incorrect',
      ip: req.ip,
    });
    return res.status(200).json({
      success: false,
      alreadySolved: true,
      message: `Kamu sudah menyelesaikan "${challenge.title}". Poin tidak ditambahkan lagi.`,
      score: player.score,
    });
  }

  // Anti spam submit (cooldown 500ms per user).
  const now = Date.now();
  if (now - player.lastSubmit < 500) {
    return res.status(429).json({
      success: false,
      message: 'Terlalu cepat, coba lagi sebentar...',
      score: player.score,
    });
  }
  player.lastSubmit = now;

  if (flag === challenge.flag) {
    player.solved.add(challenge.id);
    // PENGUJIAN ADMIN: solved tetap dicatat (kartu âœ“), tapi poin TIDAK ditambahkan
    // agar skor kompetisi peserta tidak terpengaruh oleh akun Admin.
    const isAdminSubmit = player.role === 'admin';
    if (!isAdminSubmit) player.score += challenge.points;
    await saveUsers(); // skor & solved ikut bertahan di data/users.json
    logAudit({
      username: player.username,
      challengeId: challenge.id,
      title: challenge.title,
      status: 'correct',
      ip: req.ip,
    });

    console.log(
      isAdminSubmit
        ? `[SCORE] ${player.username} benar pada ${challenge.id} (ADMIN â€” poin tidak dihitung)`
        : `[SCORE] ${player.username} benar pada ${challenge.id} (+${challenge.points}) => ${player.score}`
    );

    return res.status(200).json({
      success: true,
      message: isAdminSubmit
        ? 'FLAG BENAR! ðŸ›¡ï¸ Mode Admin â€” poin TIDAK dihitung untuk kompetisi peserta.'
        : `FLAG BENAR! +${challenge.points} poin untuk ${player.username}.`,
      points: isAdminSubmit ? 0 : challenge.points,
      score: player.score,
      solvedCount: player.solved.size,
      adminSubmit: isAdminSubmit, // penanda bagi frontend
    });
  }

  // Petunjuk format bila prefix-nya salah (semua soal kini memakai ITCLUB{...}).
  const expectedPrefix = (challenge.flag.match(/^[A-Za-z0-9_]+\{/) || ['ITCLUB{'])[0];
  const formatHint = flag.startsWith(expectedPrefix)
    ? 'FLAG SALAH. Coba lagi, hacker!'
    : `FLAG SALAH. Format flag soal ini ${expectedPrefix}... (lihat placeholder di kartu soal)`;

  console.log(`[SCORE] ${player.username} salah pada ${challenge.id}`);
  logAudit({
    username: player.username,
    challengeId: challenge.id,
    title: challenge.title,
    status: 'incorrect',
    ip: req.ip,
  });
  return res.status(200).json({
    success: false,
    message: formatHint,
    score: player.score,
  });
});

/* ---------------------------------------------------------------
 * 5c-2. API: GET/POST /api/session
 *    Cek validitas token tanpa mengubah state apa pun. Dipakai
 *    frontend saat load & sebelum menghapus sesi lokal.
 * ------------------------------------------------------------- */
app.all('/api/session', syncUsersMiddleware, async (req, res) => {
  const auth = authInfo(req);
  if (!auth.user) {
    return res.status(401).json({
      success: false,
      valid: false,
      authReason: auth.reason,
      sessionExpired: ['malformed', 'bad_signature', 'unknown_user', 'expired'].includes(auth.reason),
    });
  }
  return res.json({
    success: true,
    valid: true,
    user: pubUser(auth.user),
    // Sliding session: perpanjang token setiap kali dicek, sehingga peserta
    // yang aktif tidak tiba-tiba kehilangan sesi di tengah kompetisi.
    token: makeToken(auth.key, auth.user.salt),
  });
});

/* ---------------------------------------------------------------
 * 5d. Audit Log Submisi (persisten di data/auditlog.jsonl)
 *     Mencatat setiap submit: siapa, soal apa, correct/incorrect, waktu.
 * ------------------------------------------------------------- */
const AUDIT_FILE = path.join(__dirname, 'data', 'auditlog.jsonl');
const AUDIT_MAX = 500;
let AUDIT = [];

function loadAudit() {
  try {
    const lines = fs.readFileSync(AUDIT_FILE, 'utf-8').split('\n').filter(Boolean);
    AUDIT = lines
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean)
      .slice(-AUDIT_MAX);
  } catch (e) {
    /* file belum ada â€” mulai dari kosong */
  }
}

function logAudit(entry) {
  const row = { ts: Date.now(), ...entry };
  AUDIT.push(row);
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(row) + '\n');
  } catch (e) {
    console.error('[AUDIT] Gagal menulis log ->', e.message);
  }
  if (AUDIT.length > AUDIT_MAX * 2) {
    AUDIT = AUDIT.slice(-AUDIT_MAX);
    try {
      fs.writeFileSync(AUDIT_FILE, AUDIT.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch (e) { /* abaikan */ }
  }
}

loadAudit();
console.log(`[AUDIT] ${AUDIT.length} entri submisi dimuat`);

/* ---------------------------------------------------------------
 * 5e. ADMIN API â€” semua endpoint di bawah WAJIB role 'admin'
 *     (dilindungi requireAdmin; token sesi biasa tidak cukup)
 * ------------------------------------------------------------- */
function requireAdmin(req, res, next) {
  const u = authFrom(req);
  if (!u) {
    return res.status(401).json({ success: false, authRequired: true, message: 'Login admin diperlukan.' });
  }
  if (u.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses ditolak: akun ini bukan role Admin.' });
  }
  req.admin = u;
  next();
}

const CATEGORIES = [
  'Web Exploitation', 'Binary Exploitation', 'Digital Forensics',
  'Cryptography', 'Reverse Engineering', 'Boot2Root', 'Misc',
];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const CAT_PREFIX = {
  'Web Exploitation': 'web', 'Binary Exploitation': 'pwn', 'Digital Forensics': 'df',
  'Cryptography': 'cr', 'Reverse Engineering': 'rv', 'Boot2Root': 'b2r', 'Misc': 'ms',
};
const FLAG_RE = /^ITCLUB\{.+\}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ALLOWED_EXT = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'pcap', 'pcapng', 'enc', 'elf', 'bin', 'exe', 'apk', 'py', 'c', 'cpp', 'h', 'sh',
  'json', 'csv', 'log', 'key', 'pub', 'docx', 'xlsx',
]);

/** Tulis CHALLENGES ke data/challenges.json (mempertahankan bentuk 'file'/'files'). */
function saveChallenges() {
  try {
    const out = CHALLENGES.map((c) => {
      const o = {
        id: c.id,
        title: c.title,
        category: c.category,
        points: c.points,
        difficulty: c.difficulty,
        description: c.description,
        flag: c.flag,
      };
      if (c.srcFiles === 'files' || c.files.length !== 1) {
        if (c.files.length) o.files = c.files;
      } else {
        o.file = c.files[0];
      }
      if (c.url) o.url = c.url;
      if (c.disabled) o.disabled = true;
      return o;
    });
    fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2) + '\n');
    return true;
  } catch (e) {
    console.error('[ADMIN] Gagal menyimpan challenges.json ->', e.message);
    return false;
  }
}

const pubChallenge = ({ srcFiles, ...rest }) => rest;

function validateChallengeInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (body.title !== undefined) {
    const t = String(body.title || '').trim();
    if (t.length < 3 || t.length > 120) errors.push('Judul soal harus 3â€“120 karakter.');
    out.title = t;
  }
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) errors.push('Kategori tidak valid.');
    out.category = body.category;
  }
  if (body.difficulty !== undefined) {
    if (!DIFFICULTIES.includes(body.difficulty)) errors.push('Kesulitan harus Easy/Medium/Hard.');
    out.difficulty = body.difficulty;
  }
  if (body.points !== undefined) {
    const p = Number(body.points);
    if (!Number.isInteger(p) || p < 0 || p > 99999) errors.push('Poin harus bilangan bulat 0â€“99999.');
    out.points = p;
  }
  if (body.description !== undefined) {
    const d = String(body.description || '').trim();
    if (!d) errors.push('Deskripsi wajib diisi.');
    else if (d.length > 100000) errors.push('Deskripsi terlalu panjang (maks 100 KB).');
    out.description = d;
  }
  if (body.flag !== undefined) {
    const f = String(body.flag || '').trim();
    if (!FLAG_RE.test(f)) errors.push('Flag harus memakai format ITCLUB{...}.');
    out.flag = f;
  }
  if (body.url !== undefined) {
    const u = String(body.url || '').trim();
    if (u) {
      if (!/^https?:\/\//i.test(u)) errors.push('Link soal harus diawali http:// atau https://.');
      out.url = u;
    } else {
      out.url = null;
    }
  }
  if (body.file !== undefined) {
    const raw = String(body.file || '').trim();
    if (!raw) {
      out.files = []; // '' = lepas lampiran
      out.srcFiles = null;
    } else {
      const name = path.basename(raw);
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!SAFE_NAME_RE.test(name) || name.includes('..')) errors.push('Nama file lampiran tidak valid.');
      else if (!ALLOWED_EXT.has(ext)) errors.push(`Ekstensi .${ext} tidak didukung.`);
      else if (!findChallengeFile(name)) {
        errors.push(`File lampiran belum ter-upload: ${name}`);
      }
      out.files = [name];
      out.srcFiles = 'file';
    }
  }

  if (!partial) {
    if (!out.title) errors.push('Judul wajib diisi.');
    if (!out.category) errors.push('Kategori wajib dipilih.');
    if (!out.difficulty) errors.push('Kesulitan wajib dipilih.');
    if (out.points === undefined) errors.push('Poin wajib diisi.');
    if (!out.description) errors.push('Deskripsi wajib diisi.');
    if (!out.flag) errors.push('Flag wajib diisi.');
  }
  return { errors, out };
}

function nextChallengeId(category) {
  const prefix = CAT_PREFIX[category] || 'ms';
  let max = 0;
  for (const c of CHALLENGES) {
    const m = String(c.id).match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

/* --- Daftar soal lengkap (termasuk flag & status aktif) --- */
app.get('/api/admin/challenges', requireAdmin, (req, res) => {
  res.json({
    success: true,
    categories: CATEGORIES,
    difficulties: DIFFICULTIES,
    challenges: CHALLENGES.map(pubChallenge),
  });
});

/* --- Tambah soal baru --- */
app.post('/api/admin/challenges', requireAdmin, (req, res) => {
  const { errors, out } = validateChallengeInput(req.body || {});
  if (errors.length) return res.status(400).json({ success: false, message: errors.join(' ') });

  const challenge = {
    id: nextChallengeId(out.category),
    title: out.title,
    category: out.category,
    points: out.points,
    difficulty: out.difficulty,
    description: out.description,
    flag: out.flag,
    files: out.files || [],
    srcFiles: out.srcFiles !== undefined ? out.srcFiles : null,
    url: out.url || null,
    disabled: false,
  };

  CHALLENGES.push(challenge);
  if (!saveChallenges()) {
    CHALLENGES.pop();
    return res.status(500).json({ success: false, message: 'Gagal menyimpan data soal.' });
  }

  console.log(`[ADMIN] ${req.admin.username} menambah soal ${challenge.id} (${challenge.title})`);
  res.status(201).json({
    success: true,
    message: `Soal "${challenge.title}" ditambahkan dengan ID ${challenge.id}.`,
    challenge: pubChallenge(challenge),
  });
});

/* --- Edit soal --- */
app.put('/api/admin/challenges/:id', requireAdmin, (req, res) => {
  const c = CHALLENGES.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ success: false, message: 'Soal tidak ditemukan.' });

  const { errors, out } = validateChallengeInput(req.body || {}, { partial: true });
  if (errors.length) return res.status(400).json({ success: false, message: errors.join(' ') });
  if (!Object.keys(out).length) {
    return res.status(400).json({ success: false, message: 'Tidak ada perubahan yang dikirim.' });
  }

  Object.assign(c, out);
  if (out.files !== undefined) c.srcFiles = out.srcFiles;
  if (!saveChallenges()) {
    return res.status(500).json({ success: false, message: 'Gagal menyimpan data soal.' });
  }

  console.log(`[ADMIN] ${req.admin.username} mengedit soal ${c.id}`);
  res.json({
    success: true,
    message: `Soal "${c.title}" diperbarui.`,
    challenge: pubChallenge(c),
  });
});

/* --- Nonaktifkan / aktifkan soal (sembunyikan dari peserta) --- */
app.post('/api/admin/challenges/:id/toggle', requireAdmin, (req, res) => {
  const c = CHALLENGES.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ success: false, message: 'Soal tidak ditemukan.' });

  c.disabled = !c.disabled;
  if (!saveChallenges()) {
    c.disabled = !c.disabled;
    return res.status(500).json({ success: false, message: 'Gagal menyimpan data soal.' });
  }

  console.log(`[ADMIN] ${req.admin.username} ${c.disabled ? 'menonaktifkan' : 'mengaktifkan'} soal ${c.id}`);
  res.json({
    success: true,
    message: c.disabled
      ? `Soal "${c.title}" disembunyikan dari peserta.`
      : `Soal "${c.title}" aktif kembali.`,
    disabled: c.disabled,
  });
});

/* --- Hapus soal (file lampiran tetap aman di disk) --- */
app.delete('/api/admin/challenges/:id', requireAdmin, (req, res) => {
  const idx = CHALLENGES.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'Soal tidak ditemukan.' });

  const [removed] = CHALLENGES.splice(idx, 1);
  if (!saveChallenges()) {
    CHALLENGES.splice(idx, 0, removed);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan data soal.' });
  }

  console.log(`[ADMIN] ${req.admin.username} menghapus soal ${removed.id}`);
  res.json({ success: true, message: `Soal "${removed.title}" (${removed.id}) dihapus.` });
});

/* --- Upload lampiran: PUT raw body (tanpa dependensi multipart) --- */
app.put(
  '/api/admin/upload/:name',
  express.raw({ type: '*/*', limit: '50mb' }),
  requireAdmin,
  (req, res) => {
    const name = path.basename(String(req.params.name || ''));
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!SAFE_NAME_RE.test(name) || name.includes('..')) {
      return res.status(400).json({ success: false, message: 'Nama file tidak valid.' });
    }
    if (!ALLOWED_EXT.has(ext)) {
      return res.status(400).json({ success: false, message: `Ekstensi .${ext} tidak didukung.` });
    }
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) {
      return res.status(400).json({ success: false, message: 'File kosong.' });
    }
    try {
      fs.writeFileSync(path.join(CHALLENGES_DIR, name), buf);
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Gagal menulis file: ' + e.message });
    }
    console.log(`[ADMIN] ${req.admin.username} meng-upload lampiran ${name} (${buf.length} byte)`);
    res.json({ success: true, message: `File "${name}" ter-upload (${buf.length} byte).`, file: name });
  }
);

/* --- Manajemen peserta --- */
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const list = Array.from(users.values())
    .map((u) => ({
      username: u.username,
      name: u.name,
      score: u.score,
      solvedCount: u.solved.size,
      solved: [...u.solved],
      role: u.role === 'admin' ? 'admin' : 'user',
      createdAt: u.createdAt,
    }))
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  res.json({ success: true, users: list });
});

app.post('/api/admin/users/:username/reset-password', requireAdmin, (req, res) => {
  const key = decodeURIComponent(String(req.params.username || '')).toLowerCase();
  const u = users.get(key);
  if (!u) return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });

  const pw = typeof (req.body || {}).password === 'string' ? req.body.password : '';
  if (pw.length < 6 || pw.length > 72) {
    return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter.' });
  }

  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPassword(pw, u.salt);
  u.lastSubmit = 0;
  saveUsers();

  console.log(`[ADMIN] ${req.admin.username} mereset password @${u.username}`);
  res.json({ success: true, message: `Password @${u.username} berhasil direset.` });
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const key = decodeURIComponent(String(req.params.username || '')).toLowerCase();
  const u = users.get(key);
  if (!u) return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
  if (u.role === 'admin') {
    return res.status(400).json({ success: false, message: 'Akun Admin tidak bisa dihapus.' });
  }

  users.delete(key);
  saveUsers();

  console.log(`[ADMIN] ${req.admin.username} menghapus akun @${u.username}`);
  res.json({ success: true, message: `Akun @${u.username} dihapus.` });
});

/* --- Reset leaderboard untuk sesi kompetisi baru --- */
app.post('/api/admin/leaderboard/reset', requireAdmin, async (req, res) => {
  if (isUpstashEnabled) await syncUsersFromRedis();
  let n = 0;
  for (const u of users.values()) {
    u.score = 0;
    u.solved.clear();
    u.lastSubmit = 0;
    n++;
  }
  saveUsers();

  console.log(`[ADMIN] ${req.admin.username} mereset leaderboard (${n} akun -> 0 poin)`);
  res.json({ success: true, message: `Leaderboard direset â€” ${n} akun kembali ke 0 poin.` });
});

/* --- Riwayat submisi flag (audit log) --- */
app.get('/api/admin/audit', requireAdmin, (req, res) => {
  res.json({ success: true, log: AUDIT.slice(-300).reverse() }); // terbaru dulu
});

/* ---------------------------------------------------------------
 * 6. API: GET /api/leaderboard
 * ------------------------------------------------------------- */
app.get('/api/leaderboard', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (isUpstashEnabled) await syncUsersFromRedis();

  const ranked = Array.from(users.values())
    // ðŸ”’ Akun Admin TIDAK masuk peringkat kompetisi peserta â€” difilter di sisi
    //    server, lalu difilter ulang oleh frontend (index.html â†’ loadLeaderboard).
    .filter((p) => p.role !== 'admin' && String(p.username || '').toLowerCase() !== 'admin')
    .map((p) => ({
      username: p.username,
      role: p.role === 'admin' ? 'admin' : 'user', // penanda utk filter klien
      score: p.score,
      solved: p.solved.size,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.solved !== a.solved) return a.solved - b.solved;
      return a.username.localeCompare(b.username);
    })
    .slice(0, 100)
    .map((p, i) => ({ rank: i + 1, ...p }));

  res.json({ success: true, leaderboard: ranked });
});

/* ---------------------------------------------------------------
 * 7. Health check & 404 handler
 * ------------------------------------------------------------- */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    uptime: process.uptime(),
    challenges: CHALLENGES.length,
    users: users.size,
    serverIp: SERVER_IP,
    port: PORT,
  });
});

// SPA fallback: route tanpa ekstensi kembali ke index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/challenges/')) {
    return next();
  }
  // Path berekstensi (.json/.js/.txt dst) TIDAK boleh dibalas index.html â€”
  // biar jelas 404, bukan seolah-olah file itu ada.
  if (path.extname(req.path)) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// AI Tutor Route â€” BASE /api/ai-tutor
// â€”â€”â€”â€” Tambahkan require di awal: const aiTutorRouter = require('./routes/ai-tutor'); â€”â€”â€”â€”
// â€”â€”â€”â€” Semua endpoint: POST /api/ai-tutor , POST /api/ai-tutor/hint â€”â€”â€”â€”
// â€”â€”â€”â€” Rate-limiting: 5 req/menit/user, 20 req/menit/IP â€”â€”â€”â€”
const aiTutorRouter = require('./routes/ai-tutor');
app.use('/api/ai-tutor', aiTutorRouter);

// Error handler (termasuk file attachment yang tidak ada)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Body JSON tidak valid adalah kesalahan klien (400), bukan crash server (500).
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Body request bukan JSON yang valid.' });
  }
  console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err && err.stack ? err.stack : err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
  }
  res.status(err.status || 404).send('404 - Not Found');
});

/* ---------------------------------------------------------------
 * 8. Start Server
 * ------------------------------------------------------------- */
async function bootstrapUsers() {
  // Urutan penting: hydrate dari Redis dulu, baru pastikan akun Admin ada.
  if (isUpstashEnabled) await syncUsersFromRedis();
  ensureAdmin();
}

initServerIp()
  .then(async () => {
    await bootstrapUsers();
    app.listen(PORT, () => {
      console.log('==================================================');
      console.log('  IT CLUB // LOCAL CTF ARENA');
      console.log(`  Server running at http://localhost:${PORT}`);
      console.log(`  Server IP (untuk <SERVER_IP>): ${SERVER_IP}`);
      console.log(`  Challenges  : ${CHALLENGES.length}`);
      console.log(`  Users       : ${users.size} terdaftar`);
      console.log('  Admin       : /admin.html (AKUN DEFAULT admin/admin123 â€” ubah via env)');
      console.log('  Run "npm install && npm start" untuk memulai.');
      console.log('==================================================');
    });
  })
  .catch(async (err) => {
    console.error('[START] Gagal inisialisasi IP, memakai 127.0.0.1 ->', err.message);
    try { await bootstrapUsers(); } catch (e) { /* tetap lanjut */ }
    app.listen(PORT, () => {
      console.log(`IT CLUB // LOCAL CTF ARENA berjalan di http://localhost:${PORT} (IP fallback)`);
    });
  });
