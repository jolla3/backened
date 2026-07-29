const mongoose = require('mongoose');

const outboundSmsSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    index: true,
  },
  message: {
    type: String,
    required: true,
  },
  from: {
    type: String,
  },
  type: {
    type: String,
    enum: ['general', 'monthly_summary', 'feed_purchase', 'milk_receipt', 'custom'],
    default: 'general',
  },
  priority: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'sent', 'failed', 'cancelled', 'expired'],
    default: 'queued',
    index: true,
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
  },
  gatewayId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SmsGateway',
  },
  retryCount: {
    type: Number,
    default: 0,
  },
  maxRetries: {
    type: Number,
    default: 3,
  },
  nextRetryAt: {
    type: Date,
    default: null,   // ✅ explicit default null for consistency
  },
  expiresAt: {
    type: Date,
    default: null,   // ✅ new field for job expiration
  },
  error: {
    type: String,
  },
  providerResponse: {
    type: mongoose.Schema.Types.Mixed,
  },
  processingStartedAt: {
    type: Date,
  },
  sentAt: {
    type: Date,
  },
  failedAt: {
    type: Date,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes
outboundSmsSchema.index({ cooperativeId: 1, status: 1, priority: -1, createdAt: 1 });
outboundSmsSchema.index({ status: 1, nextRetryAt: 1 });
outboundSmsSchema.index({ phone: 1, createdAt: -1 });
// Optional index for expiresAt if you query by it often
outboundSmsSchema.index({ expiresAt: 1 });

const OutboundSms = mongoose.models.OutboundSms || mongoose.model('OutboundSms', outboundSmsSchema);
module.exports = OutboundSms;