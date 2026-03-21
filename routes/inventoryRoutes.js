const express = require('express');
const router = express.Router();
const { getAlerts, createProduct, deductStock, getInventory } = require('../controllers/inventoryController');

router.get('/', getInventory);
router.post('/', createProduct);
router.put('/:id/deduct', deductStock);

module.exports = router;
