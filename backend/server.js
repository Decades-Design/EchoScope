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
        const { type, ident } = req.params;

        // Support richer nav queries inspired by client-side `navDatabase.js`.
        // Expected query params for spatial queries: minLon,maxLon,minLat,maxLat
        const minLon = parseFloat(req.query.minLon);
        const maxLon = parseFloat(req.query.maxLon);
        const minLat = parseFloat(req.query.minLat);
        const maxLat = parseFloat(req.query.maxLat);

        const hasBounds = [minLon, maxLon, minLat, maxLat].every(v => Number.isFinite(v));

        let rows;

        switch (type) {
            case 'navpoints':
                if (!hasBounds) return res.status(400).json({ error: 'Missing bounding box' });
                rows = await db.all(
                    `SELECT * FROM main.tbl_enroute_waypoints WHERE waypoint_longitude BETWEEN ? AND ? AND waypoint_latitude BETWEEN ? AND ? AND waypoint_identifier NOT LIKE 'VP%' AND waypoint_type != 'U'`,
                    [minLon, maxLon, minLat, maxLat]
                );
                break;

            case 'airports':
                if (!hasBounds) return res.status(400).json({ error: 'Missing bounding box' });
                rows = await db.all(
                    `SELECT * FROM tbl_airports WHERE airport_ref_longitude BETWEEN ? AND ? AND airport_ref_latitude BETWEEN ? AND ? AND ifr_capability = 'Y'`,
                    [minLon, maxLon, minLat, maxLat]
                );
                break;

            case 'vors':
                if (!hasBounds) return res.status(400).json({ error: 'Missing bounding box' });
                rows = await db.all(
                    `SELECT * FROM main.tbl_vhfnavaids WHERE vor_longitude BETWEEN ? AND ? AND vor_latitude BETWEEN ? AND ? AND navaid_class LIKE 'V%'`,
                    [minLon, maxLon, minLat, maxLat]
                );
                break;

            case 'terminalWaypoints':
                if (!hasBounds) return res.status(400).json({ error: 'Missing bounding box' });
                rows = await db.all(
                    `SELECT * FROM tbl_terminal_waypoints WHERE waypoint_longitude BETWEEN ? AND ? AND waypoint_latitude BETWEEN ? AND ? AND waypoint_identifier NOT LIKE 'VP%'`,
                    [minLon, maxLon, minLat, maxLat]
                );
                break;

            case 'runways':
                if (!hasBounds) return res.status(400).json({ error: 'Missing bounding box' });
                rows = await db.all(
                    `SELECT * FROM tbl_runways WHERE runway_longitude BETWEEN ? AND ? AND runway_latitude BETWEEN ? AND ?`,
                    [minLon, maxLon, minLat, maxLat]
                );
                break;

            case 'ils':
                if (!hasBounds) return res.status(400).json({ error: 'Missing bounding box' });
                rows = await db.all(
                    `SELECT * FROM tbl_localizers_glideslopes WHERE llz_longitude BETWEEN ? AND ? AND llz_latitude BETWEEN ? AND ?`,
                    [minLon, maxLon, minLat, maxLat]
                );
                break;

            case 'approachPaths':
                // expects `airports` query param as comma-separated ICAO list
                if (!req.query.airports) {
                    await db.close();
                    return res.status(400).json({ error: 'Missing airports parameter' });
                }
                const icaos = req.query.airports.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                if (icaos.length === 0) {
                    await db.close();
                    return res.status(400).json({ error: 'Empty airports list' });
                }
                // Build placeholders
                const placeholders = icaos.map(() => '?').join(',');
                rows = await db.all(`SELECT * FROM tbl_iaps WHERE airport_identifier IN (${placeholders})`, icaos);
                break;

            case 'airport':
            case 'navaid':
                // keep compatibility with original single-item endpoints
                if (!ident) {
                    const table = (type === 'airport') ? 'airports' : 'navaids';
                    rows = await db.all(`SELECT * FROM ${table}`);
                } else {
                    const table = (type === 'airport') ? 'airports' : 'navaids';
                    const row = await db.get(`SELECT * FROM ${table} WHERE ident = ?`, ident);
                    await db.close();
                    if (!row) return res.status(404).json({ error: 'Not found' });
                    return res.json(row);
                }
                break;

            default:
                await db.close();
                return res.status(400).json({ error: 'Invalid type' });
        }

        await db.close();
        return res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
};
// --- REGISTER THE ROUTES SEPARATELY ---
// Route 1: With an ID (e.g., /api/data/airport/EGLL)
app.get('/api/data/:type/:ident', handleDataRequest);

// Route 2: Without an ID
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