// /api/navdata/request-package.js
const axios = require('axios');
const cookie = require('cookie');
// Import our new helper functions
const { refreshAccessToken, createAuthCookies } = require('../_utils/token-helper');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const cookies = cookie.parse(req.headers.cookie || '');
    let accessToken = cookies.access_token;
    const refreshToken = cookies.refresh_token;

    // A user must have a refresh token to proceed.
    if (!refreshToken) {
        return res.status(401).json({ error: 'Not authenticated. No refresh token found.' });
    }
    // If they have no access token, we can try to refresh immediately.
    if (!accessToken) {
        try {
            const { newAccessToken, newRefreshToken, newExpiresIn } = await refreshAccessToken(refreshToken);
            accessToken = newAccessToken; // Update the access token for the current request
            // We will set the cookies on the final successful response.
            res.setHeader('Set-Cookie', createAuthCookies(newAccessToken, newRefreshToken, newExpiresIn));
        } catch (error) {
            // If the immediate refresh fails, they are truly unauthenticated.
            return res.status(401).json({ error: 'Authentication failed during token refresh.' });
        }
    }
    
    try {
        // --- PRIMARY ATTEMPT ---
        const navResponse = await axios.post(
            'https://api.navigraph.com/v1/navdata/packages',
            req.body,
            { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );

        res.status(202).json({ package_id: navResponse.data.package_id });

    } catch (error) {
        // Check if the error is a 401 Unauthorized
        if (error.response && error.response.status === 401) {
            console.log('Access token expired. Attempting refresh...');
            try {
                // --- REFRESH AND RETRY ---
                const { newAccessToken, newRefreshToken, newExpiresIn } = await refreshAccessToken(refreshToken);

                // Retry the original request with the new access token
                const retryResponse = await axios.post(
                    'https://api.navigraph.com/v1/navdata/packages',
                    req.body,
                    { headers: { 'Authorization': `Bearer ${newAccessToken}`, 'Content-Type': 'application/json' } }
                );

                // IMPORTANT: Send the new tokens back to the browser with the successful response
                res.setHeader('Set-Cookie', createAuthCookies(newAccessToken, newRefreshToken, newExpiresIn));
                res.status(202).json({ package_id: retryResponse.data.package_id });
                
            } catch (refreshError) {
                // If the refresh attempt itself fails
                res.status(401).json({ error: 'Authentication failed. Please log in again.' });
            }
        } else {
            // For any other error (500, etc.), send it back
            console.error('Error requesting Navigraph package:', error.response ? error.response.data : error.message);
            res.status(500).json({ error: 'Failed to request Navigraph data package.' });
        }
    }
};