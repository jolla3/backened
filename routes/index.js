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
const monitoring = require('./monitoring');
const zoneRoutes = require('./zoneRoutes');
const userRoutes = require('./userRoutes');
const settlementRoutes = require('./settlementRoutes');
const { authMiddleware, roleCheck } = require('../middlewares/authMiddleware');
const developerRoutes = require('./developerRoutes');



router.use('/dev', developerRoutes);
// Public routes
router.use('/auth', authRoutes);
router.use('/coop',  cooperativeRoutes)
router.use('/users', userRoutes);

// Protected routes

router.use('/farmers', authMiddleware, farmerRoutes);
router.use('/porters', authMiddleware, roleCheck('SUPER_ADMIN','ADMIN'), porterRoutes);
router.use('/milk', authMiddleware, milkRoutes);
router.use('/inventory', authMiddleware, inventoryRoutes);
router.use('/pricing', authMiddleware, roleCheck('SUPER_ADMIN','ADMIN'), pricingRoutes);
router.use('/feed', authMiddleware, feedPurchaseRoutes);
router.use('/sync', syncRoutes);
router.use('/qr', qrRoutes);
router.use('/zones', zoneRoutes);
// app.use('/api/monitoring', monitoringRoutes);
router.use('/monitoring', monitoring);
router.use('/settlements', settlementRoutes);
router.use('/pos', posRoutes);
router.use('/reports', authMiddleware, roleCheck('SUPER_ADMIN','ADMIN'), reportRoutes);
router.use('/notifications', authMiddleware, notificationRoutes);
router.use('/devices', authMiddleware, deviceRoutes);
router.use('/dashboard', authMiddleware, roleCheck('SUPER_ADMIN','ADMIN'), dashboardRoutes);

module.exports = router;