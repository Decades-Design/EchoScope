const axios = require('axios');
const { put } = require('@vercel/blob');
const { Readable } = require('stream');

/**
 * Gets an access token for the backend client itself.
 */
async function getBackendAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.NAVIGRAPH_CLIENT_ID);
  params.append('client_secret', process.env.NAVIGRAPH_CLIENT_SECRET);
  params.append('scope', 'fmsdata');

  const response = await axios.post('https://identity.navigraph.com/connect/token', params);
  return response.data.access_token;
}

/**
 * Gets the download URL for the latest SQLite navdata package.
 */
async function getNavdataDownloadUrls(accessToken) {
  const response = await axios.get('https://api.navigraph.com/v1/navdata/packages', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  const allPackages = response.data;

  // Find the current package
  const currentPackage = allPackages.find(p => p.package_status === 'current' && p.format === 'dfd_sqlite');
  // Find the outdated package (this should always be available)
  const outdatedPackage = allPackages.find(p => p.package_status === 'outdated' && p.format === 'dfd_sqlite');

  if (!currentPackage || !currentPackage.files || currentPackage.files.length === 0) {
    throw new Error('Could not find the "current" SQLite navdata package.');
  }
  if (!outdatedPackage || !outdatedPackage.files || outdatedPackage.files.length === 0) {
    throw new Error('Could not find the "outdated" SQLite navdata package.');
  }

  // Return both URLs
  return {
    currentUrl: currentPackage.files[0].signed_url,
    outdatedUrl: outdatedPackage.files[0].signed_url,
  };
}

async function downloadAndStorePackage(url, blobPath) {
    console.log(`Downloading package for: ${blobPath}...`);
    const fileResponse = await axios.get(url, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(fileResponse.data);
    console.log(`Downloaded ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB.`);
    
    const blob = await put(blobPath, fileBuffer, {
      access: 'public',
      contentType: 'application/x-sqlite3'
    });
    console.log(`Successfully uploaded to Vercel Blob: ${blob.url}`);
    return blob;
}

export default async function handler(request, response) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return response.status(401).json({ message: 'Unauthorized' });
  }

  try {
    console.log("Cron job started: Updating BOTH current and outdated Navigraph navdata.");

    const accessToken = await getBackendAccessToken();
    console.log("Backend access token obtained.");

    const { currentUrl, outdatedUrl } = await getNavdataDownloadUrls(accessToken);
    console.log("Both current and outdated navdata download URLs obtained.");

    // --- MODIFIED LOGIC: Download and store both files in parallel ---
    const [currentBlob, outdatedBlob] = await Promise.all([
        downloadAndStorePackage(currentUrl, 'navdata/current_cycle.sqlite'),
        downloadAndStorePackage(outdatedUrl, 'navdata/outdated_cycle.sqlite')
    ]);

    return response.status(200).json({
      success: true,
      message: 'Both navdata packages updated successfully.',
      blobs: {
        current: currentBlob.url,
        outdated: outdatedBlob.url
      }
    });

  } catch (error) {
    console.error('Cron job failed:', error.response ? error.response.data : error.message);
    return response.status(500).json({ success: false, message: 'Cron job failed.' });
  }
}