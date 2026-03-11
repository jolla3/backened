const express = require('express');
const router = express.Router();
const {
  createPorter,
  getPorter,
  getAllPorters,
  updatePorter,
  deletePorter,
  getPerformance
} = require('../controllers/porterController');

// All routes require authentication
router.post('/', createPorter);
router.get('/', getAllPorters);
router.get('/:id', getPorter);
router.get('/:id/performance', getPerformance);
router.put('/:id', updatePorter);
router.delete('/:id', deletePorter);

module.exports = router;