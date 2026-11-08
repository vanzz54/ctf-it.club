const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../config/jwt');

// Middleware to verify JWT (so participants must be logged in to hit these endpoints)
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

router.get('/announcements', verifyToken, (req, res) => {
    res.json({
        success: true,
        data: [
            {
                title: "Welcome to the new CyberNusa Portal!",
                author: "HR Dept",
                date: "October 12, 2023",
                content: "We are excited to announce the launch of our new internal employee portal. Please make sure to update your profile information in the 'My Profile' tab. If you experience any issues, please contact the IT Helpdesk.",
                type: "primary"
            },
            {
                title: "Quarterly Townhall Meeting",
                author: "Management",
                date: "September 28, 2023",
                content: "Our next quarterly townhall meeting will be held next Friday at 10:00 AM in the main auditorium. We will be discussing our Q3 performance and the roadmap for Q4. Attendance is highly encouraged.",
                type: "success"
            },
            {
                title: "Office Maintenance Schedule",
                author: "Facilities",
                date: "September 15, 2023",
                content: "Please be informed that the HVAC system on the 3rd floor will undergo scheduled maintenance this weekend. The office will remain accessible, but temperature control might be limited.",
                type: "secondary"
            }
        ]
    });
});

router.get('/documents', verifyToken, (req, res) => {
    res.json({
        success: true,
        data: [
            { name: "Employee Handbook 2023", category: "HR Policy", categoryClass: "hr", date: "Jan 15, 2023", type: "PDF" },
            { name: "IT Security Guidelines v2.1", category: "Security", categoryClass: "sec", date: "Mar 02, 2023", type: "PDF" },
            { name: "Expense Reimbursement Form", category: "Finance", categoryClass: "fin", date: "Jun 10, 2023", type: "Excel" },
            { name: "Code of Conduct", category: "HR Policy", categoryClass: "hr", date: "Jan 15, 2023", type: "PDF" }
        ]
    });
});

module.exports = router;
