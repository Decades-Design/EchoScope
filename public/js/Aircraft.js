    // js/Aircraft.js

import { AIRCRAFT_PERFORMANCE, windDirection, windSpeed, SWEEP_INTERVAL_MS, phase} from './config.js';
import { KNOTS_TO_KPS, kmPerPixel, latLonToPixel, calculateBearing, calculateDistance, calculateCrossTrackError } from './utils.js';
import { calculateTagLayout } from './ui.js';
import { runways, ilsData } from './mapRenderer.js';


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
    constructor(callsign, lat, lon, heading, altitude, speed, departure, destination, wtc, tagAngle, initialPhase, canvas) {
        this.callsign = callsign;
        this.lat = lat;
        this.lon = lon;
        this.departure = departure;
        this.destination = destination;
        this.wtc = wtc;
        this.scratchpad = "SCRATCHPAD";
        this.targetWaypoint = null;
        this.assignedProcedure = null; // { type, id, transition }

        // Autopilot for procedures
        this.procedureWaypoints = [];
        this.currentWaypointIndex = -1;
        this.autopilotActive = false;

        // ILS interception and following
        this.interceptingLOC = false;
        this.interceptingGS = false;
        this.followingILS = false;
        this.ilsData = null;
        this.landed = false;

        // Look up performance data based on WTC ---
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

        this.phase = initialPhase;

        // --- Display & Position Properties ---
        const { x, y } = latLonToPixel(this.lat, this.lon, canvas);
        this.displayX = x;
        this.displayY = y;
        this.displayHdg = heading;
        this.tagAngle = tagAngle || 0;
        
        this.predictedPath = [];

        this.interceptingLOC = false; // "LOC" on the cockpit
        this.interceptingGS = false;  // "GS" on the cockpit
        this.followingILS = false;    // Full Approach Mode

        // Localizer PID controller state (error in km -> output in degrees)
        this.locPID = {
            kp: 80.0,        // proportional gain (deg per km)
            ki: 0.0,         // integral gain (deg per km*s)
            kd: 10.0,        // derivative gain (deg per km/s)
            integral: 0.0,   // accumulated integral (km*s)
            lastError: 0.0,  // previous error (km)
            integralLimit: 5.0 // limit to prevent windup (km*s)
        };
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
        // --- Calculate heading when a direct-to waypoint is assigned ---
        // If a heading (manual) is set, we should NOT apply wind correction.
        // If flying direct-to a waypoint under autopilot, compute the required
        // heading that compensates for wind so the aircraft's ground track
        // points to the waypoint.
        if (this.targetWaypoint && this.autopilotActive && !this.followingILS) {
            const lat1 = this.lat * Math.PI / 180;
            const lon1 = this.lon * Math.PI / 180;
            const lat2 = this.targetWaypoint.lat * Math.PI / 180;
            const lon2 = this.targetWaypoint.lon * Math.PI / 180;

            const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) -
                    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
            const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

            // Estimate TAS from IAS for the wind correction calculation.
            const tasEstimate = this.indicatedAirspeed * (1 + (this.altitude / 1000) * 0.02) || 1.0;

            // WindDirection is the wind FROM direction (degrees). Standard wind
            // correction angle (WCA) formula: WCA = asin( (windSpeed * sin(windFrom - desiredTrack)) / TAS )
            const bearingRad = bearing * Math.PI / 180;
            const windFromRad = windDirection * Math.PI / 180;
            const crosswind = windSpeed * Math.sin(windFromRad - bearingRad);

            let wcaRad = 0;
            const ratio = crosswind / tasEstimate;
            if (Math.abs(ratio) >= 1) {
                // Can't fully correct — use maximum (90 deg) in direction of crosswind
                wcaRad = Math.sign(ratio) * Math.PI / 2;
            } else {
                wcaRad = Math.asin(ratio);
            }

            // Required heading to achieve the desired ground track
            const requiredHeading = (bearing + (wcaRad * 180 / Math.PI) + 360) % 360;

            this.targetHdg = requiredHeading;
        }


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
        if (!this.followingILS) {
            const altDiff = this.targetAlt - this.altitude;
            if (Math.abs(altDiff) > 10) {
                if (altDiff > 0) {
                    const maxAltChange = (this.climbRate / 60) * deltaTime;
                    this.altitude += Math.min(maxAltChange, altDiff);
                    this.verticalSpeed = this.climbRate;
                } else {
                    const maxAltChange = (this.descentRate / 60) * deltaTime;
                    this.altitude += Math.max(-maxAltChange, altDiff);
                    this.verticalSpeed = -this.descentRate;
                }
            } else {
                this.altitude = this.targetAlt;
                this.verticalSpeed = 0;
            }
        } else {
            // While on ILS, the descent logic is handled by verticalSpeed below
            this.altitude += (this.verticalSpeed / 60) * deltaTime;
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
        
        if (this.assignedProcedure && this.assignedProcedure.type === 'approach' && this.ilsData) {
            // --- 1. DECLARE VARIABLES (Fixes the ReferenceError) ---
            const locBearing = (this.ilsData.bearing + this.ilsData.declination + 360) % 360;
            const rwyLat = this.ilsData.lat;
            const rwyLon = this.ilsData.lon;
            const gsElevation = this.ilsData.gsElevation || 0;
            const gsAngle = this.ilsData.gsAngle || 3.0;

            // --- 2. CALCULATE ERRORS ---
            const distToThreshold = calculateDistance(this.lat, this.lon, rwyLat, rwyLon);
            
            // Cross Track Error: Distance from the extended centerline
            // Note: We use (locBearing + 180) to define the line coming "out" from the runway
            const xtkError = calculateCrossTrackError(this.lat, this.lon, rwyLat, rwyLon, (locBearing + 180) % 360);

            // --- 3. LOCALIZER INTERCEPTION LOGIC ---
            if (!this.interceptingLOC && distToThreshold < 30) {
                // Capture if within 1.0km of center and heading generally toward runway
                console.log(`[ILS] ${this.callsign}: LOC Capture Check - XTK Error: ${xtkError.toFixed(2)} km, Dist to Threshold: ${distToThreshold.toFixed(2)} km, Track: ${this.track.toFixed(2)} deg, Loc Bearing: ${locBearing} deg`);
                if (Math.abs(xtkError) < 1.0 && Math.abs(((this.track - locBearing + 540) % 360) - 180) < 30) {
                    this.interceptingLOC = true;
                    this.autopilotActive = false; // Stop following procedure waypoints
                    // Reset PID integrator/derivative state on capture to avoid spikes
                    if (this.locPID) {
                        this.locPID.integral = 0.0;
                        this.locPID.lastError = xtkError;
                    }
                    console.log(`%c[ILS] ${this.callsign}: LOCALIZER INTERCEPTED, course: ${locBearing}`, "color: #00ff00; font-weight: bold;");
                }
            }

            // --- 4. GLIDESLOPE INTERCEPTION LOGIC ---
            if (this.interceptingLOC && !this.interceptingGS) {
                const gsAngleRad = gsAngle * Math.PI / 180;
                // Calculate current height of the electronic GS beam at this distance
                const beamAlt = gsElevation + (distToThreshold * 3280.84 * Math.tan(gsAngleRad));
                
                // Capture from below (current altitude is less than or equal to beam)
                if (this.altitude <= beamAlt && Math.abs(this.altitude - beamAlt) < 100) {
                    this.interceptingGS = true;
                    this.followingILS = true;
                    console.log(`%c[ILS] ${this.callsign}: GLIDESLOPE INTERCEPTED`, "color: #ffff00; font-weight: bold;");
                }
            }

            // --- 5. GUIDANCE (Movement) ---
            
            // LATERAL GUIDANCE: Track the Localizer
            if (this.interceptingLOC) {
                // PID lateral guidance for the localizer.
                // P: proportional to cross-track error (km)
                // I: integral of error over time
                // D: rate of change of error
                const pid = this.locPID || { kp: 40, ki: 0, kd: 10, integral: 0, lastError: 0, integralLimit: 5 };
                const dt = deltaTime;
                const error = xtkError; // km

                // Integrate with anti-windup
                pid.integral += error * dt;
                pid.integral = Math.max(-pid.integralLimit, Math.min(pid.integralLimit, pid.integral));

                // Derivative
                const derivative = (error - pid.lastError) / dt;

                // PID output (degrees)
                let correction = pid.kp * error + pid.ki * pid.integral + pid.kd * derivative;
                correction = Math.max(-30, Math.min(30, correction));

                // Save state
                pid.lastError = error;
                this.locPID = pid;

                this.targetHdg = (locBearing + correction + 360) % 360;
                console.log(`[ILS] ${this.callsign}: LOC Guidance - XTK Error: ${xtkError.toFixed(2)} km, Correction: ${correction.toFixed(2)} deg, Target HDG: ${this.targetHdg.toFixed(2)} deg`);
            }

            // VERTICAL GUIDANCE: Track the Glideslope
            if (this.interceptingGS) {
                const gsAngleRad = gsAngle * Math.PI / 180;
                const beamAlt = gsElevation + (distToThreshold * 3280.84 * Math.tan(gsAngleRad));
                const altError = this.altitude - beamAlt;

                // Base descent rate (FPM) = Groundspeed * 101.2 * tan(3 degrees)
                const baseDescent = this.groundSpeed * 101.269 * Math.tan(gsAngleRad);
                
                // Adjust vertical speed to "hug" the beam
                this.verticalSpeed = -(baseDescent + (altError * 5.0));
            }

            // --- 6. LANDING TRIGGER ---
            if (distToThreshold < 0.25 || (this.interceptingGS && this.altitude < gsElevation + 50)) {
                // Use the string from your config or a hardcoded string
                this.phase = "landing"; 
                this.targetSpd = 0; // Decelerate on runway
                
                if (this.indicatedAirspeed < 30) {
                    this.landed = true;
                    console.log(`[ILS] ${this.callsign}: TERMINATED - LANDED.`);
                }
            }
        }

        
        // --- AUTOPILOT PROCEDURE FOLLOWING (with lead-turn/time-to-turn) ---
        if (this.autopilotActive && this.procedureWaypoints.length > 0 && !this.followingILS) {
            // Ensure we have a valid current waypoint index
            if (this.currentWaypointIndex < 0) {
                this.currentWaypointIndex = 0;
                const firstWp = this.procedureWaypoints[0];
                if (firstWp) this.targetWaypoint = { name: firstWp.name, lat: firstWp.lat, lon: firstWp.lon };
            }

            const currentWp = this.procedureWaypoints[this.currentWaypointIndex];
            if (currentWp) {
                const dist = calculateDistance(this.lat, this.lon, currentWp.lat, currentWp.lon);

                // Default minimum capture radius (km)
                let captureRadius = 0.2;

                // If there's a next waypoint, compute a lead/anticipation distance based
                // on the time required to turn so that at turn completion the aircraft
                // is aligned with the vector from the CURRENT procedure waypoint -> NEXT waypoint.
                const nextIndex = this.currentWaypointIndex + 1;
                const nextWp = this.procedureWaypoints[nextIndex];
                if (nextWp) {
                    // Desired ground track between the two procedure waypoints (old leg -> new leg)
                    const desiredTrack = calculateBearing(currentWp.lat, currentWp.lon, nextWp.lat, nextWp.lon);

                    // Estimate TAS for wind correction (knots)
                    const tasEstimate = this.indicatedAirspeed * (1 + (this.altitude / 1000) * 0.02) || 1.0;

                    // Compute wind correction (WCA) for the desired ground track so we know
                    // which heading will produce that ground track given the current wind.
                    const desiredTrackRad = desiredTrack * Math.PI / 180;
                    const windFromRad = windDirection * Math.PI / 180;
                    const crosswindForDesired = windSpeed * Math.sin(windFromRad - desiredTrackRad);
                    let wcaRad = 0;
                    const ratio = crosswindForDesired / tasEstimate;
                    if (Math.abs(ratio) >= 1) {
                        wcaRad = Math.sign(ratio) * Math.PI / 2;
                    } else {
                        wcaRad = Math.asin(ratio);
                    }

                    // Heading we need to fly so that ground track equals desiredTrack
                    const desiredHeading = (desiredTrack + (wcaRad * 180 / Math.PI) + 360) % 360;

                    // Angular change required from current heading to desired heading (deg, smallest)
                    let angleDiff = desiredHeading - this.heading;
                    if (angleDiff > 180) angleDiff -= 360;
                    if (angleDiff < -180) angleDiff += 360;
                    const angToTurnDeg = Math.abs(angleDiff);

                    // Time to complete the turn (s) using aircraft's turnRate (deg/sec)
                    const timeToTurn = (this.turnRate > 0) ? (angToTurnDeg / this.turnRate) : 0;

                    // Approximate current ground speed (knots) based on current heading and wind
                    const headingRad = this.heading * Math.PI / 180;
                    const tasX = tasEstimate * Math.sin(headingRad);
                    const tasY = tasEstimate * Math.cos(headingRad);
                    const windRad = (windDirection - 180) * Math.PI / 180;
                    const windX = windSpeed * Math.sin(windRad);
                    const windY = windSpeed * Math.cos(windRad);
                    const gsXapprox = tasX + windX;
                    const gsYapprox = tasY + windY;
                    const groundSpeedApprox = Math.sqrt(gsXapprox * gsXapprox + gsYapprox * gsYapprox);

                    // Distance covered while turning (km)
                    const distanceDuringTurnKm = (groundSpeedApprox * KNOTS_TO_KPS) * timeToTurn;

                    // Add buffer and scale so turns begin slightly earlier than strict math
                    captureRadius = Math.max(captureRadius, distanceDuringTurnKm * 1.15 + 0.03);

                    // When we decide to start the turn we should set target heading to the
                    // wind-corrected desired heading so by the time the aircraft completes
                    // the turn its ground track will be aligned with the leg vector.
                    // We'll apply this when we actually trigger the lead-turn below.
                    this._desiredHeadingForNextLeg = desiredHeading;
                } else {
                    // clear any cached desired heading when no next waypoint
                    this._desiredHeadingForNextLeg = null;
                }

                // If we're within the capture/lead radius, advance target to the next waypoint
                if (dist < captureRadius) {
                    if (nextWp) {
                        // Start turn toward the next waypoint now (lead turn)
                        this.currentWaypointIndex = nextIndex;
                        this.targetWaypoint = { name: nextWp.name, lat: nextWp.lat, lon: nextWp.lon };
                    } else {
                        // No further waypoint: advance index and finish procedure
                        this.currentWaypointIndex++;
                        if (this.currentWaypointIndex >= this.procedureWaypoints.length) {
                            this.autopilotActive = false;
                            this.targetWaypoint = null;
                        }
                    }
                }
            }
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

    // --- SETTER METHODS ---
    setHeading(newHeading) {
        this.targetHdg = ((newHeading % 360) + 360) % 360;
        this.targetWaypoint = null; // Clear any direct-to waypoint when heading is manually set
        this.autopilotActive = false;
    }

    setSpeed(newSpeed) {
        this.targetSpd = Math.max(120, newSpeed); // Set the target Indicated Airspeed (IAS)
    }

    setAltitude(newAltitude) {
        this.targetAlt = newAltitude;
    }

    /**
     * Tune the Localizer PID controller gains.
     * @param {number} kp - Proportional gain (deg per km)
     * @param {number} ki - Integral gain (deg per km*s)
     * @param {number} kd - Derivative gain (deg per km/s)
     * @param {number} [integralLimit=5.0] - Limit for integral term (km*s)
     */
    setLocPID(kp, ki, kd, integralLimit = 5.0) {
        this.locPID = this.locPID || { integral: 0.0, lastError: 0.0 };
        this.locPID.kp = kp;
        this.locPID.ki = ki;
        this.locPID.kd = kd;
        this.locPID.integralLimit = integralLimit;
        this.locPID.integral = 0.0;
        this.locPID.lastError = 0.0;
    }

    flyDirectTo(waypoint) {
        const index = this.procedureWaypoints.findIndex(wp => wp.name === waypoint.name && Math.abs(wp.lat - waypoint.lat) < 0.001 && Math.abs(wp.lon - waypoint.lon) < 0.001);
        if (index !== -1) {
            this.currentWaypointIndex = index;
            this.targetWaypoint = waypoint;
            this.autopilotActive = true;
        } else {
            // For non-procedure direct-to we should engage autopilot so the
            // wind-corrected heading calculation runs (and the aircraft turns).
            this.currentWaypointIndex = -1;
            this.targetWaypoint = waypoint;
            this.autopilotActive = true;
        }
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
            // Compute aircraft TAS estimate, convert heading -> vector, add wind
            // vector, then convert resulting ground vector into pixels.
            const tasEstimate = this.indicatedAirspeed * (1 + (this.altitude / 1000) * 0.02) || 1.0;
            const headingRad = (currentHeading * Math.PI) / 180;

            // Aircraft true airspeed vector (knots)
            const tasX = tasEstimate * Math.sin(headingRad);
            const tasY = tasEstimate * Math.cos(headingRad);

            // Wind: convert wind FROM direction to a TO-vector (same as update uses)
            const windRad = (windDirection - 180) * Math.PI / 180;
            const windX = windSpeed * Math.sin(windRad);
            const windY = windSpeed * Math.cos(windRad);

            // Ground speed vector (knots)
            const gsX = tasX + windX;
            const gsY = tasY + windY;

            const groundSpeedPredict = Math.sqrt(gsX * gsX + gsY * gsY);
            const trueCourseRad = Math.atan2(gsX, gsY);

            const distanceKm = (groundSpeedPredict * KNOTS_TO_KPS) * timeStep;
            const distancePixels = distanceKm / kmPerPixel;

            currentX += Math.sin(trueCourseRad) * distancePixels;
            currentY -= Math.cos(trueCourseRad) * distancePixels;
            
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
        const scale = ctx.canvas.width / ctx.canvas.getBoundingClientRect().width;
        
        // Draw aircraft symbol
        ctx.beginPath();
        ctx.arc(x, y, 4 * scale, 0, 2 * Math.PI);
        ctx.fillStyle = "#2cff05";
        ctx.fill();
        
        // Draw heading vector line
        if (this.predictedPath.length > 0) {
            ctx.beginPath();
            ctx.moveTo(x, y); // Start the line from the aircraft's current position
            this.predictedPath.forEach(point => {
                ctx.lineTo(point.x, point.y);
            });
            ctx.strokeStyle = "#2cff05";
            ctx.lineWidth = 2 * scale;
            ctx.stroke();
        }


        // Draw data tag
        const layout = calculateTagLayout(this, isHovered, ctx);
        ctx.font = `800 ${11 * scale}px Google Sans Code`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        if (isHovered) {
            // Background for expanded tag
            const bx = layout.anchor.x - (layout.block.width / 2) - layout.padding;
            const by = layout.anchor.y - (layout.block.height / 2) - layout.padding;
            const bw = layout.block.width + (layout.padding * 2);
            const bh = layout.block.height + (layout.padding * 2);

            ctx.fillStyle = "#909eae";
            ctx.fillRect(bx, by, bw, bh);

            // 2px top border
            ctx.fillStyle = "#C4D8E2";
            ctx.fillRect(bx, by, bw, 3 * scale);
            // 2px left border
            ctx.fillRect(bx, by, 3 * scale, bh);

            // Use a dark text color for contrast on the light background
            ctx.fillStyle = "#2cff05";
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
