// src/token-helper.js
const axios = require('axios');
const { createVerifier } = require('fast-jwt');
const GetJwks = require('get-jwks');
const buildJwksGetter = GetJwks.default || GetJwks;

// 1. Setup JWKS Getter
// This fetches Navigraph's public keys and caches them for 1 hour
const jwks = buildJwksGetter({
  jwksPath: '/.well-known/jwks',
  ttl: 60 * 60 * 1000, // 1 hour
});

// 2. Setup JWT Verifier
// This verifies the token signature locally using the public keys
const verifyJwt = createVerifier({
  algorithms: ["RS256"],
  cache: 1000,
  cacheTTL: 60 * 60 * 1000,
  key: async (decoded) => {
    // Fetch the key matching the token's header from Navigraph
    return jwks.getPublicKey({
      kid: decoded.header.kid,
      alg: decoded.header.alg,
      domain: "https://identity.api.navigraph.com",
    });
  },
});


//Refreshes the Access Token using the Refresh Token.
async function refreshNavigraphToken(refreshToken) {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.NAVIGRAPH_CLIENT_ID);
    params.append('client_secret', process.env.NAVIGRAPH_CLIENT_SECRET);
    params.append('refresh_token', refreshToken);

    const response = await axios.post('https://identity.navigraph.com/connect/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    return {
      success: true,
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in
    };
  } catch (error) {
    console.error('Token refresh failed:', error.response?.data || error.message);
    return { success: false };
  }
}

/**
 * Validates the subscription by verifying the JWT Token signature 
 * and checking the 'subscriptions' claim array.
 */
async function validateFmsDataSubscription(accessToken) {
  if (!accessToken) return { active: false };

  try {
    // 1. Verify the signature and expiration locally
    // If the token is fake or expired, this will throw an error immediately.
    const payload = await verifyJwt(accessToken);

    // 2. Check the 'subscriptions' array in the payload
    // Navigraph sends an array like: ["charts", "fmsdata"]
    const subs = payload.subscriptions || [];

    const hasUltimate = subs.includes("charts");
    const hasFmsData = subs.includes("fmsdata");

    if (hasUltimate || hasFmsData) {
      return { active: true, type: 'fmsdata' };
    }

    console.log("User logged in but has no active FMS Data subscription.");
    return { active: false };

  } catch (error) {
    // This catches expired tokens, invalid signatures, or network errors fetching keys
    console.error("JWT Verification failed:", error.message);
    return { active: false };
  }
}

module.exports = { refreshNavigraphToken, validateFmsDataSubscription };