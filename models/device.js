const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true, index: true },
  hardware_id: { type: String, default: null },
  approved: { type: Boolean, default: false },
  revoked: { type: Boolean, default: false },
  revoked_timestamp: { type: Date, default: null },
  last_seen: { type: Date, default: Date.now },
  cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Device', deviceSchema);