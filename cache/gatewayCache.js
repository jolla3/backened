// cache/gatewayCache.js
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCachedGateway = (gatewayId) => {
  const entry = cache.get(gatewayId);
  if (entry && entry.expires > Date.now()) {
    return entry.gateway;
  }
  return null;
};

const setCachedGateway = (gatewayId, gateway) => {
  cache.set(gatewayId, { gateway, expires: Date.now() + CACHE_TTL });
};

const clearGatewayCache = (gatewayId) => {
  cache.delete(gatewayId);
};

module.exports = { getCachedGateway, setCachedGateway, clearGatewayCache };