require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const authRoutes = require('./src/auth');
const { updateNavData } = require('./src/navdata-manager');
const { validateFmsDataSubscription, refreshAccessToken } = require('./src/token-helper');

const app = express();
const PORT = 3000;

app.use(cookieParser());
app.use(express.json());

// Auth Routes
app.use('/api/auth', authRoutes);

// Database Connection Helper
async function getDbConnection(filename) {
    return open({
        filename: path.join(__dirname, 'data', filename),
        driver: sqlite3.Database
    });
}

/**
 * MAIN DATA ENDPOINT
 * Instead of downloading the file, the Frontend asks for data (e.g., /api/data/airport/EGLL)
 */
app.get('/api/data/:type/:ident?', async (req, res) => {
    let accessToken = req.cookies.access_token;
    const refreshToken = req.cookies.refresh_token;

    if (!accessToken && !refreshToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    // Refresh Token Logic (Simplified)
    if (!accessToken && refreshToken) {
        const tokens = await refreshAccessToken(refreshToken, res);
        if (tokens) accessToken = tokens.newAccessToken;
        else return res.status(401).json({ error: 'Session expired' });
    }

    // Check Subscription
    const sub = await validateFmsDataSubscription(accessToken);
    
    // Select Database based on Subscription
    const dbFileName = (sub.ActiveSubscription && sub.type === 'fmsdata') 
        ? 'current.sqlite' 
        : 'outdated.sqlite';

    try {
        const db = await getDbConnection(dbFileName);
        
        // Example: Query the DB
        // You can expand this switch case for different data types
        let result;
        const { type, ident } = req.params;

        if (type === 'airport') {
            result = await db.get('SELECT * FROM airports WHERE ident = ?', ident);
        } else if (type === 'navaid') {
             result = await db.get('SELECT * FROM navaids WHERE ident = ?', ident);
        }
        
        await db.close();
        res.json(result);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Run NavData Update immediately on startup
    updateNavData();

    // Schedule Cron: Run at 02:00 AM every day
    cron.schedule('0 2 * * *', () => {
        updateNavData();
    });
});