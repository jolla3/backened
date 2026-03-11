const mongoose = require('mongoose');

const cooperativeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  registrationNumber: {
    type: String,
    unique: true,  // ✅ This creates the unique index
    trim: true
  },
  location: {
    county: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    }
  },
  contact: {
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true
    },
    manager: {
      type: String,
      trim: true
    }
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderName: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
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

// ✅ Only add indexes that are NOT already created by field definitions
cooperativeSchema.index({ name: 1 });

module.exports = mongoose.model('Cooperative', cooperativeSchema);