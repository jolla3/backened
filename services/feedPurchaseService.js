const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const smsService = require('./smsService');
const logger = require('../utils/logger');

// ✅ getFeedPurchaseFarmer (UNCHANGED - WORKS)
const getFeedPurchaseFarmer = async (identifier, cooperativeId) => {
  const coop = await Cooperative.findById(cooperativeId);
  if (!coop) throw new Error('Cooperative not found');

  const farmer = await Farmer.findOne({
    $and: [
      { cooperativeId: coop._id },
      {
        $or: [
          { farmer_code: identifier },
          { phone: identifier },
          { name: { $regex: identifier, $options: 'i' } }
        ]
      }
    ]
  }).select('farmer_code name phone location balance isActive');

  if (!farmer) {
    throw new Error(`Farmer not found. Try code, phone, or name.`);
  }

  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const milkPayouts = await Transaction.aggregate([
    {
      $match: {
        farmer_id: farmer._id,
        cooperativeId: coop._id,
        type: 'milk',
        timestamp_server: { $gte: firstDayOfMonth },
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
        type: 'feed',  // ✅ FIXED: Use 'feed' to match enum
        timestamp_server: { $gte: firstDayOfMonth },
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
    id: farmer._id.toString(),
    name: farmer.name,
    farmerCode: farmer.farmer_code,
    phone: farmer.phone,
    location: farmer.location || '',
    milkBalance: Math.max(0, milkBalance),
    searchIdentifier: identifier
  };
};

// ✅ FIXED: purchaseFeed - Uses 'feed' enum value
const purchaseFeed = async (data, session) => {
  const { farmerId, products, adminId, cooperativeId } = data;

  if (!mongoose.Types.ObjectId.isValid(farmerId)) {
    throw new Error('Invalid farmer ID');
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products specified');
  }

  const cooperative = await Cooperative.findById(cooperativeId).session(session);
  if (!cooperative) throw new Error('Cooperative not found');

  const farmer = await Farmer.findOne({
    _id: farmerId,
    cooperativeId: cooperative._id
  }).session(session);

  if (!farmer) throw new Error('Farmer not found or does not belong to your cooperative');

  let totalCost = 0;
  const transactions = [];
  const smsItems = [];

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

    // ✅ FIXED: Use 'feed' (matches your enum: ['milk', 'feed'])
    const transaction = await Transaction.create([{
      type: 'feed',  // ✅ FIXED: Schema enum value
      product_id: productId,
      product_name: product.name,
      product_unit: product.unit || 'units',
      quantity,
      unit_price: unitPrice,
      cost,
      farmer_id: farmerId,
      farmer_name: farmer.name,
      cooperativeId: cooperative._id,
      adminId,
      device_id: 'feed_purchase_system',
      status: 'completed',
      idempotency_key: `feed-${Date.now()}-${farmerId}-${productId}`
    }], { session });

    transactions.push(transaction[0]);

    product.stock -= quantity;
    await product.save({ session });

    smsItems.push(`${quantity} ${product.unit || 'units'} ${product.name}`);
  }

  // Balance check
  const farmerBalanceInfo = await getFeedPurchaseFarmer(farmer.farmer_code || farmer.phone, cooperative._id);
  const balanceBefore = farmerBalanceInfo.milkBalance;
  
  if (totalCost > balanceBefore) {
    throw new Error(`Insufficient balance. Required: KES ${totalCost.toLocaleString()}, Available: KES ${balanceBefore.toLocaleString()}`);
  }

  // SMS
  if (farmer.phone) {
    const smsMessage = `🛒 ${cooperative.name}\nDear ${farmer.name},\n✅ Feed Purchase (${products.length} items):\n\n${smsItems.map((item, i) => `${i+1}. ${item}`).join('\n')}\n\n💰 TOTAL: KES ${totalCost.toLocaleString()}\n💳 New Balance: KES ${Math.max(0, balanceBefore - totalCost).toLocaleString()}`;
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
    balanceAfter: Math.max(0, balanceBefore - totalCost)
  };
};

module.exports = {
  getFeedPurchaseFarmer,
  purchaseFeed
};