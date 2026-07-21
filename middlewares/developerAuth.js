// middleware/developerAuth.js
const crypto = require('crypto');

const developerAuth = (req, res, next) => {
  const apiKey = req.headers['x-developer-key'] || req.headers.authorization?.replace('Bearer ', '');
  const expected = process.env.DEVELOPER_API_KEY;

  if (!expected) {
    console.error('[DeveloperAuth] DEVELOPER_API_KEY not set in environment');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (!apiKey || !crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid or missing developer API key' });
  }

  // Use a fixed developer ID from environment, or fallback to a known ID
  // This developer should exist in the Developer collection (seeded)
  req.user = {
    id: process.env.DEVELOPER_ID || '67a1b2c3d4e5f6789abcdef0', // must match a real Developer document
    email: 'developer@system.local',
    role: 'DEVELOPER',
  };
  next();
};

module.exports = developerAuth;