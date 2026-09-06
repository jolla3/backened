const express = require('express');
const router = express.Router();
const developerController = require('../controllers/developerController');
const accountingController = require('../controllers/accountingController');
const developerAuth = require('../middlewares/developerAuth');

router.use(developerAuth);

// ─── Dashboard ─────────────────────────────────────────────
router.get('/stats', developerController.getDashboardStats);

// ─── Cooperatives ──────────────────────────────────────────
// ⚠️ SPECIFIC routes MUST come before dynamic routes (/:id) ⚠️
router.get('/cooperatives/usage', accountingController.getCooperativeUsageSummary);
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

// ─── SMS Accounting (all under /dev) ──────────────────────
// Provider
router.get('/provider/status', accountingController.getProviderStatus);
router.post('/refresh-balance', accountingController.refreshBalance);

// Usage
router.get('/system/usage', accountingController.getSystemUsage);
router.get('/usage/timeline', accountingController.getUsageTimeline);   // ✅ NEW

// Balance history
router.get('/balance/history', accountingController.getBalanceHistory);

// Cooperatives usage
router.get('/cooperatives/usage', accountingController.getCooperativeUsageSummary);
router.get('/cooperative/:cooperativeId/usage', accountingController.getCooperativeUsage);

// Messages
router.get('/messages', accountingController.getSmsMessages);

// Reconciliation
router.get('/reconciliation', accountingController.getReconciliation);

module.exports = router;