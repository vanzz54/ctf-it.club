const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const JWT_SECRET = require('../config/jwt');

router.post('/register', async (req, res) => {
    try {
        const { username, password, full_name } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Basic hashing (MD5 for CTF simplicity, though bcrypt is better in real life. We'll use simple plain or basic hash to avoid extra deps if not needed, but wait, the prompt didn't specify hashing. I'll just use plain text for simplicity in this CTF, or a simple MD5 using crypto).
        // Let's just use plain text or simple md5 to keep it lightweight.
        const crypto = require('crypto');
        const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

        const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // access_level_id defaults to 2 (User)
        await db.execute(
            'INSERT INTO users (username, password, full_name) VALUES (?, ?, ?)',
            [username, hashedPassword, full_name || '']
        );

        res.json({ success: true, message: 'Registration successful. Please login.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const crypto = require('crypto');
        const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

        const [rows] = await db.execute('SELECT id, username, access_level_id FROM users WHERE username = ? AND password = ?', [username, hashedPassword]);

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];

        const token = jwt.sign(
            { id: user.id, username: user.username, role_id: user.access_level_id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.cookie('session_token', token, { httpOnly: true });
        res.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('session_token');
    res.json({ success: true, message: 'Logged out' });
});

module.exports = router;
