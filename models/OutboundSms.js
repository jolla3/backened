const mongoose = require('mongoose');

const outboundSmsSchema = new mongoose.Schema(
  {
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
      enum: ['queued', 'processing', 'sent', 'failed', 'cancelled', 'expired', 'delivered', 'undelivered'],
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
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
    },
    // Top-level provider message ID for DLR lookups (required)
    providerMessageId: {
      type: String,
      index: true,
      sparse: true,
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
    deliveredAt: {
      type: Date,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    idempotencyKey: {
      type: String,
      index: true,
    },
    deliveryRoute: {
  type: String,
  enum: ['celcom', 'gateway'],
  default: 'celcom',
  index: true,
},
  },
  {
    timestamps: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  }
);

// Unique idempotency key per cooperative
outboundSmsSchema.index(
  {
    cooperativeId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true, $ne: null },
    },
  }
);

// Main claim query index
outboundSmsSchema.index({
  cooperativeId: 1,
  status: 1,
  priority: -1,
  createdAt: 1,
});

outboundSmsSchema.index({ nextRetryAt: 1 });
outboundSmsSchema.index({ expiresAt: 1 });
outboundSmsSchema.index({ phone: 1, createdAt: -1 });
outboundSmsSchema.index({ providerMessageId: 1 }, { sparse: true });

const OutboundSms = mongoose.models.OutboundSms || mongoose.model('OutboundSms', outboundSmsSchema);
module.exports = OutboundSms;