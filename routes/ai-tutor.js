// routes/ai-tutor.js
// AI Tutor API — chat & hint service for CTF platform
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Rate limit store
const rateLimitStore = new Map();

// Cleanup rate limit store periodically (every 5 minutes)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitStore.entries()) {
    if (now - bucket.start > 120000) {
      rateLimitStore.delete(key);
    }
  }
}, 300000);
if (cleanupTimer.unref) cleanupTimer.unref();

// Config loader
function getAiConfig() {
  let openrouterKey = process.env.OPENROUTER_API_KEY || '';
  let models = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
  ];
  let timeoutMs = 15000;

  try {
    const configFile = path.join(__dirname, '..', 'config', 'ai-config.json');
    if (fs.existsSync(configFile)) {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      if (cfg.openrouterApiKey && cfg.openrouterApiKey !== 'YOUR_OPENROUTER_API_KEY_HERE') {
        openrouterKey = cfg.openrouterApiKey;
      }
      if (cfg.openrouter) {
        if (cfg.openrouter.defaultModel) {
          models = [cfg.openrouter.defaultModel, ...(cfg.openrouter.fallbackModels || [])];
        }
        if (cfg.openrouter.timeoutMs) {
          timeoutMs = cfg.openrouter.timeoutMs;
        }
      }
    }
  } catch (e) {
    console.warn('[AI Config] Gagal membaca ai-config.json:', e.message);
  }

  return { openrouterKey, models, timeoutMs };
}

// Rate limit per IP (window 1 min)
const aiRateLimit = (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const key = `ai:${ip}:${Math.floor(now / 60000)}`;

  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 0, start: now });
  }
  const bucket = rateLimitStore.get(key);
  if (now - bucket.start > 60000) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count++;
  if (bucket.count > 20) {
    return res.status(429).json({ success: false, message: 'Terlalu banyak permintaan AI. Silakan tunggu 1 menit.' });
  }
  next();
};

// Auth middleware (sederhana — validasi token sesi)
function requireAuth(req, res, next) {
  const token = req.body?.token || req.query?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.status(401).json({ success: false, message: 'Login diperlukan untuk mengakses AI Tutor.' });
  }
  // Format token standar CTF: username.signature
  if (!token.includes('.')) {
    return res.status(401).json({ success: false, message: 'Sesi token tidak valid. Silakan login ulang.' });
  }
  next();
}

// Filter flag leak agar AI tidak membocorkan flag
function filterFlagLeak(text) {
  if (!text || typeof text !== 'string') return text;
  const flagPattern = /ITCLUB\{[^}]+\}/gi;
  const lksPattern = /LKS\{[^}]+\}/gi;
  return text
    .replace(flagPattern, '*** (flag disembunyikan oleh sistem keamanan) ***')
    .replace(lksPattern, '*** (flag disembunyikan oleh sistem keamanan) ***');
}

// Call OpenRouter API dengan fallback model & timeout
async function callOpenRouter(prompt, userMessage) {
  const { openrouterKey, models, timeoutMs } = getAiConfig();

  if (!openrouterKey || openrouterKey === 'YOUR_OPENROUTER_API_KEY_HERE') {
    throw new Error('CONFIG_KEY_MISSING');
  }

  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'https://ctf.smk2banjar.sch.id',
          'X-Title': 'IT Club CTF Arena - SMK Negeri 2 Banjar',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[AI] Model ${model} gagal (HTTP ${response.status}): ${errText}`);
        lastError = new Error(`HTTP ${response.status}: ${errText}`);
        continue;
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (reply) {
        return reply;
      }
      throw new Error('Respon kosong dari provider AI');
    } catch (err) {
      console.warn(`[AI] Model ${model} error:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Gagal menghubungi semua model AI yang tersedia.');
}

