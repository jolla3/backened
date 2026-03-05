const express = require('express');
const router = express.Router();
const { register, approve, revoke } = require('../controllers/deviceController');

router.post('/register', register);
router.put('/approve/:id', approve);
router.put('/revoke/:id', revoke);

module.exports = router;