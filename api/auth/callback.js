// /api/auth/callback.js
const axios = require('axios');
const cookie = require('cookie');

const { createAuthCookies } = require('../api/utils/token-helper.js');

module.exports = async (req, res) => {
  const { code, state } = req.query;
  const cookies = cookie.parse(req.headers.cookie || '');
  const storedState = cookies.auth_state;
  const codeVerifier = cookies.auth_code_verifier;

  // Verify the 'state' parameter to prevent CSRF attacks
  if (!state || state !== storedState) {
    return res.status(400).send('State mismatch error.');
  }

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append("redirect_uri", `${ process.env.APP_URL }/api/auth/callback`);
    params.append('client_id', process.env.NAVIGRAPH_CLIENT_ID);
    params.append('client_secret', process.env.NAVIGRAPH_CLIENT_SECRET);
    params.append('code_verifier', codeVerifier);

    const response = await axios.post('https://identity.navigraph.com/connect/token', params);

    const { access_token, refresh_token, expires_in } = response.data;

    // Securely store tokens in cookies
    res.setHeader('Set-Cookie', createAuthCookies(access_token, refresh_token, expires_in));

    // Redirect user back to the main application page
    res.writeHead(302, { Location: '/' });
    res.end();

  } catch (error) {
    console.error('Error exchanging code for token:', error.response ? error.response.data : error.message);
    res.status(500).send('Authentication failed.');
  }
};