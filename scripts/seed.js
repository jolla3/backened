// // // create-superadmin.js
// // require("dotenv").config();
// // const mongoose = require("mongoose");
// // const bcrypt = require("bcryptjs");
// // const User = require("../models/user");

// // async function createSuperadmin() {
// //   try {
// //     await mongoose.connect(process.env.DB_URL);
// //     console.log("✅ Connected to MongoDB");

// //     const email = process.env.INITIAL_ADMIN_EMAIL;
// //     const plainPassword = process.env.INITIAL_ADMIN_PASSWORD;

// //     if (!email || !plainPassword) {
// //       throw new Error(
// //         "INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD not set in .env"
// //       );
// //     }

// //     const existingSuperAdmin = await User.findOne({
// //       role: "superadmin",
// //     });

// //     if (existingSuperAdmin) {
// //       console.log("❌ Super Admin already exists.");
// //       return;
// //     }

// //     const hashedPassword = await bcrypt.hash(plainPassword, 12);

// //     await User.create({
// //       name: "Super Admin",
// //       email: email.toLowerCase(),
// //       password: hashedPassword,
// //       role: "superadmin",
// //       cooperativeId: null,
// //       isActive: true,
// //     });

// //     console.log("🎉 Super Admin created successfully!");
// //     console.log("📧 Email:", email);
// //   } catch (err) {
// //     console.error("❌", err.message);
// //   } finally {
// //     await mongoose.disconnect();
// //     process.exit();
// //   }
// // }

// // createSuperadmin();


// require("dotenv").config();
// const mongoose = require("mongoose");
// const Farmer = require("../models/Farmer"); // adjust path

// const COOPERATIVE_ID = new mongoose.Types.ObjectId(
//   "6a6dad832531603e65d5394f"
// );

// const farmers = [
//   { name: "eric mutuma" },
//   { name: "bosco mwiti" },
//   { name: "cecilia kangai" },
//   { name: "ashford mbaya" },
//   { name: "david ndiga" },
//   { name: "mercy muthoni" },
//   { name: "john mugendi" },
//   { name: "bonface kinyua" },
//   { name: "jane karimi" },
//   { name: "muriuki" },
//   { name: "martin" },
//   { name: "alex mutembei" },
//   { name: "nicholus mwiti" },
//   { name: "julius nyerere" },
//   { name: "john nyaga" },
//   { name: "david kimathi" },
//   { name: "skitter kanana" },
//   { name: "rurama sec" },
//   { name: "doreen gakii" },
//   { name: "james kiambi" },
//   { name: "florah njeru" },
//   { name: "ian munene" },
//   { name: "ann kainyu" },
//   { name: "loisy gakii" },
//   { name: "gerrald ireri" },
//   { name: "james kimathi" },
//   { name: "julius munene" },
//   { name: "david gitonga" },
//   { name: "cathe karigi" },
//   { name: "kellen gatwiri" },
//   { name: "eric mugendi" },
//   { name: "robert mbaya" },
//   { name: "chrispus" },
//   { name: "john gikundi" },
//   { name: "charity kainyu" },
//   { name: "muriuki mbiri" },
//   { name: "geoffry njeru" },
//   { name: "law mugendi" },
//   { name: "sarah kangai" },
//   { name: "gerrald njuki" },
//   { name: "zipporah" },
//   { name: "rufus mute" },
//   { name: "john miriti" },
//   { name: "julius mbabu" },
//   { name: "stella kainyu" },
//   { name: "nichulus mwi" },
//   { name: "tonny mawira" },
//   { name: "david kathuri" },
//   { name: "patric mbabu" },
//   { name: "dorcus nkinga" },
//   { name: "nicholus kimathi" },
//   { name: "florence kangai" },
//   { name: "eric mugendi" },
//   { name: "philip murithi" },
//   { name: "jane mbaya" },
//   { name: "kelvin munene" },
//   { name: "bonface mutembei" },
//   { name: "fridah nkatha" },
//   { name: "james njeru" },
//   { name: "elid kathure" },
//   { name: "p musairu" },
// ];

// async function seedFarmers() {
//   try {
//     await mongoose.connect(process.env.DB_URL);

//     const docs = farmers.map((farmer) => ({
//       ...farmer,
//       cooperativeId: COOPERATIVE_ID,
//       isActive: true,
//       currentBalance: 0,
//     }));

//     const result = await Farmer.insertMany(docs);

//     console.log(`✅ Seeded ${result.length} farmers.`);
//   } catch (err) {
//     console.error("❌ Error seeding farmers:", err);
//   } finally {
//     await mongoose.disconnect();
//   }
// }

// seedFarmers();
require("dotenv").config();
const mongoose = require("mongoose");
const Farmer = require("../models/Farmer");

async function createIndex() {
  try {
    await mongoose.connect(process.env.DB_URL);

    await Farmer.collection.createIndex(
      { farmer_code: 1 },
      {
        unique: true,
        partialFilterExpression: {
          farmer_code: { $exists: true, $ne: null },
        },
        name: "farmer_code_unique",
      }
    );

    console.log("✅ Index created.");
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

createIndex();