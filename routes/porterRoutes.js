const express = require('express');
const router = express.Router();
const {
  getPerformance,
  createPorter,
  getPorter,
  updatePorter,
  deletePorter
} = require('../controllers/porterController');

router.post('/', createPorter);
router.get('/:id', getPorter);
router.get('/:id/performance', getPerformance);
router.put('/:id', updatePorter);
router.delete('/:id', deletePorter);

module.exports = router;