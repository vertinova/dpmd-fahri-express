const sequelize = require('../config/database');
const logger = require('../utils/logger');

class BankeuPerubahanPublicController {
  /**
   * Get aggregate tracking summary for public transparency
   * GET /api/public/bankeu-perubahan/tracking-summary?tahun_anggaran=2026
   */
  async getTrackingSummary(req, res) {
    try {
      const { tahun_anggaran } = req.query;
      const tahun = tahun_anggaran ? parseInt(tahun_anggaran) : new Date().getFullYear();

      // Total per status
      const [statusStats] = await sequelize.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN kecamatan_status = 'approved' THEN 1 ELSE 0 END) AS approved_kecamatan,
          SUM(CASE WHEN dpmd_status = 'approved' THEN 1 ELSE 0 END) AS approved_dpmd,
          SUM(CASE WHEN submitted_to_kecamatan = TRUE THEN 1 ELSE 0 END) AS submitted_to_kecamatan,
          SUM(CASE WHEN submitted_to_dpmd = TRUE THEN 1 ELSE 0 END) AS submitted_to_dpmd,
          SUM(CASE WHEN anggaran_usulan IS NOT NULL THEN anggaran_usulan ELSE 0 END) AS total_anggaran
        FROM bankeu_perubahan_proposals
        WHERE tahun_anggaran = ?
      `, { replacements: [tahun] });

      // Per kecamatan
      const [perKecamatan] = await sequelize.query(`
        SELECT
          k.id AS kecamatan_id,
          k.nama AS kecamatan_nama,
          COUNT(bp.id) AS total_proposals,
          COUNT(DISTINCT bp.desa_id) AS total_desa,
          SUM(CASE WHEN bp.submitted_to_dpmd = TRUE THEN 1 ELSE 0 END) AS diterima_dpmd,
          SUM(CASE WHEN bp.anggaran_usulan IS NOT NULL THEN bp.anggaran_usulan ELSE 0 END) AS total_anggaran
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        INNER JOIN kecamatans k ON d.kecamatan_id = k.id
        WHERE bp.tahun_anggaran = ? AND bp.submitted_to_kecamatan = TRUE
        GROUP BY k.id, k.nama
        ORDER BY total_proposals DESC
      `, { replacements: [tahun] });

      // Per kategori kegiatan (wajib / pilihan_infrastruktur / pilihan_non_infrastruktur)
      const [perJenis] = await sequelize.query(`
        SELECT
          jenis_kegiatan AS kategori,
          COUNT(*) AS total,
          SUM(CASE WHEN submitted_to_dpmd = TRUE THEN 1 ELSE 0 END) AS diterima,
          SUM(CASE WHEN anggaran_usulan IS NOT NULL THEN anggaran_usulan ELSE 0 END) AS total_anggaran
        FROM bankeu_perubahan_proposals
        WHERE tahun_anggaran = ?
        GROUP BY jenis_kegiatan
      `, { replacements: [tahun] });

      // ─── Partisipasi Desa (untuk dashboard core) ──────────────────────
      // "Mengusulkan" pada alur perubahan = proposal sudah diteruskan ke Kecamatan
      // (submitted_to_kecamatan = TRUE), analog dengan "submit ke dinas" di Bankeu Reguler.
      // Hanya Desa (status_pemerintahan = 'desa', bukan kelurahan) yang dihitung.
      const [allDesaList] = await sequelize.query(`
        SELECT d.id, d.nama, k.nama AS kecamatan_nama
        FROM desas d
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        WHERE d.status_pemerintahan = 'desa'
        ORDER BY d.nama ASC
      `);

      const [desaSudahRows] = await sequelize.query(`
        SELECT DISTINCT desa_id
        FROM bankeu_perubahan_proposals
        WHERE tahun_anggaran = ? AND submitted_to_kecamatan = TRUE
      `, { replacements: [tahun] });
      const desaSudahSet = new Set(desaSudahRows.map(r => Number(r.desa_id)).filter(Boolean));

      const desaPartisipasi = {};
      allDesaList.forEach(d => {
        const kecName = d.kecamatan_nama || 'Lainnya';
        if (!desaPartisipasi[kecName]) desaPartisipasi[kecName] = { sudah: [], belum: [] };
        if (desaSudahSet.has(Number(d.id))) desaPartisipasi[kecName].sudah.push(d.nama);
        else desaPartisipasi[kecName].belum.push(d.nama);
      });

      const totalDesaCount = allDesaList.length;
      const partisipasiSummary = {
        ...(statusStats[0] || {}),
        total_desa: totalDesaCount,
        desa_mengusulkan: desaSudahSet.size,
        desa_belum_mengusulkan: totalDesaCount - desaSudahSet.size,
      };

      res.json({
        success: true,
        // Bentuk lama (dipakai BankeuPerubahanPublicPage) — JANGAN diubah.
        data: {
          tahun_anggaran: tahun,
          summary: statusStats[0] || {},
          per_kecamatan: perKecamatan,
          per_kategori: perJenis
        },
        // Bentuk top-level untuk dashboard core (analog Bankeu Reguler).
        summary: partisipasiSummary,
        desa_partisipasi: desaPartisipasi,
        tahun_anggaran: tahun
      });
    } catch (error) {
      logger.error('[BankeuPerubahan Public] Error tracking:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data tracking', error: error.message });
    }
  }

  /**
   * Get available years
   * GET /api/public/bankeu-perubahan/available-years
   */
  async getAvailableYears(req, res) {
    try {
      const [rows] = await sequelize.query(`
        SELECT DISTINCT tahun_anggaran
        FROM bankeu_perubahan_proposals
        ORDER BY tahun_anggaran DESC
      `);
      const years = rows.map(r => r.tahun_anggaran);
      res.json({ success: true, data: years });
    } catch (error) {
      logger.error('[BankeuPerubahan Public] Error years:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data tahun', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanPublicController();
