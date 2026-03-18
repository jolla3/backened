const mongoose = require('mongoose');

const porterSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true,
    unique: true  // ✅ This creates the unique index
  },
  pin: {
    type: String,
    trim: true,
    minlength: 4,
    maxlength: 6,
    select: false
  },
  branch_id: {
    type: String,
    trim: true
  },
  zones: [{
    type: String,
    required: true
  }],
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true  // ✅ This creates the index
  },
  assigned_device_id: {
    type: String,
    default: null
  },
  totals: {
    litresCollected: {
      type: Number,
      default: 0
    },
    transactionsCount: {
      type: Number,
      default: 0
    },
    monthlyEarnings: {
      type: Number,
      default: 0
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ Only add indexes that are NOT already created by field definitions
porterSchema.index({ cooperativeId: 1, branch_id: 1 });
porterSchema.index({ cooperativeId: 1, isActive: 1 });

module.exports = mongoose.model('Porter', porterSchema);