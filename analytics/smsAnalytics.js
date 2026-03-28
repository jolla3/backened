const AuditLog = require('../models/auditLog');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');

const getSmsAnalytics = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [todayStats, weekStats] = await Promise.all([
    AuditLog.aggregate([
      { $match: { type: { $in: ['sms_sent', 'sms_failed'] }, timestamp: { $gte: today } } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]),
    AuditLog.aggregate([
      { $match: { type: { $in: ['sms_sent', 'sms_failed'] }, timestamp: { $gte: weekAgo } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, type: '$type' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.day': 1 } }
    ])
  ]);

  const sentToday = todayStats.find(s => s._id === 'sms_sent')?.count || 0;
  const failedToday = todayStats.find(s => s._id === 'sms_failed')?.count || 0;
  const totalToday = sentToday + failedToday;
  const deliveryRateToday = totalToday ? ((sentToday / totalToday) * 100).toFixed(1) : '0';

  // Daily breakdown for last 7 days
  const dailyData = weekStats.reduce((acc, item) => {
    const day = item._id.day;
    if (!acc[day]) acc[day] = { sent: 0, failed: 0 };
    if (item._id.type === 'sms_sent') acc[day].sent = item.count;
    else acc[day].failed = item.count;
    return acc;
  }, {});

  const dailyChart = Object.entries(dailyData).map(([date, data]) => ({
    date,
    sent: data.sent,
    failed: data.failed,
    rate: data.sent + data.failed ? (data.sent / (data.sent + data.failed) * 100).toFixed(1) : 0
  }));

  // Receipts verified today
  const receiptsVerified = await Transaction.countDocuments({
    type: 'milk',
    cooperativeId: cooperative._id,
    timestamp_server: { $gte: today },
    qr_hash: { $exists: true, $ne: '' }
  });

  // Suggest optimal sending time based on peak engagement (simulated)
  const optimalTime = '9:00 AM'; // could be derived from analytics

  return {
    smsSent: sentToday,
    smsFailed: failedToday,
    deliveryRate: deliveryRateToday + '%',
    receiptsVerifiedToday: receiptsVerified,
    dailyTrend: dailyChart,
    optimalSendingTime: optimalTime,
    weeklyTotal: weekStats.reduce((s, i) => s + i.count, 0),
  };
};

module.exports = { getSmsAnalytics };