const express = require('express');
const router = express.Router();
const { 
  getInventory, 
  createProduct, 
  deductStock, 
  deleteProduct 
} = require('../controllers/inventoryController');

// ✅ PROTECTED ROUTES
router.get('/', getInventory);
router.post('/', createProduct);
router.put('/:id/deduct', deductStock);
router.delete('/:id', deleteProduct); // ✅ NEW DELETE ROUTE

module.exports = router;