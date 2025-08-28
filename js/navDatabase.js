// js/navDatabase.js

import { minLon, maxLon, minLat, maxLat } from './utils.js';
import { setNavData, drawNavData } from './mapRenderer.js';

/**
 * @summary A helper function to execute a SQL query and map the results to an array of objects.
 * @param {Database} db - The SQL.js database object.
 * @param {string} sql - The SQL query string to execute.
 * @param {function} mapper - A function that maps a result row to an object.
 * @returns {Array} An array of objects created by the mapper function.
 */
function queryAndMap(db, sql, mapper) {
    const result = db.exec(sql);
    if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values.map(mapper);
    }
    return []; // Return an empty array if there are no results.
}

/**
 * @summary Initializes the SQL.js database and loads all necessary navigation data within the geographic bounds.
 */
export async function loadNavData(navCtx, navdataCanvas) {
  const wasmPath = '../node_modules/sql.js/dist/sql-wasm.wasm';
  const dbPath = '../NavData/navdb.s3db';

  initSqlJs({ locateFile: () => wasmPath })
    .then(SQL => {
      return fetch(dbPath)
        .then(response => response.arrayBuffer())
        .then(filebuffer => {
          const dbObject = new SQL.Database(new Uint8Array(filebuffer));

          const navData = {};

          navData.navDataPoints = queryAndMap(dbObject, `
            SELECT * FROM main.tbl_enroute_waypoints 
            WHERE waypoint_longitude BETWEEN ${minLon} AND ${maxLon} AND waypoint_latitude BETWEEN ${minLat} AND ${maxLat}
            AND waypoint_identifier NOT LIKE 'VP%' AND waypoint_type != 'U'`,
            row => ({ name: row[2], type: row[4], lon:  row[7], lat:  row[6] })
          );

          navData.airports = queryAndMap(dbObject, `
            SELECT * FROM tbl_airports 
            WHERE airport_ref_longitude BETWEEN ${minLon} AND ${maxLon} AND airport_ref_latitude BETWEEN ${minLat} AND ${maxLat} AND ifr_capability = 'Y'`,
            row => ({ icao: row[2], name: row[4], lon: row[6], lat: row[5], TA: row[10], TL: row[11], elevation: row[9] })
          );

          navData.vorData = queryAndMap(dbObject, `
            SELECT * FROM main.tbl_vhfnavaids 
            WHERE vor_longitude BETWEEN ${minLon} AND ${maxLon} AND vor_latitude BETWEEN ${minLat} AND ${maxLat} AND navaid_class like 'V%'`,
            row => ({ id: row[3], name: row[4], type: row[6], lon: row[8], lat: row[7] })
          );

          navData.terminalWaypoints = queryAndMap(dbObject, `
            SELECT * FROM tbl_terminal_waypoints
            WHERE waypoint_longitude BETWEEN ${minLon} AND ${maxLon} AND waypoint_latitude BETWEEN ${minLat} AND ${maxLat} AND waypoint_identifier NOT LIKE 'VP%'`,
            row => ({ name: row[3], airport: row[1], type: row[5], lon: row[7], lat: row[6] })
          );

          navData.runways = queryAndMap(dbObject, `
            SELECT * FROM tbl_runways
            WHERE runway_longitude BETWEEN ${minLon} AND ${maxLon} AND runway_latitude BETWEEN ${minLat} AND ${maxLat}`,
            row => ({ id: row[3], airport: row[2], lon: row[5], lat: row[4], length: row[12], width: row[13], thrElevation: row[9], thrXelevation: row[11], magBearing: row[7], trueBearing: row[8] })
          );

          navData.ilsData = queryAndMap(dbObject, `
            SELECT * FROM tbl_localizers_glideslopes
            WHERE llz_longitude BETWEEN ${minLon} AND ${maxLon} AND llz_latitude BETWEEN ${minLat} AND ${maxLat}`,
            row => ({ airport: row[2], runway: row[3], id: row[4], type: row[10], lon: row[6], lat: row[5], bearing: row[8], width: row[9], gsLat: row[11], gsLon: row[12], gsAngle: row[13], gsElevation: row[14], declination: row[15] })
          );
          
          const icaoListForSQL = navData.airports.map(a => `'${a.icao}'`).join(',');
          if (icaoListForSQL) {
            navData.approachPaths = queryAndMap(dbObject, `
              SELECT * FROM tbl_iaps WHERE airport_identifier IN (${icaoListForSQL})`,
              row => ({ icao: row[1], id: row[2], routeType: row[3], transitionId: row[4], seqno: row[5], waypointId: row[7], waypointLat: row[8], waypointLon: row[9], waypointType: row[10], turnDirection: row[11], pathTerm: row[13], navaid: row[14], navaidLat: row[15], navaidLon: row[16], arcRadius: row[17], theta: row[18], rho: row[19], magCourse: row[20], routeHoldDistanceTime: row[21], distanceOrTime: row[22], altitudeDescription: row[23], altitude1: row[24], altitude2: row[25], transitionAlt: row[26], speedLimitDescription: row[27], speedLimit: row[28], verticalAngle: row[29] })
            );
          }

          dbObject.close();
          console.log("Database loaded successfully.");
          setNavData(navData); // Pass the loaded data to the map renderer
          drawNavData(navCtx, navdataCanvas); // Initial draw
          return navData;
        });
    })
    .catch(err => {
      console.error("Database loading failed:", err);
      return {
          navDataPoints: [],
          airports: [],
          vorData: [],
          terminalWaypoints: [],
          runways: [],
          ilsData: [],
          approachPaths: []
      };

    });
}