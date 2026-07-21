// analytics/engines/inventoryEngine.js
const { safeNumber } = require('../utils/formatters');

const computeInventory = (context) => {
  const { inventory, milkTransactions, feedTransactions, now, thirtyDaysAgo } = context;

  if (!inventory || inventory.length === 0) {
    return {
      status: 'NOT_CONFIGURED',
      message: 'Inventory module has not been initialized.',
      items: [],
      summary: {
        totalItems: 0,
        totalStock: 0,
        inventoryValue: 0,
        lowStock: 0,
        outOfStock: 0,
        categories: {},
        stockValueByCategory: {},
        categoryIntelligence: {},
      },
    };
  }

  // All transactions with product_id (for velocity calculations)
  const allTransactions = [...milkTransactions, ...feedTransactions];
  const productSales = {};
  for (const t of allTransactions) {
    if (t.timestamp_server >= thirtyDaysAgo && t.product_id) {
      const pid = t.product_id.toString();
      if (!productSales[pid]) productSales[pid] = { total: 0, days: new Set(), revenue: 0 };
      productSales[pid].total += t.quantity || 0;
      productSales[pid].days.add(t.timestamp_server.toISOString().split('T')[0]);
      productSales[pid].revenue += t.cost || 0;
    }
  }

  const items = [];
  const categorySummary = {};
  const stockValueByCategory = {};
  let totalStock = 0;
  let inventoryValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  // Category-specific intelligence
  const categoryIntelligence = {
    Feed: { type: 'velocity', items: [] },
    Medicine: { type: 'stock', items: [] },
    Equipment: { type: 'stock', items: [] },
    Supplies: { type: 'stock', items: [] },
    Other: { type: 'stock', items: [] },
  };

  for (const item of inventory) {
    if (item.stock === -1) continue;

    const pid = item._id.toString();
    const sales = productSales[pid] || { total: 0, days: new Set(), revenue: 0 };
    const avgDaily = sales.days.size > 0 ? sales.total / sales.days.size : 0;
    const daysUntilStockout = avgDaily > 0 ? Math.floor(item.stock / avgDaily) : Infinity;

    let urgency = 'LOW';
    if (item.stock === 0) {
      urgency = 'EXHAUSTED';
      outOfStockCount++;
    } else if (daysUntilStockout <= 3) urgency = 'CRITICAL';
    else if (daysUntilStockout <= 7) urgency = 'URGENT';
    else if (daysUntilStockout <= 14) urgency = 'MEDIUM';

    const avgPrice = sales.total > 0 ? sales.revenue / sales.total : 0;
    const isFastMoving = avgDaily > 10;
    const isDeadStock = daysUntilStockout === Infinity && item.stock > 100;

    if (urgency === 'EXHAUSTED' || urgency === 'CRITICAL' || urgency === 'URGENT') lowStockCount++;

    const category = item.category || 'Other';
    if (!categorySummary[category]) categorySummary[category] = 0;
    categorySummary[category]++;

    const itemValue = item.stock * item.price;
    if (!stockValueByCategory[category]) stockValueByCategory[category] = 0;
    stockValueByCategory[category] += itemValue;

    totalStock += item.stock;
    inventoryValue += itemValue;

    const itemData = {
      product: item.name,
      category: item.category,
      currentStock: item.stock,
      threshold: item.threshold || 0,
      unit: item.unit,
      price: item.price,
      avgDailySales: Math.round(avgDaily),
      daysUntilStockout: daysUntilStockout === Infinity ? 'N/A' : daysUntilStockout,
      urgency,
      avgPrice: parseFloat(avgPrice.toFixed(2)),
      revenuePotential: Math.round(avgPrice * item.stock),
      isFastMoving,
      isSlowMoving: avgDaily < 2 && avgDaily > 0,
      isDeadStock,
      restockBy: daysUntilStockout <= 14 ? new Date(Date.now() + daysUntilStockout * 86400000).toISOString().split('T')[0] : null,
      supplier: item.supplier || 'Unknown',
    };

    // Add to category intelligence
    if (categoryIntelligence[category]) {
      categoryIntelligence[category].items.push(itemData);
    }

    items.push(itemData);
  }

  // Sort items
  const urgencyOrder = { EXHAUSTED: 0, CRITICAL: 1, URGENT: 2, MEDIUM: 3, LOW: 4 };
  items.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  // Generate category intelligence summaries
  const categoryIntelSummary = {};
  for (const [cat, data] of Object.entries(categoryIntelligence)) {
    if (data.items.length === 0) continue;
    if (data.type === 'velocity') {
      // For Feed: compute average velocity, fast/slow items
      const avgVelocity = data.items.reduce((s, i) => s + i.avgDailySales, 0) / data.items.length;
      const fast = data.items.filter(i => i.isFastMoving).length;
      const slow = data.items.filter(i => i.isSlowMoving).length;
      const dead = data.items.filter(i => i.isDeadStock).length;
      categoryIntelSummary[cat] = {
        type: 'velocity',
        avgVelocity: Math.round(avgVelocity),
        fastMoving: fast,
        slowMoving: slow,
        deadStock: dead,
        lowStock: data.items.filter(i => i.urgency === 'CRITICAL' || i.urgency === 'URGENT').length,
      };
    } else {
      // For others: just stock levels and alerts
      const lowStock = data.items.filter(i => i.urgency === 'CRITICAL' || i.urgency === 'URGENT').length;
      const outOfStock = data.items.filter(i => i.urgency === 'EXHAUSTED').length;
      categoryIntelSummary[cat] = {
        type: 'stock',
        totalItems: data.items.length,
        lowStock,
        outOfStock,
        totalStock: data.items.reduce((s, i) => s + i.currentStock, 0),
      };
    }
  }

  // ─── Status ──────────────────────────────────────────────────
  let status = 'HEALTHY';
  let message = 'All products have adequate stock.';
  if (items.length === 0) {
    status = 'EMPTY';
    message = 'No inventory items found.';
  } else if (outOfStockCount > 0) {
    status = 'EXHAUSTED';
    message = `${outOfStockCount} product${outOfStockCount > 1 ? 's' : ''} out of stock.`;
  } else if (lowStockCount > 0) {
    status = lowStockCount > 3 ? 'WARNING' : 'CAUTION';
    message = `${lowStockCount} product${lowStockCount > 1 ? 's' : ''} need attention.`;
  }

  return {
    status,
    message,
    items,
    summary: {
      totalItems: items.length,
      totalStock,
      inventoryValue: Math.round(inventoryValue),
      lowStock: lowStockCount,
      outOfStock: outOfStockCount,
      categories: categorySummary,
      stockValueByCategory,
      categoryIntelligence: categoryIntelSummary,
    },
  };
};

module.exports = { computeInventory };