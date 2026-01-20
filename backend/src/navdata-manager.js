// src/navdata-manager.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

// Ensure data directory exists (safe for nested paths)
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Load local metadata (what version do we currently have?)
 */
function loadMetadata() {
    if (!fs.existsSync(METADATA_FILE)) {
        return { current: null, outdated: null };
    }
    try {
        return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    } catch (e) {
        return { current: null, outdated: null };
    }
}

/**
 * Save metadata to disk
 */
function saveMetadata(data) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Helper to download a file stream
 */
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
        // Propagate stream errors from both response and writer
        response.data.on('error', err => {
            writer.destroy();
            reject(err);
        });

        writer.on('finish', resolve);
        writer.on('error', err => {
            // Ensure response stream is destroyed on writer error
            if (response.data && typeof response.data.destroy === 'function') response.data.destroy();
            reject(err);
        });
    });
}

/**
 * Main Update Function
 */
async function updateNavData() {
    console.log('[NavData] Checking for updates...');
    
    // 1. Load Local State
    const localMetadata = loadMetadata();
    let metadataUpdated = false;

    try {
        // 2. Get Access Token (Client Credentials)
        const tokenRes = await axios.post('https://identity.navigraph.com/connect/token', 
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: process.env.NAVIGRAPH_CLIENT_ID,
                client_secret: process.env.NAVIGRAPH_CLIENT_SECRET,
                scope: 'fmsdata'
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const accessToken = tokenRes.data.access_token;

        // 3. Get Available Packages from Navigraph
        const pkgRes = await axios.get('https://api.navigraph.com/v1/navdata/packages', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        // Normalize response: some API variants return an object with `.packages`
        const pkgList = Array.isArray(pkgRes.data) ? pkgRes.data : (pkgRes.data && pkgRes.data.packages) ? pkgRes.data.packages : [];

        // We are looking for the 'dfd_sqlite' format
        const apiPackages = {
            current: pkgList.find(p => p.package_status === 'current' && p.format === 'dfd_sqlite'),
            outdated: pkgList.find(p => p.package_status === 'outdated' && p.format === 'dfd_sqlite')
        };

        // 4. Process "Current" Cycle
        if (apiPackages.current) {
            const apiCycle = apiPackages.current.cycle;
            const apiRev = apiPackages.current.revision;
            
            // Check if we need to update
            const local = localMetadata.current;
            const needsUpdate = !local || local.cycle !== apiCycle || local.revision !== apiRev;

            if (needsUpdate) {
                console.log(`[NavData] New Current Cycle found: ${apiCycle} rev ${apiRev}. Downloading...`);
                await downloadFile(apiPackages.current.files[0].signed_url, 'current.sqlite');
                
                // Update Metadata Object
                localMetadata.current = { cycle: apiCycle, revision: apiRev };
                metadataUpdated = true;
                console.log('[NavData] Current Cycle updated successfully.');
            } else {
                console.log(`[NavData] Current Cycle is up to date (${local.cycle} r${local.revision}).`);
            }
        }

        // 5. Process "Outdated" Cycle
        if (apiPackages.outdated) {
            const apiCycle = apiPackages.outdated.cycle;
            const apiRev = apiPackages.outdated.revision;

            const local = localMetadata.outdated;
            const needsUpdate = !local || local.cycle !== apiCycle || local.revision !== apiRev;

            if (needsUpdate) {
                console.log(`[NavData] New Outdated Cycle found: ${apiCycle} rev ${apiRev}. Downloading...`);
                await downloadFile(apiPackages.outdated.files[0].signed_url, 'outdated.sqlite');

                // Update Metadata Object
                localMetadata.outdated = { cycle: apiCycle, revision: apiRev };
                metadataUpdated = true;
                console.log('[NavData] Outdated Cycle updated successfully.');
            } else {
                console.log(`[NavData] Outdated Cycle is up to date (${local.cycle} r${local.revision}).`);
            }
        }

        // 6. Save changes to disk
        if (metadataUpdated) {
            saveMetadata(localMetadata);
            console.log('[NavData] Metadata saved.');
        }

    } catch (error) {
        console.error('[NavData] Update failed:', error.response?.data || error.message);
    }
}

module.exports = { updateNavData };