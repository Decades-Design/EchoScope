// src/navdata-manager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

async function downloadFile(url, filename) {
    const filePath = path.join(DATA_DIR, filename);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function updateNavData() {
    console.log('[NavData] Starting update check...');
    try {
        // 1. Client Credentials Flow (Get Token for Server)
        const tokenRes = await axios.post('https://identity.navigraph.com/connect/token', 
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: process.env.NAVIGRAPH_CLIENT_ID,
                client_secret: process.env.NAVIGRAPH_CLIENT_SECRET,
                scope: 'fmsdata'
            })
        );
        const accessToken = tokenRes.data.access_token;

        // 2. Get Package URLs
        const pkgRes = await axios.get('https://api.navigraph.com/v1/navdata/packages', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const currentPkg = pkgRes.data.find(p => p.package_status === 'current' && p.format === 'dfd_sqlite');
        const outdatedPkg = pkgRes.data.find(p => p.package_status === 'outdated' && p.format === 'dfd_sqlite');

        if (currentPkg) {
            console.log('[NavData] Downloading Current Cycle...');
            await downloadFile(currentPkg.files[0].signed_url, 'current.sqlite');
        }

        if (outdatedPkg) {
            console.log('[NavData] Downloading Outdated Cycle...');
            await downloadFile(outdatedPkg.files[0].signed_url, 'outdated.sqlite');
        }

        console.log('[NavData] Update complete.');

    } catch (error) {
        console.error('[NavData] Error updating:', error.message);
    }
}

module.exports = { updateNavData };