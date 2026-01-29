// js/mapRenderer.js

import { activeAirports } from './config.js';
import { FEET_TO_KM, NM_TO_KM, kmPerPixel, latLonToPixel } from './utils.js';

// This module needs the nav data, which will be passed in from main.js
export let airports = [];
export let runways = [];
export let ilsData = [];
export let navDataPoints = [];
export let terminalWaypoints = [];
export let vorData = [];
export let approachPaths = [];
export let waypoints = []; // Consolidated list of all waypoint-like objects (enroute, terminal, VORs)

export function setNavData(data) {
  airports = data.airports;
  runways = data.runways;
  ilsData = data.ilsData;
  navDataPoints = data.navDataPoints;
  terminalWaypoints = data.terminalWaypoints;
  vorData = data.vorData;
  approachPaths = data.approachPaths
  // Build a consolidated waypoints array. Convert VORs into waypoint-like objects
  // so callers can treat everything uniformly.
  const convertedVors = (vorData || []).map(v => ({
    name: v.id || v.name,
    type: 'VOR',
    lon: v.lon,
    lat: v.lat,
    _raw: v,
    isVor: true
  }));
  waypoints = [ ...(navDataPoints || []), ...(terminalWaypoints || []), ...convertedVors ];
}

/**
 * @summary Draws a hexagonal VOR symbol.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {number} x - The center x-coordinate of the symbol.
 * @param {number} y - The center y-coordinate of the symbol.
 * @param {number} size - The radius of the symbol.
 */
function drawVorSymbol(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x + size * Math.cos(0), y + size * Math.sin(0));
  for (let i = 1; i <= 6; i++) {
    const angle = i * Math.PI / 3;
    ctx.lineTo(x + size * Math.cos(angle), y + size * Math.sin(angle));
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  // scale line width to logical canvas pixels
  const scale = ctx.canvas.width / ctx.canvas.getBoundingClientRect().width;
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 1.5, 0, 2 * Math.PI); // Center dot
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fill();
}

/**
 * @summary Draws a single waypoint symbol (triangle or star) and its name.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {object} point - The waypoint object from the database.
 */
function drawWaypointSymbol(ctx, point, navdataCanvas) {
  const { x, y } = latLonToPixel(point.lat, point.lon, navdataCanvas);
  const scale = navdataCanvas.width / navdataCanvas.getBoundingClientRect().width;
  if (point.type[0] === 'C' || point.type[0] === 'R') {
    const size = 6 * scale;
    ctx.beginPath();
    ctx.moveTo(x, y - size * 0.75);
    ctx.lineTo(x - size * 0.6, y + size * 0.45);
    ctx.lineTo(x + size * 0.6, y + size * 0.45);
    ctx.closePath();
    ctx.fill();
  } else if (point.type[0] === 'W') {
    const size = 5 * scale;
    const innerSize = size / 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + innerSize, y - innerSize);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + innerSize, y + innerSize);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - innerSize, y + innerSize);
    ctx.lineTo(x - size, y);
    ctx.lineTo(x - innerSize, y - innerSize);
    ctx.closePath();
    ctx.fill();
  }

  if (!/\d/.test(point.name)) {
    ctx.fillText(point.name, x + (8 * scale), y);
  }
}

/**
 * @summary Draws all runways for the currently active airports.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 */
