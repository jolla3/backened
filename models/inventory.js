const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  category: { type: String,},
  stock: { type: Number, required: true, index: true },
  price: { type: Number,},
  threshold: { type: Number,},
  cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User',},
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Inventory', inventorySchema);