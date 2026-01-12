// js/ui.js

/**
 * @summary Calculates the layout, dimensions, and positions for an aircraft's data tag.
 * @param {Aircraft} plane - The aircraft for which to calculate the tag layout.
 * @param {boolean} isHovered - Whether the tag should be in the detailed (hovered) state.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context for measuring text.
 * @returns {object} An object containing all necessary layout information.
 */
export function calculateTagLayout(plane, isHovered, ctx) {
    ctx.font = '11px "Google Sans Code"';
    const lineHeight = 15;
    const padding = 3;

    // --- Text Content ---
    const assignedHdg = `H${Math.round(plane.targetHdg).toString().padStart(3, '0')}`;
    const line1 = { text: `${plane.callsign} ${assignedHdg}` };

    const currentFL = Math.round(plane.altitude / 100).toString().padStart(3, '0');
    let trendIndicator = " ";
    if (Math.abs(plane.verticalSpeed) > 100) {
        trendIndicator = plane.verticalSpeed > 0 ? "↑" : "↓";
    }
    const crcVal = Math.round(plane.verticalSpeed / 100);
    const crcText = `${crcVal > 0 ? '+' : ''}${crcVal.toString().padStart(2, '0')}`;
    const line2 = { 
        text: isHovered 
        ? `${currentFL}${trendIndicator} ${plane.destination} XX ${crcText}`
        : `${currentFL}${trendIndicator} ${plane.destination}`
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
    const TAG_GAP = 15;
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
    const headingWidth = ctx.measureText(assignedHdg).width;
    const headingX = tagOriginX + ctx.measureText(callsignText).width;
    const speedWidth = ctx.measureText(speedWTCText).width;
    const altitudeWidth = ctx.measureText(clearedFLText).width;
    const altitudeX = tagOriginX + ctx.measureText(speedWTCText).width;
    
    const hitboxes = {
        heading: { 
            x: headingX, 
            y: isHovered ? anchor.y - lineHeight * 1.5 : anchor.y - lineHeight, 
            width: headingWidth,  
            height: lineHeight 
        },
        speed: { 
            x: tagOriginX,
            y: isHovered ? anchor.y + lineHeight * 0.5 : anchor.y + lineHeight, 
            width: speedWidth,    
            height: lineHeight 
        },
        altitude: { 
            x: altitudeX, 
            y: isHovered ? anchor.y + lineHeight * 0.5 : anchor.y + lineHeight, 
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
export function getTagHitboxes(plane, ctx) {
    // Hitboxes are always calculated based on the detailed (hovered) layout.
    const layout = calculateTagLayout(plane, true, ctx);
    return layout.hitboxes;
}


/**
 * @summary Shows and positions the tag input box over the correct element.
 * @param {Aircraft} plane - The plane being edited.
 * @param {string} property - The property to be edited: "heading", "speed", or "altitude".
 * @param {object} hitbox - The hitbox object from the layout calculation.
 * @param {HTMLElement} tagInputElement - The input DOM element to manipulate.
 * @returns {object} The new active input state for the main script to track.
 */
export function showTagInput(plane, property, hitbox, tagInputElement) {
    tagInputElement.style.display = 'block';
    tagInputElement.style.left = `${hitbox.x}px`;
    tagInputElement.style.top = `${hitbox.y - hitbox.height / 2}px`;
    tagInputElement.style.width = `${hitbox.width}px`;
    tagInputElement.style.height = `${hitbox.height}px`;

    if (property === 'heading') tagInputElement.value = plane.targetHdg;
    if (property === 'speed') tagInputElement.value = plane.targetSpd;
    if (property === 'altitude') tagInputElement.value = plane.targetAlt / 100;

    tagInputElement.focus();
    tagInputElement.select();

    // Return an object representing the active input state
    return { plane, property };
}