const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, index: true },
  category: { 
    type: String, 
    required: true, 
    enum: ['Feed', 'Medicine', 'Equipment', 'Supplies', 'Other'] 
  },
  stock: { type: Number, required: true, min: -1, index: true }, // -1 = deleted
  price: { type: Number, required: true, min: 0 },
  threshold: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true },
  cooperativeId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Cooperative', 
    required: true, 
    index: true 
  },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // ✅ NEW: Soft delete fields
  deleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date },
  deleted_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// ✅ Exclude deleted items from queries by default
inventorySchema.pre(/^find/, function() {
  this.where({ stock: { $gte: 0 } });
});

module.exports = mongoose.model('Inventory', inventorySchema);