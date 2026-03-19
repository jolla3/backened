const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const Farmer = require('../models/farmer'); // Add Farmer model import
const Cooperative = require('../models/cooperative');
const smsService = require('./smsService');
const logger = require('../utils/logger');

const purchaseFeed = async (farmerId, productId, quantity, rate, adminId, session) => {
  const cooperative = await Cooperative.findById(adminId).session(session);
  if (!cooperative) throw new Error('Cooperative not found');

  const product = await Inventory.findById(productId).session(session);
  if (!product) throw new Error('Product not found');
  if (product.stock < quantity) throw new Error(`Insufficient stock. Available: ${product.stock}`);

  // ✅ Verify product belongs to cooperative
  if (product.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Product does not belong to your cooperative');
  }

  // ✅ Get FARMER details (for SMS and balance)
  const farmer = await Farmer.findOne({ _id: farmerId }).session(session);
  if (!farmer) throw new Error('Farmer not found');
  
  const farmerName = farmer.name || 'Farmer';
  const farmerPhone = farmer.phone || farmer.phoneNumber;

  // ✅ Calculate totals
  const cost = quantity * rate;
  const unitPrice = rate;

  // ✅ CREATE TRANSACTION
  const transaction = await Transaction.create([{
    type: 'feed_purchase',
    product_id: productId,
    product_name: product.name,
    product_unit: product.unit || 'units',
    quantity,
    unit_price: rate,
    total_cost: cost,
    farmer_id: farmerId,
    farmer_name: farmerName,
    device_id: 'system',
    status: 'completed',
    idempotency_key: `feed-${Date.now()}-${farmerId}-${productId}`,
    cooperativeId: cooperative._id,
    adminId
  }], { session });

  // ✅ DEDUCT STOCK
  product.stock -= quantity;
  await product.save({ session });

  // ✅ DEDUCT FROM FARMER'S MILK BALANCE
  if (farmer.milkBalance && farmer.milkBalance > 0) {
    const deduction = Math.min(cost, farmer.milkBalance);
    farmer.milkBalance -= deduction;
    await farmer.save({ session });
    
    logger.info('Milk balance deducted', {
      farmerId,
      farmerName,
      deduction,
      remainingBalance: farmer.milkBalance
    });
  }

  // ✅ SEND SMS NOTIFICATION
  try {
    if (farmerPhone) {
      const smsMessage = `🛒 ${cooperative.name || 'DairyCoop'}\n\n` +
        `Dear ${farmerName},\n\n` +
        `✅ Feed Purchase Confirmed!\n\n` +
        `📦 Product: ${product.name}\n` +
        `📏 Quantity: ${quantity} ${product.unit || 'units'}\n` +
        `💰 Rate: KES ${unitPrice.toLocaleString()}\n` +
        `💵 Total: KES ${cost.toLocaleString()}\n\n` +
        `💳 Deducted from milk balance\n` +
        `💰 Remaining balance: KES ${farmer.milkBalance?.toLocaleString() || 0}\n\n` +
        `Thank you for your purchase!\n${cooperative.name}`;

      const smsResult = await smsService.sendSMS(farmerPhone, smsMessage);
      
      logger.info('Feed purchase SMS sent', {
        farmerId,
        farmerName,
        farmerPhone,
        product: product.name,
        quantity,
        cost,
        smsSuccess: smsResult.success
      });
    } else {
      logger.warn('No phone number for SMS', { farmerId, farmerName });
    }
  } catch (smsError) {
    logger.error('SMS failed but purchase succeeded', {
      farmerId,
      error: smsError.message
    });
    // ✅ Don't fail purchase if SMS fails
  }

  logger.info('Feed purchase completed', { 
    farmerId, 
    farmerName, 
    product: product.name, 
    quantity, 
    cost, 
    remainingStock: product.stock,
    remainingMilkBalance: farmer.milkBalance 
  });

  return {
    transaction: transaction[0],
    product,
    farmer: {
      name: farmerName,
      milkBalance: farmer.milkBalance,
      phone: farmerPhone
    },
    smsSent: !!farmerPhone
  };
};

module.exports = { purchaseFeed };