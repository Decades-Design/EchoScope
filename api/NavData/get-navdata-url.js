// /api/navdata/get-navdata-url.js
const axios = require('axios');
const cookie = require('cookie');
const { refreshAccessToken, createAuthCookies, validateFmsDataSubscription } = require('../utils/token-helper');

module.exports = async (req, res) => {
    // Boilerplate: get tokens, handle refresh
    const cookies = cookie.parse(req.headers.cookie || ''); 
    let accessToken = cookies.access_token;
    const refreshToken = cookies.refresh_token;

    console.log("Received request for Navigraph navdata URL.");

    let package_status = null; // e.g. 'current', 'outdated'

    if (!refreshToken) {
        return res.status(401).json({ error: 'Not authenticated. No refresh token found.' });
    }

    if (!accessToken) {
        try {
            const tokens = await refreshAccessToken(refreshToken, res);
            
            if (!tokens) {
                return;
            }
            
            accessToken = tokens.newAccessToken;
        } catch (error) {
            // This catch block will now only catch unexpected errors
            return res.status(500).json({ error: 'An unexpected error occurred during token refresh.' });
        }
    }

    // Boilerplate: Validate subscription
    const subscription = await validateFmsDataSubscription(accessToken);
    if (!subscription.ActiveSubscription) {
        package_status = 'outdated';
    } else if (subscription.type === 'fmsdata' && subscription.ActiveSubscription) {
        package_status = 'current';
    }
    
    try {
        // --- PRIMARY ATTEMPT ---
        const navResponse = await axios.get(
            'https://api.navigraph.com/v1/navdata/packages',
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        
        // Find the current package. Based on your request for JSON, we will look for a format
        // that is likely a zip file. Let's assume a format key like 'ndac_json' or similar exists.
        // We prioritize the 'current' cycle.
        const packages = navResponse.data;
        const currentPackage = packages.find(p => p.package_status === 'current');

        if (!currentPackage || !currentPackage.files || currentPackage.files.length === 0) {
            throw new Error('No current navdata package found in the response.');
        }

        // The download URL is directly in the response
        const downloadUrl = currentPackage.files[0].signed_url;
        res.status(200).json({ download_url: downloadUrl });

    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.log('Access token expired. Attempting refresh...');
            try {
                // --- REFRESH AND RETRY ---
                const tokens = await refreshAccessToken(refreshToken, res);
                const retryResponse = await axios.get(
                    'https://api.navigraph.com/v1/navdata/packages',
                    { headers: { 'Authorization': `Bearer ${tokens.newAccessToken}` } }
                );
                
                const packages = retryResponse.data;
                const currentPackage = packages.find(p => p.package_status === 'current');
                if (!currentPackage || !currentPackage.files || currentPackage.files.length === 0) {
                    throw new Error('No current navdata package found after retry.');
                }
                const downloadUrl = currentPackage.files[0].signed_url;

                res.status(200).json({ download_url: downloadUrl });
                
            } catch (refreshError) {
                res.status(401).json({ error: 'Authentication failed. Please log in again.' });
            }
        } else {
            console.error('Error fetching Navigraph packages:', error.response ? error.response.data : error.message);
            res.status(500).json({ error: 'Failed to fetch Navigraph packages.' });
        }
    }
};