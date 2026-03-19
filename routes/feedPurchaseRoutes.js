const express = require('express');
const router = express.Router();
const { getFeedPurchaseFarmers, purchaseFeed } = require('../controllers/feedPurchaseController');

// ✅ PROTECTED ROUTES (admin only)
router.get('/farmers/search',  getFeedPurchaseFarmers);  // ✅ ADDED
router.post('/purchase',  purchaseFeed);

module.exports = router;