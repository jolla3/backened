const express = require('express');
const router = express.Router();
const { purchaseFeed } = require('../controllers/feedPurchaseController');

router.post('/purchase', purchaseFeed);

module.exports = router;