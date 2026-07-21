const dns = require("dns").promises;

dns.resolveSrv("_mongodb._tcp.cluster0.6bzmy3j.mongodb.net")
  .then(console.log)
  .catch(console.error);