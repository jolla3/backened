require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/user');
const config = require('../src/config');

const seedAdmin = async () => {
  try {
    console.log('🌱 Connecting to MongoDB...');
    await mongoose.connect(config.DB_URL);
    console.log('✅ MongoDB Connected');

    // Check if any admin exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    
    if (existingAdmin) {
      console.log('⚠️  Admin already exists. Skipping seed.');
      console.log('📧 Email:', existingAdmin.email);
      console.log('🔒 Password: CHANGE IMMEDIATELY');
      process.exit(0);
    }

    // Create first admin
    const adminData = {
      email: process.env.INITIAL_ADMIN_EMAIL || 'admin@coop.com',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'ChangeMe123!',
      role: 'admin',
      name: 'System Administrator'
    };

    const admin = await User.create(adminData);
    
    console.log('✅ Admin created successfully!');
    console.log('📧 Email:', admin.email);
    console.log('🔒 Password:', adminData.password);
    console.log('');
    console.log('⚠️  ⚠️  ⚠️  ⚠️  ⚠️');
    console.log('🔴 CHANGE PASSWORD IMMEDIATELY AFTER FIRST LOGIN!');
    console.log('⚠️  ⚠️  ⚠️  ⚠️  ⚠️');
    console.log('');
    console.log('🚀 Run: npm start');
    console.log('🔐 Login with:', admin.email);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }
};

seedAdmin();