const { 
  recordMilkTransaction: recordMilkTxService, 
  getFarmerHistory: getFarmerHistoryService, 
  syncOfflineTransactions: syncOfflineTxService,
  verifyTransaction: verifyTxService,
  findFarmerByCode: findFarmerService,
  getPorterPerformance: getPorterPerformanceService,
  getDailySummary: getDailySummaryService,
  getFarmersCollectedByPorter: getFarmersCollectedByPorterService,   // 🆕
  getPerformanceChartData: getPerformanceChartDataService             // 🆕
} = require('../services/posService');
const { milkTransactionSchema, farmerCodeSchema } = require('../validators/posValidator');
const logger = require('../utils/logger');

// 1️⃣ Find Farmer by Code
const findFarmerByCode = async (req, res) => {
  try {
    const { error } = farmerCodeSchema.validate(req.params);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const result = await findFarmerService(req.params.farmer_code);
    
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Find farmer failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 2️⃣ Record Milk Transaction + PRINT RECEIPT
const recordMilkTransaction = async (req, res) => {
  let session = null;
  
  try {
    const { error, value } = milkTransactionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { farmer_code, litres, porter_id, zone, device_seq_num, timestamp_local, cooperativeId } = value;
    const device = req.device;
    const branch_id = req.branch_id;

    if (device.revoked || !device.approved) {
      return res.status(403).json({ error: 'Device not authorized' });
    }
    if (device.branch && device.branch !== branch_id) {
      return res.status(403).json({ error: 'Device branch mismatch' });
    }

    session = await Transaction.startSession();
    session.startTransaction();
    
    const result = await recordMilkTxService(session, {
      farmer_code,
      litres,
      porter_id,
      zone,
      device_id: device.uuid,
      branch_id,
      device_seq_num,
      timestamp_local: timestamp_local ? new Date(timestamp_local) : new Date(),
      cooperativeId
    });

    await session.commitTransaction();

    res.json({
      success: true,
      transaction: {
        id: result.transaction._id,
        receiptNum: result.receiptNum,
        serverSeqNum: result.serverSeqNum,
        qrUrl: result.qrUrl,
        status: 'completed'
      },
      farmer: {
        code: result.farmer_code,
        name: result.farmer_name,
        newBalance: result.newBalance
      },
      receipt: {
        thermalData: result.thermalReceipt.thermalReceipt,
        qrImage: result.thermalReceipt.qrImage,
        preview: result.receiptPreview,
        receiptNum: result.receiptNum
      }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      session.endSession();
    }
    
    logger.error('Record milk failed', { error: error.message });
    if (error.message.includes('limit') || error.message.includes('rate')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  } finally {
    if (session) session.endSession();
  }
};

// 3️⃣ Verify Transaction
const verifyTransaction = async (req, res) => {
  try {
    const { receiptNum } = req.params;
    const result = await verifyTxService(receiptNum);

    if (!result.valid) {
      return res.status(404).json({ error: result.error || 'Transaction not found' });
    }

    res.json({ 
      success: true, 
      verified: true, 
      transaction: result.transaction 
    });
  } catch (error) {
    logger.error('Verify failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 4️⃣ Porter Performance (basic stats)
const getPorterPerformance = async (req, res) => {
  try {
    const { porter_id } = req.params;
    const { period = 'today' } = req.query;

    const result = await getPorterPerformanceService(porter_id, period);
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Performance failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 5️⃣ Daily Summary
const getDailySummary = async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.query;
    const result = await getDailySummaryService(date);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Summary failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 6️⃣ Sync Offline Transactions
const syncOfflineTransactions = async (req, res) => {
  try {
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'No transactions to sync' });
    }
    if (transactions.length > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 transactions per sync' });
    }

    const result = await syncOfflineTxService(transactions);
    res.json({ success: true, synced: result.synced, failed: result.failed });
  } catch (error) {
    logger.error('Sync failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 7️⃣ Farmer History
const getFarmerHistory = async (req, res) => {
  try {
    const { farmer_code } = req.params;
    const { limit = 50 } = req.query;

    const result = await getFarmerHistoryService(farmer_code, parseInt(limit));
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ success: true, farmer: result.farmer, history: result.history });
  } catch (error) {
    logger.error('History failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 🆕 8️⃣ Get Farmers Collected by a Porter
const getFarmersCollectedByPorter = async (req, res) => {
  try {
    const { porter_id } = req.params;
    const { startDate, endDate } = req.query;

    const result = await getFarmersCollectedByPorterService(porter_id, startDate, endDate);
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Get farmers collected by porter failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 🆕 9️⃣ Chart Data for Graphs
const getPerformanceChartData = async (req, res) => {
  try {
    const { entity, id, period, metric, startDate, endDate } = req.query;

    const result = await getPerformanceChartDataService({
      entity,
      id,
      period,
      metric,
      startDate,
      endDate
    });

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Chart data failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  findFarmerByCode,
  recordMilkTransaction,
  verifyTransaction,
  getPorterPerformance,
  getDailySummary,
  syncOfflineTransactions,
  getFarmerHistory,
  getFarmersCollectedByPorter,   // 🆕
  getPerformanceChartData         // 🆕
};