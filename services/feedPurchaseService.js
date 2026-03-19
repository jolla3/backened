const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const Farmer = require('../models/farmer'); // Keep for basic info
const Cooperative = require('../models/cooperative');
const smsService = require('./smsService');
const logger = require('../utils/logger');

// ✅ Get Farmer by ANY identifier (code, phone, name) + Calculate balance from TRANSACTIONS
const getFeedPurchaseFarmer = async (identifier, cooperativeId) => {
  const coop = await Cooperative.findById(cooperativeId);
  if (!coop) throw new Error('Cooperative not found');

  // ✅ Search by farmerCode, phone, OR name
  const farmer = await Farmer.findOne({
    $or: [
      { farmerCode: identifier },
      { phone: identifier },
      { phoneNumber: identifier },
      { name: { $regex: identifier, $options: 'i' } }
    ]
  });

  if (!farmer) {
    throw new Error(`Farmer not found. Try code, phone, or name.`);
  }

  // ✅ Calculate CURRENT BALANCE from TRANSACTIONS (milk payouts - feed purchases)
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const milkPayouts = await Transaction.aggregate([
    {
      $match: {
        farmer_id: farmer._id,
        cooperativeId: coop._id,
        type: 'milk',
        timestamp_server: { $gte: monthAgo },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        totalPayout: { $sum: '$payout' }
      }
    }
  ]);

  const feedPurchases = await Transaction.aggregate([
    {
      $match: {
        farmer_id: farmer._id,
        cooperativeId: coop._id,
        type: { $in: ['feed', 'feed_purchase'] },
        timestamp_server: { $gte: monthAgo },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        totalCost: { $sum: '$cost' }
      }
    }
  ]);

  const milkBalance = (milkPayouts[0]?.totalPayout || 0) - (feedPurchases[0]?.totalCost || 0);

  return {
    _id: farmer._id,
    id: farmer._id,
    name: farmer.name,
    farmerCode: farmer.farmerCode,
    phone: farmer.phone || farmer.phoneNumber,
    milkBalance: Math.max(0, milkBalance), // No negative balances
    searchIdentifier: identifier
  };
};

// ✅ Main purchase function
const purchaseFeed = async (farmerId, products, adminId, session) => {
  // Validate inputs
  if (!mongoose.Types.ObjectId.isValid(farmerId)) {
    throw new Error('Invalid farmer ID');
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products specified');
  }

  const cooperative = await Cooperative.findById(adminId).session(session);
  if (!cooperative) throw new Error('Cooperative not found');

  // ✅ Get farmer details
  const farmer = await Farmer.findById(farmerId).session(session);
  if (!farmer) throw new Error('Farmer not found');

  let totalCost = 0;
  const transactions = [];
  const smsItems = [];

  // ✅ Process each product
  for (const { productId, quantity } of products) {
    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error(`Product not found: ${productId}`);
    if (product.stock < quantity) {
      throw new Error(`Insufficient stock: ${product.name} (${product.stock} available)`);
    }
    if (product.cooperativeId.toString() !== cooperative._id.toString()) {
      throw new Error(`Product ${product.name} not authorized`);
    }

    const unitPrice = Number(product.price) || 0;
    const cost = quantity * unitPrice;
    totalCost += cost;

    // ✅ Create transaction
    const transaction = await Transaction.create([{
      type: 'feed_purchase',
      product_id: productId,
      product_name: product.name,
      product_unit: product.unit || 'units',
      quantity,
      unit_price: unitPrice,
      cost, // Use 'cost' field from Transaction schema
      farmer_id: farmerId,
      farmer_name: farmer.name,
      cooperativeId: cooperative._id,
      adminId,
      device_id: 'feed_purchase_system',
      status: 'completed',
      idempotency_key: `feed-${Date.now()}-${farmerId}-${productId}`
    }], { session });

    transactions.push(transaction[0]);

    // ✅ Deduct inventory stock
    product.stock -= quantity;
    await product.save({ session });

    smsItems.push(`${quantity} ${product.unit || 'units'} ${product.name}`);
  }

  // ✅ Calculate balance from transactions (NOT stored in farmer)
  const farmerBalanceInfo = await getFeedPurchaseFarmer(farmer.farmerCode || farmer._id.toString(), cooperative._id);
  const balanceBefore = farmerBalanceInfo.milkBalance;
  
  if (totalCost > balanceBefore) {
    throw new Error(`Insufficient balance. Required: KES ${totalCost.toLocaleString()}, Available: KES ${balanceBefore.toLocaleString()}`);
  }

  // ✅ Send SMS
  if (farmer.phone) {
    const smsMessage = `🛒 ${cooperative.name}\n\nDear ${farmer.name},\n\n✅ Feed Purchase (${products.length} items):\n\n` +
      smsItems.map((item, i) => `${i+1}. ${item}`).join('\n') + '\n\n' +
      `💰 TOTAL: KES ${totalCost.toLocaleString()}\n` +
      `💳 New Balance: KES ${Math.max(0, balanceBefore - totalCost).toLocaleString()}\n\nThank you!`;

    await smsService.sendSMS(farmer.phone, smsMessage);
  }

  logger.info('Feed purchase completed', { 
    farmerId, 
    farmerName: farmer.name, 
    productsCount: products.length, 
    totalCost 
  });

  return {
    success: true,
    farmerId,
    farmerName: farmer.name,
    transactions,
    totalCost,
    balanceBefore,
    estimatedBalanceAfter: Math.max(0, balanceBefore - totalCost)
  };
};

module.exports = {
  getFeedPurchaseFarmer,
  purchaseFeed
};