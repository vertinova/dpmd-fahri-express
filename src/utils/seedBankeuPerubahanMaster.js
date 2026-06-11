/**
 * Auto-seeder untuk bankeu_perubahan_master_kegiatan
 * Idempotent: cek dulu apakah data sudah ada sebelum insert
 * Dipanggil saat server startup
 */
const sequelize = require('../config/database');
const logger = require('./logger');

const KEGIATAN_DATA = [
  // WAJIB (3)
  { kategori: 'wajib', urutan: 1, nama_kegiatan: 'Minimal Satu Sarjana Satu Desa' },
  { kategori: 'wajib', urutan: 2, nama_kegiatan: 'Digitalisasi Data Desa' },
  { kategori: 'wajib', urutan: 3, nama_kegiatan: 'Dayeuh Pajajaran' },

  // PILIHAN INFRASTRUKTUR (8)
  { kategori: 'pilihan_infrastruktur', urutan: 1, nama_kegiatan: 'Jalan Desa' },
  { kategori: 'pilihan_infrastruktur', urutan: 2, nama_kegiatan: 'Jalan Lingkungan' },
  { kategori: 'pilihan_infrastruktur', urutan: 3, nama_kegiatan: 'Jembatan Desa' },
  { kategori: 'pilihan_infrastruktur', urutan: 4, nama_kegiatan: 'TPT (Tembok Penahan Tanah)' },
  { kategori: 'pilihan_infrastruktur', urutan: 5, nama_kegiatan: 'Pembangunan/Rehabilitasi/Rekonstruksi Kantor Desa' },
  { kategori: 'pilihan_infrastruktur', urutan: 6, nama_kegiatan: 'Drainase/Gorong-gorong' },
  { kategori: 'pilihan_infrastruktur', urutan: 7, nama_kegiatan: 'Sarana Prasarana Air Bersih' },
  { kategori: 'pilihan_infrastruktur', urutan: 8, nama_kegiatan: 'Pendukung KDMP (Pengkerasan Lahan Parkir)' },

  // PILIHAN NON INFRASTRUKTUR (8)
  { kategori: 'pilihan_non_infrastruktur', urutan: 1, nama_kegiatan: 'Desa Siaga' },
  { kategori: 'pilihan_non_infrastruktur', urutan: 2, nama_kegiatan: 'Kampung KB' },
  { kategori: 'pilihan_non_infrastruktur', urutan: 3, nama_kegiatan: 'Sekolah Pra Nikah' },
  { kategori: 'pilihan_non_infrastruktur', urutan: 4, nama_kegiatan: 'Gerakan Pangan Murah' },
  { kategori: 'pilihan_non_infrastruktur', urutan: 5, nama_kegiatan: 'Sekolah Perempuan' },
  { kategori: 'pilihan_non_infrastruktur', urutan: 6, nama_kegiatan: 'Pemberdayaan Lembaga Kemasyarakatan' },
  { kategori: 'pilihan_non_infrastruktur', urutan: 7, nama_kegiatan: 'BPJS Ketenagakerjaan Pekerja Rentan' },
  { kategori: 'pilihan_non_infrastruktur', urutan: 8, nama_kegiatan: 'Sarana dan Prasarana Keagamaan' },
];

async function seedBankeuPerubahanMasterKegiatan() {
  try {
    // Cek apakah tabel sudah ada
    const [tableExists] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'bankeu_perubahan_master_kegiatan'
    `);
    if (tableExists[0].cnt === 0) {
      // Tabel belum dibuat - skip silently (akan dibuat via prisma db push / migration SQL)
      return { seeded: 0, skipped: true, reason: 'Table not exists yet' };
    }

    // Self-heal: "Sarana dan Prasarana Keagamaan" dipindah dari infrastruktur
    // ke non-infrastruktur. Jalankan tiap startup agar DB yang sudah ter-seed
    // sebelumnya (mis. di server) ikut terkoreksi, karena db push hanya
    // menyinkronkan skema, bukan data.
    await sequelize.query(`
      UPDATE bankeu_perubahan_master_kegiatan
      SET kategori = 'pilihan_non_infrastruktur', urutan = 8
      WHERE nama_kegiatan = 'Sarana dan Prasarana Keagamaan'
        AND kategori = 'pilihan_infrastruktur'
    `);

    // Self-heal: rename "Pembangunan/Rehab Kantor Desa" -> versi lengkap.
    // Sekaligus sinkronkan nama terdenormalisasi pada proposal yang sudah ada.
    await sequelize.query(`
      UPDATE bankeu_perubahan_master_kegiatan
      SET nama_kegiatan = 'Pembangunan/Rehabilitasi/Rekonstruksi Kantor Desa'
      WHERE nama_kegiatan = 'Pembangunan/Rehab Kantor Desa'
    `);
    await sequelize.query(`
      UPDATE bankeu_perubahan_proposals
      SET kegiatan_nama = 'Pembangunan/Rehabilitasi/Rekonstruksi Kantor Desa'
      WHERE kegiatan_nama = 'Pembangunan/Rehab Kantor Desa'
    `);

    // Cek apakah sudah ada data
    const [existing] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM bankeu_perubahan_master_kegiatan
    `);
    if (Number(existing[0].cnt) >= KEGIATAN_DATA.length) {
      return { seeded: 0, skipped: true, reason: 'Already seeded' };
    }

    // Insert kegiatan yang belum ada (idempotent per nama_kegiatan + kategori)
    let inserted = 0;
    for (const item of KEGIATAN_DATA) {
      const [check] = await sequelize.query(`
        SELECT id FROM bankeu_perubahan_master_kegiatan
        WHERE kategori = ? AND nama_kegiatan = ?
        LIMIT 1
      `, { replacements: [item.kategori, item.nama_kegiatan] });

      if (check.length === 0) {
        await sequelize.query(`
          INSERT INTO bankeu_perubahan_master_kegiatan (kategori, urutan, nama_kegiatan, is_active)
          VALUES (?, ?, ?, TRUE)
        `, { replacements: [item.kategori, item.urutan, item.nama_kegiatan] });
        inserted++;
      }
    }

    if (inserted > 0) {
      logger.info(`✅ [Seed] bankeu_perubahan_master_kegiatan: ${inserted} kegiatan ter-seed`);
    }
    return { seeded: inserted, skipped: false };
  } catch (error) {
    logger.error('[Seed] Error seeding bankeu_perubahan_master_kegiatan:', error.message);
    // Jangan throw - biar tidak menghentikan startup server
    return { seeded: 0, skipped: true, error: error.message };
  }
}

module.exports = { seedBankeuPerubahanMasterKegiatan, KEGIATAN_DATA };
