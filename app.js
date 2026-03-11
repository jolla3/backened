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

const app = express()
const server = http.createServer(app);

// Initialize WebSocket
const io = initWebSocket(server);

// Middleware
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(correlationMiddleware);

// Routes
app.use('/api', routes);

// Error handling
app.use(errorMiddleware);

// Start server
const PORT = config.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
    
    server.listen(PORT, () => {
      // No log here - too verbose
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

module.exports = { app, server, io };