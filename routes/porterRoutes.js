// routes/porterRoutes.js
const express = require('express');
const router = express.Router();
const {
  createPorter,
  getPorter,
  getAllPorters,
  updatePorter,
  deletePorter,
  getPerformance,
  getSummary,
  getTrends,
  getFarmers
} = require('../controllers/porterController');

// ─── CRUD ──────────────────────────────────────────────
router.post('/', createPorter);
router.get('/', getAllPorters);
router.get('/:id', getPorter);
router.put('/:id', updatePorter);
router.delete('/:id', deletePorter);

// ─── Performance ────────────────────────────────────────
router.get('/:id/performance', getPerformance);       // legacy
router.get('/:id/summary', getSummary);               // ✅ correct
router.get('/:id/trends', getTrends);                 // ✅ correct
router.get('/:id/farmers', getFarmers);               // ✅ correct

module.exports = router;