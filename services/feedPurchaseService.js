const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const Ledger = require('../models/ledger');
const smsService = require('./smsService');
const transactionService = require('./transactionService');
const logger = require('../utils/logger');
const { updateFarmerBalance } = require('../utils/ledgerUtils');

// ── Helper ──────────────────────────────────────────────
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
  }).select('farmer_code name phone location currentBalance isActive');

  if (!farmer) {
    throw new Error(`Farmer not found. Try code, phone, or name.`);
  }

  const lastLedger = await Ledger.findOne({
    cooperativeId: coop._id,
    farmerId: farmer._id,
  })
    .sort({ timestamp: -1 })
    .lean();

  const currentBalance = lastLedger ? lastLedger.runningBalance : farmer.currentBalance;

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
    { $group: { _id: null, totalPayout: { $sum: '$payout' } } }
  ]);

  const feedPurchases = await Transaction.aggregate([
    {
      $match: {
        farmer_id: farmer._id,
        cooperativeId: coop._id,
        type: 'feed',
        timestamp_server: { $gte: firstDayOfMonth },
        status: 'completed',
        paymentMethod: 'balance'
      }
    },
    { $group: { _id: null, totalCost: { $sum: '$cost' } } }
  ]);

  const milkBalance = (milkPayouts[0]?.totalPayout || 0) - (feedPurchases[0]?.totalCost || 0);

  return {
    id: farmer._id.toString(),
    name: farmer.name,
    farmerCode: farmer.farmer_code,
    phone: farmer.phone,
    location: farmer.location || '',
    milkBalance: Math.max(0, milkBalance),
    currentBalance: currentBalance,
    searchIdentifier: identifier
  };
};

