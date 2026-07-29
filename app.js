require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { initWebSocket, emitToAdmin } = require('./websocket');
const connectDB = require('./config/db');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/errorMiddleware');
const correlationMiddleware = require('./middlewares/correlationMiddleware');
const logger = require('./utils/logger');
const config = require('./config');

// ── Scheduler ──────────────────────────────────────────────
const { startJobRecovery } = require('./scheduler/jobRecovery');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket
const io = initWebSocket(server);

// Middleware
app.use(cors());
app.use(helmet());
app.use(compression());

// ✅ Limit JSON payload to 1MB to prevent abuse
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(correlationMiddleware);

// Routes
app.use('/api', routes);

// Error handling
app.use(errorMiddleware);

const PORT = config.PORT || 3000;

const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();
    logger.info('MongoDB connected');

    // 2. Start job recovery scheduler (synchronous call)
    startJobRecovery();

    // 3. Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };