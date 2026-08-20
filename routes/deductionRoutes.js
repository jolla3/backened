const express = require('express');
const router = express.Router({ mergeParams: true }); // important for :farmerId
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');
const { createDeduction } = require('../controllers/deductionController');

// POST /api/farmers/:farmerId/deductions
router.post(
  '/',
  authMiddleware,
  createDeduction
);

module.exports = router;