// CORE SIMULATION CONFIGURATION
export const centerCoord = { lat: 45.44944444, lon: 9.27833333 };
export const radarRangeNM = 30;

export const activeAirports = {
  "LIML": ["RW35"],
  "LIMC": ["RW35R"]
};

export const SWEEP_INTERVAL_MS = 2000;

export let windDirection = 270; // Wind from 240 degrees
export let windSpeed = 50;      // 15 knots

// AIRCRAFT PERFORMANCE
export const AIRCRAFT_PERFORMANCE  = {
  "L": { turnRate: 3.5, climbRate: 1800, descentRate: 2000, accelerationRate: 4.0, decelerationRate: 3.0 },
  "M": { turnRate: 3.0, climbRate: 2200, descentRate: 2500, accelerationRate: 3.0, decelerationRate: 2.0 },
  "H": { turnRate: 2.5, climbRate: 1500, descentRate: 2200, accelerationRate: 2.0, decelerationRate: 1.5 },
  "J": { turnRate: 2.0, climbRate: 1200, descentRate: 2000, accelerationRate: 1.5, decelerationRate: 1.0 }
};

// FLIGHT PHASES
export const phase = {
  TAKEOFF: "takeoff",
  INITIAL_CLIMB: "initial_climb",
  CLIMB: "climb",
  CRUISE: "cruise",
  DESCENT: "descent",
  FINAL_DESCENT: "final_descent",
  FINAL_APPROACH: "final_approach",
  LANDING: "landing"
};
