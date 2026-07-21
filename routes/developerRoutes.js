const express = require('express');
const router = express.Router();
const developerController = require('../controllers/developerController');
const developerAuth = require('../middlewares/developerAuth');

router.use(developerAuth);

// ─── Dashboard ─────────────────────────────────────────────
router.get('/stats', developerController.getDashboardStats);

// ─── Cooperatives ──────────────────────────────────────────
router.post('/cooperatives', developerController.createCooperative);
router.get('/cooperatives', developerController.getCooperatives);
router.get('/cooperatives/:id', developerController.getCooperative);
router.put('/cooperatives/:id', developerController.updateCooperative);
router.put('/cooperatives/:id/activate', developerController.activateCooperative);
router.put('/cooperatives/:id/deactivate', developerController.deactivateCooperative);

// ─── SUPER_ADMINs ─────────────────────────────────────────
router.get('/superadmins', developerController.getSuperAdmins);
router.get('/superadmins/:id', developerController.getSuperAdmin);
router.put('/superadmins/:id', developerController.updateSuperAdmin);
router.put('/superadmins/:id/reset-password', developerController.resetSuperAdminPassword);
router.put('/superadmins/:id/activate', developerController.activateSuperAdmin);
router.put('/superadmins/:id/deactivate', developerController.deactivateSuperAdmin);

// ─── Impersonation ─────────────────────────────────────────
router.post('/impersonate/:id', developerController.impersonate);

module.exports = router;