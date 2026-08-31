// routes/settlementRoutes.js
const express = require('express');
const router = express.Router();
const settlementController = require('../controllers/settlementController');
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');

router.use(authMiddleware);
router.use(roleCheck('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')); // ensure roleCheck accepts array

router.post('/generate', settlementController.generateMonthlySettlements);

router.get('/batches', settlementController.getBatches);
router.get('/batches/:batchId', settlementController.getBatch);
router.get('/batches/:batchId/settlements', settlementController.getBatchSettlements);

router.post('/batches/:batchId/approve', settlementController.approveBatch);
router.put('/batches/:batchId/settle', settlementController.settleBatch);
router.post('/batches/:batchId/close', settlementController.closeBatch);

router.get('/overrides/pending', settlementController.getPendingOverrides);
router.post('/:settlementId/override/request', settlementController.requestSettlementOverride);
router.post('/:settlementId/override/approve', settlementController.approveSettlementOverride);
router.post('/:settlementId/override/reject', settlementController.rejectSettlementOverride);

router.get('/farmers/:farmerId', settlementController.getFarmerSettlements);

module.exports = router;