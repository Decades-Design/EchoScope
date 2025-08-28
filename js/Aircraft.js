// js/Aircraft.js

import { AIRCRAFT_PERFORMANCE, windDirection, windSpeed, SWEEP_INTERVAL_MS} from './config.js';
import { KNOTS_TO_KPS, kmPerPixel, latLonToPixel } from './utils.js';
import { calculateTagLayout } from './ui.js';


export class Aircraft {
    /**
     * @summary Represents a single aircraft in the simulation.
     * @param {string} callsign - The aircraft's unique identifier (e.g., "BAW123").
     * @param {number} lat - The initial latitude in decimal degrees.
     * @param {number} lon - The initial longitude in decimal degrees.
     * @param {number} heading - The initial heading in degrees (0-360).
     * @param {number} altitude - The initial altitude in feet.
     * @param {number} speed - The initial speed in knots.
     * @param {string} departure - The flight's departure airport ICAO code.
     * @param {string} destination - The flight's destination airport ICAO code.
     * @param {string} wtc - The wake turbulence category ("L", "M", "H", "J").
     * @param {number} [tagAngle=0] - The initial angle for the data tag, in radians.
     * @param {string} phase - The initial flight phase.
     */
    constructor(callsign, lat, lon, heading, altitude, speed, departure, destination, wtc, tagAngle, phase, canvas) {
    this.callsign = callsign;
    this.lat = lat;
    this.lon = lon;
    this.departure = departure;
    this.destination = destination;
    this.wtc = wtc;
    this.scratchpad = "SCRATCHPAD";

    // --- NEW: Look up performance data based on WTC ---
    const performance = AIRCRAFT_PERFORMANCE[this.wtc] || AIRCRAFT_PERFORMANCE["M"];
    this.turnRate = performance.turnRate;
    this.climbRate = performance.climbRate;
    this.descentRate = performance.descentRate;
    this.accelerationRate = performance.accelerationRate;
    this.decelerationRate = performance.decelerationRate;

    // --- Core Flight Parameters ---
    this.altitude = altitude; // Current altitude in feet
    this.targetAlt = altitude; // Assigned altitude in feet
    this.verticalSpeed = 0; // Current vertical speed in feet per minute

    this.heading = heading; // Current heading in degrees
    this.targetHdg = heading; // Assigned heading in degrees
    this.track = heading; // Actual direction of travel over the ground

    this.indicatedAirspeed = speed; // Current indicated airspeed (IAS) in knots
    this.targetSpd = speed; // Assigned speed in knots
    this.trueAirspeed = 0; // Calculated true airspeed (TAS) in knots
    this.groundSpeed = 0; // Calculated ground speed in knots

    this.phase = phase;

    // --- Display & Position Properties ---
    const { x, y } = latLonToPixel(this.lat, this.lon, canvas);
    this.displayX = x;
    this.displayY = y;
    this.displayHdg = heading;
    this.tagAngle = tagAngle || 0;
    
    this.predictedPath = [];
  }


