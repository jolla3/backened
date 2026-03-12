const Transaction = require('../models/transaction');
const AuditLog = require('../models/auditLog');

const getSmsAnalytics = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

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
      cooperativeId: cooperative._id,
      timestamp_server: { $gte: today },
      qr_hash: { $exists: true, $ne: '' }
    })
  ]);

  const totalSms = smsSent + smsFailed;
  const deliveryRate = totalSms > 0 ? ((smsSent / totalSms) * 100) : 0;

  return {
    smsSent,
    smsFailed,
    deliveryRate: deliveryRate,
    receiptsVerifiedToday: receiptsVerified
  };
};

module.exports = { getSmsAnalytics };