const mongoose = require('mongoose');

const farmerSchema = new mongoose.Schema({
  farmer_code: {
    type: String,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  branch_id: {
    type: String,
    trim: true
  },
  location: {
    type: String,
    trim: true
  },
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true
  },
  balance: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  history: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Transaction',
    default: []  // ✅ Initialize as empty array
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ Only add indexes that are NOT already created by field definitions
farmerSchema.index({ cooperativeId: 1, farmer_code: 1 });

module.exports = mongoose.model('Farmer', farmerSchema);