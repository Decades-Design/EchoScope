// /api/auth/login.js
const crypto = require('crypto');
const cookie = require('cookie');

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

module.exports = (req, res) => {
  const code_verifier = base64URLEncode(crypto.randomBytes(32));
  const state = base64URLEncode(crypto.randomBytes(16));

  const code_challenge = base64URLEncode(sha256(code_verifier));

  // Store the verifier and state in a secure, HTTP-only cookie
  res.setHeader('Set-Cookie', [
    cookie.serialize('auth_code_verifier', code_verifier, { httpOnly: true, secure: true, path: '/', maxAge: 60 * 15 }),
    cookie.serialize('auth_state', state, { httpOnly: true, secure: true, path: '/', maxAge: 60 * 15 })
  ]);

  const authUrl = new URL('https://identity.navigraph.com/connect/authorize');
  authUrl.searchParams.set('client_id', process.env.NAVIGRAPH_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set('scope', 'openid offline_access fmsdata'); // Add scopes you need
  authUrl.searchParams.set('redirect_uri', `${ process.env.APP_URL }/api/auth/callback`);
  authUrl.searchParams.set('code_challenge', code_challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Redirect the user to Navigraph's login page
  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
};