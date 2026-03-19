const express = require('express');
const router = express.Router();
const { getAlerts, createProduct, deductStock } = require('../controllers/inventoryController');
const { getInventory } = require('../controllers/dashboardController');

router.get('/low-alerts', getAlerts);
router.get('/inventory', getInventory);
router.post('/', createProduct);
router.put('/:id/deduct', deductStock);

module.exports = router;