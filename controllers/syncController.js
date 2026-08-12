const syncService = require('../services/syncService');
const logger = require('../utils/logger');

const postBatch = async (req, res) => {
  const cooperativeId = req.user?.cooperativeId;
  const adminId = req.user?.id || req.user?._id;

  if (!cooperativeId) {
    logger.error('Sync batch failed – missing cooperativeId in token', {
      adminId,
      user: req.user,
    });
    return res.status(400).json({ error: 'Invalid token: cooperativeId missing' });
  }

  const session = await require('mongoose').startSession();
  session.startTransaction();

  try {
    const { batch } = req.body;

    if (!Array.isArray(batch) || batch.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'batch must be a non-empty array' });
    }

    const result = await syncService.reconcileDeltas(batch, cooperativeId, session);

    await session.commitTransaction();
    res.json(result);
  } catch (error) {
    await session.abortTransaction();
    logger.error('Sync batch failed', {
      error: error.message,
      cooperativeId,
      adminId,
    });
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

const postDeltas = async (req, res) => {
  const cooperativeId = req.user?.cooperativeId;
  const adminId = req.user?.id || req.user?._id;

  if (!cooperativeId) {
    logger.error('Sync deltas failed – missing cooperativeId in token', {
      adminId,
      user: req.user,
    });
    return res.status(400).json({ error: 'Invalid token: cooperativeId missing' });
  }

  const session = await require('mongoose').startSession();
  session.startTransaction();

  try {
    const { deltas } = req.body;

    if (!Array.isArray(deltas) || deltas.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'deltas must be a non-empty array' });
    }

    const result = await syncService.reconcileDeltas(deltas, cooperativeId, session);

    await session.commitTransaction();
    res.json(result);
  } catch (error) {
    await session.abortTransaction();
    logger.error('Sync deltas failed', {
      error: error.message,
      cooperativeId,
      adminId,
    });
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

module.exports = { postBatch, postDeltas };