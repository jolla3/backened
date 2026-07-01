// create-superadmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Load your User model (adjust path as needed)
const User = require('../models/user'); // Update this path to your User model

async function createSuperadmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.DB_URL);
    console.log('✅ Connected to MongoDB');

    // Superadmin credentials from .env
    const email = process.env.INITIAL_ADMIN_EMAIL;
    const plainPassword = process.env.INITIAL_ADMIN_PASSWORD;

    if (!email || !plainPassword) {
      throw new Error('INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD not set in .env');
    }

    // Check if superadmin already exists
    const existingAdmin = await User.findOne({ email });
    if (existingAdmin) {
      console.log('❌ Superadmin already exists:', email);
      process.exit(0);
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);

    // Create superadmin
    const superadmin = new User({
      email,
      password: hashedPassword,
      role: 'superadmin', // or whatever your superadmin role is called
      isActive: true,
      isVerified: true,
      name: 'Super Admin',
      // Add any other required fields for your User schema
    });

    await superadmin.save();
    console.log('🎉 Superadmin created successfully!');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', plainPassword);
    console.log('⚠️  CHANGE THE DEFAULT PASSWORD IMMEDIATELY AFTER LOGIN!');

  } catch (error) {
    console.error('❌ Error creating superadmin:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

createSuperadmin();