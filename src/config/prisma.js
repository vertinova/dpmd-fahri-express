/**
 * Prisma Client Instance
 * Single instance untuk digunakan di seluruh aplikasi
 */

const { PrismaClient, Prisma } = require('@prisma/client');
const { buatEkstensiPg } = require('./prismaPg');
const logger = require('../utils/logger');

// Satu pool untuk seluruh aplikasi. Dulu shim SQL punya pool 30 koneksi sendiri; bawaan Prisma
// (2×CPU+1) terlalu kecil untuk menggantikannya. Bisa ditimpa lewat connection_limit di DATABASE_URL.
const urlDb = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '30');
    return u.toString();
  } catch {
    return undefined; // DATABASE_URL kosong/rusak: biarkan Prisma melaporkan galatnya sendiri
  }
})();

// Buat Prisma Client instance
const klienDasar = new PrismaClient({
  ...(urlDb && { datasourceUrl: urlDb }),
  log: process.env.NODE_ENV === 'development' 
    ? ['info', 'warn', 'error']  // Removed 'query' to reduce log noise
    : ['warn', 'error'],
});

// Ekstensi PG: literal untuk SQL mentah, pencarian tak peka huruf, urutan stabil (lihat prismaPg.js).
const prisma = klienDasar.$extends(buatEkstensiPg(Prisma));

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
