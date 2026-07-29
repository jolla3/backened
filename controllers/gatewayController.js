const gatewayService = require('../services/gatewayService');
const smsConfig = require('../config/smsConfig');
const logger = require('../utils/logger');

// ─── Token rotation (two‑phase) ────────────────────────────
const rotateToken = async (req, res) => {
  try {
    const { gatewayId } = req.params;
    const audit = { userId: req.user.id, ip: req.ip || req.connection.remoteAddress };
    const result = await gatewayService.rotateToken(gatewayId, audit);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Token rotation failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const confirmRotation = async (req, res) => {
  try {
    const { gatewayId } = req.params;
    const gateway = await gatewayService.confirmRotation(gatewayId);
    res.json({ success: true, gateway });
  } catch (error) {
    logger.error('Confirm rotation failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Provisioning ──────────────────────────────────────────
const getProvisionData = async (req, res) => {
  // Disable caching
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader('ETag');

  console.log('📨 PROVISION REQUEST HEADERS:');
  console.log('  user-agent:', req.headers['user-agent']);
  console.log('  origin:', req.headers['origin']);
  console.log('  host:', req.headers['host']);
  console.log('  x-device-id:', req.headers['x-device-id']);
  console.log('  referer:', req.headers['referer']);
  console.log('  authorization:', req.headers.authorization ? 'Present' : 'Missing');

  try {
    const deviceId = req.headers['x-device-id'];
    if (!deviceId) {
      return res.status(400).json({ error: 'X-Device-ID header required' });
    }
    const cooperativeId = req.user.cooperativeId;
    const data = await gatewayService.getProvisionData(deviceId, cooperativeId);
    res.json(data);
  } catch (error) {
    console.error('❌ Provision error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ─── Heartbeat ─────────────────────────────────────────────
const heartbeat = async (req, res) => {
  try {
    const gatewayId = req.gateway.gatewayId; // UUID
    const data = req.body;
    const gateway = await gatewayService.processHeartbeat(gatewayId, data);
    res.json({ success: true, gateway });
  } catch (error) {
    logger.error('Heartbeat failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Jobs ──────────────────────────────────────────────────
const claimJobs = async (req, res) => {
  try {
    const gatewayId = req.gateway.gatewayId; // UUID
    const limit = parseInt(req.query.limit) || 10;

    const canPoll = await gatewayService.tryClaimPoll(gatewayId);
    if (!canPoll) {
      return res.status(429).json({
        error: 'Polling too frequently. Please wait a few seconds.',
        retryAfter: smsConfig.gatewayPollIntervalSeconds || 3,
      });
    }

    const jobs = await gatewayService.claimJobs(gatewayId, limit);
    res.json({ success: true, jobs });
  } catch (error) {
    logger.error('Claim jobs failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ✅ CRITICAL FIX: use req.gateway._id (ObjectId) instead of req.gateway.gatewayId
const markSent = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { providerResponse } = req.body;

    const payloadSize = JSON.stringify(req.body).length;
    if (payloadSize > 1024 * 1024) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const gatewayObjectId = req.gateway._id; // Mongo ObjectId
    const job = await gatewayService.markJobSent(jobId, gatewayObjectId, providerResponse);
    res.json({ success: true, job });
  } catch (error) {
    logger.error('Mark sent failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ✅ CRITICAL FIX: use req.gateway._id
const markFailed = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { error: errorMsg, providerResponse } = req.body;

    const payloadSize = JSON.stringify(req.body).length;
    if (payloadSize > 1024 * 1024) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const gatewayObjectId = req.gateway._id; // Mongo ObjectId
    const job = await gatewayService.markJobFailed(jobId, gatewayObjectId, errorMsg, providerResponse);
    res.json({ success: true, job });
  } catch (error) {
    logger.error('Mark failed failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const getStatus = async (req, res) => {
  try {
    const gatewayId = req.gateway.gatewayId;
    const gateway = await gatewayService.getGatewayStatus(gatewayId);
    res.json({ success: true, gateway });
  } catch (error) {
    logger.error('Get status failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const retryFailedJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await gatewayService.retryFailedJob(jobId);
    res.json({ success: true, job });
  } catch (error) {
    logger.error('Retry failed job error', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  rotateToken,
  confirmRotation,
  getProvisionData,
  heartbeat,
  claimJobs,
  markSent,
  markFailed,
  getStatus,
  retryFailedJob,
};