// models/SmsLog.js
const mongoose = require('mongoose');

const smsLogSchema = new mongoose.Schema({
  to: { type: String, required: true, index: true },
  message: { type: String, required: true },
  from: { type: String },
  provider: { type: String, required: true },
  status: {
    type: String,
    enum: ['queued', 'processing', 'sent', 'failed'],
    default: 'queued',
  },
  providerResponse: { type: mongoose.Schema.Types.Mixed },
  error: { type: String },
  retryCount: { type: Number, default: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, index: true },
  sentAt: { type: Date },
});

smsLogSchema.index({ to: 1, createdAt: -1 });
smsLogSchema.index({ status: 1 });

const SmsLog = mongoose.models.SmsLog || mongoose.model('SmsLog', smsLogSchema);
module.exports = SmsLog;