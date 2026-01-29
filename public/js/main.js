// js/main.js

import { SWEEP_INTERVAL_MS, phase, radarRangeNM} from './config.js';
import { calculateGeographicBounds, setGeographicBounds, setKmPerPixel, latLonToPixel, pixelToLatLon, NM_TO_KM} from './utils.js';
import { Aircraft } from './Aircraft.js';
import { drawNavData } from './mapRenderer.js';
import { waypoints } from './mapRenderer.js';
import { loadNavData } from './navDatabase.js';
import { getAircraftTagBoundingBox, getTagHitboxes, showTagInput, calculateTagLayout, showWaypointInput, hideWaypointInput } from './ui.js';
import { showProceduresPanel, hideProceduresPanel, getHoveredProcedure, buildProcedurePoints } from './procedures.js';



// UI & CANVAS GLOBALS
const canvas = document.getElementById("radar-scope");
const ctx = canvas.getContext("2d");
const navdataCanvas = document.getElementById("navdata-canvas");
const navCtx = navdataCanvas.getContext("2d");
const canvasStack = document.getElementById("canvas-stack");
const tagInput = document.getElementById("tag-input");
export const waypointInput = document.getElementById("waypoint-input");
export const waypointSuggestions = document.getElementById("waypoint-suggestions");
// High-resolution canvas backing store size (logical pixels)
const CANVAS_HIRES = 2160;

// GLOBAL SIMULATION STATE
let aircraftList = [];
let selectedAircraft = null;
let hoveredAircraft = null;
let activeInput = null;
export let directToState = { active: false, plane: null };

// Helper to determine whether a plane's tag should be rendered in the
// 'hovered' (expanded) state. A tag is hovered if the mouse is over it
// or if there is an active input editing that plane's tag.
function isTagHovered(plane) {
    return plane === hoveredAircraft
        || (activeInput && activeInput.plane === plane)
        || (directToState && directToState.active && directToState.plane === plane);
}

// TIMING & ANIMATION STATE
let lastUpdateTime = 0;
let timeSinceLastSweep = 0;

// ================================================================================= //
//                                     MAIN GAME LOOP                                //
// ================================================================================= //
/**
 * @summary The main animation loop that updates and redraws the simulation every frame.
 * @param {number} currentTime - The current time provided by `requestAnimationFrame`.
 */
