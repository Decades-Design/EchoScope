// src/token-helper.js
const axios = require('axios');

async function refreshNavigraphToken(refreshToken) {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.NAVIGRAPH_CLIENT_ID);
    params.append('client_secret', process.env.NAVIGRAPH_CLIENT_SECRET);
    params.append('refresh_token', refreshToken);

    const response = await axios.post('https://identity.navigraph.com/connect/token', params);
    
    return {
      success: true,
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in
    };
  } catch (error) {
    console.error('Token refresh failed:', error.response?.data || error.message);
    return { success: false };
  }
}

async function validateFmsDataSubscription(accessToken) {
  try {
    const response = await axios.get('https://api.navigraph.com/v1/subscriptions/valid', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const fmsSubscription = response.data.find(sub => sub.type === 'fmsdata');
    if (!fmsSubscription) return { active: false };

    const activeDate = new Date(fmsSubscription.date_active);
    const expiryDate = new Date(fmsSubscription.date_expiry);
    const now = new Date();

    if (now >= activeDate && now <= expiryDate) {
      return { active: true, type: 'fmsdata' };
    }
    return { active: false };
  } catch (error) {
    return { active: false };
  }
}

module.exports = { refreshNavigraphToken, validateFmsDataSubscription };