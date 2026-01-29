// js/procedures.js

import { approachPaths, ilsData } from './mapRenderer.js';
import { latLonToPixel, calculateDistance } from './utils.js';
import { activeAirports } from './config.js';

// Valid approach types (A = Approach, I = Initial Approach)
const approachTypes = ['A', 'I'];

// Module state
export let hoveredProcedure = null; // array of {lat,lon}
let selectedPlane = null;
let selectedApproach = null;
let selectedTransition = null;

// DOM elements (cached)
const panel = document.getElementById('procedures-panel');
const planeIdEl = document.getElementById('proc-plane-id');
const assignedEl = document.getElementById('proc-assigned');
const approachListEl = document.getElementById('approach-list');
const transitionListEl = document.getElementById('transition-list');
const assignBtn = document.getElementById('assign-proc');
const closeBtn = document.getElementById('close-proc');

function clearHover() {
	hoveredProcedure = null;
}

export function buildProcedurePoints(icao, approachId, transitionId) {
	if (!approachId) return null;
	// Gather approach segments for this approachId.
	// If transitionId === null, we explicitly want the standard (no-transition) segment
	// which is represented by rows where r.transitionId is falsy. If transitionId is
	// provided (string), we pick only rows for that transition.
	let rows;
	if (transitionId === null) {
		rows = approachPaths.filter(r => 
			r.icao === icao && 
			r.id === approachId && 
			(!r.transitionId || r.transitionId === '')

		);
	} else if (transitionId) {
		rows = approachPaths.filter(r => 
			r.icao === icao && 
			r.id === approachId && 
			r.transitionId === transitionId
		);
	} else {
		// If transitionId is undefined, fall back to the full approach (all pieces)
		rows = approachPaths.filter(r => 
			r.icao === icao && 
			r.id === approachId
		);
	}

	// Find index of first missed approach point (M as third char in waypointType)
	const mapIdx = rows.findIndex(r => r.waypointType && String(r.waypointType)[2] === 'M');
	// If found, truncate rows at that point (exclude MAP and subsequent points)
	if (mapIdx !== -1) {
		rows = rows.slice(0, mapIdx);
		if (rows.length === 0) return null;
	}
	// Sort by seqno
	rows.sort((a,b) => (a.seqno || 0) - (b.seqno || 0));
	// Map to lat/lon
	const pts = rows.map(r => ({ name: r.waypointId, lat: r.waypointLat, lon: r.waypointLon }));
	return pts;
}

function approachMatchesActiveRunway(approachId, icao) {
	if (!approachId) return false;
	const active = (activeAirports && activeAirports[icao]) ? activeAirports[icao] : [];
	if (!active || active.length === 0) return true; // no configured active runways -> don't filter

	// approachId format: 1st char = approach type (ignore), 2-3 = runway number, 4 (optional) = L/C/R
	const idRunNum = (approachId.length >= 3) ? approachId.substring(1,3) : '';
	const idDesignator = (approachId.length >= 4) ? approachId.charAt(3).toUpperCase() : '';

	for (const ar of active) {
		if (!ar) continue;
		const arStr = String(ar).toUpperCase().replace(/^RW/, '');
		const arNumMatch = arStr.match(/\d+/);
		if (!arNumMatch) continue;
		const arNum = arNumMatch[0].padStart(2, '0');
		const arDesignatorMatch = arStr.match(/[A-Z]$/);
		const arDesignator = arDesignatorMatch ? arDesignatorMatch[0] : '';

		if (arNum === idRunNum) {
			if (!arDesignator) return true; // active runway has no side letter -> accept any
			if (arDesignator === idDesignator) return true; // exact side match
		}
	}
	return false;
}

