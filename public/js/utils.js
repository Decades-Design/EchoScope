// js/utils.js

import { centerCoord, radarRangeNM } from './config.js';

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
    const radarRangeKm = radarRangeNM * NM_TO_KM;
    const centerLatRad = centerCoord.lat * Math.PI / 180;
    const latDelta = radarRangeKm / 111.32;
    const lonDelta = radarRangeKm / (111.32 * Math.cos(centerLatRad));
    minLat = centerCoord.lat - latDelta;
    maxLat = centerCoord.lat + latDelta;
    minLon = centerCoord.lon - lonDelta;
    maxLon = centerCoord.lon + lonDelta;
}

// Explicitly set bounds (used when user selects an airport)
export function setGeographicBounds(bounds) {
    if (!bounds) return;
    minLon = bounds.minLon;
    maxLon = bounds.maxLon;
    minLat = bounds.minLat;
    maxLat = bounds.maxLat;
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

export function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Calculates the cross-track error (distance from a line)
 * @param {number} lat - Current Latitude
 * @param {number} lon - Current Longitude
 * @param {number} startLat - Runway Threshold Lat
 * @param {number} startLon - Runway Threshold Lon
 * @param {number} bearing - The Localizer Bearing (Degrees)
 * @returns {number} Distance from centerline in KM (positive = right of track)
 */
export function calculateCrossTrackError(lat, lon, startLat, startLon, bearing) {
    const R = 6371; // Earth's radius in km
    const d13 = calculateDistance(startLat, startLon, lat, lon);
    const brng13 = calculateBearing(startLat, startLon, lat, lon) * Math.PI / 180;
    const brng12 = bearing * Math.PI / 180;
    
    // Standard cross-track distance formula
    return Math.asin(Math.sin(d13 / R) * Math.sin(brng13 - brng12)) * R;
}