function gameLoop(currentTime) {
  if (lastUpdateTime === 0) {
    lastUpdateTime = currentTime;
  }
  const deltaTimeMs = currentTime - lastUpdateTime;
  lastUpdateTime = currentTime;

  aircraftList.forEach(plane => plane.update(deltaTimeMs / 1000));

  // Remove landed aircraft
  aircraftList = aircraftList.filter(plane => !plane.landed);

  timeSinceLastSweep += deltaTimeMs;
  if (timeSinceLastSweep >= SWEEP_INTERVAL_MS) {
    aircraftList.forEach(plane => {
        const { x, y } = latLonToPixel(plane.lat, plane.lon, canvas);
        plane.displayX = x;
        plane.displayY = y;
        plane.displayHdg = plane.track; 
        plane.predictPath();
    });
    timeSinceLastSweep = 0;
  }

    if (activeInput) {
        const isPlaneHovered = isTagHovered(activeInput.plane);
        const layout = calculateTagLayout(activeInput.plane, isPlaneHovered, ctx);
        const box = layout.hitboxes[activeInput.property];
        if (box) {
            const rect = canvas.getBoundingClientRect();
            const cssScale = rect.width / canvas.width; // display px per logical pixel
            tagInput.style.left = `${box.x * cssScale}px`;
            // hitbox.y is the top of the line; position input at that y
            tagInput.style.top = `${box.y * cssScale}px`;
        }
    }

    // If a direct-to waypoint input is active, keep waypoint input and
    // suggestions positioned relative to the plane's heading/hitbox so they
    // follow the aircraft as it moves (same behavior as tag-input).
    if (directToState.active && directToState.plane) {
        const plane = directToState.plane;
        const isPlaneHovered = isTagHovered(plane);
        const layout = calculateTagLayout(plane, isPlaneHovered, ctx);
        const box = layout.hitboxes['heading'];
        if (box) {
            // Position the waypoint input similar to showWaypointInput()
            const rect = canvas.getBoundingClientRect();
            const cssScale = rect.width / canvas.width;
            waypointInput.style.left = `${box.x * cssScale}px`;
            waypointInput.style.top = `${box.y * cssScale}px`;

            // Position suggestions directly under the input
            waypointSuggestions.style.left = waypointInput.style.left;
            waypointSuggestions.style.top = `${(box.y + box.height) * cssScale}px`;
        }
    }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw hovered procedure preview (yellow) if any
    const hoveredProc = getHoveredProcedure();
    if (hoveredProc && hoveredProc.length > 0) {
        ctx.beginPath();
        hoveredProc.forEach((pt, idx) => {
            const p = latLonToPixel(pt.lat, pt.lon, canvas);
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
  
    aircraftList.forEach(plane => plane.draw(ctx, isTagHovered(plane)));

  requestAnimationFrame(gameLoop);
}


// ================================================================================= //
//                          EVENT HANDLING & INITIALIZATION                          //
// ================================================================================= //
function resizeCanvas() {
    const padding = 0;
    const availableWidth = window.innerWidth - padding;
    const availableHeight = window.innerHeight - padding;
    const size = Math.min(availableWidth, availableHeight);

    // Account for asymmetric border widths so the border remains visible.
    const borderLeftRight = 2; // left and right borders in px
    const borderTopBottom = 6; // top and bottom borders in px
    const totalHorizBorder = borderLeftRight * 2; // left + right
    const totalVertBorder = borderTopBottom * 2; // top + bottom
    // Subtract the larger of horizontal/vertical total border thickness
    // so the border is visible on all sides while keeping a square canvas.
    const innerSize = Math.max(0, size - Math.max(totalHorizBorder, totalVertBorder));

    canvasStack.style.width = `${innerSize}px`;
    canvasStack.style.height = `${innerSize}px`;
    // Backing store remains a high-resolution square; CSS scales to fit
    canvas.width = CANVAS_HIRES;
    canvas.height = CANVAS_HIRES;
    navdataCanvas.width = CANVAS_HIRES;
    navdataCanvas.height = CANVAS_HIRES;
    // Ensure the canvas displays at the innerSize (CSS pixels)
    canvas.style.width = `${innerSize}px`;
    canvas.style.height = `${innerSize}px`;
    navdataCanvas.style.width = `${innerSize}px`;
    navdataCanvas.style.height = `${innerSize}px`;

    // Avoid dividing by zero; only set km-per-pixel when innerSize > 0
    if (innerSize > 0) {
        // kmPerPixel must be calculated in logical canvas pixels
        setKmPerPixel((radarRangeNM * NM_TO_KM * 2) / canvas.width);
    }

    drawNavData(navCtx, navdataCanvas);
}

window.addEventListener("resize", resizeCanvas);

// --- Main Click Listener for Data Tag Interaction & Waypoint Selection ---
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width; // logical pixels per CSS/display pixel
    const mouseX = (e.clientX - rect.left) * scale;
    const mouseY = (e.clientY - rect.top) * scale;

    if (directToState.active) {
        const allWaypoints = waypoints;
        let clickedWaypoint = null;
        let minDistance = 10 * scale; // Max click distance, converted to logical pixels

        for (const wp of allWaypoints) {
            const wpPixelPos = latLonToPixel(wp.lat, wp.lon, canvas);
            const dx = wpPixelPos.x - mouseX;
            const dy = wpPixelPos.y - mouseY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < minDistance) {
                minDistance = distance;
                clickedWaypoint = wp;
            }
        }

        if (clickedWaypoint) {
            directToState.plane.flyDirectTo(clickedWaypoint);
            hideWaypointInput();
            return;
        }
    }
    
    if (activeInput) {
        tagInput.style.display = 'none';
        activeInput = null;
        return;
    }
    
    for (const plane of aircraftList) {
        const hitboxes = getTagHitboxes(plane, ctx, isTagHovered(plane)); 
        for (const property in hitboxes) {
            const box = hitboxes[property];
            // FIX: Use standard top-left bounding box logic
            if (mouseX >= box.x && mouseX <= box.x + box.width &&
                mouseY >= box.y && mouseY <= box.y + box.height) 
            {
                if (property === 'destination') {
                    showProceduresPanel(plane, box);
                    return;
                }
                activeInput = showTagInput(plane, property, box, tagInput);
                return;
            }
        }
    }
});


