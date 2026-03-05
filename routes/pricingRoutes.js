const express = require('express');
const router = express.Router();
const { updateRate, getHistory } = require('../controllers/pricingController');

router.post('/update-milk', updateRate);
router.get('/history/:type', getHistory);

module.exports = router;