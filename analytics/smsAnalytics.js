const Transaction = require('../models/transaction');
const AuditLog = require('../models/auditLog');

const getSmsAnalytics = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [smsSent, smsFailed, receiptsVerified] = await Promise.all([
    AuditLog.countDocuments({
      type: 'sms_sent',
      timestamp: { $gte: today }
    }),
    AuditLog.countDocuments({
      type: 'sms_failed',
      timestamp: { $gte: today }
    }),
    Transaction.countDocuments({
      type: 'milk',
      timestamp_server: { $gte: today },
      qr_hash: { $exists: true, $ne: '' }
    })
  ]);

  const totalSms = smsSent + smsFailed;
  const deliveryRate = totalSms > 0 ? ((smsSent / totalSms) * 100) : 0;

  return {
    smsSent,
    smsFailed,
    deliveryRate: deliveryRate, // ✅ FIXED: Return number, not string
    receiptsVerifiedToday: receiptsVerified
  };
};

module.exports = { getSmsAnalytics };