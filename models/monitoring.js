// routes/monitoring.js
const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/monitoringController');
const auth = require('../middlewares/auth');

// All routes require authentication
router.use(auth);

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

// module.exports = router;