function populateApproachList(plane) {
	approachListEl.innerHTML = '';
	selectedApproach = null;
	selectedTransition = null;
	transitionListEl.innerHTML = '(Select an approach)';

	// Filter approaches by destination, allowed route types (R/I) and active runway
	const approachesForIcao = approachPaths.filter(ap => {
		if (ap.icao !== plane.destination) return false;
		const route = String(ap.routeType || '').toUpperCase();
		if (!['R', 'I'].includes(route)) return false; // only RNAV ('R') or ILS ('I') approaches
		if (!ap.id) return false;
		return approachMatchesActiveRunway(ap.id, plane.destination);
	});
	const approachIds = [...new Set(approachesForIcao.map(a => a.id))].sort();
	if (approachIds.length === 0) {
		approachListEl.innerHTML = '(No approaches found)';
		return;
	}

	approachIds.forEach(id => {
		const item = document.createElement('div');
		item.className = 'proc-item';
		item.textContent = id;
		item.onmouseenter = () => {
			const pts = buildProcedurePoints(plane.destination, id, null);
			hoveredProcedure = pts;
		};
		item.onmouseleave = () => { clearHover(); };
		item.onclick = () => {
			selectedApproach = id;
			// populate transitions for this approach
			populateTransitionList(plane, id);
			// show selection visually
			Array.from(approachListEl.children).forEach(ch => ch.style.backgroundColor = '');
			item.style.backgroundColor = '#333';
		};
		approachListEl.appendChild(item);
	});
}

function populateTransitionList(plane, approachId) {
	transitionListEl.innerHTML = '';
	selectedTransition = null;
		let rows = approachPaths.filter(ap => 
			ap.icao === plane.destination && 
			ap.id === approachId
		);
		// Find index of first missed approach point (M as third char in waypointType)
		const mapIdx = rows.findIndex(r => r.waypointType && String(r.waypointType)[2] === 'M');
		// If found, truncate rows at that point (exclude MAP and subsequent points)
		if (mapIdx !== -1) {
			rows = rows.slice(0, mapIdx);
		}
		// Collect unique, non-empty transition IDs. Exclude values equal to approachId
		// and falsy values (which correspond to the standard/no-transition segment).
		const transitions = [...new Set(rows.map(r => r.transitionId).filter(tid => tid && tid !== approachId))].sort();
	if (transitions.length === 0) {
		// Even if there are no transitions, offer 'None' as the standard option
		const noneItem = document.createElement('div');
		noneItem.className = 'proc-item';
		noneItem.textContent = 'None';
		noneItem.onmouseenter = () => {
			const pts = buildProcedurePoints(plane.destination, approachId, null);
			hoveredProcedure = pts;
		};
		noneItem.onmouseleave = () => { clearHover(); };
		noneItem.onclick = () => {
			selectedTransition = null;
			Array.from(transitionListEl.children).forEach(ch => ch.style.backgroundColor = '');
			noneItem.style.backgroundColor = '#333';
		};
		transitionListEl.appendChild(noneItem);
		return;
	}

	// Always add a 'None' option at the top so users can explicitly pick the standard (no-transition)
	const noneItem = document.createElement('div');
	noneItem.className = 'proc-item';
	noneItem.textContent = 'None';
	noneItem.onmouseenter = () => {
		const pts = buildProcedurePoints(plane.destination, approachId, null);
		hoveredProcedure = pts;
	};
	noneItem.onmouseleave = () => { clearHover(); };
	noneItem.onclick = () => {
		selectedTransition = null;
		Array.from(transitionListEl.children).forEach(ch => ch.style.backgroundColor = '');
		noneItem.style.backgroundColor = '#333';
	};
	transitionListEl.appendChild(noneItem);
	transitions.forEach(tid => {
		const item = document.createElement('div');
		item.className = 'proc-item';
		item.textContent = tid;
		item.onmouseenter = () => {
			const pts = buildProcedurePoints(plane.destination, approachId, tid);
			hoveredProcedure = pts;
		};
		item.onmouseleave = () => { clearHover(); };
		item.onclick = () => {
			selectedTransition = tid;
			Array.from(transitionListEl.children).forEach(ch => ch.style.backgroundColor = '');
			item.style.backgroundColor = '#333';
		};
		transitionListEl.appendChild(item);
	});
}