    /**
     * The new physics-based update loop for the aircraft.
     * @param {number} deltaTime - Time in seconds since the last frame.
     */
    /**
     * The new physics-based update loop for the aircraft.
     * @param {number} deltaTime - Time in seconds since the last frame.
     */
    update(deltaTime) {
        // --- 1. HEADING LOGIC ---
        // Adjusts the current heading towards the target heading based on the aircraft's turn rate.
        if (this.heading !== this.targetHdg) {
            const turnStep = this.turnRate * deltaTime;
            let diff = this.targetHdg - this.heading;

            // Ensure the aircraft turns in the shortest direction
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;

            // Apply the turn, ensuring we don't overshoot the target
            if (Math.abs(diff) < turnStep) {
                this.heading = this.targetHdg;
            } else {
                this.heading += turnStep * Math.sign(diff);
            }
            // Keep heading within the 0-359 degree range
            this.heading = (this.heading + 360) % 360;
        }

        // --- 2. ALTITUDE LOGIC ---
        // Adjusts altitude towards the target using climb/descent rates.
        const altDiff = this.targetAlt - this.altitude;
        if (Math.abs(altDiff) > 10) { // Only adjust if difference is more than 10 feet
            if (altDiff > 0) { // Climbing
                const maxAltChange = (this.climbRate / 60) * deltaTime; // Convert FPM to feet per second
                this.altitude += Math.min(maxAltChange, altDiff);
                this.verticalSpeed = this.climbRate;
            } else { // Descending
                const maxAltChange = (this.descentRate / 60) * deltaTime; // Convert FPM to feet per second
                this.altitude += Math.max(-maxAltChange, altDiff); // Use max for negative change
                this.verticalSpeed = -this.descentRate;
            }
        } else {
            this.altitude = this.targetAlt;
            this.verticalSpeed = 0;
        }

        // --- 3. SPEED LOGIC ---
        // Adjusts speed towards the target using acceleration/deceleration rates.
        const speedDiff = this.targetSpd - this.indicatedAirspeed;
        if (Math.abs(speedDiff) > 0.5) { // Only adjust if difference is significant
            if (speedDiff > 0) { // Accelerating
                const maxSpeedChange = this.accelerationRate * deltaTime;
                this.indicatedAirspeed += Math.min(maxSpeedChange, speedDiff);
            } else { // Decelerating
                const maxSpeedChange = this.decelerationRate * deltaTime;
                this.indicatedAirspeed += Math.max(-maxSpeedChange, speedDiff);
            }
        } else {
            this.indicatedAirspeed = this.targetSpd;
        }
        
        // --- 4. ATMOSPHERIC & SPEED CONVERSIONS (Simplified) ---
        // True Airspeed (TAS) is roughly 2% higher than Indicated Airspeed (IAS) per 1000 ft.
        this.trueAirspeed = this.indicatedAirspeed * (1 + (this.altitude / 1000) * 0.02);
        
        // --- 5. GROUND SPEED CALCULATION ---
        const windRad = (windDirection - 180) * Math.PI / 180;
        const headingRad = this.heading * Math.PI / 180;
        const tasX = this.trueAirspeed * Math.sin(headingRad);
        const tasY = this.trueAirspeed * Math.cos(headingRad);
        const windX = windSpeed * Math.sin(windRad);
        const windY = windSpeed * Math.cos(windRad);
        const gsX = tasX + windX;
        const gsY = tasY + windY;
        this.groundSpeed = Math.sqrt(gsX * gsX + gsY * gsY);
        const trueCourseRad = Math.atan2(gsX, gsY);
        this.track = (trueCourseRad * 180 / Math.PI + 360) % 360;

        // --- 6. POSITIONAL UPDATE ---
        const distanceMovedKm = (this.groundSpeed * KNOTS_TO_KPS) * deltaTime;
        const latRad = this.lat * Math.PI / 180;
        const R = 6371; // Earth's radius in km
        const newLatRad = Math.asin(Math.sin(latRad) * Math.cos(distanceMovedKm / R) + Math.cos(latRad) * Math.sin(distanceMovedKm / R) * Math.cos(trueCourseRad));
        const newLonRad = (this.lon * Math.PI / 180) + Math.atan2(Math.sin(trueCourseRad) * Math.sin(distanceMovedKm / R) * Math.cos(latRad), Math.cos(distanceMovedKm / R) - Math.sin(latRad) * Math.sin(newLatRad));
        this.lat = newLatRad * 180 / Math.PI;
        this.lon = newLonRad * 180 / Math.PI;
    }

    // --- NEW SIMPLIFIED SETTER METHODS ---
    setHeading(newHeading) {
        this.targetHdg = ((newHeading % 360) + 360) % 360;
    }

    setSpeed(newSpeed) {
        this.targetSpd = Math.max(120, newSpeed); // Set the target Indicated Airspeed (IAS)
    }

