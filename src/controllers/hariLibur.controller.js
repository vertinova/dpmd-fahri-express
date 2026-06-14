/**
 * Controller CRUD Hari Libur (libur nasional / cuti bersama).
 * Dipakai untuk memblokir pemilihan tanggal merah saat generate BA & SP bankeu.
 */

const { sequelize } = require('../models');
const { getHariLibur, toYmd } = require('../utils/tanggalMerah');
const logger = require('../utils/logger');

class HariLiburController {
  /**
   * GET /api/hari-libur?tahun=2026
   * Daftar hari libur aktif. Bisa diakses semua user terautentikasi
   * (kecamatan butuh untuk menonaktifkan tanggal di date picker).
   */
  async list(req, res) {
    try {
      const { tahun } = req.query;
      const data = await getHariLibur(tahun);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Error list hari libur:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil daftar hari libur', error: error.message });
    }
  }

  /**
   * POST /api/hari-libur  { tanggal, keterangan }
   */
  async create(req, res) {
    try {
      const { tanggal, keterangan } = req.body;
      const ymd = toYmd(tanggal);

      if (!ymd || !keterangan || !keterangan.trim()) {
        return res.status(400).json({ success: false, message: 'Tanggal dan keterangan wajib diisi' });
      }

      const [existing] = await sequelize.query(
        `SELECT id, is_active FROM hari_libur WHERE tanggal = :ymd LIMIT 1`,
        { replacements: { ymd }, type: sequelize.QueryTypes.SELECT }
      );

      if (existing) {
        // Tanggal sudah ada -> aktifkan kembali & perbarui keterangan (idempotent)
        await sequelize.query(
          `UPDATE hari_libur SET keterangan = :keterangan, is_active = 1, updated_at = NOW() WHERE id = :id`,
          { replacements: { keterangan: keterangan.trim(), id: existing.id } }
        );
        return res.json({ success: true, message: 'Hari libur diperbarui', data: { id: existing.id, tanggal: ymd, keterangan: keterangan.trim() } });
      }

      const [id] = await sequelize.query(
        `INSERT INTO hari_libur (tanggal, keterangan, created_by) VALUES (:ymd, :keterangan, :createdBy)`,
        { replacements: { ymd, keterangan: keterangan.trim(), createdBy: req.user?.id || null } }
      );

      res.status(201).json({ success: true, message: 'Hari libur ditambahkan', data: { id, tanggal: ymd, keterangan: keterangan.trim() } });
    } catch (error) {
      logger.error('Error create hari libur:', error);
      res.status(500).json({ success: false, message: 'Gagal menambah hari libur', error: error.message });
    }
  }

