const express = require('express');
const router = express.Router();
const { getPerformance, createPorter } = require('../controllers/porterController');

router.get('/:id/performance', getPerformance);
router.post('/', createPorter);

module.exports = router;