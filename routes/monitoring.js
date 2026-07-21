// routes/monitoring.js
const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/monitoringController');
// const auth = require('../middlewares/authMiddleware');
const { authMiddleware } = require('../middlewares/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// Add new routes
router.get('/daily-farmers', monitoringController.getDailyFarmers);
router.get('/daily-inventory', monitoringController.getDailyInventory);
router.get('/farmers/:id/performance', monitoringController.getFarmerPerformance);

router.get('/dashboard', monitoringController.getDashboard);
router.get('/graphs', monitoringController.getGraphs);
router.get('/zones', monitoringController.getZones);
router.get('/farmers', monitoringController.getFarmers);
router.get('/farmers/:id/details', monitoringController.getFarmerDetails);
router.get('/porters', monitoringController.getPorters);
router.get('/sessions', monitoringController.getSessions);
router.get('/forecast', monitoringController.getForecast);
router.get('/alerts', monitoringController.getAlerts);
router.get('/export', monitoringController.exportData);
router.get('/farmers/:id/purchases', monitoringController.getFarmerPurchases);

module.exports = router;