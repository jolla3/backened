// routes/milkRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const {
  getDailyTotal,
  getMonthlySummary,
  addManualMilkEntry
} = require('../controllers/milkController');

// All routes require authentication
router.use(authMiddleware);

// Existing routes
router.get('/daily-total', getDailyTotal);
router.get('/monthly-summary', getMonthlySummary);

// ✅ NEW: Manual milk entry (admin / back-office)
router.post('/manual', addManualMilkEntry);

module.exports = router;