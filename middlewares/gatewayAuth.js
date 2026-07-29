const SmsGateway = require('../models/SmsGateway');
const gatewayService = require('../services/gatewayService');

// ─── Cache ──────────────────────────────────────────────────────
// TTL now matches the heartbeat interval (60s) + grace period.
// Active gateways heartbeat every 60s → cache for 5 minutes.
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes (was 30s)

const getCachedGateway = (gatewayId) => {
  const entry = cache.get(gatewayId);
  if (entry && entry.expires > Date.now()) {
    return entry.gateway;
  }
  return null;
};

const setCachedGateway = (gatewayId, gateway) => {
  cache.set(gatewayId, { gateway, expires: Date.now() + CACHE_TTL });
};

// ─── Debug logging toggle ─────────────────────────────────────
const DEBUG = process.env.NODE_ENV !== 'production';

// ─── Middleware ───────────────────────────────────────────────
const gatewayAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  const gatewayId = req.headers['x-gateway-id'];

  if (!gatewayId) {
    return res.status(400).json({ error: 'X-Gateway-Id header is required' });
  }

  // 1. Try cache
  let gateway = getCachedGateway(gatewayId);
  if (!gateway) {
    if (DEBUG) console.log(`🔍 Gateway not in cache, querying DB for ${gatewayId}`);
    gateway = await SmsGateway.findOne({ gatewayId }).populate('deviceId');
    if (!gateway) {
      return res.status(403).json({ error: 'Gateway not found' });
    }
    setCachedGateway(gatewayId, gateway);
  } else {
    if (DEBUG) console.log(`✅ Gateway found in cache`);
  }

  // 2. Verify token
  const isValid = await gatewayService.verifyGatewayToken(gatewayId, token);
  if (!isValid) {
    // Only log failures
    console.warn(`❌ Invalid gateway credentials for ${gatewayId}`);
    return res.status(403).json({ error: 'Invalid gateway credentials' });
  }

  // 3. Check Device status
  const device = gateway.deviceId;
  if (!device) return res.status(403).json({ error: 'Device not found' });
  if (!device.approved) return res.status(403).json({ error: 'Device not approved' });
  if (device.revoked) return res.status(403).json({ error: 'Device has been revoked' });

  // 4. Check Gateway status
  if (gateway.status === 'pending') return res.status(403).json({ error: 'Gateway awaiting activation' });
  if (gateway.status === 'revoked') return res.status(403).json({ error: 'Gateway has been revoked' });
  if (gateway.status === 'needs_update') return res.status(403).json({ error: 'Gateway app version needs update' });

  req.gateway = gateway;
  next();
};

module.exports = gatewayAuth; 