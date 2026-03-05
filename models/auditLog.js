const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  user_id: { type: String, default: 'system' },
  user_role: { type: String, default: 'system' },
  timestamp: { type: Date, default: Date.now, index: true },
  details: { type: Object, default: {} },
  ip_address: { type: String },
  correlation_id: { type: String }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);