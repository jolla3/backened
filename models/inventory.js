const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, index: true },
  category: { 
    type: String, 
    required: true, 
    enum: ['Feed', 'Medicine', 'Equipment', 'Supplies', 'Other'] 
  },
  stock: { type: Number, required: true, min: 0, index: true },
  price: { type: Number, required: true, min: 0 },
  threshold: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true }, // Added unit field
  cooperativeId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Cooperative', 
    required: true, 
    index: true 
  },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Inventory', inventorySchema);