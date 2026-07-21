// routes/zoneRoutes.js
const express = require('express');
const router = express.Router();
const zoneController = require('../controllers/zoneController');
// const auth = require('../middlewares/authMiddleware');
const { authMiddleware } = require('../middlewares/authMiddleware');
router.use(authMiddleware);

router.post('/', zoneController.createZone);
router.get('/', zoneController.getAllZones);
router.get('/active', zoneController.getActiveZones);
router.get('/:id', zoneController.getZoneById);
router.put('/:id', zoneController.updateZone);
router.delete('/:id', zoneController.deleteZone);

module.exports = router;