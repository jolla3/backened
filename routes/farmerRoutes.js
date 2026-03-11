const express = require('express');
const router = express.Router();
const {
  createFarmer,
  getFarmer,
  getFarmerByCode,
  getAllFarmers,
  updateFarmer,
  deleteFarmer,
  getBalance,
  updateBalance,
  getFarmerHistory
} = require('../controllers/farmerController');

// All routes require authentication
router.post('/', createFarmer);
router.get('/', getAllFarmers);
router.get('/code/:code', getFarmerByCode);
router.get('/:id', getFarmer);
router.get('/:id/balance', getBalance);
router.put('/:id', updateFarmer);
router.delete('/:id', deleteFarmer);
router.put('/:id/balance', updateBalance);
router.get('/:id/history', getFarmerHistory);

module.exports = router;