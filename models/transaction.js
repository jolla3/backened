const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  device_id: {
    type: String,
    
    index: true
  },
  receipt_num: {
    type: String,
    
    
    index: true
  },
  qr_hash: {
    type: String,
    
    
    index: true
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed',
    index: true
  },
  device_seq_num: {
    type: Number,
    default: 0,
    index: true
  },
  server_seq_num: {
    type: String,
    
  },
  timestamp_local: {
    type: Date,
    
    index: true
  },
  timestamp_server: {
    type: Date,
    default: Date.now,
    index: true
  },
  digital_signature: {
    type: String,
    
  },
  idempotency_key: {
    type: String,
    
    
    index: true
  },
  soft_delta: {
    type: Number,
    default: 0
  },
  type: {
    type: String,
    enum: ['milk', 'feed'],
    
    index: true
  },
  litres: {
    type: Number,
    default: 0
  },
  quantity: {
    type: Number,
    default: 0
  },
  payout: {
    type: Number,
    default: 0
  },
  cost: {
    type: Number,
    default: 0
  },
  farmer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Farmer',
    
    index: true
  },
  rate_version_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RateVersion',
    
    index: true
  },
  porter_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Porter',
    
    index: true
  },
  zone: {
    type: String,
    
    index: true
  },
  branch_id: {
    type: String,
    
    index: true
  },
  // Add this field to the schema
product_id: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Inventory',
  index: true
},
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Composite indexes for performance
transactionSchema.index({ farmer_id: 1, timestamp_server: -1 });
transactionSchema.index({ porter_id: 1, timestamp_server: -1 });
transactionSchema.index({ zone: 1, timestamp_server: -1 });
transactionSchema.index({ branch_id: 1, timestamp_server: -1 });
transactionSchema.index({ device_id: 1, device_seq_num: 1 }, { unique: true });
transactionSchema.index({ server_seq_num: 1 });
transactionSchema.index({ cooperativeId: 1, timestamp_server: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);