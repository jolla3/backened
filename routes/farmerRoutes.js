const express = require('express');
const router = express.Router();
const { createFarmer, getBalance, updateBalance } = require('../controllers/farmerController');

router.post('/', createFarmer);
router.get('/:id/balance', getBalance);
router.put('/:id/balance', updateBalance);

module.exports = router;