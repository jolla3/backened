const express = require('express');
const router = express.Router();
const gatewayController = require('../controllers/gatewayController');

// ✅ authMiddleware exports an object → destructure
const { authMiddleware } = require('../middlewares/authMiddleware');

// ✅ gatewayAuth exports a function → import directly
const gatewayAuth = require('../middlewares/gatewayAuth');

// ─── Admin‑only endpoints ──────────────────────────────────
router.post('/:gatewayId/rotate-token', authMiddleware, gatewayController.rotateToken);
router.post('/:gatewayId/confirm-rotation', authMiddleware, gatewayController.confirmRotation);
router.get('/provision', authMiddleware, gatewayController.getProvisionData);
router.post('/provision/confirm', authMiddleware, gatewayController.confirmProvision);
router.post('/admin/retry/:jobId', authMiddleware, gatewayController.retryFailedJob);

// ─── Gateway‑authenticated endpoints ──────────────────────
router.post('/heartbeat', gatewayAuth, gatewayController.heartbeat);
router.get('/jobs', gatewayAuth, gatewayController.claimJobs);
router.post('/job/:jobId/sent', gatewayAuth, gatewayController.markSent);
router.post('/job/:jobId/failed', gatewayAuth, gatewayController.markFailed);
router.get('/status', gatewayAuth, gatewayController.getStatus);

module.exports = router;