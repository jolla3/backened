const gatewayService = require('../services/gatewayService');
const smsConfig = require('../config/smsConfig');
const logger = require('../utils/logger');
const { clearGatewayCache } = require('../cache/gatewayCache');

// ─── Provisioning (Phase 1: prepare) ──────────────────────
const getProvisionData = async (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader('ETag');

  try {
    const deviceId = req.headers['x-device-id'];
    if (!deviceId) {
      return res.status(400).json({ error: 'X-Device-ID header required' });
    }
    const cooperativeId = req.user.cooperativeId;
    const data = await gatewayService.prepareProvision(deviceId, cooperativeId);
    res.json(data);
  } catch (error) {
    logger.error('Provision error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ─── Provisioning (Phase 2: confirm) ──────────────────────

// ─── Provisioning (Phase 2: confirm) ──────────────────────
const confirmProvision = async (req, res) => {
  try {
    const gateway = req.gateway; // loaded by provisionAuth
    if (!gateway) {
      return res.status(401).json({ error: 'Gateway not authenticated' });
    }

    const result = await gatewayService.confirmProvision(gateway);
    clearGatewayCache(gateway.gatewayId);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Confirm provision failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Heartbeat ─────────────────────────────────────────────
const heartbeat = async (req, res) => {
  try {
    const gatewayId = req.gateway.gatewayId;
    const data = req.body;
    await gatewayService.processHeartbeat(gatewayId, data);
    // Invalidate cache so the next request fetches fresh gateway status
    clearGatewayCache(gatewayId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Heartbeat failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Token rotation ────────────────────────────────────────
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
    // Also clear the gateway cache because status may have changed
    clearGatewayCache(gatewayId);
    res.json({ success: true, gateway });
  } catch (error) {
    logger.error('Confirm rotation failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};


// ─── Jobs ──────────────────────────────────────────────────
const claimJobs = async (req, res) => {
  try {
    const gatewayId = req.gateway.gatewayId;
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

const markSent = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { providerResponse } = req.body;
    const gatewayObjectId = req.gateway._id;
    const job = await gatewayService.markJobSent(jobId, gatewayObjectId, providerResponse);
    res.json({ success: true, job });
  } catch (error) {
    logger.error('Mark sent failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const markFailed = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { error: errorMsg, providerResponse } = req.body;
    const gatewayObjectId = req.gateway._id;
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
  confirmProvision,
  heartbeat,
  claimJobs,
  markSent,
  markFailed,
  getStatus,
  retryFailedJob,
};