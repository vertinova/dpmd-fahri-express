/**
 * Prisma Client Instance
 * Single instance untuk digunakan di seluruh aplikasi
 */

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// Buat Prisma Client instance
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['info', 'warn', 'error']  // Removed 'query' to reduce log noise
    : ['warn', 'error'],
});

// Test connection (non-fatal - Prisma will auto-reconnect on first query)
prisma.$connect()
  .then(() => {
    logger.info('✅ Prisma Client connected to database');
  })
  .catch((err) => {
    logger.error('❌ Prisma Client initial connection failed (will retry on first query):', err);
  });

// Graceful shutdown.
//
// `beforeExit` DI-EMIT BERULANG: Node memancarkannya lagi setiap kali event loop
// kosong kembali. Handler ini async, jadi await-nya sendiri mengisi ulang event
// loop → beforeExit nyala lagi → ribuan baris "Prisma Client disconnected"
// membanjiri terminal setiap skrip CLI selesai. Karena itu dijaga agar sekali jalan.
let disconnecting = false;
process.on('beforeExit', async () => {
  if (disconnecting) return;
  disconnecting = true;
  await prisma.$disconnect();
  logger.info('Prisma Client disconnected');
});

module.exports = prisma;
