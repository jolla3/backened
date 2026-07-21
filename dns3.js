const dns = require("dns");

dns.getServers();
console.log("Servers:", dns.getServers());