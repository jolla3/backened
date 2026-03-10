const mongoose = require('mongoose');

const farmerSchema = new mongoose.Schema({
  farmer_code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    // ✅ REMOVED: index: true (duplicate with schema.index())
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  branch_id: {
    type: String,
    required: true,
    trim: true
  },
  balance: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ Keep this index definition only
farmerSchema.index({ farmer_code: 1 }, { unique: true });

module.exports = mongoose.model('Farmer', farmerSchema);