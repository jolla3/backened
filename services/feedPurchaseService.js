// services/feedPurchaseService.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const smsService = require('./smsService');
const logger = require('../utils/logger');

const purchaseFeed = async (farmerId, products, adminId, session) => {
  if (!mongoose.Types.ObjectId.isValid(farmerId)) {
    throw new Error('Invalid farmer ID');
  }

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products specified');
  }

  if (!mongoose.Types.ObjectId.isValid(adminId)) {
    throw new Error('Invalid admin ID');
  }

  // ✅ Validate all product IDs
  const invalidProducts = products.filter(p => !mongoose.Types.ObjectId.isValid(p.productId));
  if (invalidProducts.length > 0) {
    throw new Error('Invalid product IDs provided');
  }

  // ✅ Get cooperative
  const cooperative = await Cooperative.findById(adminId).session(session);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  // ✅ Get farmer
  const farmer = await Farmer.findById(farmerId).session(session);
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  if (!farmer.phone) {
    logger.warn('Farmer has no phone number for SMS', { farmerId: farmer._id });
  }

  let totalCost = 0;
  const transactions = [];
  const smsItems = [];
  const processedProducts = [];

  // ✅ Process EACH product with error handling
  for (let i = 0; i < products.length; i++) {
    const { productId, quantity } = products[i];

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for product ${i + 1}`);
    }

    const product = await Inventory.findById(productId).session(session);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    if (product.stock < quantity) {
      throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${quantity}`);
    }

    // ✅ Verify product belongs to cooperative
    if (product.cooperativeId.toString() !== cooperative._id.toString()) {
      throw new Error(`Product ${product.name} does not belong to your cooperative`);
    }

    // ✅ Use product price (not passed rate)
    const unitPrice = Number(product.price) || 0;
    const cost = quantity * unitPrice;
    totalCost += cost;

    // ✅ Create transaction record
    const transaction = await Transaction.create([{
      type: 'feed_purchase',
      product_id: productId,
      product_name: product.name,
      product_unit: product.unit || 'units',
      quantity,
      unit_price: unitPrice,
      total_cost: cost,
      farmer_id: farmerId,
      farmer_name: farmer.name,
      farmer_phone: farmer.phone,
      milk_balance_before: farmer.milkBalance,
      milk_balance_after: farmer.milkBalance - totalCost,
      cooperativeId: cooperative._id,
      adminId,
      device_id: 'feed_purchase_system',
      status: 'completed',
      idempotency_key: `feed-purchase-${Date.now()}-${farmerId}-${productId}`,
      metadata: {
        cooperativeName: cooperative.name,
        productStockBefore: product.stock,
        productStockAfter: product.stock - quantity
      }
    }], { session });

    transactions.push(transaction[0]);

    // ✅ Deduct stock
    product.stock -= quantity;
    await product.save({ session });

    // ✅ SMS item
    smsItems.push(`${quantity} ${product.unit || 'units'} ${product.name} (KES ${unitPrice.toLocaleString()})`);
    processedProducts.push({
      productId,
      productName: product.name,
      quantity,
      unitPrice,
      cost
    });
  }

  // ✅ Validate milk balance BEFORE deduction
  if (totalCost > (farmer.milkBalance || 0)) {
    throw new Error(
      `Insufficient milk balance. ` +
      `Required: KES ${totalCost.toLocaleString()}, ` +
      `Available: KES ${(farmer.milkBalance || 0).toLocaleString()}`
    );
  }

  // ✅ Deduct TOTAL from milk balance
  const milkBalanceBefore = farmer.milkBalance || 0;
  farmer.milkBalance = Math.max(0, farmer.milkBalance - totalCost);
  await farmer.save({ session });

  logger.info('Feed purchase milk balance deduction', {
    farmerId,
    farmerName: farmer.name,
    totalCost,
    milkBalanceBefore,
    milkBalanceAfter: farmer.milkBalance
  });

  // ✅ Send SINGLE SMS for ALL products
  try {
    if (farmer.phone) {
      const smsMessage = `🛒 ${cooperative.name || 'DairyCoop'}\n\n` +
        `Dear ${farmer.name},\n\n` +
        `✅ Feed Purchase Complete!\n` +
        `(${products.length} ${products.length === 1 ? 'item' : 'items'})\n\n` +
        smsItems.map((item, i) => `${i + 1}. ${item}`).join('\n') + '\n\n' +
        `💰 TOTAL AMOUNT: KES ${totalCost.toLocaleString()}\n` +
        `💳 Milk Balance: KES ${milkBalanceBefore.toLocaleString()} → KES ${farmer.milkBalance.toLocaleString()}\n\n` +
        `Thank you for shopping with us!\n` +
        `${cooperative.name || 'DairyCoop'}`;

      const smsResult = await smsService.sendSMS(farmer.phone, smsMessage);
      
      logger.info('Feed purchase SMS sent', {
        farmerId,
        farmerName: farmer.name,
        totalCost,
        itemsCount: products.length,
        smsSuccess: smsResult.success
      });
    }
  } catch (smsError) {
    logger.error('SMS failed (purchase still succeeded)', {
      farmerId,
      error: smsError.message
    });
    // Don't rollback transaction for SMS failure
  }

  logger.info('Feed purchase COMPLETED successfully', {
    farmerId: farmer._id,
    farmerName: farmer.name,
    itemsCount: products.length,
    totalCost,
    transactionsCount: transactions.length,
    remainingMilkBalance: farmer.milkBalance,
    remainingStock: processedProducts.map(p => ({ product: p.productName, stockLeft: p.quantity }))
  });

  return {
    success: true,
    farmerId: farmer._id,
    farmerName: farmer.name,
    transactions,
    processedProducts,
    totalCost,
    milkBalanceBefore,
    milkBalanceAfter: farmer.milkBalance,
    smsSent: !!farmer.phone,
    message: `Feed purchase completed for ${products.length} items. Total: KES ${totalCost.toLocaleString()}`
  };
};

module.exports = { purchaseFeed };