function drawAllRunways(ctx, navdataCanvas) {
  const drawnRunways = new Set();
  runways.forEach(runway => {
    if (activeAirports[runway.airport] && activeAirports[runway.airport].includes(runway.id) && !drawnRunways.has(runway.id)) {
      const p1 = latLonToPixel(runway.lat, runway.lon, navdataCanvas);
      let p2;

      const rwyNum = parseInt(runway.id.substring(2, 4));
      const oppositeNum = rwyNum > 18 ? rwyNum - 18 : rwyNum + 18;
      const rwySide = runway.id.substring(4);
      let oppositeSide = '';
      if (rwySide === 'L') oppositeSide = 'R';
      if (rwySide === 'R') oppositeSide = 'L';
      if (rwySide === 'C') oppositeSide = 'C';
      const oppositeId = `RW${String(oppositeNum).padStart(2, '0')}${oppositeSide}`;
      const oppositeRunway = runways.find(r => r.id === oppositeId && r.airport === runway.airport);

      if (oppositeRunway) {
        p2 = latLonToPixel(oppositeRunway.lat, oppositeRunway.lon, navdataCanvas);
        drawnRunways.add(oppositeRunway.id);
      } else {
        const lengthPx = (runway.length * FEET_TO_KM) / kmPerPixel;
        const bearingRad = runway.trueBearing * Math.PI / 180;
        p2 = { x: p1.x + Math.sin(bearingRad) * lengthPx, y: p1.y - Math.cos(bearingRad) * lengthPx };
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = "rgba(255, 255, 255, 1)";
      const scale = navdataCanvas.width / navdataCanvas.getBoundingClientRect().width;
      ctx.lineWidth = 4 * scale;
      ctx.stroke();
      drawnRunways.add(runway.id);
    }
  });
}

/**
 * @summary Draws all ILS (Instrument Landing System) localizer lines for active runways.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 */
function drawAllIls(ctx, navdataCanvas) {
  ilsData.forEach(ils => {
    if (activeAirports[ils.airport] && activeAirports[ils.airport].includes(ils.runway)) {
      const runway = runways.find(r => r.id === ils.runway && r.airport === ils.airport);
      if (!runway) return;

      const threshold = latLonToPixel(runway.lat, runway.lon, navdataCanvas);

      const trueBearing = ils.bearing + ils.declination;
      const bearingRad = trueBearing * Math.PI / 180;

      const bTypeApproaches = approachPaths.filter(ap => ap.waypointType && ap.waypointType[3] === "B" && ap.icao === ils.airport);
      const cutRunway = runway.id.substring(2); // e.g., "RW35L" -> "35L"
      const matchingApproaches = bTypeApproaches.filter(ap => ap.id && ap.id.includes(cutRunway));

      let locLengthPx;
      if (matchingApproaches.length > 0) {
        const idCounts = {};
        matchingApproaches.forEach(ap => {
          idCounts[ap.waypointId] = (idCounts[ap.waypointId] || 0) + 1;
        });

        // Find the most frequently occurring waypoint ID(s).
        let mostCommonIds = [];
        let maxCount = 0;
        for (const id in idCounts) {
          if (idCounts[id] > maxCount) {
            maxCount = idCounts[id];
            mostCommonIds = [id];
          } else if (idCounts[id] === maxCount) {
            mostCommonIds.push(id);
          }
        }

        let preferredIds = mostCommonIds.filter(id => !/\d/.test(id));
        let chosenId = preferredIds.length > 0 ? preferredIds[0] : mostCommonIds[0];

        // Get the approach data for the chosen waypoint.
        const ap = matchingApproaches.find(ap => ap.waypointId === chosenId);

        // Calculate the distance from the runway threshold to this waypoint using the Haversine formula.
        const R = 6371; // Earth radius in km
        const toRad = deg => deg * Math.PI / 180;
        const dLat = toRad(ap.waypointLat - runway.lat);
        const dLon = toRad(ap.waypointLon - runway.lon);
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRad(runway.lat)) * Math.cos(toRad(ap.waypointLat)) *
                  Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distKm = R * c;
        locLengthPx = distKm / kmPerPixel; // Convert distance to pixels.
      } else {
        locLengthPx = (15 * NM_TO_KM) / kmPerPixel;
      }

      const endX = threshold.x - Math.sin(bearingRad) * locLengthPx;
      const endY = threshold.y + Math.cos(bearingRad) * locLengthPx;

      // 4. Draw the localizer line.
      ctx.beginPath();
      ctx.moveTo(threshold.x, threshold.y); // Start at the runway threshold.
      ctx.lineTo(endX, endY);               // Extend out along the approach course.
      ctx.strokeStyle = "rgba(255, 255, 0, 0.7)"; // Yellow for ILS
      const scale = navdataCanvas.width / navdataCanvas.getBoundingClientRect().width;
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
    }
  });
}

/**
 * @summary Draws all en-route and terminal waypoints on the map.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 */
function drawAllWaypoints(ctx, navdataCanvas) {
  const scale = navdataCanvas.width / navdataCanvas.getBoundingClientRect().width;
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = `800 ${11 * scale}px Google Sans Code`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  navDataPoints.forEach(point => drawWaypointSymbol(ctx, point, navdataCanvas));
  terminalWaypoints.forEach(point => {
    if (activeAirports[point.airport] && !/\d/.test(point.name)) {
      drawWaypointSymbol(ctx, point, navdataCanvas);
    }
  });
}

/**
 * @summary Draws all VOR navaids on the map.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 */
function drawAllVors(ctx, navdataCanvas) {
  const scale = navdataCanvas.width / navdataCanvas.getBoundingClientRect().width;
  vorData.forEach(vor => {
    const size = 5 * scale;
    const { x, y } = latLonToPixel(vor.lat, vor.lon, navdataCanvas);
    drawVorSymbol(ctx, x, y, size);
    ctx.fillText(vor.id, x + (8 * scale), y);
    if (vor.type[1] === 'D') {
      const boxSize = size * 2.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeRect(x - boxSize / 2, y - boxSize / 2, boxSize, boxSize);
    }
  });
}

export function drawNavData(navCtx, navdataCanvas) {
  const rect = navdataCanvas.getBoundingClientRect();
  // Clear logical canvas area
  navCtx.clearRect(0, 0, navdataCanvas.width, navdataCanvas.height);
  drawAllRunways(navCtx, navdataCanvas);
  drawAllIls(navCtx, navdataCanvas);
  drawAllWaypoints(navCtx, navdataCanvas);
  drawAllVors(navCtx, navdataCanvas);
}
