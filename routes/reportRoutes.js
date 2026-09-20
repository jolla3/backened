const express = require('express');
const router = express.Router();
const {
  getMonthly,
  exportCSV,
  getMonthlyPayment,
  exportMonthlySummaryExcel,
  exportBankPaymentExcel,
} = require('../controllers/reportController');

// Existing reports
router.get('/monthly', getMonthly);
router.get('/export', exportCSV);

// Monthly payment (Ledger-based) — preview + Excel
router.get('/monthly-payment', getMonthlyPayment);
router.get('/monthly-payment/excel/summary', exportMonthlySummaryExcel);
router.get('/monthly-payment/excel/bank', exportBankPaymentExcel);

module.exports = router;
