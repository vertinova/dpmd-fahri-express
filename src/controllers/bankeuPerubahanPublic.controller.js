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

      // ─── Daftar proposal + agregasi (untuk dashboard publik) ───────────
      // Analog Bankeu Reguler: proposals[], kecamatan{}, anggaran_per_program{}.
      // Beda: alur 3 tahap (Desa→Kecamatan→DPMD) & dikelompokkan per JENIS
      // KEGIATAN (bukan dinas) — field `dinas_terkait` diisi label kategori
      // agar komponen frontend bisa dipakai ulang tanpa ubah struktur.
      const [allProposals] = await sequelize.query(`
        SELECT bp.id, bp.desa_id, bp.jenis_kegiatan, bp.kegiatan_nama,
               bp.nama_kegiatan_spesifik, bp.anggaran_usulan, bp.lokasi, bp.volume,
               bp.status, bp.kecamatan_status, bp.dpmd_status,
               bp.submitted_to_kecamatan, bp.submitted_to_dpmd,
               d.nama AS desa_nama, k.nama AS kecamatan_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        WHERE bp.tahun_anggaran = ?
      `, { replacements: [tahun] });

      // Nama kegiatan dari tabel pivot (fallback bila kegiatan_nama kosong).
      const [pivotRows] = await sequelize.query(`
        SELECT bppk.proposal_id,
               GROUP_CONCAT(bmk.nama_kegiatan ORDER BY bmk.urutan SEPARATOR ', ') AS nama_kegiatan
        FROM bankeu_perubahan_proposal_kegiatan bppk
        JOIN bankeu_perubahan_master_kegiatan bmk ON bppk.kegiatan_id = bmk.id
        GROUP BY bppk.proposal_id
      `);
      const pivotMap = {};
      pivotRows.forEach(r => { pivotMap[Number(r.proposal_id)] = r.nama_kegiatan; });

      const KATEGORI_LABEL = {
        wajib: 'Wajib',
        pilihan_infrastruktur: 'Infrastruktur',
        pilihan_non_infrastruktur: 'Non-Infrastruktur',
      };
      const kategoriLabel = (x) => KATEGORI_LABEL[x] || x || 'Lainnya';

      // Tahap proposal perubahan (Desa→Kecamatan→DPMD), ciutkan ke 3 bucket.
      const getStage = (p) => {
        const kec = p.kecamatan_status || 'pending';
        if (p.dpmd_status === 'revision' || p.dpmd_status === 'rejected') return 'di_kecamatan';
        if (!p.submitted_to_dpmd && (kec === 'revision' || kec === 'rejected')) return 'di_desa';
        if ((p.status === 'revision' || p.status === 'rejected') && !p.submitted_to_kecamatan) return 'di_desa';
        if (p.submitted_to_dpmd) return 'selesai';
        if (p.submitted_to_kecamatan) return 'di_kecamatan';
        return 'di_desa';
      };

      const MAX_ANGGARAN = 1_500_000_000;
      const kecamatanAgg = {};
      const publicProposals = allProposals.map(p => {
        const stage = getStage(p);
        const anggaran = Math.min(Number(p.anggaran_usulan) || 0, MAX_ANGGARAN);
        const kegiatan = p.kegiatan_nama || pivotMap[Number(p.id)] || p.nama_kegiatan_spesifik || '-';
        const kategori = kategoriLabel(p.jenis_kegiatan);
        const kecName = p.kecamatan_nama || 'Lainnya';
        const desaName = p.desa_nama || 'Lainnya';

        if (!kecamatanAgg[kecName]) kecamatanAgg[kecName] = { count: 0, total: 0, desas: {} };
        kecamatanAgg[kecName].count += 1;
        kecamatanAgg[kecName].total += anggaran;
        if (!kecamatanAgg[kecName].desas[desaName]) kecamatanAgg[kecName].desas[desaName] = { count: 0, total: 0, stage };
        kecamatanAgg[kecName].desas[desaName].count += 1;
        kecamatanAgg[kecName].desas[desaName].total += anggaran;

        return {
          kecamatan: kecName, desa: desaName, kegiatan,
          dinas_terkait: kategori, // label kategori (dipakai utk pengelompokan di frontend)
          anggaran, stage, lokasi: p.lokasi || '-', volume: p.volume || '-'
        };
      });

      // Anggaran per program — hanya proposal yang sudah sampai DPMD (stage 'selesai'),
      // dikelompokkan per kegiatan + kategori.
      const programAgg = {};
      publicProposals.forEach(p => {
        if (p.stage !== 'selesai') return;
        const key = `${p.kegiatan}|||${p.dinas_terkait}`;
        if (!programAgg[key]) {
          programAgg[key] = { nama_program: p.kegiatan, dinas_terkait: p.dinas_terkait, total_anggaran: 0, jumlah_proposal: 0, desa_set: new Set() };
        }
        programAgg[key].total_anggaran += p.anggaran;
        programAgg[key].jumlah_proposal += 1;
        if (p.desa && p.desa !== 'Lainnya') programAgg[key].desa_set.add(p.desa);
      });
      const programs = Object.values(programAgg)
        .map(it => ({ nama_program: it.nama_program, dinas_terkait: it.dinas_terkait, total_anggaran: it.total_anggaran, jumlah_proposal: it.jumlah_proposal, jumlah_desa: it.desa_set.size }))
        .sort((a, b) => b.total_anggaran - a.total_anggaran);
      const totalAnggaranFinal = programs.reduce((s, p) => s + p.total_anggaran, 0);
      const totalDesaFinal = new Set(publicProposals.filter(p => p.stage === 'selesai' && p.desa && p.desa !== 'Lainnya').map(p => p.desa)).size;
      const totalProposalFinal = publicProposals.filter(p => p.stage === 'selesai').length;

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
        // Bentuk top-level untuk dashboard publik & core (analog Bankeu Reguler).
        summary: partisipasiSummary,
        desa_partisipasi: desaPartisipasi,
        proposals: publicProposals,
        kecamatan: kecamatanAgg,
        anggaran_per_program: {
          programs,
          total_anggaran_final: totalAnggaranFinal,
          total_desa_final: totalDesaFinal,
          total_proposal_final: totalProposalFinal
        },
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
