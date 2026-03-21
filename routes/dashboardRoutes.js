const express = require('express');
const router = express.Router();
const { 
  getSummary, getFinancial, getAnalytics, getDevices, getAlerts, getInventory, getCompleteOverview,
  getCEOStats, getIntelligence, getSystemOverview, getTasks 
} = require('../controllers/dashboardController');

router.get('/summary', getSummary);
router.get('/financial', getFinancial);
router.get('/analytics', getAnalytics);
router.get('/devices', getDevices);
router.get('/alerts', getAlerts);
router.get('/inventory', getInventory);
router.get('/overview', getCompleteOverview);

// ✅ NEW ROUTES
router.get('/ceo-stats', getCEOStats);
router.get('/intelligence', getIntelligence);
router.get('/system', getSystemOverview);
router.get('/tasks', getTasks);

module.exports = router;