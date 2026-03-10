const express = require('express');
const router = express.Router();
const posController = require('../controllers/posController');
const deviceMiddleware = require('../middlewares/deviceMiddleware');

// Farmer Lookup
router.get('/farmer/:farmer_code', posController.findFarmerByCode);

// Milk Transaction Recording (Requires Device Auth)
router.post('/milk', deviceMiddleware, posController.recordMilkTransaction);

// Transaction Verification (Public - for QR scanning)
router.get('/verify/:receiptNum', posController.verifyTransaction);

// Porter Performance
router.get('/porter/:porter_id/performance', posController.getPorterPerformance);

// Daily Summary
router.get('/summary', posController.getDailySummary);

// Sync Offline Transactions (Requires Device Auth)
router.post('/sync', deviceMiddleware, posController.syncOfflineTransactions);

// Farmer History
router.get('/farmer/:farmer_code/history', posController.getFarmerHistory);

module.exports = router;