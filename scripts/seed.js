require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/index');
const User = require('../models/user');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Inventory = require('../models/inventory');
const RateVersion = require('../models/rateVersion');
const Transaction = require('../models/transaction');
const Device = require('../models/device');
const AuditLog = require('../models/auditLog');

// ✅ YOUR COOPERATIVE ID
const COOPERATIVE_ID = '69b31bedf575f028cbd92a63';

// ✅ YOUR EXACT FARMER IDs
const FARMER_IDS = [
  '69a9d29a40bc4ce9e60474a8',  // John Kamau
  '69a9d29a40bc4ce9e60474a9',  // Mary Wanjiku
  '69a9d29a40bc4ce9e60474aa'   // David Ochieng
];

// ✅ YOUR EXACT PORTER IDs
const PORTER_IDS = [
  '69a9d1ce16fb321864bbfe04',  // Porter 1
  '69a9d1ce16fb321864bbfe05',  // Porter 2
  '69a9d1ce16fb321864bbfe06'   // Porter 3
];

// ✅ YOUR EXACT TRANSACTION IDs
const TRANSACTION_IDS = [
  '69ab39efd75f38c71bcf5cd8',  // David 0
  '69ab39efd75f38c71bcf5cd9',  // David 1
  '69ab39efd75f38c71bcf5cdb'   // David 3
];

