const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  developerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Developer',
    required: true,
  },
  userId: {                    // ✅ optional – target user being acted upon
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  action: {                    // ✅ only one action field
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
      'SETTLEMENT_BATCH_SETTLED',
    ],
    required: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ipAddress: {
    type: String,
  },
  userAgent: {
    type: String,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

auditLogSchema.index({ developerId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
module.exports = AuditLog;