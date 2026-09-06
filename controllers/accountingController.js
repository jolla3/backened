const accountingService = require('../services/accountingService');
const logger = require('../utils/logger');

/**
 * Get current provider balance and status.
 */
const getProviderStatus = async (req, res) => {
  try {
    const account = await accountingService.getProviderAccount('celcom');
    if (!account) {
      return res.status(404).json({ success: false, error: 'Provider account not found' });
    }
    res.json({
      success: true,
      provider: account.provider,
      balance: account.currentBalance,
      currency: account.currency,
      status: account.status,
      lastCheckedAt: account.lastCheckedAt,
    });
  } catch (error) {
    logger.error('Failed to get provider status', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get cooperative usage summary.
 */
const getCooperativeUsage = async (req, res) => {
  try {
    const { cooperativeId } = req.params;
    const { startDate, endDate } = req.query;
    const usage = await accountingService.getCooperativeUsage(cooperativeId, startDate, endDate);
    res.json({ success: true, usage });
  } catch (error) {
    logger.error('Failed to get cooperative usage', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get system-wide usage summary.
 */
const getSystemUsage = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await accountingService.getSystemUsageSummary(startDate, endDate);
    res.json({ success: true, summary });
  } catch (error) {
    logger.error('Failed to get system usage', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get balance history (snapshots).
 */
const getBalanceHistory = async (req, res) => {
  try {
    const { provider = 'celcom', limit = 30 } = req.query;
    const history = await accountingService.getBalanceHistory(provider, parseInt(limit));
    res.json({ success: true, history });
  } catch (error) {
    logger.error('Failed to get balance history', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get per-cooperative usage breakdown.
 */
const getCooperativeUsageSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await accountingService.getCooperativeUsageSummary(startDate, endDate);
    res.json({ success: true, summary });
  } catch (error) {
    logger.error('Failed to get cooperative usage summary', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

// ─── NEW METHODS ─────────────────────────────────────────────

/**
 * Get paginated list of SMS messages with filters.
 * Query params: cooperativeId, status, type, startDate, endDate, page, limit
 */
const getSmsMessages = async (req, res) => {
  try {
    const { cooperativeId, status, type, startDate, endDate, page = 1, limit = 20 } = req.query;
    const result = await accountingService.getMessages({
      cooperativeId,
      status,
      type,
      startDate,
      endDate,
      page: parseInt(page),
      limit: parseInt(limit),
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to get SMS messages', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get reconciliation data: provider balance vs internal usage.
 */
const getReconciliation = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const result = await accountingService.getReconciliation(startDate, endDate);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to get reconciliation', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Trigger a manual refresh of provider balance (calls Celcom API and stores snapshot).
 */
const refreshBalance = async (req, res) => {
  try {
    const result = await accountingService.refreshProviderBalance('celcom');
    res.json({ success: true, balance: result.balance });
  } catch (error) {
    logger.error('Failed to refresh balance', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getProviderStatus,
  getCooperativeUsage,
  getSystemUsage,
  getBalanceHistory,
  getCooperativeUsageSummary,
  getSmsMessages,
  getReconciliation,
  refreshBalance,
};