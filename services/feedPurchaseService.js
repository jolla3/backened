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
const { formatFeedReceipt } = require('../utils/receiptFormatter');

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

const purchaseFeed = async (data, session) => {
  const {
    farmerId,
    products,
    adminId,
    cooperativeId,
    paymentMethod = 'balance',
    // Required for safe mobile/admin retries
    clientIdempotencyKey,
  } = data;

  if (!['balance', 'cash'].includes(paymentMethod)) {
    throw new Error('Invalid payment method. Must be "balance" or "cash"');
  }
  if (!mongoose.Types.ObjectId.isValid(farmerId)) {
    throw new Error('Invalid farmer ID');
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products specified');
  }
  if (!clientIdempotencyKey) {
    throw new Error('clientIdempotencyKey is required for feed purchases');
  }

  // ── Request-level idempotency ─────────────────────────
  const existing = await Transaction.findOne({
    cooperativeId,
    idempotency_key: clientIdempotencyKey,
    type: 'feed',
  }).session(session);

  if (existing) {
    // Idempotent replay
    const farmer = await Farmer.findById(farmerId).session(session).lean();
    const cooperative = await Cooperative.findById(cooperativeId).session(session).lean();

    return {
      success: true,
      duplicate: true,
      farmerId,
      farmerName: farmer?.name,
      transactions: [existing],
      totalCost: existing.cost,
      paymentMethod: existing.paymentMethod,
      balanceBefore: null,
      balanceAfter: farmer?.currentBalance,
      paymentSummary: {
        method: existing.paymentMethod,
        amount: existing.cost,
        balanceAdjusted: existing.paymentMethod === 'balance',
        newBalance: farmer?.currentBalance,
      },
      receipt: null,
    };
  }

  const cooperative = await Cooperative.findById(cooperativeId).session(session);
  if (!cooperative) throw new Error('Cooperative not found');

  const farmer = await Farmer.findOne({
    _id: farmerId,
    cooperativeId: cooperative._id,
  }).session(session);
  if (!farmer) {
    throw new Error('Farmer not found or does not belong to your cooperative');
  }

  let totalCost = 0;
  const transactions = [];
  const receiptItems = [];
  const branchId = cooperative._id.toString();

  // Explicit debt policy (env or future coop setting)
  const ALLOW_NEGATIVE_BALANCE =
    process.env.ALLOW_FARMER_DEBT === 'true' ||
    cooperative.allowFarmerDebt === true;

  // ── Process each product – price from inventory only ──
  for (const productData of products) {
    const { productId, quantity, category } = productData;

    if (!productId) throw new Error('Product ID is required');
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new Error('Invalid product ID');
    }
    if (!category) throw new Error('Product category is required');
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Product quantity must be a positive integer');
    }

    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error(`Product not found: ${productId}`);

    if (product.cooperativeId.toString() !== cooperative._id.toString()) {
      throw new Error(`Product ${product.name} not authorized`);
    }
    if (product.stock < quantity) {
      throw new Error(`Insufficient stock: ${product.name} (${product.stock} available)`);
    }

    // ★ Authoritative price – never trust client
    const unitPrice = Number(
      product.sellingPrice ?? product.price ?? product.unitPrice
    );
    if (isNaN(unitPrice) || unitPrice < 0) {
      throw new Error(`Invalid price configured for product ${product.name}`);
    }

    const cost = quantity * unitPrice;
    totalCost += cost;

    const receiptNum = await transactionService.generateReceiptNum(session);
    const serverSeqNum = await transactionService.generateServerSeqNum(session, branchId);

    // First product carries the client idempotency key; subsequent products
    // get a deterministic suffix so they stay linked but unique if needed.
    const isPrimary = transactions.length === 0;
    const txIdempotencyKey = isPrimary
      ? clientIdempotencyKey
      : `${clientIdempotencyKey}:${productId}`;

    const deviceId = `FEED-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const transactionData = {
      device_id: deviceId,
      device_seq_num: 0,
      receipt_num: receiptNum,
      server_seq_num: serverSeqNum,
      qr_hash: `FEED-${receiptNum}-${serverSeqNum}`,
      idempotency_key: txIdempotencyKey,
      type: 'feed',
      quantity,
      cost,
      payout: 0,
      farmer_id: farmerId,
      cooperativeId: cooperative._id,
      admin_id: adminId,
      status: 'completed',
      category,
      product_id: productId,
      timestamp_server: new Date(),
      timestamp_local: new Date(),
      paymentMethod,
      balanceAdjusted: paymentMethod === 'balance',
    };

    const [tx] = await Transaction.create([transactionData], { session });
    transactions.push(tx);

    product.stock -= quantity;
    await product.save({ session });

    receiptItems.push({
      productName: product.name,
      quantity,
      unit: product.unit,
      category,
      unitPrice,
      lineTotal: cost,
    });
  }

  // ── Atomic balance from latest ledger (same session) ──
  const lastLedger = await Ledger.findOne({
    cooperativeId: cooperative._id,
    farmerId: farmer._id,
  })
    .sort({ timestamp: -1, _id: -1 })
    .session(session)
    .lean();

  const currentRunningBalance = lastLedger
    ? lastLedger.runningBalance
    : (farmer.currentBalance || 0);

  let balanceBefore = currentRunningBalance;
  let balanceAfter = currentRunningBalance;

  if (paymentMethod === 'balance') {
    const newRunningBalance = currentRunningBalance - totalCost;

    // Explicit negative-balance policy
    if (!ALLOW_NEGATIVE_BALANCE && newRunningBalance < 0) {
      throw new Error(
        `Insufficient balance. Available: KES ${currentRunningBalance.toFixed(2)}, required: KES ${totalCost.toFixed(2)}`
      );
    }

    const [ledgerEntry] = await Ledger.create(
      [{
        cooperativeId: cooperative._id,
        farmerId: farmer._id,
        transactionId: transactions[0]._id,
        type: 'FEED_DEBIT',
        amount: -totalCost,
        runningBalance: newRunningBalance,
        description: `Feed purchase - ${transactions.map((t) => t.receipt_num).join(', ')}`,
        reference: transactions.map((t) => t.receipt_num).join(','),
        createdBy: adminId,
        metadata: {
          products: products.map((p) => ({
            productId: p.productId,
            quantity: p.quantity,
          })),
          paymentMethod: 'balance',
          clientIdempotencyKey,
        },
        timestamp: new Date(),
      }],
      { session }
    );

    // ★ Session passed – stays inside the Mongo transaction
    await updateFarmerBalance(farmer._id, newRunningBalance, ledgerEntry._id, session);

    balanceBefore = currentRunningBalance;
    balanceAfter = newRunningBalance;

    logger.info('Ledger entry created for feed purchase (balance)', {
      farmerId,
      amount: -totalCost,
      runningBalance: newRunningBalance,
      ledgerId: ledgerEntry._id,
    });
  } else {
    // Cash sale – zero wallet impact
    const [ledgerEntry] = await Ledger.create(
      [{
        cooperativeId: cooperative._id,
        farmerId: farmer._id,
        transactionId: transactions[0]._id,
        type: 'FEED_CASH_SALE',
        amount: totalCost,          // informational only
        runningBalance: currentRunningBalance, // unchanged
        description: `Cash feed purchase - ${transactions.map((t) => t.receipt_num).join(', ')}`,
        reference: transactions.map((t) => t.receipt_num).join(','),
        createdBy: adminId,
        metadata: {
          products: products.map((p) => ({
            productId: p.productId,
            quantity: p.quantity,
          })),
          paymentMethod: 'cash',
          clientIdempotencyKey,
        },
        timestamp: new Date(),
      }],
      { session }
    );

    balanceBefore = currentRunningBalance;
    balanceAfter = currentRunningBalance;

    logger.info('Ledger entry created for feed purchase (cash)', {
      farmerId,
      amount: totalCost,
      runningBalance: currentRunningBalance,
      ledgerId: ledgerEntry._id,
    });
  }

  // ── Receipt ───────────────────────────────────────────
  const receipt = formatFeedReceipt({
    cooperativeName: cooperative.name,
    receiptNumber: transactions[0].receipt_num,
    farmerName: farmer.name,
    farmerCode: farmer.farmer_code || farmer.code,
    paymentMethod,
    items: receiptItems,
    total: totalCost,
    walletBalance: balanceAfter,
    transactionDate: new Date(),
  });

  // ── Queue SMS (after business work; caller commits session) ──
  if (farmer.phone) {
    try {
      const primaryTxId = transactions[0]._id.toString();

      const smsResult = await smsService.sendSMS({
        to: farmer.phone,
        message: receipt.sms,
        from: process.env.CELCOM_SENDER_ID || 'JOMUGITAGRI',
        type: 'feed_purchase',
        cooperativeId: cooperative._id,
        farmerId: farmer._id,
        priority: 70,
        idempotencyKey: `feed_purchase:${primaryTxId}`,
        metadata: {
          transactionIds: transactions.map((t) => t._id.toString()),
          receiptNumber: transactions[0].receipt_num,
          totalCost,
          paymentMethod,
          clientIdempotencyKey,
        },
      });

      if (smsResult.queued) {
        logger.info('Feed SMS queued', {
          jobId: smsResult.jobId,
          phone: farmer.phone,
          duplicate: !!smsResult.duplicate,
        });
      }
    } catch (smsError) {
      logger.error('SMS exception but purchase completed', {
        phone: farmer.phone,
        error: smsError.message,
      });
    }
  }

  logger.info('Feed purchase completed', {
    farmerId,
    farmerName: farmer.name,
    productsCount: products.length,
    totalCost,
    paymentMethod,
    balanceBefore,
    balanceAfter,
    receiptNums: transactions.map((t) => t.receipt_num),
    clientIdempotencyKey,
  });

  return {
    success: true,
    duplicate: false,
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
      newBalance: balanceAfter,
    },
    receipt,
  };
};

module.exports = {
  getFeedPurchaseFarmer,
  purchaseFeed
};