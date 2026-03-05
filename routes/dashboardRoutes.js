const express = require('express');
const router = express.Router();
const { getTotals, getOverview } = require('../controllers/dashboardController');

router.get('/totals', getTotals);
router.get('/overview', getOverview);

module.exports = router;