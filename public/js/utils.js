// js/utils.js

import { centerCoord, radarRangeNM } from './config.js';
import { size } from './main.js';

// GEOGRAPHICAL HELPERS & CONSTANTS
export const NM_TO_KM = 1.852;
export const KNOTS_TO_KPS = 0.000514444;
export const FEET_TO_KM = 0.0003048;

export let minLon, maxLon, minLat, maxLat;
export let kmPerPixel;

// This state is managed here but calculated by resizeCanvas in main.js
export function setKmPerPixel(value) {
    kmPerPixel = value;
}

export function calculateGeographicBounds() {
    setKmPerPixel((radarRangeNM * NM_TO_KM * 2) / size);
    
    const radarRangeKm = radarRangeNM * NM_TO_KM;
    const centerLatRad = centerCoord.lat * Math.PI / 180;
    const latDelta = radarRangeKm / 111.32;
    const lonDelta = radarRangeKm / (111.32 * Math.cos(centerLatRad));
    minLat = centerCoord.lat - latDelta;
    maxLat = centerCoord.lat + latDelta;
    minLon = centerCoord.lon - lonDelta;
    maxLon = centerCoord.lon + lonDelta;
}

export function pixelToLatLon(x, y, canvas) {
    const lon = (x / canvas.width) * (maxLon - minLon) + minLon;
    const lat = maxLat - (y / canvas.height) * (maxLat - minLat);
    return { lat, lon };
}

export function latLonToPixel(lat, lon, canvas) {
    const x = ((lon - minLon) / (maxLon - minLon)) * canvas.width;
    const y = ((maxLat - lat) / (maxLat - minLat)) * canvas.height;
    return { x, y };
}

/**
 * @summary Checks for the presence of the 'refresh_token' cookie.
 * @returns {boolean} True if the cookie exists, false otherwise.
 */
export function hasRefreshToken() {
  // document.cookie returns a single string of all cookies, e.g., "key=val; key2=val2"
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const trimmedCookie = cookie.trim();
    if (trimmedCookie.startsWith('refresh_token=')) {
      return true; // The cookie was found
    }
  }
  return false; // No such cookie was found
}