// --- Event Listeners for Waypoint Input ---
waypointInput.addEventListener('input', () => {
    if (!directToState.active) return;
    const query = waypointInput.value.toUpperCase();
    waypointSuggestions.innerHTML = '';

    if (query.length < 1) return;

    const allWaypoints = waypoints;
    const results = allWaypoints
        .filter(wp => wp.name.toUpperCase().startsWith(query))
        .slice(0, 10); // Limit results

    results.forEach(wp => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = wp.name;
        item.onclick = () => {
            directToState.plane.flyDirectTo(wp);
            hideWaypointInput();
        };
        waypointSuggestions.appendChild(item);
    });
});

waypointInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideWaypointInput();
    }
    if (e.key === 'Enter') {
        const firstSuggestion = waypointSuggestions.querySelector('.suggestion-item');
        if(firstSuggestion) {
            firstSuggestion.click();
        }
    }
});

waypointInput.addEventListener('blur', () => {
    // Delay hiding to allow suggestion click to register
    setTimeout(() => {
        if (document.activeElement !== waypointInput) {
             hideWaypointInput();
        }
    }, 200);
});

// --- Event Listener for the Pop-up Input Field ---
tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (activeInput) {
            const value = parseFloat(tagInput.value);
            if (!isNaN(value)) {
                const { plane, property } = activeInput;
                if (property === 'heading') plane.setHeading(value);
                if (property === 'speed') plane.setSpeed(value);
                if (property === 'altitude') plane.setAltitude(value * 100);
            }
        }
        tagInput.blur();
    }
    if (e.key === 'Escape') {
        tagInput.blur();
    }
});

// --- Real-time validation for the Pop-up Input Field ---
tagInput.addEventListener('input', () => {
    // Remove any character that is not a digit.
    tagInput.value = tagInput.value.replace(/[^0-9]/g, '');

    // Enforce a 3-digit limit, which is standard for these inputs.
    if (tagInput.value.length > 3) {
        tagInput.value = tagInput.value.slice(0, 3);
    }
});


// --- Hides the input field when it loses focus ---
tagInput.addEventListener('blur', () => {
    tagInput.style.display = 'none';
    activeInput = null;
});

// --- Mouse Hover Detection for Data Tags ---
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const mouseX = (e.clientX - rect.left) * scale;
    const mouseY = (e.clientY - rect.top) * scale;

    let foundAircraft = null;
    for (let i = aircraftList.length - 1; i >= 0; i--) {
        const plane = aircraftList[i];
        const isHovered = isTagHovered(plane);
        const bounds = getAircraftTagBoundingBox(plane, isHovered, ctx);

        if (mouseX > bounds.x && mouseX < bounds.x + bounds.width &&
            mouseY > bounds.y && mouseY < bounds.y + bounds.height) {
            foundAircraft = plane;
            break;
        }
    }
    hoveredAircraft = foundAircraft;
});


