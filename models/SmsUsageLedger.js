const mongoose = require('mongoose');

const smsUsageLedgerSchema = new mongoose.Schema(
  {
    // Reference to the OutboundSms job that caused this usage
    smsJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OutboundSms',
      required: true,
      unique: true, // ensures idempotency
    },
    cooperativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cooperative',
      required: true,
      index: true,
    },
    farmerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farmer',
      index: true,
    },
    provider: {
      type: String,
      enum: ['celcom', 'gateway', 'other'],
      default: 'celcom',
      required: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
    },
    segments: {
      type: Number,
      required: true,
      min: 1,
    },
    // Rate version used for this usage
    rateVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SmsRateVersion',
      required: true,
    },
    unitCost: {
      type: Number,
      required: true,
    },
    totalCost: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'KES',
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'unknown'],
      default: 'sent',
    },
    providerMessageId: {
      type: String,
      index: true,
    },
    providerAcceptedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

// Indexes for queries
smsUsageLedgerSchema.index({ cooperativeId: 1, createdAt: -1 });
smsUsageLedgerSchema.index({ provider: 1, createdAt: -1 });
smsUsageLedgerSchema.index({ providerMessageId: 1 });

module.exports = mongoose.model('SmsUsageLedger', smsUsageLedgerSchema);