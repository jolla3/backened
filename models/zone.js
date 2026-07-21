// models/zone.js
const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  
  description: { type: String, trim: true },
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true,
  },
  // Geo location (optional)
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] },
  },
  // Zone manager/porter assignment
  assignedPorters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Porter',
  }],
  // Zone threshold (e.g., expected daily litres)
  expectedDailyLitres: { type: Number, default: 0 },
  expectedFarmers: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

zoneSchema.index({ cooperativeId: 1, name: 1 });
zoneSchema.index({ cooperativeId: 1, code: 1 });
zoneSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Zone', zoneSchema);