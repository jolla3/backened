require("dotenv").config();
const mongoose = require("mongoose");

console.log(process.env.DB_URL);

mongoose
  .connect(process.env.DB_URL)
  .then(() => {
    console.log("Connected!");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });