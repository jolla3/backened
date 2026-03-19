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

  // ✅ FIXED: Match ACTUAL farmer schema fields (farmer_code, phone, name)
  const farmer = await Farmer.findOne({
    $and: [
      { cooperativeId: coop._id }, // ✅ Must belong to this cooperative
      {
        $or: [
          { farmer_code: identifier },        // ✅ Correct field name
          { phone: identifier },              // ✅ Correct field name  
          { name: { $regex: identifier, $options: 'i' } }  // ✅ Case insensitive name search
        ]
      }
    ]
  }).select('farmer_code name phone location balance isActive'); // ✅ Only select needed fields

  if (!farmer) {
    throw new Error(`Farmer not found. Try code, phone, or name.`);
  }

  // ✅ FIXED: Proper month calculation from ACTUAL current month start
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); // ✅ Start of CURRENT month

  // ✅ Milk payouts this month
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

  // ✅ Feed purchases this month  
  const feedPurchases = await Transaction.aggregate([
    {
      $match: {
        farmer_id: farmer._id,
        cooperativeId: coop._id,
        type: { $in: ['feed', 'feed_purchase'] },
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

  // ✅ FIXED: Return CORRECT field names, NO ID exposure
  return {
    id: farmer._id.toString(),           // ✅ Keep for internal use only
    name: farmer.name,
    farmerCode: farmer.farmer_code,      // ✅ Correct field mapping
    phone: farmer.phone,
    location: farmer.location || '',
    milkBalance: Math.max(0, milkBalance),
    searchIdentifier: identifier
  };
};
// ✅ Main purchase function
const purchaseFeed = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { farmerId, products } = req.body;
    const adminId = req.user.id;  // ✅ From JWT token
    const cooperativeId = req.user.cooperativeId;  // ✅ From JWT token

    // Validate inputs
    if (!mongoose.Types.ObjectId.isValid(farmerId)) {
      return res.status(400).json({ error: 'Invalid farmer ID' });
    }
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products specified' });
    }

    await session.withTransaction(async () => {
      // ✅ FIXED: Use cooperativeId from JWT, NOT adminId
      const cooperative = await Cooperative.findById(cooperativeId).session(session);
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
        if (product.cooperativeId.toString() !== cooperativeId.toString()) {
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
          cost,
          farmer_id: farmerId,
          farmer_name: farmer.name,
          cooperativeId: cooperativeId,  // ✅ Use cooperativeId
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

      // ✅ Check balance
      const farmerBalanceInfo = await getFeedPurchaseFarmer(farmer.farmer_code || farmer.phone || farmer.name, cooperativeId);
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

      res.json({
        success: true,
        farmerId,
        farmerName: farmer.name,
        transactions,
        totalCost,
        balanceBefore,
        estimatedBalanceAfter: Math.max(0, balanceBefore - totalCost)
      });
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  getFeedPurchaseFarmer,
  purchaseFeed
};