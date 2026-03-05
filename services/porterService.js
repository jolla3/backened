const Porter = require('../models/porter');
const Transaction = require('../models/transaction');

const getPerformance = async (porterId) => {
  const porter = await Porter.findById(porterId);
  if (!porter) return null;

  const stats = await Transaction.aggregate([
    { $match: { device_id: porterId } },
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' }
    }}
  ]);

  return {
    ...porter.toObject(),
    performance: stats[0] || { totalLitres: 0, totalPayout: 0 }
  };
};

const createPorter = async (data) => {
  return await Porter.create(data);
};

module.exports = { getPerformance, createPorter };