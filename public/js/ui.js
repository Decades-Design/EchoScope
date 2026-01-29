// js/ui.js

import { directToState, waypointInput, waypointSuggestions } from "./main.js";

/**
 * @summary Calculates the layout, dimensions, and positions for an aircraft's data tag.
 * @param {Aircraft} plane - The aircraft for which to calculate the tag layout.
 * @param {boolean} isHovered - Whether the tag should be in the detailed (hovered) state.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context for measuring text.
 * @returns {object} An object containing all necessary layout information.
 */
export function calculateTagLayout(plane, isHovered, ctx) {
    const scale = ctx.canvas.width / ctx.canvas.getBoundingClientRect().width;
    ctx.font = `800 ${11 * scale}px Google Sans Code`;
    const lineHeight = 15 * scale;
    const padding = 3 * scale;

    // --- Text Content ---
    const assignedHdg = `H${Math.round(plane.targetHdg).toString().padStart(3, '0')}`;
    // If the aircraft has a direct-to waypoint assigned, display the waypoint name
    // instead of the assigned heading in the tag.
    const headingDisplay = (plane.targetWaypoint && plane.targetWaypoint.name) ? plane.targetWaypoint.name : assignedHdg;
    const line1 = { text: `${plane.callsign} ${headingDisplay}` };

    const currentFL = Math.round(plane.altitude / 100).toString().padStart(3, '0');
    let trendIndicator = " ";
    if (Math.abs(plane.verticalSpeed) > 100) {
        trendIndicator = plane.verticalSpeed > 0 ? "↑" : "↓";
    }
    const crcVal = Math.round(plane.verticalSpeed / 100);
    const crcText = `${crcVal > 0 ? '+' : ''}${crcVal.toString().padStart(2, '0')}`;
        // Show a star next to the destination if no procedure has been assigned
        const destDisplay = `${plane.destination}${!plane.assignedProcedure ? '*' : ''}`;
        const line2 = {
            text: isHovered
                ? `${currentFL}${trendIndicator} ${destDisplay} XX ${crcText}`
                : `${currentFL}${trendIndicator} ${destDisplay}`
        };

    const clearedFL = Math.round(plane.targetAlt / 100).toString().padStart(3, '0');
    const speedWTC = `${Math.round(plane.groundSpeed)}${plane.wtc}`;
    const line3 = { text: `${speedWTC} ${clearedFL}` };

    const line4 = { text: plane.scratchpad };

    // --- Dimension and Position Calculations ---
    const lines = isHovered ? [line1, line2, line3, line4] : [line1, line2, line3];
    lines.forEach(line => line.width = ctx.measureText(line.text).width);
    const blockWidth = Math.max(...lines.map(line => line.width));
    const blockHeight = lineHeight * lines.length;
    const TAG_GAP = 15 * scale;
    const radiusX = (blockWidth / 2) + TAG_GAP + padding;
    const radiusY = (blockHeight / 2) + TAG_GAP + padding;
    const anchor = {
        x: plane.displayX + radiusX * Math.cos(plane.tagAngle),
        y: plane.displayY + radiusY * Math.sin(plane.tagAngle)
    };
    const tagOriginX = anchor.x - (blockWidth / 2);

    // --- Hitbox Calculations ---
    const callsignText = `${plane.callsign} `;
    const speedWTCText = `${Math.round(plane.groundSpeed)}${plane.wtc}`;
    const clearedFLText = ` ${Math.round(plane.targetAlt / 100).toString().padStart(3, '0')}`;
    const headingWidth = ctx.measureText(headingDisplay).width;
    const headingX = tagOriginX + ctx.measureText(callsignText).width;
    const speedWidth = ctx.measureText(speedWTCText).width;
    const altitudeWidth = ctx.measureText(clearedFLText).width;
    // Compute the top-left origin for the tag block so we can place hitboxes exactly
    const altitudeX = tagOriginX + ctx.measureText(`${speedWTC} `).width;
    const tagOriginY = anchor.y - (blockHeight / 2);

    // Determine line index for each field (0 = first line)
    const headingIndex = 0;
    const destinationIndex = 1;
    // speed and altitude are on the third line (index 2) for both collapsed and expanded
    const speedIndex = 2;
    const altitudeIndex = 2;

    const hitboxes = {
        heading: {
            x: headingX,
            y: tagOriginY + headingIndex * lineHeight,
            width: headingWidth,
            height: lineHeight
        },
        destination: {
            // destination appears on line 2 after the flight level and trend indicator
            x: tagOriginX + ctx.measureText(`${currentFL}${trendIndicator} `).width,
            y: tagOriginY + destinationIndex * lineHeight,
            width: ctx.measureText(destDisplay).width,
            height: lineHeight
        },
        speed: {
            x: tagOriginX,
            y: tagOriginY + speedIndex * lineHeight,
            width: speedWidth,
            height: lineHeight
        },
        altitude: {
            x: altitudeX,
            y: tagOriginY + altitudeIndex * lineHeight,
            width: altitudeWidth,
            height: lineHeight
        }
    };

    return { lines, block: { width: blockWidth, height: blockHeight }, anchor, tagOriginX, hitboxes, padding, lineHeight };
}