// --- Combined Context Menu Handler (Direct-To & Tag Reposition) ---
canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (activeInput || directToState.active) {
        hideWaypointInput();
        hideProceduresPanel();
        tagInput.blur();
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const mouseX = (e.clientX - rect.left) * scale;
    const mouseY = (e.clientY - rect.top) * scale;

    // Check for right click on a heading tag first
    for (const plane of aircraftList) {
        const hitboxes = getTagHitboxes(plane, ctx, isTagHovered(plane));
        const box = hitboxes['heading'];
        if (mouseX > box.x && mouseX < box.x + box.width &&
            mouseY > box.y && mouseY < box.y + box.height)
        {
            showWaypointInput(plane, box);
            return; // Found a heading click, do not proceed to repositioning
        }
    }

    // If no heading was clicked, check for tag repositioning
    aircraftList.forEach((plane) => {
        const dx = plane.displayX - mouseX;
        const dy = plane.displayY - mouseY;
        // 15px threshold expressed in logical canvas pixels
        const thresholdLogical = 15 * scale;
        if (Math.sqrt(dx * dx + dy * dy) < thresholdLogical) {
            plane.tagAngle += Math.PI / 3;
        }
    });
});

// INITIALIZATION
async function initialize() {
    // Geographic bounds and canvas sizing will be set after airport selection
    // to avoid computing bounds for a default center before the user chooses.

    // Check authentication/session before loading nav data
    const loginOverlay = document.getElementById('login-overlay');
    async function checkSession() {
        try {
            const resp = await fetch('/api/auth/status', { credentials: 'include' });
            if (!resp.ok) return false;
            const data = await resp.json();
            return !!data.authenticated;
        } catch (err) {
            return false;
        }
    }

    const authenticated = await checkSession();
    if (!authenticated) {
        if (loginOverlay) loginOverlay.style.display = 'block';
        return; // Stop initialization until user logs in
    }
    if (loginOverlay) loginOverlay.style.display = 'none';

    // Fetch airports list JSON and show airport selector
    const airportOverlay = document.getElementById('airport-overlay');
    const airportListEl = document.getElementById('airport-list');
    const airportSelectBtn = document.getElementById('airport-select-btn');

    let airports = [];
    try {
        const r = await fetch('/data/airports.json');
        if (r.ok) airports = await r.json();
    } catch (e) {
        console.warn('Failed to load airports.json, falling back to default bounds', e);
    }

    function showAirportSelector(list) {
        airportListEl.innerHTML = '';
        list.forEach((a, idx) => {
            const item = document.createElement('div');
            item.className = 'airport-item';
            item.dataset.index = idx;
            item.textContent = `${a.icao} — ${a.name || ''}`;
            item.onclick = () => {
                // toggle selected
                airportListEl.querySelectorAll('.airport-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            };
            airportListEl.appendChild(item);
        });
        airportOverlay.style.display = 'flex';
    }

    if (airports.length > 0) {
        showAirportSelector(airports);
    } else {
        // No airports file — calculate bounds from default center and resize canvas
        calculateGeographicBounds();
        resizeCanvas();
        await startSimulation();
        return;
    }

    airportSelectBtn.onclick = async () => {
        const selected = airportListEl.querySelector('.airport-item.selected');
        if (!selected) return;
        const idx = parseInt(selected.dataset.index, 10);
        const ap = airports[idx];
        if (!ap) return;

        // Apply bounds from the selected airport
        setGeographicBounds({ minLon: ap.minLon, maxLon: ap.maxLon, minLat: ap.minLat, maxLat: ap.maxLat });
        airportOverlay.style.display = 'none';
        resizeCanvas();
        await startSimulation();
    };

    // Start simulation using previously set bounds
    async function startSimulation() {
        // Asynchronously load nav data
        await loadNavData(navCtx, navdataCanvas);

        // Create initial aircraft
        const initialPos1 = pixelToLatLon(110, 470, canvas);
        const initialPos2 = pixelToLatLon(600, 700, canvas);

        aircraftList.push(new Aircraft("BAW123", initialPos1.lat, initialPos1.lon, 30, 4000, 280, "EGLL", "MMMD", "H", 0, phase.CRUISE, canvas));
        aircraftList.push(new Aircraft("AWE456", initialPos2.lat, initialPos2.lon, 225, 12000, 310, "EDDF", "MMMD", "M", 0, phase.CRUISE, canvas));

        // Start the main animation loop
        requestAnimationFrame(gameLoop);
    }
}

initialize();
