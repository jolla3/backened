const express = require('express');
const router = express.Router();
const accountingController = require('../controllers/accountingController');
const { authMiddleware } = require('../middlewares/authMiddleware');

// All routes require authentication
router.get('/provider/status', authMiddleware, accountingController.getProviderStatus);
router.get('/system/usage', authMiddleware, accountingController.getSystemUsage);
router.get('/balance/history', authMiddleware, accountingController.getBalanceHistory);
router.get('/cooperatives/usage', authMiddleware, accountingController.getCooperativeUsageSummary);
router.get('/cooperative/:cooperativeId/usage', authMiddleware, accountingController.getCooperativeUsage);

module.exports = router;