// ── Main purchase function ──────────────────────────────
const purchaseFeed = async (data, session) => {
  const { farmerId, products, adminId, cooperativeId, paymentMethod = 'balance' } = data;

  if (!['balance', 'cash'].includes(paymentMethod)) {
    throw new Error('Invalid payment method. Must be "balance" or "cash"');
  }

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
  const branchId = cooperative._id.toString();

  // ── Process each product ─────────────────────────────────
  for (const productData of products) {
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
    const unitPrice = Number(price);
    const cost = quantity * unitPrice;
    totalCost += cost;

    if (product.stock < quantity) {
      throw new Error(`Insufficient stock: ${product.name} (${product.stock} available)`);
    }
    if (product.cooperativeId.toString() !== cooperative._id.toString()) {
      throw new Error(`Product ${product.name} not authorized`);
    }

    const receiptNum = await transactionService.generateReceiptNum(session);
    const serverSeqNum = await transactionService.generateServerSeqNum(session, branchId);

    const transactionId = new mongoose.Types.ObjectId();
    const idempotencyKey = `feed-${Date.now()}-${farmerId}-${productId}-${transactionId}`;
    const qrHash = `FEED-${receiptNum}-${serverSeqNum}`;

    const deviceId = `FEED-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const deviceSeqNum = 0;

    const transactionData = {
      device_id: deviceId,
      device_seq_num: deviceSeqNum,
      receipt_num: receiptNum,
      server_seq_num: serverSeqNum,
      qr_hash: qrHash,
      idempotency_key: idempotencyKey,
      type: 'feed',
      quantity,
      cost,
      payout: 0,
      farmer_id: farmerId,
      cooperativeId: cooperative._id,
      admin_id: adminId,
      status: 'completed',
      category: category,
      product_id: productId,
      timestamp_server: new Date(),
      timestamp_local: new Date(),
      paymentMethod: paymentMethod,
      balanceAdjusted: paymentMethod === 'balance'
    };

    const transaction = await Transaction.create([transactionData], { session });
    transactions.push(transaction[0]);

    product.stock -= quantity;
    await product.save({ session });

    smsItems.push(`${quantity} x ${product.name} (${category}) @ KES ${unitPrice}`);
  }

  // ── Handle financial impact ────────────────────────────
  let balanceBefore = farmer.currentBalance || 0;
  let balanceAfter = balanceBefore;

  // Get current running balance from last ledger
  const lastLedger = await Ledger.findOne({
    cooperativeId: cooperative._id,
    farmerId: farmer._id,
  })
    .sort({ timestamp: -1 })
    .session(session)
    .lean();

  const currentRunningBalance = lastLedger ? lastLedger.runningBalance : farmer.currentBalance;

  if (paymentMethod === 'balance') {
    // ── Balance deduction ──────────────────────────────────
    const newRunningBalance = currentRunningBalance - totalCost;

    const [ledgerEntry] = await Ledger.create([{
      cooperativeId: cooperative._id,
      farmerId: farmer._id,
      transactionId: transactions[0]?._id,
      type: 'FEED_DEBIT',
      amount: -totalCost,
      runningBalance: newRunningBalance,
      description: `Feed purchase - ${transactions.map(t => t.receipt_num).join(', ')}`,
      reference: transactions.map(t => t.receipt_num).join(','),
      createdBy: adminId,
      metadata: {
        products: products.map(p => ({ productId: p.productId, quantity: p.quantity, price: p.price })),
        paymentMethod: 'balance'
      },
      timestamp: new Date(),
    }], { session });

    await updateFarmerBalance(farmer._id, newRunningBalance, ledgerEntry._id);

    balanceBefore = currentRunningBalance;
    balanceAfter = newRunningBalance;

    logger.info('Ledger entry created for feed purchase (balance)', {
      farmerId,
      amount: -totalCost,
      runningBalance: newRunningBalance,
      ledgerId: ledgerEntry._id
    });
  } else {
    // ── Cash payment – no balance change ──────────────────
    const [ledgerEntry] = await Ledger.create([{
      cooperativeId: cooperative._id,
      farmerId: farmer._id,
      transactionId: transactions[0]?._id,
      type: 'FEED_CASH_SALE',
      amount: totalCost,
      runningBalance: currentRunningBalance, // unchanged
      description: `Cash feed purchase - ${transactions.map(t => t.receipt_num).join(', ')}`,
      reference: transactions.map(t => t.receipt_num).join(','),
      createdBy: adminId,
      metadata: {
        products: products.map(p => ({ productId: p.productId, quantity: p.quantity, price: p.price })),
        paymentMethod: 'cash'
      },
      timestamp: new Date(),
    }], { session });

    // Do NOT update farmer.currentBalance – it stays the same
    balanceBefore = currentRunningBalance;
    balanceAfter = currentRunningBalance;

    logger.info('Ledger entry created for feed purchase (cash)', {
      farmerId,
      amount: totalCost,
      runningBalance: currentRunningBalance,
      ledgerId: ledgerEntry._id
    });
  }

  // ── Send SMS ────────────────────────────────────────────
  if (farmer.phone) {
    try {
      const paymentLabel = paymentMethod === 'balance' ? 'BALANCE' : 'CASH';
      const itemsList = smsItems.join('\n');

      const smsMessage = [
        cooperative.name.toUpperCase(),
        'FEED PURCHASE RECEIPT',
        '',
        `Farmer: ${farmer.name}`,
        `Payment: ${paymentLabel}`,
        '',
        itemsList,
        '',
        `TOTAL: KES ${totalCost.toLocaleString()}`,
        `WALLET BALANCE: KES ${balanceAfter.toLocaleString()}`,
        '',
        'Thank you for your business!'
      ].join('\n');

      const smsResult = await smsService.sendSMS(farmer.phone, smsMessage);

      if (smsResult.success) {
        const messageId = smsResult.data?.SMSMessageData?.Recipients?.[0]?.messageId || null;
        if (messageId) {
          logger.info('Feed SMS sent', { phone: farmer.phone, farmer: farmer.name, messageId });
        }
      } else {
        logger.warn('Feed SMS failed', { phone: farmer.phone, error: smsResult.error });
      }
    } catch (smsError) {
      logger.warn('SMS exception but purchase completed', {
        phone: farmer.phone,
        error: smsError.message
      });
    }
  }

  // Fetch updated farmer for response
  const updatedFarmer = await Farmer.findById(farmer._id).lean();

  logger.info('Feed purchase completed', {
    farmerId,
    farmerName: farmer.name,
    productsCount: products.length,
    totalCost,
    paymentMethod,
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
    paymentMethod,
    balanceBefore,
    balanceAfter,
    paymentSummary: {
      method: paymentMethod,
      amount: totalCost,
      balanceAdjusted: paymentMethod === 'balance',
      newBalance: balanceAfter
    }
  };
};

module.exports = {
  getFeedPurchaseFarmer,
  purchaseFeed
};