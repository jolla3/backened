// routes/developerAuthRoutes.js
const express = require('express');
const router = express.Router();
const developerAuthController = require('../controllers/developerAuthController');

router.post('/login', developerAuthController.login);

module.exports = router;