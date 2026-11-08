const crypto = require('crypto');

// Menggunakan JWT_SECRET dari environment variable, jika tidak ada generate secara acak (agar aman dan tidak bisa ditebak)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

module.exports = JWT_SECRET;
