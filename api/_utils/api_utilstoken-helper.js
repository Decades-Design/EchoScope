// /api/_utils/token-helper.js
const axios = require('axios');
const cookie = require('cookie');

/**
 * Uses a refresh token to get a new access token and refresh token from Navigraph.
 * @param {string} refreshToken - The refresh token from the user's cookie.
 * @returns {object} An object containing { newAccessToken, newRefreshToken, newExpiresIn }.
 */
async function refreshAccessToken(refreshToken) {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.NAVIGRAPH_CLIENT_ID);
    params.append('client_secret', process.env.NAVIGRAPH_CLIENT_SECRET);
    params.append('refresh_token', refreshToken);

    const response = await axios.post('https://identity.navigraph.com/connect/token', params);
    
    const { access_token, refresh_token, expires_in } = response.data;
    
    // VERY IMPORTANT: Log this for debugging, especially the new refresh token.
    console.log("Successfully refreshed tokens. New refresh token received.");

    return {
      newAccessToken: access_token,
      newRefreshToken: refresh_token,
      newExpiresIn: expires_in
    };
  } catch (error) {
    console.error('CRITICAL: Token refresh failed.', error.response ? error.response.data : error.message);
    // If the refresh fails, we throw an error. This will force the user to log in again.
    throw new Error('Could not refresh token.');
  }
}

/**
 * Creates the Set-Cookie headers for the browser.
 * @param {string} accessToken - The new access token.
 * @param {string} refreshToken - The new refresh token.
 * @param {number} expiresIn - The expiration time for the access token.
 * @returns {Array<string>} An array of cookie strings.
 */
function createAuthCookies(accessToken, refreshToken, expiresIn) {
    return [
      cookie.serialize('access_token', accessToken, { httpOnly: true, secure: true, path: '/', maxAge: expiresIn }),
      cookie.serialize('refresh_token', refreshToken, { httpOnly: true, secure: true, path: '/' })
    ];
}

module.exports = { refreshAccessToken, createAuthCookies };