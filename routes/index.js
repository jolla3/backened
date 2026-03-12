const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const farmerRoutes = require('./farmerRoutes');
const porterRoutes = require('./porterRoutes');
const milkRoutes = require('./milkRoutes');
const inventoryRoutes = require('./inventoryRoutes');
const pricingRoutes = require('./pricingRoutes');
const feedPurchaseRoutes = require('./feedPurchaseRoutes');
const syncRoutes = require('./syncRoutes');
const qrRoutes = require('./qrRoutes');
const reportRoutes = require('./reportRoutes');
const notificationRoutes = require('./notificationRoutes');
const deviceRoutes = require('./deviceRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const posRoutes = require('./posRoutes')
const cooperativeRoutes = require('./cooperativeRoutes')
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');

// Public routes
router.use('/auth', authRoutes);
router.use('/coop',  cooperativeRoutes)

// Protected routes
router.use('/farmers', authMiddleware, farmerRoutes);
router.use('/porters', authMiddleware, roleCheck('admin'), porterRoutes);
router.use('/milk', authMiddleware, milkRoutes);
router.use('/inventory', authMiddleware, inventoryRoutes);
router.use('/pricing', authMiddleware, roleCheck('admin'), pricingRoutes);
router.use('/feed', authMiddleware, feedPurchaseRoutes);
router.use('/sync', syncRoutes);
router.use('/qr', qrRoutes);
router.use('/pos', posRoutes);
router.use('/reports', authMiddleware, roleCheck('admin'), reportRoutes);
router.use('/notifications', authMiddleware, notificationRoutes);
router.use('/devices', authMiddleware, roleCheck('admin'), deviceRoutes);
router.use('/dashboard', authMiddleware, roleCheck('admin'), dashboardRoutes);

module.exports = router;