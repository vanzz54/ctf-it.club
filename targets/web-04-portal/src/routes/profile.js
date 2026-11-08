const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const JWT_SECRET = require('../config/jwt');

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
    const token = req.cookies.session_token;
    if (!token) return res.status(401).json({ error: 'Access denied' });

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ error: 'Invalid token' });
    }
};

router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT id, username, full_name, bio, phone, department, access_level_id FROM users WHERE id = ?',
            [req.user.id]
        );
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// VULNERABLE ENDPOINT (Mass Assignment)
router.put('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Simulating an insecure update logic where all provided keys are updated
        // In a real secure app, we should use destructuring or Lodash _.pick
        // const { full_name, bio, phone, department } = req.body;
        
        let updateData = req.body;
        
        // Very basic blacklist (but misses access_level_id intentionally)
        if (updateData.id) delete updateData.id;
        if (updateData.username) delete updateData.username;
        if (updateData.password) delete updateData.password;
        if (updateData.role) delete updateData.role; // attacker might try role, but we use access_level_id

        const keys = Object.keys(updateData);
        if (keys.length === 0) {
            return res.status(400).json({ error: 'No data to update' });
        }

        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const values = Object.values(updateData);
        values.push(userId); // for the WHERE clause

        // Vulnerable to Mass Assignment because if access_level_id is sent, it gets updated!
        const query = `UPDATE users SET ${setClause} WHERE id = ?`;
        
        await db.execute(query, values);

        // If access level changed, token needs refresh but for simplicity they can just re-login or the next request reads from DB.
        // Actually, JWT has role_id inside it. Let's make sure the admin route checks DB or we refresh token.
        // To be safe, let's refresh token here if it's updated.
        const [updatedUser] = await db.execute('SELECT id, username, access_level_id FROM users WHERE id = ?', [userId]);
        const newToken = jwt.sign(
            { id: updatedUser[0].id, username: updatedUser[0].username, role_id: updatedUser[0].access_level_id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.cookie('session_token', newToken, { httpOnly: true });

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error / Invalid column' });
    }
});

module.exports = router;
