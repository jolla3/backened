const express = require('express');
const router = express.Router();
const { getAlerts, createProduct, deductStock } = require('../controllers/inventoryController');

router.get('/low-alerts', getAlerts);
router.post('/', createProduct);
router.put('/:id/deduct', deductStock);

module.exports = router;