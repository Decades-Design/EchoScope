require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const authRoutes = require('./src/auth');
const { updateNavData } = require('./src/navdata-manager');
const { initSessionStore, getSession, updateSessionTokens } = require('./src/session-store');
const { validateFmsDataSubscription, refreshNavigraphToken } = require('./src/token-helper');

const app = express();
const PORT = 3000;

app.use(cookieParser());
app.use(express.json());

// Auth Routes
app.use('/api/auth', authRoutes);

// Database Connection Helper
async function getNavDB(filename) {
    return open({
        filename: path.join(__dirname, 'data', filename),
        driver: sqlite3.Database
    });
}

// MAIN DATA ENDPOINT
const handleDataRequest = async (req, res) => {
    const sessionId = req.cookies.session_id;

    if (!sessionId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    // 1. Look up user in local DB
    const session = await getSession(sessionId);
    if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    let { access_token, refresh_token, expires_at } = session;

    // 2. Check if Access Token is expired
    if (Date.now() > expires_at) {
        console.log('Access token expired. Refreshing on backend...');
        const newTokens = await refreshNavigraphToken(refresh_token);
        
        if (!newTokens.success) {
            return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }

        // Update DB with new tokens
        await updateSessionTokens(sessionId, newTokens.access_token, newTokens.refresh_token, newTokens.expires_in);
        access_token = newTokens.access_token;
    }

    // 3. Check Subscription
    const sub = await validateFmsDataSubscription(access_token);
    
    // 4. Select Database
    const dbFileName = (sub.active) ? 'current.sqlite' : 'outdated.sqlite';

    try {
        const db = await getNavDB(dbFileName);
        
        let result;
        const { type, ident } = req.params;

        // Query Logic
        if (type === 'airport') {
            result = await db.get('SELECT * FROM airports WHERE ident = ?', ident);
        } else if (type === 'navaid') {
             result = await db.get('SELECT * FROM navaids WHERE ident = ?', ident);
        }
        
        await db.close();
        
        if (!result) return res.status(404).json({ error: 'Not found' });
        res.json(result);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
};
// --- REGISTER THE ROUTES SEPARATELY ---
// Route 1: With an ID (e.g., /api/data/airport/EGLL)
app.get('/api/data/:type/:ident', handleDataRequest);

// Route 2: Without an ID (if you ever need to list all items)
app.get('/api/data/:type', handleDataRequest);


// Initialize and Start
(async () => {
    await initSessionStore(); // Ensure session DB is ready
    
    // Run NavData Update immediately on startup if missing
    updateNavData();

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    // Schedule Cron: Run at 02:00 AM every day
    cron.schedule('0 2 * * *', () => {
        updateNavData();
    });
})();