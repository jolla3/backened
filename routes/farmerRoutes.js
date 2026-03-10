const express = require('express');
const router = express.Router();
const {
  createFarmer,
  getFarmer,
  getBalance,
  updateFarmer,
  deleteFarmer,
  updateBalance,
  getBalanceHistory
} = require('../controllers/farmerController');

router.post('/', createFarmer);
router.get('/:id', getFarmer);
router.get('/:id/balance', getBalance);
router.put('/:id', updateFarmer);
router.delete('/:id', deleteFarmer);
router.put('/:id/balance', updateBalance);
router.get('/:id/history', getBalanceHistory);

module.exports = router;