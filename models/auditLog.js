const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  developerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Developer',
  },
  userId: {                    // optional – target/actor user
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  action: {
    type: String,
    enum: [
      'COOPERATIVE_CREATED',
      'COOPERATIVE_UPDATED',
      'COOPERATIVE_ACTIVATED',
      'COOPERATIVE_DEACTIVATED',
      'SUPER_ADMIN_CREATED',
      'SUPER_ADMIN_UPDATED',
      'SUPER_ADMIN_PASSWORD_RESET',
      'SUPER_ADMIN_ACTIVATED',
      'SUPER_ADMIN_DEACTIVATED',
      'IMPERSONATION',
      'SETTLEMENT_GENERATED',
      'SETTLEMENT_BATCH_APPROVED',
      'SETTLEMENT_BATCH_SETTLING_STARTED',
      'SETTLEMENT_BATCH_SETTLED',
      'SETTLEMENT_BATCH_PARTIALLY_SETTLED',
      'SETTLEMENT_BATCH_CLOSED',
      'SETTLEMENT_MISMATCH_DETECTED',
      'SETTLEMENT_OVERRIDE_REQUESTED',
      'SETTLEMENT_OVERRIDE_APPROVED',
      'SETTLEMENT_OVERRIDE_REJECTED',
    ],
    required: true,
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: Date.now },
});

auditLogSchema.index({ developerId: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
module.exports = AuditLog;