/**
 * @summary Gets the bounding box for the entire data tag for hover detection.
 * @param {Aircraft} plane - The aircraft whose tag bounding box is needed.
 * @param {boolean} isHovered - The current hover state of the aircraft.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @returns {{x: number, y: number, width: number, height: number}} The bounding box.
 */
export function getAircraftTagBoundingBox(plane, isHovered, ctx) {
    const layout = calculateTagLayout(plane, isHovered, ctx);
    return {
        x: layout.anchor.x - (layout.block.width / 2) - layout.padding,
        y: layout.anchor.y - (layout.block.height / 2) - layout.padding,
        width: layout.block.width + (layout.padding * 2),
        height: layout.block.height + (layout.padding * 2)
    };
}


/**
 * @summary Gets the specific hitboxes for clickable elements within a data tag.
 * @param {Aircraft} plane - The aircraft whose hitboxes are needed.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @returns {object} An object containing hitboxes for "heading", "speed", and "altitude".
 */
export function getTagHitboxes(plane, ctx, isHovered = false) {
    // Return hitboxes for the layout matching the current hover state.
    const layout = calculateTagLayout(plane, isHovered, ctx);
    return layout.hitboxes;
}


/**
 * @summary Shows and positions the tag input box over the correct element.
 * @param {Aircraft} plane - The plane being edited.
 * @param {string} property - The property to be edited: "heading", "speed", "altitude", or "waypoint".
 * @param {object} hitbox - The hitbox object from the layout calculation.
 * @param {HTMLElement} tagInputElement - The input DOM element to manipulate.
 * @returns {object} The new active input state for the main script to track.
 */
export function showTagInput(plane, property, hitbox, tagInputElement) {
    tagInputElement.style.display = 'block';
    // Convert logical canvas pixels to CSS/display pixels for DOM placement
    const canvas = document.getElementById('radar-scope');
    const rect = canvas.getBoundingClientRect();
    const cssScale = rect.width / canvas.width;
    tagInputElement.style.left = `${hitbox.x * cssScale}px`;
    // hitbox.y is the top of the line, so position input at that y
    tagInputElement.style.top = `${hitbox.y * cssScale}px`;
    tagInputElement.style.width = `${hitbox.width * cssScale}px`;
    tagInputElement.style.height = `${hitbox.height * cssScale}px`;

    // Clear previous value and set type attribute
    tagInputElement.value = '';
    if (property === 'waypoint') {
        tagInputElement.setAttribute('type', 'text');
        tagInputElement.setAttribute('maxlength', '5'); // Waypoint names are typically 5 chars
    } else {
        tagInputElement.setAttribute('type', 'number');
        tagInputElement.removeAttribute('maxlength');
    }


    if (property === 'heading') tagInputElement.value = plane.targetHdg;
    if (property === 'speed') tagInputElement.value = plane.targetSpd;
    if (property === 'altitude') tagInputElement.value = plane.targetAlt / 100;
    // For 'waypoint', we start with an empty field

    tagInputElement.focus();
    tagInputElement.select();

    // Return an object representing the active input state
    return { plane, property };
}

export function showWaypointInput(plane, hitbox) {
    directToState.active = true;
    directToState.plane = plane;

    waypointInput.style.display = 'block';
    // Convert logical canvas pixels to CSS/display pixels for DOM placement
    const canvas = document.getElementById('radar-scope');
    const rect = canvas.getBoundingClientRect();
    const cssScale = rect.width / canvas.width;
    waypointInput.style.left = `${hitbox.x * cssScale}px`;
    // Position input at the top of the hitbox line
    waypointInput.style.top = `${hitbox.y * cssScale}px`;
    waypointInput.style.width = `${(hitbox.width + 25) * cssScale}px`;
    waypointInput.style.height = `${hitbox.height * cssScale}px`;
    waypointInput.value = '';
    waypointInput.focus();

    waypointSuggestions.style.display = 'block';
    waypointSuggestions.style.left = waypointInput.style.left;
    // Place suggestions immediately below the input
    waypointSuggestions.style.top = `${(hitbox.y + hitbox.height) * cssScale}px`;
    waypointSuggestions.style.width = waypointInput.style.width;
    waypointSuggestions.innerHTML = '';
}

export function hideWaypointInput() {
    directToState.active = false;
    directToState.plane = null;
    waypointInput.style.display = 'none';
    waypointSuggestions.style.display = 'none';
}
