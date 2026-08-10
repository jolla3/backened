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


require("dotenv").config();
const mongoose = require("mongoose");
const Farmer = require("../models/Farmer"); // adjust path

const COOPERATIVE_ID = new mongoose.Types.ObjectId(
  "6a6dad832531603e65d5394f"
);

const farmers = [
  { name: "eric mutuma" },
  { name: "bosco mwiti" },
  { name: "cecilia kangai" },
  { name: "ashford mbaya" },
  { name: "david ndiga" },
  { name: "mercy muthoni" },
  { name: "john mugendi" },
  { name: "bonface kinyua" },
  { name: "jane karimi" },
  { name: "muriuki" },
  { name: "martin" },
  { name: "alex mutembei" },
  { name: "nicholus mwiti" },
  { name: "julius nyerere" },
  { name: "john nyaga" },
  { name: "david kimathi" },
  { name: "skitter kanana" },
  { name: "rurama sec" },
  { name: "doreen gakii" },
  { name: "james kiambi" },
  { name: "florah njeru" },
  { name: "ian munene" },
  { name: "ann kainyu" },
  { name: "loisy gakii" },
  { name: "gerrald ireri" },
  { name: "james kimathi" },
  { name: "julius munene" },
  { name: "david gitonga" },
  { name: "cathe karigi" },
  { name: "kellen gatwiri" },
  { name: "eric mugendi" },
  { name: "robert mbaya" },
  { name: "chrispus" },
  { name: "john gikundi" },
  { name: "charity kainyu" },
  { name: "muriuki mbiri" },
  { name: "geoffry njeru" },
  { name: "law mugendi" },
  { name: "sarah kangai" },
  { name: "gerrald njuki" },
  { name: "zipporah" },
  { name: "rufus mute" },
  { name: "john miriti" },
  { name: "julius mbabu" },
  { name: "stella kainyu" },
  { name: "nichulus mwi" },
  { name: "tonny mawira" },
  { name: "david kathuri" },
  { name: "patric mbabu" },
  { name: "dorcus nkinga" },
  { name: "nicholus kimathi" },
  { name: "florence kangai" },
  { name: "eric mugendi" },
  { name: "philip murithi" },
  { name: "jane mbaya" },
  { name: "kelvin munene" },
  { name: "bonface mutembei" },
  { name: "fridah nkatha" },
  { name: "james njeru" },
  { name: "elid kathure" },
  { name: "p musairu" },
];

async function seedFarmers() {
  try {
    await mongoose.connect(process.env.DB_URL);

    const docs = farmers.map((farmer) => ({
      ...farmer,
      cooperativeId: COOPERATIVE_ID,
      isActive: true,
      currentBalance: 0,
    }));

    const result = await Farmer.insertMany(docs);

    console.log(`✅ Seeded ${result.length} farmers.`);
  } catch (err) {
    console.error("❌ Error seeding farmers:", err);
  } finally {
    await mongoose.disconnect();
  }
}

// // seedFarmers();
// require("dotenv").config();
// const mongoose = require("mongoose");
// const Farmer = require("../models/Farmer");

// async function createIndex() {
//   try {
//     await mongoose.connect(process.env.DB_URL);

//     await Farmer.collection.createIndex(
//       { farmer_code: 1 },
//       {
//         unique: true,
//         partialFilterExpression: {
//           farmer_code: { $exists: true, $ne: null },
//         },
//         name: "farmer_code_unique",
//       }
//     );

//     console.log("✅ Index created.");
//   } catch (err) {
//     console.error(err);
//   } finally {
//     await mongoose.disconnect();
//   }
// }

// createIndex();



