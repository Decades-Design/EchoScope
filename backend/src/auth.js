// src/auth.js
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { createAuthCookies } = require('./token-helper');

const router = express.Router();

function base64URLEncode(str) {
    return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest();
}

// LOGIN ROUTE
router.get('/login', (req, res) => {
    const code_verifier = base64URLEncode(crypto.randomBytes(32));
    const state = base64URLEncode(crypto.randomBytes(16));
    const code_challenge = base64URLEncode(sha256(code_verifier));

    // Store verifier/state in cookies (15 mins)
    res.cookie('auth_code_verifier', code_verifier, { httpOnly: true, secure: true, maxAge: 900000 });
    res.cookie('auth_state', state, { httpOnly: true, secure: true, maxAge: 900000 });

    const authUrl = new URL('https://identity.navigraph.com/connect/authorize');
    authUrl.searchParams.set('client_id', process.env.NAVIGRAPH_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set('scope', 'openid offline_access fmsdata');
    
    // IMPORTANT: This must match your Vercel URL + /api/auth/callback
    // because Vercel is proxying the traffic.
    authUrl.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/auth/callback`);
    
    authUrl.searchParams.set('code_challenge', code_challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    res.redirect(authUrl.toString());
});

// CALLBACK ROUTE
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies.auth_state;
    const codeVerifier = req.cookies.auth_code_verifier;

    if (!state || state !== storedState) return res.status(400).send('State mismatch.');

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append("redirect_uri", `${process.env.APP_URL}/api/auth/callback`);
        params.append('client_id', process.env.NAVIGRAPH_CLIENT_ID);
        params.append('client_secret', process.env.NAVIGRAPH_CLIENT_SECRET);
        params.append('code_verifier', codeVerifier);

        const response = await axios.post('https://identity.navigraph.com/connect/token', params);
        const { access_token, refresh_token, expires_in } = response.data;

        // Helper function from token-helper.js to generate cookie array
        const cookieArgs = createAuthCookies(access_token, refresh_token, expires_in);
        
        // Express-style cookie setting
        // Note: createAuthCookies returns strings used for Set-Header, 
        // simpler here to just set them directly in Express:
        res.cookie('access_token', access_token, { httpOnly: true, secure: true, maxAge: expires_in * 1000 });
        res.cookie('refresh_token', refresh_token, { httpOnly: true, secure: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

        res.redirect('/'); // Back to Vercel Frontend
    } catch (error) {
        console.error('Auth Error:', error.message);
        res.status(500).send('Authentication failed');
    }
});

module.exports = router;