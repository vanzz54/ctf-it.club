const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const JWT_SECRET = require('../config/jwt');

// Middleware to verify JWT and Check Admin Role
const verifyAdmin = async (req, res, next) => {
    const token = req.cookies.session_token;
    if (!token) return res.status(401).json({ error: 'Access denied' });

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        
        // Double check with DB to ensure role_id is 1
        const [rows] = await db.execute('SELECT access_level_id FROM users WHERE id = ?', [verified.id]);
        
        if (rows.length === 0 || rows[0].access_level_id !== 1) {
            return res.status(403).json({ error: 'Forbidden. Admin access required.' });
        }
        
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ error: 'Invalid token' });
    }
};

// VULNERABLE ENDPOINT (Union-based SQL Injection)
router.get('/search', verifyAdmin, async (req, res) => {
    try {
        let searchQuery = req.query.department || '';
        
        // Insecure string concatenation leading to SQL Injection
        // Expected usage: /api/employees/search?department=IT
        // Injection: /api/employees/search?department=IT' UNION SELECT 1, flag_value, 3, 4 FROM secret_flags-- -
        
        // We select 4 columns: name, email, department, position
        const query = `SELECT name, email, department, position FROM employees WHERE department = '${searchQuery}'`;
        
        // db.query is used instead of db.execute because db.execute uses prepared statements implicitly for string concat?
        // Wait, mysql2 db.execute with concat string might still be vulnerable, but db.query is safer for classic injections
        const [rows] = await db.query(query);

        res.json({ success: true, data: rows });
    } catch (error) {
        // Outputting error to make it easier for players to debug their SQLi
        res.status(500).json({ error: 'Database error: ' + error.message });
    }
});

module.exports = router;
