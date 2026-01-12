// In js/navDatabase.js

import { setNavData, drawNavData } from './mapRenderer.js';

export async function loadNavData(navCtx, navdataCanvas) {
  console.log("Requesting Navigraph data URL...");

  try {
    // Step 1: Request the download URL from our new single backend endpoint.
    const urlResponse = await fetch('../../api/NavData/get-navdata-url.js');
    
    if (urlResponse.status === 401) {
        console.log("Not authenticated. Redirecting to login.");
        window.location.href = '/api/auth/login';
        return;
    }
    if (urlResponse.status === 403) {
        throw new Error('User does not have an active subscription.');
    }
    if (!urlResponse.ok) {
        throw new Error('Failed to get download URL from backend.');
    }

    const { download_url } = await urlResponse.json();
    console.log(`Download URL received successfully.`);

    // Step 2: Fetch the database file from the signed URL.
    const dbResponse = await fetch(download_url);
    if (!dbResponse.ok) throw new Error('Failed to download the data file.');
    
    // --- IMPORTANT: Handling the JSON Data ---
    // The file is a zip archive. We need to handle that now instead of a direct SQLite file.
    // This will require a library like JSZip. You would add it to your index.html.
    
    console.log("Data file (zip) downloaded.");
    // const blob = await dbResponse.blob();
    // const jszip = new JSZip();
    // const zip = await jszip.loadAsync(blob);
    //
    // const airportsText = await zip.file("airports.json").async("string");
    // const airports = JSON.parse(airportsText);
    //
    // console.log("Airports loaded from JSON:", airports);

    // Your existing SQL.js logic would be replaced with parsing for each JSON file you need.
    // For now, we'll stop here to confirm the download works.
    console.log("Data loading process complete.");

  } catch (err) {
    console.error("Failed to load Navigraph data:", err);
    // Display an error to the user on the canvas
  }
}