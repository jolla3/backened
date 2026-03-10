const express = require('express');
const router = express.Router();
const {  getSummary, getFinancial, getDevices, getAlerts, getCompleteOverview, getAnalytics, getInventory } = require('../controllers/dashboardController');



router.get('/summary', getSummary);
router.get('/financial', getFinancial);
router.get('/analytics', getAnalytics);
router.get('/devices', getDevices);
router.get('/alerts', getAlerts);
router.get('/inventory', getInventory);
router.get('/overview', getCompleteOverview); 

module.exports = router;