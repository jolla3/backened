const express = require('express');
const router = express.Router();
const gatewayController = require('../controllers/gatewayController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { gatewayAuth, provisionAuth } = require('../middlewares/gatewayAuth');

router.post('/:gatewayId/rotate-token', authMiddleware, gatewayController.rotateToken);
router.post('/:gatewayId/confirm-rotation', authMiddleware, gatewayController.confirmRotation);
router.get('/provision', authMiddleware, gatewayController.getProvisionData);

router.post('/provision/confirm', provisionAuth, gatewayController.confirmProvision);

router.post('/admin/retry/:jobId', authMiddleware, gatewayController.retryFailedJob);

router.post('/heartbeat', gatewayAuth, gatewayController.heartbeat);
router.get('/jobs', gatewayAuth, gatewayController.claimJobs);
router.post('/job/:jobId/sent', gatewayAuth, gatewayController.markSent);
router.post('/job/:jobId/failed', gatewayAuth, gatewayController.markFailed);
router.get('/status', gatewayAuth, gatewayController.getStatus);

module.exports = router;