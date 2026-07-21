const express = require('express');
const router = express.Router();
const cooperativeController = require('../controllers/cooperativeController');
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// ─── GET /coop – anyone authenticated can view their coop ──
router.get('/', cooperativeController.getProfile);

// ─── PUT /coop – only SUPER_ADMIN can update ──────────
router.put('/', roleCheck('SUPER_ADMIN'), cooperativeController.updateProfile);

module.exports = router;