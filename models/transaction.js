const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  device_id: { type: String, required: true, index: true },
  receipt_num: { type: String, required: true },
  qr_hash: { type: String, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  device_seq_num: { type: Number, required: true },
  server_seq_num: { type: Number, default: 0 },
  timestamp_local: { type: Date, required: true },
  timestamp_server: { type: Date, default: Date.now },
  digital_signature: { type: String },
  idempotency_key: { type: String, required: true, unique: true },
  soft_delta: { type: Number, default: 0 },
  type: { type: String, enum: ['milk', 'feed'], required: true },
  litres: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  payout: { type: Number, default: 0 },
  cost: { type: Number, default: 0 },
  farmer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer' },
  rate_version_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RateVersion' }
}, { timestamps: true });

transactionSchema.index({ timestamp_server: 1 });
transactionSchema.index({ device_id: 1, device_seq_num: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);