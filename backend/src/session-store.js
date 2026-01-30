// src/session-store.js
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/sessions.db');

let db;

// Initialize Session Database
async function initSessionStore() {
    // Ensure the data directory exists before opening the DB
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Create table if it doesn't exist
    await db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            access_token TEXT,
            refresh_token TEXT,
            expires_at INTEGER
        )
    `);
    console.log('Session store initialized.');
}

// Create a new session or update existing
async function createSession(access_token, refresh_token, expires_in) {
    const session_id = uuidv4();
    const expires_at = Date.now() + (expires_in * 1000);

    await db.run(
        `INSERT INTO sessions (session_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)`,
        [session_id, access_token, refresh_token, expires_at]
    );

    return session_id;
}

// Retrieve tokens by session ID
async function getSession(session_id) {
    return await db.get('SELECT * FROM sessions WHERE session_id = ?', session_id);
}

// Update tokens for an existing session (used during refresh)
async function updateSessionTokens(session_id, access_token, refresh_token, expires_in) {
    const expires_at = Date.now() + (expires_in * 1000);
    await db.run(
        `UPDATE sessions SET access_token = ?, refresh_token = ?, expires_at = ? WHERE session_id = ?`,
        [access_token, refresh_token, expires_at, session_id]
    );
}

// Delete session (Logout)
async function deleteSession(session_id) {
    await db.run('DELETE FROM sessions WHERE session_id = ?', session_id);
}

/**
 * Deletes all sessions where the 'expires_at' timestamp is in the past.
 * Returns the number of deleted rows.
 */
async function cleanupExpiredSessions() {
    const now = Date.now();
    
    // Run the DELETE query
    const result = await db.run('DELETE FROM sessions WHERE expires_at < ?', now);
    
    // Optional: Run VACUUM to actually reclaim the disk space from the file system
    // (SQLite doesn't shrink the file size automatically without this)
    await db.run('VACUUM');
    
    return result.changes; // Returns count of deleted rows
}

module.exports = { initSessionStore, createSession, getSession, updateSessionTokens, deleteSession, cleanupExpiredSessions };