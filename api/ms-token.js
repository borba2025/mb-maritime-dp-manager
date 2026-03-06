// Vercel Serverless Function — Proxy for Microsoft OAuth Client Credentials
// This runs server-side, avoiding CORS issues with login.microsoftonline.com

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Client secret from env var (set in Vercel dashboard) or request body
  const { client_secret } = req.body || {};
  const SECRET = client_secret || process.env.MS_CLIENT_SECRET || '';

  if (!SECRET) {
    return res.status(400).json({ error: 'No client secret configured' });
  }

  const CLIENT_ID = '8dd557f7-2ec9-4b91-8c61-fec096945474';
  const TENANT_ID = '3c31da93-f0fa-43a6-970e-b40b12bd81f2';
  const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

  try {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: SECRET,
      scope: 'https://graph.microsoft.com/.default'
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // Return token data
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type
    });
  } catch (error) {
    console.error('Token proxy error:', error);
    return res.status(500).json({ error: 'Failed to obtain token', details: error.message });
  }
}