    setAltitude(newAltitude) {
        this.targetAlt = newAltitude;
    }

    /**
     * @summary Simulates the aircraft's future trajectory for the vector line.
     * @description This method is called only on a radar sweep. It calculates a series
     * of points representing the aircraft's path over the next 60 seconds,
     * accounting for any ongoing turns.
     */
    predictPath() {
        const path = [];
        const timeToPredict = 60; // Predict 60 seconds into the future
        const timeStep = SWEEP_INTERVAL_MS / 1000;       // Calculate a new point every second

        // Start simulation from the aircraft's current state
        let currentX = this.displayX;
        let currentY = this.displayY;
        let currentHeading = this.heading;

        for (let t = 0; t < timeToPredict; t += timeStep) {
            // --- 1. Predict the turn (same logic as the update method) ---
            if (currentHeading !== this.targetHdg) {
                const turnStep = this.turnRate * timeStep;
                let diff = this.targetHdg - currentHeading;
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;

                if (Math.abs(diff) < turnStep) {
                currentHeading = this.targetHdg;
                } else {
                currentHeading += turnStep * Math.sign(diff);
                }
                currentHeading = (currentHeading + 360) % 360;
            }

            // --- 2. Predict the movement in one timeStep ---
            const distanceKm = (this.groundSpeed * KNOTS_TO_KPS) * timeStep;
            const distancePixels = distanceKm / kmPerPixel;
            const rad = (currentHeading * Math.PI) / 180;

            currentX += Math.sin(rad) * distancePixels;
            currentY -= Math.cos(rad) * distancePixels;
            
            path.push({ x: currentX, y: currentY });
        }

        this.predictedPath = path;
    }

    /**
     * @summary Draws the aircraft symbol, vector line, and data tag on the canvas.
     * @param {boolean} [isHovered=false] - True if the mouse is hovering over the aircraft's tag, triggering the detailed view.
     */
    draw(ctx, isHovered = false) {
        //Aircraft Position
        const x = this.displayX;
        const y = this.displayY;
        
        // Draw aircraft symbol
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#0f0";
        ctx.fill();
        
        // Draw heading vector line
        if (this.predictedPath.length > 0) {
            ctx.beginPath();
            ctx.moveTo(x, y); // Start the line from the aircraft's current position
            this.predictedPath.forEach(point => {
                ctx.lineTo(point.x, point.y);
            });
            ctx.strokeStyle = "#0f0";
            ctx.lineWidth = 2;
            ctx.stroke();
        }


        // Draw data tag
        const layout = calculateTagLayout(this, isHovered, ctx);
        ctx.font = '11px "Google Sans Code"';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        if (isHovered) {
            ctx.fillStyle = "rgba(30, 30, 30, 0.9)";
            ctx.fillRect(
                layout.anchor.x - (layout.block.width / 2) - layout.padding,
                layout.anchor.y - (layout.block.height / 2) - layout.padding,
                layout.block.width + (layout.padding * 2),
                layout.block.height + (layout.padding * 2)
            );
            ctx.fillStyle = "#0f0";
        }

        if (isHovered) {
            ctx.fillText(layout.lines[0].text, layout.tagOriginX, layout.anchor.y - layout.lineHeight * 1.5);
            ctx.fillText(layout.lines[1].text, layout.tagOriginX, layout.anchor.y - layout.lineHeight * 0.5);
            ctx.fillText(layout.lines[2].text, layout.tagOriginX, layout.anchor.y + layout.lineHeight * 0.5);
            ctx.fillText(layout.lines[3].text, layout.tagOriginX, layout.anchor.y + layout.lineHeight * 1.5);
        } else {
            ctx.fillText(layout.lines[0].text, layout.tagOriginX, layout.anchor.y - layout.lineHeight);
            ctx.fillText(layout.lines[1].text, layout.tagOriginX, layout.anchor.y);
            ctx.fillText(layout.lines[2].text, layout.tagOriginX, layout.anchor.y + layout.lineHeight);
        }
    }
}