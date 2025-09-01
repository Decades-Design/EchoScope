// js/main.js

import { SWEEP_INTERVAL_MS, phase, radarRangeNM } from "./config.js";
import {
  calculateGeographicBounds,
  setKmPerPixel,
  latLonToPixel,
  pixelToLatLon,
  NM_TO_KM,
  hasRefreshToken,
} from "./utils.js";
import { Aircraft } from "./Aircraft.js";
import { drawNavData, setNavData } from "./mapRenderer.js";
import { loadNavData } from "./navDatabase.js";
import {
  getAircraftTagBoundingBox,
  getTagHitboxes,
  showTagInput,
  calculateTagLayout,
} from "./ui.js";

// UI & CANVAS GLOBALS
const canvas = document.getElementById("radar-scope");
const ctx = canvas.getContext("2d");
const navdataCanvas = document.getElementById("navdata-canvas");
const navCtx = navdataCanvas.getContext("2d");
const canvasStack = document.getElementById("canvas-stack");
const tagInput = document.getElementById("tag-input");
const loginOverlay = document.getElementById("login-overlay");

// Canvas size is the smaller of the window's width or height, minus some padding
const padding = 20;
let availableWidth = window.innerWidth - padding;
let availableHeight = window.innerHeight - padding;
export let size = Math.min(availableWidth, availableHeight);

// GLOBAL SIMULATION STATE
let aircraftList = [];
let selectedAircraft = null;
let hoveredAircraft = null;
let activeInput = null;

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

  aircraftList.forEach((plane) => plane.update(deltaTimeMs / 1000));

  timeSinceLastSweep += deltaTimeMs;
  if (timeSinceLastSweep >= SWEEP_INTERVAL_MS) {
    aircraftList.forEach((plane) => {
      const { x, y } = latLonToPixel(plane.lat, plane.lon, canvas);
      plane.displayX = x;
      plane.displayY = y;
      plane.displayHdg = plane.track;
      plane.predictPath();
    });
    timeSinceLastSweep = 0;
  }

  if (activeInput) {
    const isPlaneHovered = activeInput.plane === hoveredAircraft;
    const layout = calculateTagLayout(activeInput.plane, isPlaneHovered, ctx);
    const box = layout.hitboxes[activeInput.property];
    if (box) {
      tagInput.style.left = `${box.x}px`;
      tagInput.style.top = `${box.y - box.height / 2}px`;
    }
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  aircraftList.forEach((plane) => plane.draw(ctx, plane === hoveredAircraft));

  requestAnimationFrame(gameLoop);
}

// ================================================================================= //
//                          EVENT HANDLING & INITIALIZATION                          //
// ================================================================================= //
function resizeCanvas() {
  availableWidth = window.innerWidth - padding;
  availableHeight = window.innerHeight - padding;
  size = Math.min(availableWidth, availableHeight);
  calculateGeographicBounds();

  canvasStack.style.width = `${size}px`;
  canvasStack.style.height = `${size}px`;
  canvas.width = size;
  canvas.height = size;
  navdataCanvas.width = size;
  navdataCanvas.height = size;

  drawNavData(navCtx, navdataCanvas);
}

window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// --- Main Click Listener for Data Tag Interaction ---
canvas.addEventListener("click", (e) => {
  if (activeInput) {
    tagInput.style.display = "none";
    activeInput = null;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  for (const plane of aircraftList) {
    // Pass ctx to the hitbox function
    const hitboxes = getTagHitboxes(plane, ctx);

    for (const property in hitboxes) {
      const box = hitboxes[property];
      if (
        mouseX > box.x &&
        mouseX < box.x + box.width &&
        mouseY > box.y - box.height / 2 &&
        mouseY < box.y + box.height / 2
      ) {
        // showTagInput now returns the activeInput state
        activeInput = showTagInput(plane, property, box, tagInput);
        return;
      }
    }
  }
});

// --- Event Listener for the Pop-up Input Field ---
tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (activeInput) {
      const value = parseFloat(tagInput.value);
      if (!isNaN(value)) {
        const { plane, property } = activeInput;
        if (property === "heading") plane.setHeading(value);
        if (property === "speed") plane.setSpeed(value);
        if (property === "altitude") plane.setAltitude(value * 100);
      }
    }
    tagInput.blur();
  }
  if (e.key === "Escape") {
    tagInput.blur();
  }
});

// --- Real-time validation for the Pop-up Input Field ---
tagInput.addEventListener("input", () => {
  // Remove any character that is not a digit.
  tagInput.value = tagInput.value.replace(/[^0-9]/g, "");

  // Enforce a 3-digit limit, which is standard for these inputs.
  if (tagInput.value.length > 3) {
    tagInput.value = tagInput.value.slice(0, 3);
  }
});

// --- Hides the input field when it loses focus ---
tagInput.addEventListener("blur", () => {
  tagInput.style.display = "none";
  activeInput = null;
});

// --- Mouse Hover Detection for Data Tags ---
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  let foundAircraft = null;
  for (let i = aircraftList.length - 1; i >= 0; i--) {
    const plane = aircraftList[i];
    const isHovered = hoveredAircraft === plane;
    const bounds = getAircraftTagBoundingBox(plane, isHovered, ctx);

    if (
      mouseX > bounds.x &&
      mouseX < bounds.x + bounds.width &&
      mouseY > bounds.y &&
      mouseY < bounds.y + bounds.height
    ) {
      foundAircraft = plane;
      break;
    }
  }
  hoveredAircraft = foundAircraft;
});

// --- Data Tag Repositioning (via Right Click on aircraft symbol) ---
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  aircraftList.forEach((plane) => {
    const dx = plane.displayX - mouseX;
    const dy = plane.displayY - mouseY;
    if (Math.sqrt(dx * dx + dy * dy) < 15) {
      plane.tagAngle += Math.PI / 3;
    }
  });
});

// --- Login Overlay Handling ---
function showLoginPopup() {
  loginOverlay.style.display = "flex";
}

// INITIALIZATION
async function initialize() {
  resizeCanvas();
  
  // Check for the presence of the refresh token cookie
  if (!hasRefreshToken()) {
    console.log("No refresh token found. Displaying login pop-up.");
    showLoginPopup();
    return; // IMPORTANT: Stop the initialization process right here.
  }

  // If the script reaches this point, it means the token exists and we can proceed.
  console.log("Refresh token found. Initializing application.");

  calculateGeographicBounds();

  // Asynchronously load nav data
  const allNavData = await loadNavData(navCtx, navdataCanvas);

  // Create initial aircraft
  const initialPos1 = pixelToLatLon(100, 100, canvas);
  const initialPos2 = pixelToLatLon(1000, 800, canvas);

  aircraftList.push(
    new Aircraft(
      "BAW123",
      initialPos1.lat,
      initialPos1.lon,
      135,
      18000,
      280,
      "EGLL",
      "LIMC",
      "H",
      0,
      phase.CRUISE,
      canvas
    )
  );
  aircraftList.push(
    new Aircraft(
      "AWE456",
      initialPos2.lat,
      initialPos2.lon,
      225,
      24000,
      310,
      "EDDF",
      "LIML",
      "M",
      0,
      phase.CRUISE,
      canvas
    )
  );

  // Start the main animation loop
  requestAnimationFrame(gameLoop);
}

initialize();
