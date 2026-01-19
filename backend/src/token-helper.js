// /api/utils/token-helper.js
const axios = require('axios');
const cookie = require('cookie');

/**
 * Creates the Set-Cookie headers for the browser.
 * @param {string} accessToken - The new access token.
 * @param {string} refreshToken - The new refresh token.
 * @param {number} expiresIn - The expiration time for the access token.
 * @returns {Array<string>} An array of cookie strings.
 */
function createAuthCookies(accessToken, refreshToken, expiresIn) {
    return [
      cookie.serialize('access_token', accessToken, { httpOnly: true, secure: true, path: '/', maxAge: expiresIn }),
      cookie.serialize('refres  h_token', refreshToken, { httpOnly: true, secure: true, path: '/' })
    ];
}

/**
 * Uses a refresh token to get a new access token and refresh token from Navigraph.
 * @param {string} refreshToken - The refresh token from the user's cookie.
 * @returns {object} An object containing { newAccessToken, newRefreshToken, newExpiresIn }.
 */
async function refreshAccessToken(refreshToken, res) {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.NAVIGRAPH_CLIENT_ID);
    params.append('client_secret', process.env.NAVIGRAPH_CLIENT_SECRET);
    params.append('refresh_token', refreshToken);

    const response = await axios.post('https://identity.navigraph.com/connect/token', params);
    
    const { access_token, refresh_token, expires_in } = response.data;
    
    // VERY IMPORTANT: Log this for debugging, especially the new refresh token.
    console.log("Successfully refreshed tokens. New refresh token received.");

    res.setHeader('Set-Cookie', createAuthCookies(access_token, refresh_token, expires_in));

    return {
      newAccessToken: access_token,
      newRefreshToken: refresh_token,
      newExpiresIn: expires_in
    };
  } catch (error) {
    console.error('CRITICAL: Token refresh failed. The refresh token is likely invalid. Clearing cookies and forcing re-login.', error.response ? error.response.data : error.message);

    res.setHeader('Set-Cookie', [
      cookie.serialize('access_token', '', { httpOnly: true, secure: true, path: '/', maxAge: 0 }),
      cookie.serialize('refresh_token', '', { httpOnly: true, secure: true, path: '/', maxAge: 0 })
    ]);

    res.writeHead(302, { Location: '/' });

    res.end();

    return null; 
  }
}

/**
 * Validates a user's Navigraph subscription to ensure they have an active 'fmsdata' plan.
 *
 * @param {string} accessToken - The user's current access token for authentication.
 * @returns {Promise<object>} A promise that resolves to an object with the subscription status.
 *          - On success: { ActiveSubscription: true, subscription_name: "...", type: "fmsdata" }
 *          - On failure (no valid subscription or error): { ActiveSubscription: false }
 */
async function validateFmsDataSubscription(accessToken) {
  // Define a default response object for failure cases.
  const invalidResponse = { ActiveSubscription: false };

  if (!accessToken) {
    console.error("Subscription check failed: No access token provided.");
    return invalidResponse;
  }

  try {
    // 1. Send a GET request to the Navigraph subscription endpoint.
    const response = await axios.get('https://api.navigraph.com/v1/subscriptions/valid', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    // The response.data is expected to be an array of subscription objects.
    const subscriptions = response.data;
    if (!Array.isArray(subscriptions)) {
      console.error("Subscription check failed: API did not return an array.");
      return invalidResponse;
    }

    // 2. Find the specific subscription for 'fmsdata'.
    const fmsSubscription = subscriptions.find(sub => sub.type === 'fmsdata');

    // If no 'fmsdata' subscription exists, the user is not entitled to the data.
    if (!fmsSubscription) {
      console.log("User does not have an 'fmsdata' subscription.");
      return invalidResponse;
    }

    // 3. Process the response to ensure the current date is within the active period.
    const activeDate = new Date(fmsSubscription.date_active);
    const expiryDate = new Date(fmsSubscription.date_expiry);
    const currentDate = new Date(); // Gets the current date and time in UTC

    // Check if the current date is between the active and expiry dates.
    if (currentDate >= activeDate && currentDate <= expiryDate) {
      console.log("User has a valid and active 'fmsdata' subscription.");
      // 4. If so, return the successful validation details.
      return {
        ActiveSubscription: true,
        subscription_name: fmsSubscription.subscription_name,
        type: fmsSubscription.type
      };
    } else {
      console.log("User's 'fmsdata' subscription has expired or is not yet active.");
      return invalidResponse;
    }

  } catch (error) {
    // Handle potential errors, such as a 401 if the access token itself is expired.
    console.error("API call to check subscription failed:", error.response ? error.response.data : error.message);
    return invalidResponse;
  }
}

module.exports = { refreshAccessToken, createAuthCookies, validateFmsDataSubscription };