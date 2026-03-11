const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_role: { type: String, default: 'system' },
  cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  details: { type: Object, default: {} },
  ip_address: { type: String },
  correlation_id: { type: String }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);