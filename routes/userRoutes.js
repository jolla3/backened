const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// ─── Public (within auth) ─────────────────────────────────
router.get('/me', userController.getMe);
router.put('/me/password', userController.changeOwnPassword);

// ─── SUPER_ADMIN only ─────────────────────────────────────
router.post('/', roleCheck('SUPER_ADMIN'), userController.createUser);
router.get('/', roleCheck('SUPER_ADMIN'), userController.getUsers);
router.get('/:id', roleCheck('SUPER_ADMIN'), userController.getUser);
router.put('/:id', roleCheck('SUPER_ADMIN'), userController.updateUser);
router.put('/:id/deactivate', roleCheck('SUPER_ADMIN'), userController.deactivateUser);
router.put('/:id/activate', roleCheck('SUPER_ADMIN'), userController.activateUser);
router.put('/:id/reset-password', roleCheck('SUPER_ADMIN'), userController.resetPassword);

module.exports = router;