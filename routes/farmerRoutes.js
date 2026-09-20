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
  getFarmerHistory,
  exportFarmersExcel,
} = require('../controllers/farmerController');

const deductionRoutes = require('./deductionRoutes');

// Farmer CRUD
router.post('/', createFarmer);
router.get('/', getAllFarmers);

// Excel export — must be registered before /:id routes
router.get('/export/excel', exportFarmersExcel);

router.get('/code/:code', getFarmerByCode);
router.get('/:id', getFarmer);
router.get('/:id/balance', getBalance);
router.put('/:id', updateFarmer);
router.delete('/:id', deleteFarmer);
router.put('/:id/balance', updateBalance);
router.get('/:id/history', getFarmerHistory);

// Nested deduction route
// → POST /api/farmers/:farmerId/deductions
router.use('/:farmerId/deductions', deductionRoutes);

module.exports = router;
