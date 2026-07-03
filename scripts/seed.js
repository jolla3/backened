// create-superadmin.js
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/user");

async function createSuperadmin() {
  try {
    await mongoose.connect(process.env.DB_URL);
    console.log("✅ Connected to MongoDB");

    const email = process.env.INITIAL_ADMIN_EMAIL;
    const plainPassword = process.env.INITIAL_ADMIN_PASSWORD;

    if (!email || !plainPassword) {
      throw new Error(
        "INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD not set in .env"
      );
    }

    const existingSuperAdmin = await User.findOne({
      role: "superadmin",
    });

    if (existingSuperAdmin) {
      console.log("❌ Super Admin already exists.");
      return;
    }

    const hashedPassword = await bcrypt.hash(plainPassword, 12);

    await User.create({
      name: "Super Admin",
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "superadmin",
      cooperativeId: null,
      isActive: true,
    });

    console.log("🎉 Super Admin created successfully!");
    console.log("📧 Email:", email);
  } catch (err) {
    console.error("❌", err.message);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

createSuperadmin();