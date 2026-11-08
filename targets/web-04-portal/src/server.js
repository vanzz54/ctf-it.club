const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Disable ETag to prevent 304 Not Modified responses (so participants always see the full JSON in Network Tab)
app.disable('etag');

// Middleware
app.use(cors());
app.use(express.json()); // Parsing JSON for Mass Assignment vulnerability
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // Serve frontend

// Routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const employeeRoutes = require('./routes/employees');
const contentRoutes = require('./routes/content');

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/content', contentRoutes);

// Fallback to index.html for frontend routing or generic views
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
