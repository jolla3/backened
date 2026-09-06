const mongoose = require('mongoose');

const smsBalanceSnapshotSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['celcom', 'gateway', 'other'],
      default: 'celcom',
      required: true,
    },
    balance: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'KES',
    },
    checkedAt: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['health_check', 'manual', 'recovery', 'manual_refresh'],
      default: 'health_check',
    },
    metadata: {
      type: Object,
      default: {},
    },
    // Deduplication key: prevents multiple snapshots for the same provider+balance within the same interval bucket
    dedupKey: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

// Compound index for quick balance history by provider
smsBalanceSnapshotSchema.index({ provider: 1, checkedAt: -1 });

// Additional index for periodic audit snapshots (optional)
smsBalanceSnapshotSchema.index(
  { provider: 1, balance: 1, checkedAt: -1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('SmsBalanceSnapshot', smsBalanceSnapshotSchema);