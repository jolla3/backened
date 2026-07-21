const express = require('express');
const router = express.Router();
const { generateQR, verifyQR } = require('../controllers/qrController');
const { authMiddleware } = require('../middlewares/authMiddleware');

// All QR endpoints require authentication
router.use(authMiddleware);

router.post('/generate', generateQR);
router.get('/verify/:num', verifyQR);
module.exports = router;