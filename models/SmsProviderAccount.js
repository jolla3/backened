const mongoose = require('mongoose');

const smsProviderAccountSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['celcom', 'gateway', 'other'],
      default: 'celcom',
      required: true,
      unique: true,
    },
    partnerId: {
      type: String,
    },
    senderId: {
      type: String,
      required: true,
    },
    currentBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      default: 'KES',
    },
    lastCheckedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['healthy', 'unhealthy', 'blocked'],
      default: 'healthy',
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

module.exports = mongoose.model('SmsProviderAccount', smsProviderAccountSchema);