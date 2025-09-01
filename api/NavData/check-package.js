// /api/navdata/check-package.js
const axios = require('axios');
const cookie = require('cookie');

module.exports = async (req, res) => {
    const cookies = cookie.parse(req.headers.cookie || '');
    const accessToken = cookies.access_token;

    if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    // The package_id is passed as a query parameter
    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Package ID is required.' });
    }

    try {
        // First, check the status of the package
        const statusResponse = await axios.get(`https://api.navigraph.com/v1/navdata/packages/${id}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const package_status = statusResponse.data.status;

        // If it's not complete, just return the status
        if (package_status !== 'complete') {
            return res.status(200).json({ status: package_status });
        }

        // If it IS complete, get the download URL
        const downloadResponse = await axios.get(`https://api.navigraph.com/v1/navdata/packages/${id}/download`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        // And return the status AND the URL
        res.status(200).json({
            status: 'complete',
            download_url: downloadResponse.data.url
        });

    } catch (error) {
        console.error('Error checking package status:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to check package status.' });
    }
};