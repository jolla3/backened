const express = require('express');
const router = express.Router();
const { register, approve, revoke } = require('../controllers/deviceController');
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware'); // <-- import

// ✅ Registration: any authenticated user (porter/admin) can register their own device
router.post('/register', authMiddleware, register);

// ✅ Approval & Revocation: only admins can perform these actions
router.put('/approve/:id', authMiddleware, roleCheck('SUPER_ADMIN','admin'), approve);
router.put('/revoke/:id', authMiddleware, roleCheck('SUPER_ADMIN','admin'), revoke);

module.exports = router;