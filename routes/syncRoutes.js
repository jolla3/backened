const express = require('express');
const router = express.Router();
const { postBatch, postDeltas } = require('../controllers/syncController');
const deviceMiddleware = require('../middlewares/deviceMiddleware');

router.post('/batch', deviceMiddleware, postBatch);
router.post('/deltas', deviceMiddleware, postDeltas);

module.exports = router;