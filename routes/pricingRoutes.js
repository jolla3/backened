const express = require('express');
const router = express.Router();
const {  updateMilkRate, updateInventoryCategory, getMilkHistory, getCurrentPrices, getInventoryCategories } = require('../controllers/pricingController');

router.post('/milk',updateMilkRate);
router.patch('/inventory/:itemId',updateInventoryCategory);
router.get('/milk-history',getMilkHistory);
router.get('/categories',getInventoryCategories);
router.get('/current',getCurrentPrices);

module.exports = router;