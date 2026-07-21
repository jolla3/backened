const express = require('express');
const router = express.Router();
const settlementController = require('../controllers/settlementController');
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');

// ✅ roleCheck expects an array
router.use(authMiddleware);
router.use(roleCheck('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'));

router.post('/generate', settlementController.generateMonthlySettlements);
router.post('/batches/:batchId/approve', settlementController.approveBatch); // ✅ added
router.put('/batches/:batchId/settle', settlementController.settleBatch);
router.get('/batches', settlementController.getBatches);
router.get('/batches/:batchId', settlementController.getBatch);
router.get('/batches/:batchId/settlements', settlementController.getBatchSettlements);
router.get('/farmers/:farmerId', settlementController.getFarmerSettlements);

module.exports = router;