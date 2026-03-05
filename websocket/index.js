const http = require('http');
const { Server } = require('socket.io');
const logger = require('../utils/logger');

let io;

const initWebSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id });
    
    socket.on('join', (room) => {
      socket.join(room);
      logger.info('Joined room', { room, socketId: socket.id });
    });

    socket.on('disconnect', () => {
      logger.info('Client disconnected', { socketId: socket.id });
    });
  });

  return io;
};

const emitToAdmin = (event, data) => {
  if (io) {
    io.to('admin').emit(event, data);
  }
};

module.exports = { initWebSocket, emitToAdmin };