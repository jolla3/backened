const SmsGateway = require('../models/SmsGateway');
const gatewayService = require('../services/gatewayService');
const { getCachedGateway, setCachedGateway } = require('../cache/gatewayCache');

const DEBUG = process.env.NODE_ENV !== 'production';

// ─── Full runtime middleware ──────────────────────────────
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

  const isValid = await gatewayService.verifyGatewayToken(gatewayId, token);
  if (!isValid) {
    console.warn(`❌ Invalid gateway credentials for ${gatewayId}`);
    return res.status(403).json({ error: 'Invalid gateway credentials' });
  }

  const device = gateway.deviceId;
  if (!device) return res.status(403).json({ error: 'Device not found' });
  if (!device.approved) return res.status(403).json({ error: 'Device not approved' });
  if (device.revoked) return res.status(403).json({ error: 'Device has been revoked' });

  if (gateway.status === 'pending') return res.status(403).json({ error: 'Gateway awaiting activation' });
  if (gateway.status === 'revoked') return res.status(403).json({ error: 'Gateway has been revoked' });
  if (gateway.status === 'needs_update') return res.status(403).json({ error: 'Gateway app version needs update' });

  req.gateway = gateway;
  next();
};

// ─── Provisioning middleware ──────────────────────────────
const provisionAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const gatewayId = req.headers['x-gateway-id'];

  // ─── DEBUG LOGGING ──────────────────────────────────────────
  console.log('🔐 provisionAuth');
  console.log('  Authorization header :', authHeader);
  console.log('  X-Gateway-Id         :', gatewayId);
  // ──────────────────────────────────────────────────────────

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!gatewayId) {
    return res.status(400).json({ error: 'X-Gateway-Id header is required' });
  }

  // Fetch fresh from DB – don't rely on cache for provisioning
  const gateway = await SmsGateway.findOne({ gatewayId }).populate('deviceId');
  if (!gateway) {
    return res.status(403).json({ error: 'Gateway not found' });
  }

  const device = gateway.deviceId;
  if (!device) return res.status(403).json({ error: 'Device not found' });
  if (device.revoked) return res.status(403).json({ error: 'Device has been revoked' });

  const isValid = await gatewayService.verifyGatewayToken(gatewayId, token);
  if (!isValid) {
    console.warn(`❌ Invalid provisioning credentials for ${gatewayId}`);
    return res.status(403).json({ error: 'Invalid gateway credentials' });
  }

  req.gateway = gateway;
  next();
};

module.exports = { gatewayAuth, provisionAuth };