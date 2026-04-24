const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const prisma = new PrismaClient();
  try {
    const desas = await prisma.desas.findMany({
      where: {
        kecamatans: {
          nama: { contains: 'BABAKAN MADANG' }
        }
      },
      select: { id: true, nama: true, kecamatan_id: true },
      orderBy: { nama: 'asc' }
    });
    for (const d of desas) {
      console.log(`desa_id=${d.id.toString().padStart(3)} | nama=${d.nama}`);
    }
    console.log(`\nTotal: ${desas.length} desa`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
