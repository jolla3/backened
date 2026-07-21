const dns = require("dns");

dns.lookup("google.com", (err, address, family) => {
  console.log({ err, address, family });
});