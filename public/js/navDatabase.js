// In js/navDatabase.js

import { setNavData, drawNavData } from './mapRenderer.js';

// Helper function for polling
const poll = (fn, ms) => {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            try {
                const result = await fn();
                if (result.status === 'complete') {
                    clearInterval(interval);
                    resolve(result);
                } else if (result.status === 'failed') {
                    clearInterval(interval);
                    reject(new Error('Package generation failed.'));
                }
                // If status is 'pending', do nothing and wait for the next interval
            } catch (error) {
                clearInterval(interval);
                reject(error);
            }
        }, ms);
    });
};


export async function loadNavData(navCtx, navdataCanvas) {
  console.log("Requesting Navigraph data package...");

  try {
    // Step 1: Request the package for the airports you need
    const requestResponse = await fetch('/api/navdata/request-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icaos: ["LIML", "LIMC"] }) // Specify your airports
    });
    
    // Handle auth errors - maybe the access token expired
    if (requestResponse.status === 401) {
        console.log("Not authenticated. Redirecting to login.");
        window.location.href = '/api/auth/login';
        return;
    }
    if (!requestResponse.ok) throw new Error('Failed to request package.');

    const { package_id } = await requestResponse.json();
    console.log(`Package requested successfully. ID: ${package_id}`);


    // Step 2: Poll the check-package endpoint until the status is 'complete'
    console.log("Waiting for package to be generated...");
    const checkFn = () => fetch(`/api/navdata/check-package?id=${package_id}`).then(res => res.json());
    const finalPackage = await poll(checkFn, 5000); // Poll every 5 seconds
    console.log(`Package is complete. Download URL received.`);


    // Step 3: Fetch the database file from the signed URL
    const dbResponse = await fetch(finalPackage.download_url);
    if (!dbResponse.ok) throw new Error('Failed to download the database file.');
    const filebuffer = await dbResponse.arrayBuffer();
    console.log("Database file downloaded.");


    // Step 4: Load the downloaded database into SQL.js (This part is mostly your existing code)
    const SQL = await initSqlJs({ locateFile: () => '../libs/sql-wasm.wasm' });
    const dbObject = new SQL.Database(new Uint8Array(filebuffer));
    
    // ... all your 'queryAndMap' calls would go here, unchanged ...
    // const navData = { airports: queryAndMap(...) };
    
    console.log("Database loaded and parsed successfully.");
    // setNavData(navData);
    // drawNavData(navCtx, navdataCanvas);
    // return navData;

  } catch (err) {
    console.error("Failed to load Navigraph data:", err);
  }
}