const seedRealisticData = async () => {
  try {
    console.log('🌱 Connecting to MongoDB...');
    await mongoose.connect(config.DB_URL);
    console.log('✅ MongoDB Connected\n');

    // 1. Create Admin User
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash('ChangeMe123!', salt);
      await User.create({
        email: 'admin@coop.com',
        password: hashedPassword,
        role: 'admin',
        name: 'System Administrator',
        isActive: true
      });
      console.log('✅ Admin created');
    } else {
      console.log('✅ Admin already exists');
    }

    // 2. Create Porters (with cooperativeId)
    const porters = await Porter.find({});
    if (porters.length === 0) {
      await Porter.insertMany([
        { 
          name: 'Porter 1 - Main Route', 
          zones: ['Zone A', 'Zone B'], 
          cooperativeId: COOPERATIVE_ID,
          totals: { litresCollected: 15000, transactionsCount: 750 } 
        },
        { 
          name: 'Porter 2 - Nakuru Route', 
          zones: ['Zone C'], 
          cooperativeId: COOPERATIVE_ID,
          totals: { litresCollected: 12000, transactionsCount: 600 } 
        },
        { 
          name: 'Porter 3 - Rural Route', 
          zones: ['Zone D'], 
          cooperativeId: COOPERATIVE_ID,
          totals: { litresCollected: 8000, transactionsCount: 400 } 
        }
      ]);
      console.log('✅ Created 3 porters with cooperativeId');
    } else {
      console.log(`✅ ${porters.length} porters already exist`);
      // Update existing porters with cooperativeId
      await Porter.updateMany(
        { _id: { $in: PORTER_IDS } },
        { $set: { cooperativeId: COOPERATIVE_ID } }
      );
      console.log(`✅ Updated ${PORTER_IDS.length} existing porters with cooperativeId`);
    }

    // 3. Create Inventory (with cooperativeId)
    const inventory = await Inventory.find({});
    if (inventory.length === 0) {
      await Inventory.insertMany([
        { 
          name: 'Cattle Feed Premium', 
          category: 'feed', 
          stock: 50, 
          price: 1500, 
          threshold: 100,
          cooperativeId: COOPERATIVE_ID 
        },
        { 
          name: 'Cattle Feed Standard', 
          category: 'feed', 
          stock: 300, 
          price: 1200, 
          threshold: 50,
          cooperativeId: COOPERATIVE_ID 
        }
      ]);
      console.log('✅ Created 2 inventory products with cooperativeId');
    } else {
      console.log(`✅ ${inventory.length} inventory products already exist`);
    }

    // 4. Create Rate Versions (with admin_id)
    const rates = await RateVersion.find({});
    if (rates.length === 0) {
      await RateVersion.insertMany([
        { type: 'milk', rate: 65, effective_date: new Date('2024-01-01'), admin_id: 'admin@coop.com' },
        { type: 'feed', rate: 1500, effective_date: new Date('2024-01-01'), admin_id: 'admin@coop.com' }
      ]);
      console.log('✅ Created 2 rate versions');
    } else {
      console.log(`✅ ${rates.length} rate versions already exist`);
    }

    // 5. CREATE TRANSACTIONS - FORCE CREATE (Clear old ones first)
    console.log('\n🔄 STEP 5: Creating transactions...');
    
    // Clear existing transactions
    const existingTxCount = await Transaction.countDocuments();
    if (existingTxCount > 0) {
      console.log(`⚠️  Clearing ${existingTxCount} existing transactions...`);
      await Transaction.deleteMany({});
      console.log('✅ Old transactions cleared');
    }

    const portersList = await Porter.find({ cooperativeId: COOPERATIVE_ID });
    const rateList = await RateVersion.find({});
    const milkRate = rateList.find(r => r.type === 'milk');
    const feedRate = rateList.find(r => r.type === 'feed');

    const transactionData = [];
    let milkSeq = 20240001;
    let feedSeq = 20240101;

    // ✅ JOHN KAMAU - 4 milk transactions
    for (let i = 0; i < 4; i++) {
      const litres = 20 + (i * 5);
      const payout = litres * milkRate.rate;
      const daysAgo = 1 + i;

      transactionData.push({
        device_id: portersList[0]._id,
        receipt_num: `REC-${milkSeq++}`,
        qr_hash: `qr_john_${i}`,
        status: 'completed',
        device_seq_num: i,
        server_seq_num: i,
        timestamp_local: new Date(Date.now() - daysAgo * 86400000),
        timestamp_server: new Date(Date.now() - daysAgo * 86400000),
        digital_signature: `sig_john_${i}`,
        idempotency_key: `john-milk-${i}`,
        soft_delta: 0,
        type: 'milk',
        litres: litres,
        quantity: 0,
        payout: payout,
        cost: 0,
        farmer_id: '69a9d29a40bc4ce9e60474a8',
        cooperativeId: COOPERATIVE_ID,
        branch_id: 'Zone A',
        zone: 'Zone A',
        porter_id: portersList[0]._id,
        rate_version_id: milkRate._id
      });
    }

    // ✅ MARY WANJIKU - 3 milk transactions
    for (let i = 0; i < 3; i++) {
      const litres = 25 + (i * 5);
      const payout = litres * milkRate.rate;
      const daysAgo = 2 + i;

      transactionData.push({
        device_id: portersList[0]._id,
        receipt_num: `REC-${milkSeq++}`,
        qr_hash: `qr_mary_${i}`,
        status: 'completed',
        device_seq_num: i + 4,
        server_seq_num: i + 4,
        timestamp_local: new Date(Date.now() - daysAgo * 86400000),
        timestamp_server: new Date(Date.now() - daysAgo * 86400000),
        digital_signature: `sig_mary_${i}`,
        idempotency_key: `mary-milk-${i}`,
        soft_delta: 0,
        type: 'milk',
        litres: litres,
        quantity: 0,
        payout: payout,
        cost: 0,
        farmer_id: '69a9d29a40bc4ce9e60474a9',
        cooperativeId: COOPERATIVE_ID,
        branch_id: 'Zone B',
        zone: 'Zone B',
        porter_id: portersList[0]._id,
        rate_version_id: milkRate._id
      });
    }

    // ✅ DAVID OCHIENG - 5 milk transactions
    for (let i = 0; i < 5; i++) {
      const litres = 30 + (i * 5);
      const payout = litres * milkRate.rate;
      const daysAgo = 1 + i;

      transactionData.push({
        device_id: portersList[1]._id,
        receipt_num: `REC-${milkSeq++}`,
        qr_hash: `qr_david_${i}`,
        status: 'completed',
        device_seq_num: i + 7,
        server_seq_num: i + 7,
        timestamp_local: new Date(Date.now() - daysAgo * 86400000),
        timestamp_server: new Date(Date.now() - daysAgo * 86400000),
        digital_signature: `sig_david_${i}`,
        idempotency_key: `david-milk-${i}`,
        soft_delta: 0,
        type: 'milk',
        litres: litres,
        quantity: 0,
        payout: payout,
        cost: 0,
        farmer_id: '69a9d29a40bc4ce9e60474aa',
        cooperativeId: COOPERATIVE_ID,
        branch_id: 'Zone C',
        zone: 'Zone C',
        porter_id: portersList[1]._id,
        rate_version_id: milkRate._id
      });
    }

    const insertedTransactions = await Transaction.insertMany(transactionData);
    console.log(`✅ Created ${insertedTransactions.length} transactions with cooperativeId\n`);

    // 6. UPDATE FARMER HISTORY WITH TRANSACTION IDS
    console.log('🔄 STEP 6: Updating farmer history with transaction IDs...');

    // Update farmers with cooperativeId
    await Farmer.updateMany(
      { _id: { $in: FARMER_IDS } },
      { $set: { cooperativeId: COOPERATIVE_ID } }
    );
    console.log(`✅ Updated ${FARMER_IDS.length} existing farmers with cooperativeId`);

    const farmerTransactionMap = {};
    for (const tx of insertedTransactions) {
      if (!farmerTransactionMap[tx.farmer_id]) {
        farmerTransactionMap[tx.farmer_id] = [];
      }
      farmerTransactionMap[tx.farmer_id].push(tx._id);
    }

    for (const farmerId in farmerTransactionMap) {
      const transactionIds = farmerTransactionMap[farmerId];
      await Farmer.findByIdAndUpdate(
        farmerId,
        { $set: { history: transactionIds } },
        { new: true }
      );
      console.log(`✅ Updated ${farmerId} with ${transactionIds.length} transactions in history`);
    }

    // 7. Create Devices (with cooperativeId)
    const devices = await Device.find({});
    if (devices.length === 0) {
      await Device.insertMany([
        { 
          uuid: 'device-uuid-001', 
          hardware_id: 'HW001', 
          approved: true, 
          revoked: false, 
          last_seen: new Date(),
          cooperativeId: COOPERATIVE_ID 
        },
        { 
          uuid: 'device-uuid-002', 
          hardware_id: 'HW002', 
          approved: true, 
          revoked: false, 
          last_seen: new Date(),
          cooperativeId: COOPERATIVE_ID 
        }
      ]);
      console.log('✅ Created 2 devices with cooperativeId');
    } else {
      console.log(`✅ ${devices.length} devices already exist`);
    }

    // 8. Create Audit Logs
    const auditLogs = await AuditLog.find({});
    if (auditLogs.length === 0) {
      await AuditLog.insertMany([
        { type: 'sms_sent', message: 'SMS sent to John Kamau', timestamp: new Date(), user_id: 'admin@coop.com' },
        { type: 'sms_sent', message: 'SMS sent to Mary Wanjiku', timestamp: new Date(), user_id: 'admin@coop.com' },
        { type: 'sms_sent', message: 'SMS sent to David Ochieng', timestamp: new Date(), user_id: 'admin@coop.com' }
      ]);
      console.log('✅ Created 3 audit logs');
    } else {
      console.log(`✅ ${auditLogs.length} audit logs already exist`);
    }

    // 9. VERIFY RESULTS
    console.log('\n📊 STEP 7: Verifying results...\n');
    console.log('Cooperative ID:', COOPERATIVE_ID);
    console.log('');
    console.log('Farmer: John Kamau');
    console.log(`  ID: 69a9d29a40bc4ce9e60474a8`);
    const john = await Farmer.findById('69a9d29a40bc4ce9e60474a8');
    console.log(`  Cooperative ID: ${john.cooperativeId}`);
    console.log(`  History Length: ${john.history.length}`);
    console.log(`  History IDs: ${john.history.map(id => id.toString()).join(', ')}`);
    console.log('');
    console.log('Farmer: Mary Wanjiku');
    console.log(`  ID: 69a9d29a40bc4ce9e60474a9`);
    const mary = await Farmer.findById('69a9d29a40bc4ce9e60474a9');
    console.log(`  Cooperative ID: ${mary.cooperativeId}`);
    console.log(`  History Length: ${mary.history.length}`);
    console.log(`  History IDs: ${mary.history.map(id => id.toString()).join(', ')}`);
    console.log('');
    console.log('Farmer: David Ochieng');
    console.log(`  ID: 69a9d29a40bc4ce9e60474aa`);
    const david = await Farmer.findById('69a9d29a40bc4ce9e60474aa');
    console.log(`  Cooperative ID: ${david.cooperativeId}`);
    console.log(`  History Length: ${david.history.length}`);
    console.log(`  History IDs: ${david.history.map(id => id.toString()).join(', ')}`);
    console.log('');
    console.log('Porter 1:');
    const porter1 = await Porter.findById('69a9d1ce16fb321864bbfe04');
    console.log(`  Cooperative ID: ${porter1.cooperativeId}`);
    console.log('');
    console.log('Transaction 1:');
    const tx1 = await Transaction.findById('69ab39efd75f38c71bcf5cd8');
    console.log(`  Cooperative ID: ${tx1.cooperativeId}`);
    console.log(`  Farmer ID: ${tx1.farmer_id}`);
    console.log(`  Litres: ${tx1.litres}`);
    console.log(`  Branch ID: ${tx1.branch_id}`);
    console.log(`  Zone: ${tx1.zone}`);
    console.log(`  Porter ID: ${tx1.porter_id}`);

    console.log('\n✅ SEEDING COMPLETE\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seedRealisticData();