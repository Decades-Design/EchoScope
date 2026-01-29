// In js/navDatabase.js

import { minLon, maxLon, minLat, maxLat } from './utils.js';
import { setNavData, drawNavData } from './mapRenderer.js';

export async function loadNavData(navCtx, navdataCanvas) {
  console.log('Requesting navigation data from backend...');

  // Build common query params for spatial queries
  const params = new URLSearchParams({
    minLon: String(minLon),
    maxLon: String(maxLon),
    minLat: String(minLat),
    maxLat: String(maxLat),
  });

  const fetchOpts = { credentials: 'same-origin' };

  try {
    // Fetch primary datasets in parallel
    const [navRes, airportsRes, vorsRes, termWpRes, runwaysRes, ilsRes] = await Promise.all([
      fetch(`/api/data/navpoints?${params.toString()}`, fetchOpts),
      fetch(`/api/data/airports?${params.toString()}`, fetchOpts),
      fetch(`/api/data/vors?${params.toString()}`, fetchOpts),
      fetch(`/api/data/terminalWaypoints?${params.toString()}`, fetchOpts),
      fetch(`/api/data/runways?${params.toString()}`, fetchOpts),
      fetch(`/api/data/ils?${params.toString()}`, fetchOpts),
    ]);

    // Handle auth/subscription errors uniformly
    const responses = [navRes, airportsRes, vorsRes, termWpRes, runwaysRes, ilsRes];
    for (const r of responses) {
      if (r.status === 401) {
        console.log('Not authenticated. Redirecting to login.');
        window.location.href = '/api/auth/login';
        return;
      }
      if (r.status === 403) {
        throw new Error('User does not have an active FMS Data subscription.');
      }
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Backend error: ${r.status} ${text}`);
      }
    }

    const [navPoints, airports, vors, terminalWaypoints, runways, ils] = await Promise.all(
      responses.map(r => r.json())
    );

    // Request approachPaths based on airports' ICAOs
    let approachPaths = [];
    try {
      const icaoList = airports.map(a => a.icao).filter(Boolean);
      if (icaoList.length) {
        const apParams = new URLSearchParams();
        apParams.set('airports', icaoList.join(','));
        const apRes = await fetch(`/api/data/approachPaths?${apParams.toString()}`, fetchOpts);
        if (apRes.status === 401) { window.location.href = '/api/auth/login'; return; }
        if (apRes.ok) approachPaths = await apRes.json();
      }
    } catch (e) {
      console.warn('Failed to load approach paths:', e);
    }

    const navData = {
      navDataPoints: navPoints,
      airports: airports,
      vorData: vors,
      terminalWaypoints: terminalWaypoints,
      runways: runways,
      ilsData: ils,
      approachPaths: approachPaths,
    };

    setNavData(navData);
    drawNavData(navCtx, navdataCanvas);
    console.log('Navigation data loaded and rendered.');

    return navData;

  } catch (err) {
    console.error('Failed to load navigation data:', err);
    // Optionally render an error state on the canvas
    return {
      navDataPoints: [],
      airports: [],
      vorData: [],
      terminalWaypoints: [],
      runways: [],
      ilsData: [],
      approachPaths: []
    };
  }
}