  /**
   * PUT /api/hari-libur/:id  { tanggal?, keterangan?, is_active? }
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { tanggal, keterangan, is_active } = req.body;

      const [existing] = await sequelize.query(
        `SELECT id FROM hari_libur WHERE id = :id LIMIT 1`,
        { replacements: { id }, type: sequelize.QueryTypes.SELECT }
      );
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Hari libur tidak ditemukan' });
      }

      const sets = [];
      const replacements = { id };
      if (tanggal !== undefined) {
        const ymd = toYmd(tanggal);
        if (!ymd) return res.status(400).json({ success: false, message: 'Format tanggal tidak valid' });
        sets.push('tanggal = :tanggal');
        replacements.tanggal = ymd;
      }
      if (keterangan !== undefined) {
        if (!keterangan.trim()) return res.status(400).json({ success: false, message: 'Keterangan tidak boleh kosong' });
        sets.push('keterangan = :keterangan');
        replacements.keterangan = keterangan.trim();
      }
      if (is_active !== undefined) {
        sets.push('is_active = :is_active');
        replacements.is_active = is_active ? 1 : 0;
      }

      if (sets.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada data yang diperbarui' });
      }

      await sequelize.query(
        `UPDATE hari_libur SET ${sets.join(', ')}, updated_at = NOW() WHERE id = :id`,
        { replacements }
      );

      res.json({ success: true, message: 'Hari libur diperbarui' });
    } catch (error) {
      logger.error('Error update hari libur:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui hari libur', error: error.message });
    }
  }

  /**
   * POST /api/hari-libur/sync?tahun=2026
   * Tarik kalender libur nasional + cuti bersama Indonesia dari sumber publik
   * (APIHariLibur_V2 / guangrei, raw GitHub) lalu simpan/perbarui ke tabel hari_libur.
   */
  async sync(req, res) {
    try {
      const tahun = parseInt(req.query.tahun || req.body?.tahun, 10);
      if (!tahun || tahun < 2000 || tahun > 2100) {
        return res.status(400).json({ success: false, message: 'Parameter tahun tidak valid' });
      }

      let calendar;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch('https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/calendar.json', { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        calendar = await resp.json();
      } catch (apiErr) {
        logger.error('Gagal memanggil sumber kalender libur:', apiErr);
        return res.status(502).json({
          success: false,
          message: 'Gagal mengambil data kalender libur online. Pastikan server terhubung internet, atau tambahkan tanggal secara manual.'
        });
      }

      if (!calendar || typeof calendar !== 'object') {
        return res.status(502).json({ success: false, message: 'Format data kalender tidak dikenali' });
      }

      // Ambil entri tahun terpilih yang merupakan hari libur (tanggal merah / cuti bersama)
      const entries = Object.entries(calendar).filter(
        ([tgl, val]) => tgl.startsWith(`${tahun}-`) && val && val.holiday === true
      );

      if (entries.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Data kalender libur untuk tahun ${tahun} belum tersedia di sumber online. Coba tahun lain atau tambahkan manual.`
        });
      }

      let inserted = 0;
      let updated = 0;
      for (const [tgl, val] of entries) {
        const ymd = toYmd(tgl);
        if (!ymd) continue;
        const summary = Array.isArray(val.summary) ? val.summary.join(', ') : (val.summary || '');
        const keterangan = String(summary || 'Libur Nasional').trim().slice(0, 255);

        const [existing] = await sequelize.query(
          `SELECT id FROM hari_libur WHERE tanggal = :ymd LIMIT 1`,
          { replacements: { ymd }, type: sequelize.QueryTypes.SELECT }
        );

        if (existing) {
          await sequelize.query(
            `UPDATE hari_libur SET keterangan = :keterangan, is_active = 1, updated_at = NOW() WHERE id = :id`,
            { replacements: { keterangan, id: existing.id } }
          );
          updated++;
        } else {
          await sequelize.query(
            `INSERT INTO hari_libur (tanggal, keterangan, created_by) VALUES (:ymd, :keterangan, :createdBy)`,
            { replacements: { ymd, keterangan, createdBy: req.user?.id || null } }
          );
          inserted++;
        }
      }

      const data = await getHariLibur(tahun);
      res.json({
        success: true,
        message: `Sinkronisasi kalender libur ${tahun} selesai: ${inserted} ditambahkan, ${updated} diperbarui.`,
        data,
        summary: { tahun, total: entries.length, inserted, updated }
      });
    } catch (error) {
      logger.error('Error sync hari libur:', error);
      res.status(500).json({ success: false, message: 'Gagal sinkronisasi hari libur', error: error.message });
    }
  }

  /**
   * DELETE /api/hari-libur/:id  (hard delete)
   */
  async remove(req, res) {
    try {
      const { id } = req.params;
      const result = await sequelize.query(
        `DELETE FROM hari_libur WHERE id = :id`,
        { replacements: { id } }
      );
      res.json({ success: true, message: 'Hari libur dihapus' });
    } catch (error) {
      logger.error('Error delete hari libur:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus hari libur', error: error.message });
    }
  }
}

module.exports = new HariLiburController();
