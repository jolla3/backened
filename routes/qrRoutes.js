const express = require('express');
const router = express.Router();
const { generateQR, verifyQR } = require('../controllers/qrController');

router.post('/generate', generateQR);
router.post('/verify', verifyQR);

module.exports = router;