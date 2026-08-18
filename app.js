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

// Schedulers
const { startJobRecovery } = require('./scheduler/jobRecovery');
const { startSmsWorker, stopSmsWorker } = require('./scheduler/smsWorkerScheduler');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket
const io = initWebSocket(server);

// Middleware
app.use(cors());
app.use(helmet());
app.use(compression());
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

    // 2. Start job recovery scheduler
    startJobRecovery();

    // 3. Start SMS worker (Celcom pipeline)
    //    This is the critical link: worker must actually run.
    await startSmsWorker();
    logger.info('SMS worker started');

    // 4. Start HTTP server
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
const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  try {
    await stopSmsWorker();
  } catch (e) {
    logger.warn('Error stopping SMS worker', { error: e.message });
  }
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, io };