// Load challenges
function loadChallenges() {
  const DATA_FILE = path.join(__dirname, '..', 'data', 'challenges.json');
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

// POST /api/ai-tutor — chat langsung dengan AI Tutor
router.post('/', aiRateLimit, requireAuth, async (req, res) => {
  try {
    const { challenge_id, user_message, hint_budget = 3 } = req.body || {};
    const challengeId = String(challenge_id || '').trim();
    const userMessage = String(user_message || '').trim();

    if (!userMessage) {
      return res.status(400).json({ success: false, message: 'Pesan pertanyaan wajib diisi.' });
    }

    const challenges = loadChallenges();
    const challenge = challenges.find((c) => c.id === challengeId) || null;
    const category = challenge ? (challenge.category || 'Umum') : 'Umum (General CTF)';
    const difficulty = challenge ? (challenge.difficulty || 'Standar') : 'Semua Level';
    const description = challenge ? (challenge.description || '') : 'Pertanyaan umum terkait teknik CTF atau konsep keamanan siber.';
    const title = challenge ? (challenge.title || challengeId) : 'Umum';

    // Build system prompt
    const SYSTEM_PROMPT = `Kamu adalah AI Tutor untuk platform CTF IT Club SMK Negeri 2 Banjar.
Konteks Soal CTF:
- Judul: ${title}
- Kategori: ${category}
- Tingkat Kesulitan: ${difficulty}
- Deskripsi: ${description}

Aturan Ketat AI Tutor:
1. JANGAN PERNAH memberikan string flag final (format ITCLUB{...} atau LKS{...}) dalam situasi apapun!
2. Berikan panduan bertahap (scaffolding), logika analisa, konsep, atau tool yang relevan (misal: Wireshark, Burp Suite, Ghidra, CyberChef, sqlmap).
3. Jika peserta bertanya langsung mengenai jawaban atau flag, tolak dengan sopan dan berikan petunjuk langkah pertama.
4. Gunakan bahasa Indonesia yang ramah, edukatif, dan memotivasi peserta siswa SMK.
5. Pertahankan jawaban tetap ringkas dan padat (maksimal 2-3 paragraf).`;

    const rawResponse = await callOpenRouter(SYSTEM_PROMPT, userMessage);
    const filteredResponse = filterFlagLeak(rawResponse);

    return res.json({
      success: true,
      message: filteredResponse,
      hint_used: Math.min(1, Math.max(0, hint_budget - 1)),
    });

  } catch (err) {
    console.error('[AI TUTOR] Error:', err.message);
    if (err.message === 'CONFIG_KEY_MISSING') {
      return res.status(503).json({
        success: false,
        message: 'Layanan AI Tutor belum aktif: Kunci API OpenRouter belum dikonfigurasi di server (config/ai-config.json). Hubungi admin.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Terjadi kendala saat menghubungi AI. Silakan coba kembali dalam beberapa saat.',
    });
  }
});

// POST /api/ai-tutor/hint — dapatkan hint resmi bertahap
router.post('/hint', aiRateLimit, requireAuth, async (req, res) => {
  try {
    const { challenge_id, rating } = req.body || {};
    const challengeId = String(challenge_id || '').trim();

    const challenges = loadChallenges();
    const challenge = challenges.find((c) => c.id === challengeId) || null;
    const category = challenge ? (challenge.category || 'Umum') : 'Umum';
    const difficulty = challenge ? (challenge.difficulty || 'Standar') : 'Umum';
    const description = challenge ? (challenge.description || '') : 'Pertanyaan umum CTF.';
    const title = challenge ? (challenge.title || challengeId) : 'Umum';

    const SYSTEM_PROMPT = `Kamu adalah AI Tutor untuk kompetisi CTF SMK Negeri 2 Banjar.
Soal: "${title}" (${category} - ${difficulty}).
Deskripsi Soal: ${description}

Instruksi Hint:
Berikan 1 petunjuk (hint) bertahap yang membimbing peserta menemukan arah pemecahan tanpa membocorkan jawaban atau flag.
Saran tools atau sudut pandang analisis yang tepat. Format singkat (1-2 poin tindakan praktis).`;

    const promptUser = rating ? `Permintaan hint spesifik: ${rating}` : 'Berikan 1 hint praktis untuk soal ini.';
    const rawResponse = await callOpenRouter(SYSTEM_PROMPT, promptUser);
    const filteredResponse = filterFlagLeak(rawResponse);

    return res.json({
      success: true,
      message: filteredResponse,
    });

  } catch (err) {
    console.error('[AI HINT] Error:', err.message);
    if (err.message === 'CONFIG_KEY_MISSING') {
      return res.status(503).json({
        success: false,
        message: 'Kunci API OpenRouter belum dikonfigurasi di server. Hubungi panitia/admin.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil hint AI. Silakan coba beberapa saat lagi.',
    });
  }
});

module.exports = router;
