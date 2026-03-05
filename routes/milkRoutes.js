const express = require('express');
const router = express.Router();
const { getDailyTotal, getMonthlySummary } = require('../controllers/milkController');

router.get('/daily-total', getDailyTotal);
router.get('/monthly-summary', getMonthlySummary);

module.exports = router;