export function showProceduresPanel(plane, hitbox) {
	selectedPlane = plane;
	panel.style.display = 'block';
	planeIdEl.textContent = `Procedures for ${plane.callsign} (${plane.destination})`;
	assignedEl.textContent = plane.assignedProcedure ? `Assigned: ${plane.assignedProcedure.type} ${plane.assignedProcedure.id || ''}` : 'No procedure assigned';
	populateApproachList(plane);
	// If a procedure is already assigned, highlight it in the lists
	if (plane.assignedProcedure && plane.assignedProcedure.type === 'approach') {
		const assignedId = plane.assignedProcedure.id;
		const assignedTrans = plane.assignedProcedure.transition;
		// Highlight approach
		Array.from(approachListEl.children).forEach(ch => {
			if (ch.textContent === assignedId) ch.style.backgroundColor = '#333';
			else ch.style.backgroundColor = '';
		});
		selectedApproach = assignedId;
		// Populate transitions for the assigned approach and highlight
		populateTransitionList(plane, assignedId);
		if (assignedTrans) {
			Array.from(transitionListEl.children).forEach(ch => {
				if (ch.textContent === assignedTrans) ch.style.backgroundColor = '#333';
				else ch.style.backgroundColor = '';
			});
			selectedTransition = assignedTrans;
		} else {
			// If assigned transition is null/None, highlight the 'None' element
			const none = Array.from(transitionListEl.children).find(ch => ch.textContent === 'None');
			if (none) none.style.backgroundColor = '#333';
			selectedTransition = null;
		}
	}
}

export function hideProceduresPanel() {
	panel.style.display = 'none';
	selectedPlane = null;
	selectedApproach = null;
	selectedTransition = null;
	clearHover();
}

assignBtn.addEventListener('click', () => {
	if (!selectedPlane || !selectedApproach) return;

    // 1. Assign the basic procedure
    selectedPlane.assignedProcedure = { 
        type: 'approach', 
        id: selectedApproach, 
        transition: selectedTransition 
    };

    // 2. Build and assign waypoints
    const pts = buildProcedurePoints(selectedPlane.destination, selectedApproach, selectedTransition);
    selectedPlane.procedureWaypoints = pts || [];
    selectedPlane.currentWaypointIndex = 0;
    selectedPlane.autopilotActive = true;

    if (selectedPlane.procedureWaypoints.length > 0) {
        selectedPlane.targetWaypoint = selectedPlane.procedureWaypoints[0];
    }

    // 3. Robust ILS Searching
    console.log(`[PROCEDURE] Matching ILS for ${selectedPlane.callsign} at ${selectedPlane.destination}...`);
    
    let foundIls = null;
    
    // Search strategy: Find ILS belonging to destination airport 
    // where the runway ID matches the approach name (e.g., "ILS 35R" contains "35R")
    const searchTarget = selectedApproach.toUpperCase();
    
    foundIls = ilsData.find(i => {
        const isSameAirport = i.airport === selectedPlane.destination;
        // Check if the runway ID (like '35R') is mentioned in the approach name (like 'ILS 35R')
        const runwayMatch = searchTarget.includes(i.runway.replace('RW', ''));
        return isSameAirport && runwayMatch;
    });

    // Fallback: If no runway match, take the closest ILS to the first waypoint
    if (!foundIls && selectedPlane.procedureWaypoints.length > 0) {
        const firstWp = selectedPlane.procedureWaypoints[0];
        let minDist = 999;
        ilsData.forEach(i => {
            if (i.airport === selectedPlane.destination) {
                const d = calculateDistance(i.lat, i.lon, firstWp.lat, firstWp.lon);
                if (d < minDist) {
                    minDist = d;
                    foundIls = i;
                }
            }
        });
    }

    selectedPlane.ilsData = foundIls;
    
    // Reset ILS flags for the new approach
    selectedPlane.interceptingLOC = false;
    selectedPlane.interceptingGS = false;
    selectedPlane.followingILS = false;

    console.log(`[PROCEDURE] Assigned to ${selectedPlane.callsign}. ILS Found:`, !!foundIls);
    
    hideProceduresPanel();
});


closeBtn.addEventListener('click', () => {
	hideProceduresPanel();
});

export function getHoveredProcedure() {
	return hoveredProcedure;
}