[
    ("09", "Peter Karani", "0716637189"),
    ("43", "Person Mwiri", "0717060917"),
    ("21", "Robert Mbaya", "0722291182"),
    ("35", "Rosemary Kagendo ", "0717394963"),
    ("22", "Rufus Mutembei", "0722111183"),
    ("27", "Rufus Mutomi", "0722981033"),
    ("28", "Jeniter Micheni", "0720812207"),
    ("47", "Saran KangaI", "0768684600"),
    ("46", "Stella Kainyu", "0719526612"),
    ("15", "Susan Kanga", "0710446979"),
    ("79", "Tabitha Karwitha", "0799603895"),
    ("75", "Tonny Mawira", "0743480142"),
    ("45", "Zipporah Kathambi", "0797431147"),

    ("52", "Ian Munene", "0714878441"),
    ("37", "Jackim Murimi", "0716879326"),
    ("61", "James Kiambi", "0792898035"),
    ("07", "James Kimathi", "0714511659"),
    ("16", "James Njeru", "0722811272"),
    ("80", "Jane Karimi", "0705289608"),
    ("25", "Jane Mbaya", "0719830488"),
    ("99", "Jasper Mawira", "0112441136"),
    ("03", "Jerald Ireri", "07283329156"),
    ("04", "John Gikundi", "0724419924"),
    ("10", "John Mugendi", "0720574139"),
    ("06", "John Nyaga", "0711931315"),
    ("101", "John Miriti", "0798492855"),
    ("01", "Julius Munene", "0714269256"),
    ("58", "Julius Muriuki", "0712143174"),
    ("90", "Julius Nyerere", "0711522790"),
    ("91", "Julius Mbabu M`inoti ", "0799691440"),
    ("88", "Kellen Gatwiri", "071160735"),
    ("103", "Kelvin Munene", "0710549538"),
    ("71", "Kinyua Micheni", "0724905004"),
    ("14", "Lawrence Mugendi", "0728682158"),
    ("86", "Loisy Gakii", "0712267038"),
    ("17", "Loyd Mwirigi", "0725016748"),
    ("72", "Martin Kinegeni", "0718254231"),
    ("94", "Martin Mwenda", "0725121980"),
    ("12", "Mercy Muthoni", "0702827077"),
    ("36", "Muriuki Mbinchi", "0721660548"),
    ("81", "Nicholus Kimathi", "0728087546"),
    ("56", "Nicholus Mwirigi", "0743840593"),
    ("96", "Nicholus Mwiti Mbaya", "07916506659"),
    ("50", "Patrick Mbabu", "0701602309"),
    ("106", "Patrick Musairu", "0721602626"),

    ("89", "Alex Muembtei", "0729688064"),
    ("48", "Ann Kainyu", "0721769197"),
    ("18", "Ashford Mbaya", "0796396420"),
    ("104", "Bonface Mutembei", "0724209404"),
    ("53", "Bonface Kinyua", "0791838099"),
    ("41", "Bosco Mwiti", "0715473913"),
    ("54", "Brian Mwenda", "0711952791"),
    ("23", "Catherine Kang`i", "0703978696"),
    ("62", "Charles Mugambi", "0758849512"),
    ("30", "Charity Kainyu", "0741373458"),
    ("02", "Chrispus Mbaya", "0705087233"),
    ("70", "Cecilia Kangai", "0700778179"),
    ("77", "David Gitonga", "0716322322"),
    ("11", "David Ndiga", "0720312742"),
    ("63", "David Kimathi Riungu", "0724234947"),
    ("44", "David Kathuri","0797607756"),
    ("39", "Dorcus Nkinga", "0721175853"),
    ("83", "Doreen Gakii", "0717907130"),
    ("13", "Dorothy Kawira", "0718011671"),
    ("82", "Edwin Murimi Njiru", "0718812707"),
    ("107", "Enid Kathure", "0784211659"),
    ("08", "Eric Mugendi Mbaya", "0725082455"),
    ("95", "Eric Mutuma", "0725787366"),
    ("49", "Eric Mugendi Kaari", "0704461079"),
    ("55", "Eustace Kaburu Murithi", "07978304870"),
    ("69", "Florah Njeru", "0722994368"),
    ("92", "Florence Kangai Kithinji", "0707951288"),
    ("102", "Fridah Nkatha", "0742017719"),
    ("29", "Gerrald Njuki", "0711738569"),
    ("76", "Gerrald Mbabu", "0728946572"),
    ("105", "Geoffrey Munene", "0723963405"),
    ("31", "Geoffrey Njeru", "0729520016"),
  ]



