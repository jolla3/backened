const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const smsService = require('./smsService');
const transactionService = require('./transactionService'); // ✅ IMPORT TRANSACTION SERVICE
const logger = require('../utils/logger');

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
        type: 'feed',
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

  // ✅ Use cooperative._id as branch_id for feed purchases
  const branchId = cooperative._id.toString();

  for (const productData of products) {
    // ✅ FIXED: Validate required fields BEFORE database lookup
    const { productId, quantity, category, price } = productData;
    
    if (!productId) throw new Error('Product ID is required');
    if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error('Invalid product ID');
    if (!category) throw new Error('Product category is required');
    if (price === undefined || price === null || isNaN(Number(price))) {
      throw new Error('Product price is required and must be a valid number');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Product quantity must be a positive integer');
    }

    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error(`Product not found: ${productId}`);
    
    // ✅ Use provided price/category from frontend (allows custom pricing)
    const unitPrice = Number(price);
    const cost = quantity * unitPrice;
    totalCost += cost;

    if (product.stock < quantity) {
      throw new Error(`Insufficient stock: ${product.name} (${product.stock} available)`);
    }
    if (product.cooperativeId.toString() !== cooperative._id.toString()) {
      throw new Error(`Product ${product.name} not authorized`);
    }

    // ✅ USE TRANSACTION SERVICE FUNCTIONS
    const receiptNum = await transactionService.generateReceiptNum(session);
    const serverSeqNum = await transactionService.generateServerSeqNum(session, branchId);
    
    // Generate proper idempotency key and QR hash
    const transactionId = new mongoose.Types.ObjectId();
    const idempotencyKey = `feed-${Date.now()}-${farmerId}-${productId}-${transactionId}`;
    const qrHash = `FEED-${receiptNum}-${serverSeqNum}`; // Simple hash for feed (can enhance later)

    const transactionData = {
      // ✅ PROPER TRANSACTION SERVICE FIELDS
      receipt_num: receiptNum,
      server_seq_num: serverSeqNum,
      qr_hash: qrHash,
      idempotency_key: idempotencyKey,
      type: 'feed',
      quantity,
      cost,
      payout: 0, // feed purchases don't payout
      farmer_id: farmerId,
      cooperativeId: cooperative._id,
      admin_id: adminId,
      status: 'completed',
      category: category,
      product_id: productId,
      // ✅ Additional feed-specific fields
      timestamp_server: new Date(),
      timestamp_local: new Date()
    };

    const transaction = await Transaction.create([transactionData], { session });
    transactions.push(transaction[0]);

    // Update inventory stock
    product.stock -= quantity;
    await product.save({ session });

    smsItems.push(`${quantity} ${product.name} (${category})`);
  }

  // Calculate balance (non-blocking)
  const farmerBalanceInfo = await getFeedPurchaseFarmer(farmer.farmer_code || farmer.phone, cooperative._id);
  const balanceBefore = farmerBalanceInfo.milkBalance;
  const balanceAfter = balanceBefore - totalCost;

  // ✅ DEDUCT FROM FARMER BALANCE (atomic operation)
  if (balanceAfter < 0) {
    throw new Error(`Insufficient balance. Available: KES ${balanceBefore.toLocaleString()}, Required: KES ${totalCost.toLocaleString()}`);
  }

  // Atomic balance deduction
  await Farmer.findByIdAndUpdate(
    farmerId,
    { $inc: { balance: -totalCost } },
    { session }
  );

  // SMS (non-blocking)
  if (farmer.phone) {
    try {
      const smsMessage = `🛒 ${cooperative.name}\nDear ${farmer.name},\n✅ Feed Purchase:\n${smsItems.join('\n')}\n💰 TOTAL: KES ${totalCost.toLocaleString()}\n💳 New Balance: KES ${balanceAfter.toLocaleString()}`;
      await smsService.sendSMS(farmer.phone, smsMessage);
    } catch (smsError) {
      logger.warn('SMS failed but purchase completed', { 
        phone: farmer.phone, 
        error: smsError.message 
      });
    }
  }

  logger.info('Feed purchase completed', { 
    farmerId, 
    farmerName: farmer.name, 
    productsCount: products.length, 
    totalCost,
    balanceBefore,
    balanceAfter,
    receiptNums: transactions.map(t => t.receipt_num)
  });

  return {
    success: true,
    farmerId,
    farmerName: farmer.name,
    transactions,
    totalCost,
    balanceBefore,
    balanceAfter
  };
};

module.exports = {
  getFeedPurchaseFarmer,
  purchaseFeed
};