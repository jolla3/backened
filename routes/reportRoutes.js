const express = require('express');
const router = express.Router();
const { getMonthly, exportCSV } = require('../controllers/reportController');

router.get('/monthly', getMonthly);
router.get('/export', exportCSV);

module.exports = router;