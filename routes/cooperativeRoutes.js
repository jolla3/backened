const express = require('express');
const router = express.Router();
const { getCooperative, setupCooperative, updateCooperative } = require('../controllers/cooperativeController');
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');

// Get cooperative details
router.get('/', getCooperative);

// Setup cooperative (first time)
router.post('/setup', setupCooperative);

// Update cooperative details
router.put('/',  updateCooperative);

module.exports = router;