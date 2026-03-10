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

// ✅ YOUR EXACT FARMER IDs
const FARMER_IDS = [
  '69a9d29a40bc4ce9e60474a8',  // John Kamau
  '69a9d29a40bc4ce9e60474a9',  // Mary Wanjiku
  '69a9d29a40bc4ce9e60474aa'   // David Ochieng
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

    // 2. Create Porters
    const porters = await Porter.find({});
    if (porters.length === 0) {
      await Porter.insertMany([
        { name: 'Porter 1 - Main Route', zones: ['Zone A', 'Zone B'], totals: { litresCollected: 15000, transactionsCount: 750 } },
        { name: 'Porter 2 - Nakuru Route', zones: ['Zone C'], totals: { litresCollected: 12000, transactionsCount: 600 } }
      ]);
      console.log('✅ Created 2 porters');
    } else {
      console.log(`✅ ${porters.length} porters already exist`);
    }

    // 3. Create Inventory
    const inventory = await Inventory.find({});
    if (inventory.length === 0) {
      await Inventory.insertMany([
        { name: 'Cattle Feed Premium', category: 'feed', stock: 50, price: 1500, threshold: 100 },
        { name: 'Cattle Feed Standard', category: 'feed', stock: 300, price: 1200, threshold: 50 }
      ]);
      console.log('✅ Created 2 inventory products');
    } else {
      console.log(`✅ ${inventory.length} inventory products already exist`);
    }

    // 4. Create Rate Versions
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

    const portersList = await Porter.find({});
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
        rate_version_id: milkRate._id
      });
    }

    const insertedTransactions = await Transaction.insertMany(transactionData);
    console.log(`✅ Created ${insertedTransactions.length} transactions\n`);

    // 6. UPDATE FARMER HISTORY WITH TRANSACTION IDS
    console.log('🔄 STEP 6: Updating farmer history with transaction IDs...');

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

    console.log('\n✅ Farmer history updated successfully!\n');

    // 7. Create Devices
    const devices = await Device.find({});
    if (devices.length === 0) {
      await Device.insertMany([
        { uuid: 'device-uuid-001', hardware_id: 'HW001', approved: true, revoked: false, last_seen: new Date() },
        { uuid: 'device-uuid-002', hardware_id: 'HW002', approved: true, revoked: false, last_seen: new Date() }
      ]);
      console.log('✅ Created 2 devices');
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
    console.log('Farmer: John Kamau');
    console.log(`  ID: 69a9d29a40bc4ce9e60474a8`);
    const john = await Farmer.findById('69a9d29a40bc4ce9e60474a8');
    console.log(`  History Length: ${john.history.length}`);
    console.log(`  History IDs: ${john.history.map(id => id.toString()).join(', ')}`);
    console.log('');
    console.log('Farmer: Mary Wanjiku');
    console.log(`  ID: 69a9d29a40bc4ce9e60474a9`);
    const mary = await Farmer.findById('69a9d29a40bc4ce9e60474a9');
    console.log(`  History Length: ${mary.history.length}`);
    console.log(`  History IDs: ${mary.history.map(id => id.toString()).join(', ')}`);
    console.log('');
    console.log('Farmer: David Ochieng');
    console.log(`  ID: 69a9d29a40bc4ce9e60474aa`);
    const david = await Farmer.findById('69a9d29a40bc4ce9e60474aa');
    console.log(`  History Length: ${david.history.length}`);
    console.log(`  History IDs: ${david.history.map(id => id.toString()).join(', ')}`);

    console.log('\n✅ SEEDING COMPLETE\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seedRealisticData();