const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  category: { type: String, required: true },
  stock: { type: Number, required: true, index: true },
  price: { type: Number, required: true },
  threshold: { type: Number, required: true }
});

module.exports = mongoose.model('Inventory', inventorySchema);