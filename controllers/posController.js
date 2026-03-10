const { 
  recordMilkTransaction: recordMilkTxService, 
  getFarmerHistory: getFarmerHistoryService, 
  syncOfflineTransactions: syncOfflineTxService,
  checkDailyFraudLimit,
  verifyTransaction: verifyTxService
} = require('../services/posService');
const { milkTransactionSchema, farmerCodeSchema } = require('../validators/posValidator');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');

// 1️⃣ Find Farmer by Code
const findFarmerByCode = async (req, res) => {
  try {
    const { error } = farmerCodeSchema.validate(req.params);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { farmer_code } = req.params;
    const farmer = await Farmer.findOne({ farmer_code }).lean();
    
    if (!farmer) {
      return res.status(404).json({ error: 'Farmer not found' });
    }

    const lastTx = await Transaction.findOne({ farmer_id: farmer._id })
      .sort({ timestamp_server: -1 });

    res.json({
      success: true,
      farmer: {
        code: farmer.farmer_code,
        name: farmer.name,
        phone: farmer.phone,
        branch: farmer.branch_id,
        balance: farmer.balance,
        lastDelivery: lastTx ? lastTx.timestamp_server : null
      }
    });
  } catch (error) {
    logger.error('Find farmer failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 2️⃣ Record Milk Transaction (Controller Only Handles HTTP Layer)
const recordMilkTransaction = async (req, res) => {
  let session = null;
  
  try {
    // 8️⃣ Validation Layer
    const { error, value } = milkTransactionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { farmer_code, litres, porter_id, zone, device_seq_num, timestamp_local } = value;
    const device = req.device;

    // 5️⃣ Device Validation (Stronger)
    if (device.revoked || !device.approved) {
      return res.status(403).json({ error: 'Device not authorized' });
    }
    if (device.branch && device.branch !== req.branch_id) {
      return res.status(403).json({ error: 'Device branch mismatch' });
    }

    // Get Farmer
    const farmer = await Farmer.findOne({ farmer_code }).lean();
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

    // Get Porter
    const porter = await Porter.findById(porter_id);
    if (!porter) return res.status(404).json({ error: 'Porter not found' });

    // Branch/Zone Consistency Check
    if (!porter.zones.includes(zone)) {
      return res.status(403).json({ error: 'Porter not authorized in this zone' });
    }
    if (farmer.branch_id !== porter.branch_id) {
      return res.status(403).json({ error: 'Farmer and Porter branch mismatch' });
    }

    // Rate Lookup Safety
    const rate = await RateVersion.findOne({
      type: 'milk',
      effective_date: { $lte: new Date() }
    }).sort({ effective_date: -1 });
    if (!rate) return res.status(500).json({ error: 'No active milk rate' });

    const payout = litres * rate.rate;

    // Session Handling with Retry Logic
    session = await Transaction.startSession();
    
    let result;
    
    try {
      // 1️⃣ Transaction Logic Inside withTransaction
      await session.withTransaction(async () => {
        // 8️⃣ Fraud check inside transaction (faster with find)
        await checkDailyFraudLimit(farmer._id, litres, session);

        // Call Service Function
        result = await recordMilkTxService(session, {
          farmer_code,
          litres,
          payout,
          porter_id,
          zone,
          device_id: device.uuid,
          farmer_id: farmer._id,
          rate_version_id: rate._id,
          branch_id: farmer.branch_id,
          device_seq_num,
          timestamp_local: timestamp_local ? new Date(timestamp_local) : new Date(),
          rate
        });
      });

      // 4️⃣ Calculate new balance (avoid extra DB call)
      const newBalance = farmer.balance + payout;

      // 1️⃣ & 2️⃣ Return REAL transaction ID and receipt number
      res.json({
        success: true,
        transaction: {
          id: result.transaction._id,
          receiptNum: result.receiptNum,
          qr: result.qrUrl,
          status: 'completed'
        },
        farmer: {
          code: farmer.farmer_code,
          name: farmer.name,
          newBalance
        }
      });
    } catch (error) {
      if (error.message.includes('limit')) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Record milk failed', { error: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    // 3️⃣ Session Always Closed
    if (session) {
      session.endSession();
    }
  }
};

// 3️⃣ Verify Transaction (Fixed: Populate Rate)
const verifyTransaction = async (req, res) => {
  try {
    const { receiptNum } = req.params;
    const result = await verifyTxService(receiptNum);

    if (!result.valid) {
      return res.status(404).json({ error: result.error || 'Transaction not found' });
    }

    res.json({ success: true, verified: true, transaction: result.transaction });
  } catch (error) {
    logger.error('Verify failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 4️⃣ Get Porter Performance (Fixed: Indexes)
const getPorterPerformance = async (req, res) => {
  try {
    const { porter_id } = req.params;
    const { period = 'today' } = req.query;

    const porter = await Porter.findById(porter_id);
    if (!porter) return res.status(404).json({ error: 'Porter not found' });

    let startDate;
    if (period === 'today') {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    const stats = await Transaction.aggregate([
      { $match: { porter_id: porter._id, timestamp_server: { $gte: startDate } } },
      { $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
        totalPayout: { $sum: '$payout' }
      }}
    ]);

    res.json({
      success: true,
      porter: { id: porter._id, name: porter.name, zones: porter.zones },
      stats: stats[0] || { totalLitres: 0, transactionCount: 0, totalPayout: 0 },
      period
    });
  } catch (error) {
    logger.error('Performance failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 5️⃣ Daily Summary (Fixed: Indexes)
const getDailySummary = async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.query;
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    const summary = await Transaction.aggregate([
      { $match: { type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
      { $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
        activeFarmers: { $addToSet: '$farmer_id' }
      }}
    ]);

    const topPorter = await Transaction.aggregate([
      { $match: { type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
      { $group: { _id: '$porter_id', totalLitres: { $sum: '$litres' } } },
      { $sort: { totalLitres: -1 } },
      { $limit: 1 }
    ]);

    const topZone = await Transaction.aggregate([
      { $match: { type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
      { $group: { _id: '$zone', totalLitres: { $sum: '$litres' } } },
      { $sort: { totalLitres: -1 } },
      { $limit: 1 }
    ]);

    res.json({
      success: true,
      date,
      summary: {
        totalLitres: summary[0]?.totalLitres || 0,
        transactionCount: summary[0]?.transactionCount || 0,
        activeFarmers: summary[0]?.activeFarmers?.length || 0
      },
      topPorter: topPorter[0] ? { id: topPorter[0]._id, litres: topPorter[0].totalLitres } : null,
      topZone: topZone[0] ? { zone: topZone[0]._id, litres: topZone[0].totalLitres } : null
    });
  } catch (error) {
    logger.error('Summary failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 6️⃣ Sync Offline Transactions (Fixed: Size Limit & Idempotency)
const syncOfflineTransactions = async (req, res) => {
  try {
    const { transactions } = req.body;

    // 10️⃣ Size Protection
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'No transactions to sync' });
    }

    if (transactions.length > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 transactions per sync' });
    }

    const synced = await syncOfflineTxService(transactions);

    res.json({
      success: true,
      synced: synced.synced,
      failed: synced.failed
    });
  } catch (error) {
    logger.error('Sync failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// 7️⃣ Get Farmer History (Fixed: Query Transactions)
const getFarmerHistory = async (req, res) => {
  try {
    const { farmer_code } = req.params;
    const { limit = 50 } = req.query;

    const result = await getFarmerHistoryService(farmer_code, parseInt(limit));

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({
      success: true,
      farmer: result.farmer,
      history: result.history
    });
  } catch (error) {
    logger.error('History failed', { error: error.message });
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
  getFarmerHistory
};