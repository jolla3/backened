require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { initWebSocket } = require('./websocket');
const connectDB = require('./config/db');
const routes = require('./routes');
const errorMiddleware = require('./middlewares/errorMiddleware');
const correlationMiddleware = require('./middlewares/correlationMiddleware');
const logger = require('./utils/logger');
const config = require('./config');
const smsService = require('./services/smsService');

// const { startJobRecovery } = require('./scheduler/jobRecovery');
const { startSmsWorker, stopSmsWorker } = require('./scheduler/smsWorkerScheduler');

const app = express();
const server = http.createServer(app);

initWebSocket(server);

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(correlationMiddleware);

app.use('/api', routes);
app.use(errorMiddleware);

const PORT = config.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
    logger.info('MongoDB connected');

    // // Optional: stuck job recovery for other job types
    // if (typeof startJobRecovery === 'function') {
    //   startJobRecovery();
    // }

    // Requeue known low-credit unknowns onto celcom route (once at boot)
    try {
      const n = await smsService.recoverLowCreditJobs();
      if (n > 0) {
        logger.info(`Requeued ${n} low-credit SMS job(s) for Celcom`);
      }
    } catch (e) {
      logger.warn('recoverLowCreditJobs failed at startup', { error: e.message });
    }

    await startSmsWorker();
    logger.info('SMS worker started (Celcom deliveryRoute only)');

    server.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

startServer();

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

module.exports = { app, server };