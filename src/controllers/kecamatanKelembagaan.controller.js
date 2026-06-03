/**
 * Kecamatan Kelembagaan Controller
 * Handles kelembagaan & pengurus verification by kecamatan
 * Flow: Desa input → Kecamatan verifikasi → Admin DPMD review
 */

const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const TYPE_LABEL_MAP = {
  rws: 'RW',
  rts: 'RT',
  posyandus: 'Posyandu',
  karang_tarunas: 'Karang Taruna',
  lpms: 'LPM',
  pkks: 'PKK',
  satlinmas: 'Satlinmas',
  lembaga_lainnyas: 'Lembaga Lainnya',
  // Legacy key used by pengurus groupBy
  'lembaga-lainnya': 'Lembaga Lainnya',
};

// Ordered list of lembaga types as they appear in the UI
const LEMBAGA_TYPES = ['rws', 'rts', 'posyandus', 'karang_tarunas', 'lpms', 'pkks', 'satlinmas', 'lembaga_lainnyas'];

// Table name → Prisma model name mapping
const TYPE_TO_MODEL = {
  rws: 'rws',
  rts: 'rts',
  posyandus: 'posyandus',
  karang_tarunas: 'karang_tarunas',
  lpms: 'lpms',
  pkks: 'pkks',
  satlinmas: 'satlinmas',
  lembaga_lainnyas: 'lembaga_lainnyas',
};

// Prisma model → route segment
const TYPE_TO_ROUTE = {
  rws: 'rw',
  rts: 'rt',
  posyandus: 'posyandu',
  karang_tarunas: 'karang-taruna',
  lpms: 'lpm',
  pkks: 'pkk',
  satlinmas: 'satlinmas',
  lembaga_lainnyas: 'lembaga-lainnya',
};

class KecamatanKelembagaanController {

  /**
   * GET /api/kecamatan/kelembagaan/pengurus
   * List all pengurus from desa in kecamatan, grouped by desa
   */
  async getPengurusByKecamatan(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'kecamatan') {
        return res.status(403).json({ success: false, message: 'Hanya kecamatan yang dapat mengakses' });
      }

      const kecamatanId = user.kecamatan_id;
      if (!kecamatanId) {
        return res.status(403).json({ success: false, message: 'Kecamatan ID tidak ditemukan' });
      }

      const { status_verifikasi, desa_id } = req.query;

      // Get all desa in kecamatan
      const desas = await prisma.desas.findMany({
        where: { kecamatan_id: kecamatanId },
        select: { id: true, nama: true, kecamatan_id: true },
        orderBy: { nama: 'asc' },
      });

      const desaIds = desas.map(d => d.id);

      if (desaIds.length === 0) {
        return res.json({ success: true, data: [] });
      }

      // Filter
      const where = {
        desa_id: desa_id ? parseInt(desa_id) : { in: desaIds },
      };
      if (status_verifikasi) {
        where.status_verifikasi = status_verifikasi;
      }

      const pengurus = await prisma.pengurus.findMany({
        where,
        orderBy: [{ desa_id: 'asc' }, { created_at: 'desc' }],
      });

      // Build desa map
      const desaMap = {};
      desas.forEach(d => { desaMap[d.id] = d; });

      // Group by desa, then by kelembagaan type
      const grouped = {};
      pengurus.forEach(p => {
        const desaId = p.desa_id;
        if (!grouped[desaId]) {
          grouped[desaId] = {
            desa: desaMap[desaId] || { id: desaId, nama: `Desa ${desaId}` },
            total: 0,
            unverified: 0,
            verified: 0,
            ditolak: 0,
            pengurus: [],
          };
        }
        grouped[desaId].total++;
        if (p.status_verifikasi === 'unverified') grouped[desaId].unverified++;
        else if (p.status_verifikasi === 'verified') grouped[desaId].verified++;
        else if (p.status_verifikasi === 'ditolak') grouped[desaId].ditolak++;
        grouped[desaId].pengurus.push({
          ...p,
          jenis_kelembagaan: TYPE_LABEL_MAP[p.pengurusable_type] || p.pengurusable_type,
        });
      });

      const result = Object.values(grouped).sort((a, b) =>
        (a.desa.nama || '').localeCompare(b.desa.nama || '')
      );

      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error in getPengurusByKecamatan:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data pengurus', error: error.message });
    }
  }

  /**
   * GET /api/kecamatan/kelembagaan/summary
   * Summary stats: total desa, pengurus verified/unverified/ditolak
   */
  async getSummary(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'kecamatan') {
        return res.status(403).json({ success: false, message: 'Hanya kecamatan yang dapat mengakses' });
      }

      const kecamatanId = user.kecamatan_id;
      if (!kecamatanId) {
        return res.status(403).json({ success: false, message: 'Kecamatan ID tidak ditemukan' });
      }

      const desas = await prisma.desas.findMany({
        where: { kecamatan_id: kecamatanId },
        select: { id: true },
      });

      const desaIds = desas.map(d => d.id);

      if (desaIds.length === 0) {
        return res.json({ success: true, data: { total_desa: 0, total_pengurus: 0, unverified: 0, verified: 0, ditolak: 0 } });
      }

      const [total, unverified, verified, ditolak] = await Promise.all([
        prisma.pengurus.count({ where: { desa_id: { in: desaIds } } }),
        prisma.pengurus.count({ where: { desa_id: { in: desaIds }, status_verifikasi: 'unverified' } }),
        prisma.pengurus.count({ where: { desa_id: { in: desaIds }, status_verifikasi: 'verified' } }),
        prisma.pengurus.count({ where: { desa_id: { in: desaIds }, status_verifikasi: 'ditolak' } }),
      ]);

      return res.json({
        success: true,
        data: {
          total_desa: desaIds.length,
          total_pengurus: total,
          unverified,
          verified,
          ditolak,
        },
      });
    } catch (error) {
      logger.error('Error in getSummary:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil ringkasan', error: error.message });
    }
  }

  /**
   * PUT /api/kecamatan/kelembagaan/pengurus/:id/verifikasi
   * Kecamatan approve or reject pengurus
   * Body: { status_verifikasi: 'verified' | 'ditolak', catatan_verifikasi?: string }
   */
  async verifikasiPengurus(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'kecamatan') {
        return res.status(403).json({ success: false, message: 'Hanya kecamatan yang dapat memverifikasi' });
      }

      const kecamatanId = user.kecamatan_id;
      if (!kecamatanId) {
        return res.status(403).json({ success: false, message: 'Kecamatan ID tidak ditemukan' });
      }

      const { status_verifikasi, catatan_verifikasi } = req.body;

      if (!status_verifikasi || !['verified', 'ditolak'].includes(status_verifikasi)) {
        return res.status(400).json({
          success: false,
          message: 'Status verifikasi harus "verified" atau "ditolak"',
        });
      }

      if (status_verifikasi === 'ditolak' && (!catatan_verifikasi || !catatan_verifikasi.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Catatan penolakan wajib diisi',
        });
      }

      const existing = await prisma.pengurus.findUnique({
        where: { id: String(req.params.id) },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      // Verify pengurus belongs to a desa in this kecamatan
      const desa = await prisma.desas.findFirst({
        where: { id: existing.desa_id, kecamatan_id: kecamatanId },
      });

      if (!desa) {
        return res.status(403).json({ success: false, message: 'Pengurus tidak berada di wilayah kecamatan ini' });
      }

      const updateData = {
        status_verifikasi,
        verifikator_nama: user.name || user.email || 'Kecamatan',
        verified_at: new Date(),
        catatan_verifikasi: status_verifikasi === 'ditolak' ? (catatan_verifikasi || null) : null,
      };

      const updated = await prisma.pengurus.update({
        where: { id: String(req.params.id) },
        data: updateData,
      });

      logger.info(`✅ Kecamatan ${kecamatanId} ${status_verifikasi === 'verified' ? 'approved' : 'rejected'} pengurus ${updated.id} (${updated.nama_lengkap})`);

      return res.json({ success: true, data: updated });
    } catch (error) {
      logger.error('Error in verifikasiPengurus:', error);
      return res.status(500).json({ success: false, message: 'Gagal memverifikasi pengurus', error: error.message });
    }
  }

  /**
   * PUT /api/kecamatan/kelembagaan/pengurus/bulk-verifikasi
   * Bulk approve or reject multiple pengurus
   * Body: { ids: string[], status_verifikasi: 'verified' | 'ditolak', catatan_verifikasi?: string }
   */
  async bulkVerifikasiPengurus(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'kecamatan') {
        return res.status(403).json({ success: false, message: 'Hanya kecamatan yang dapat memverifikasi' });
      }

      const kecamatanId = user.kecamatan_id;
      if (!kecamatanId) {
        return res.status(403).json({ success: false, message: 'Kecamatan ID tidak ditemukan' });
      }

      const { ids, status_verifikasi, catatan_verifikasi } = req.body;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'IDs pengurus wajib diisi' });
      }

      if (!status_verifikasi || !['verified', 'ditolak'].includes(status_verifikasi)) {
        return res.status(400).json({ success: false, message: 'Status verifikasi harus "verified" atau "ditolak"' });
      }

      if (status_verifikasi === 'ditolak' && (!catatan_verifikasi || !catatan_verifikasi.trim())) {
        return res.status(400).json({ success: false, message: 'Catatan penolakan wajib diisi' });
      }

      // Get desa IDs in this kecamatan
      const desas = await prisma.desas.findMany({
        where: { kecamatan_id: kecamatanId },
        select: { id: true },
      });
      const desaIds = desas.map(d => d.id);

      // Only update pengurus that belong to desa in this kecamatan
      const result = await prisma.pengurus.updateMany({
        where: {
          id: { in: ids.map(String) },
          desa_id: { in: desaIds },
        },
        data: {
          status_verifikasi,
          verifikator_nama: user.name || user.email || 'Kecamatan',
          verified_at: new Date(),
          catatan_verifikasi: status_verifikasi === 'ditolak' ? (catatan_verifikasi || null) : null,
        },
      });

      logger.info(`✅ Kecamatan ${kecamatanId} bulk ${status_verifikasi} ${result.count} pengurus`);

      return res.json({ success: true, data: { count: result.count } });
    } catch (error) {
      logger.error('Error in bulkVerifikasiPengurus:', error);
      return res.status(500).json({ success: false, message: 'Gagal memverifikasi pengurus', error: error.message });
    }
  }

  /**
   * GET /api/kecamatan/kelembagaan/lembaga-per-desa
   * Returns per-desa, per-type lembaga counts with verification status breakdown.
   * Used by the new kecamatan verification overview page.
   */
  async getLembagaByDesa(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'kecamatan') {
        return res.status(403).json({ success: false, message: 'Hanya kecamatan yang dapat mengakses' });
      }

      const kecamatanId = user.kecamatan_id;
      if (!kecamatanId) {
        return res.status(403).json({ success: false, message: 'Kecamatan ID tidak ditemukan' });
      }

      // Get all desa in kecamatan
      const desas = await prisma.desas.findMany({
        where: { kecamatan_id: kecamatanId },
        select: { id: true, nama: true },
        orderBy: { nama: 'asc' },
      });

      if (desas.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const desaIds = desas.map(d => d.id);

      // For each lembaga type, do a groupBy count per desa + status
      // We run queries in parallel for all types
      const countQueries = LEMBAGA_TYPES.map(type => {
        const model = TYPE_TO_MODEL[type];
        return prisma[model].groupBy({
          by: ['desa_id', 'status_verifikasi'],
          where: { desa_id: { in: desaIds } },
          _count: { id: true },
        }).then(rows => ({ type, rows }));
      });

      // Also count pengurus per desa per type
      const pengurusQuery = prisma.pengurus.groupBy({
        by: ['desa_id', 'pengurusable_type', 'status_verifikasi'],
        where: { desa_id: { in: desaIds } },
        _count: { id: true },
      }).then(rows => ({ type: 'pengurus', rows }));

      const allResults = await Promise.all([...countQueries, pengurusQuery]);

      // Build data structure: desaId → type → { total, verified, unverified, ditolak }
      const desaMap = {};
      desas.forEach(d => {
        desaMap[d.id] = {
          desa: d,
          lembaga: {},
          total_lembaga: 0,
          total_verified: 0,
          total_unverified: 0,
        };
        LEMBAGA_TYPES.forEach(type => {
          desaMap[d.id].lembaga[type] = { total: 0, verified: 0, unverified: 0, ditolak: 0 };
        });
      });

      // Fill lembaga counts
      allResults.forEach(({ type, rows }) => {
        if (type === 'pengurus') return; // handle pengurus separately
        rows.forEach(row => {
          const desaId = row.desa_id;
          if (!desaMap[desaId]) return;
          const count = row._count.id;
          desaMap[desaId].lembaga[type].total += count;
          const sv = row.status_verifikasi || 'unverified';
          if (sv === 'verified') desaMap[desaId].lembaga[type].verified += count;
          else if (sv === 'ditolak') desaMap[desaId].lembaga[type].ditolak += count;
          else desaMap[desaId].lembaga[type].unverified += count;
        });
      });

      // Compute per-desa totals
      desas.forEach(d => {
        let totalLembaga = 0, totalVerified = 0, totalUnverified = 0;
        LEMBAGA_TYPES.forEach(type => {
          const t = desaMap[d.id].lembaga[type];
          totalLembaga += t.total;
          totalVerified += t.verified;
          totalUnverified += t.unverified + t.ditolak;
        });
        desaMap[d.id].total_lembaga = totalLembaga;
        desaMap[d.id].total_verified = totalVerified;
        desaMap[d.id].total_unverified = totalUnverified;
      });

      // Shape response
      const result = desas.map(d => {
        const entry = desaMap[d.id];
        return {
          desa: entry.desa,
          total_lembaga: entry.total_lembaga,
          total_verified: entry.total_verified,
          total_unverified: entry.total_unverified,
          lembaga: LEMBAGA_TYPES.map(type => ({
            type,
            route: TYPE_TO_ROUTE[type],
            label: TYPE_LABEL_MAP[type] || type,
            ...entry.lembaga[type],
          })),
        };
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error in getLembagaByDesa:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data lembaga per desa', error: error.message });
    }
  }

  /**
   * GET /api/kecamatan/kelembagaan/lembaga-per-desa/summary
   * Aggregate summary across all desa (totals per lembaga type).
   */
  async getLembagaSummary(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'kecamatan') {
        return res.status(403).json({ success: false, message: 'Hanya kecamatan yang dapat mengakses' });
      }

      const kecamatanId = user.kecamatan_id;
      if (!kecamatanId) {
        return res.status(403).json({ success: false, message: 'Kecamatan ID tidak ditemukan' });
      }

      const desas = await prisma.desas.findMany({
        where: { kecamatan_id: kecamatanId },
        select: { id: true },
      });

      const desaIds = desas.map(d => d.id);

      if (desaIds.length === 0) {
        return res.json({ success: true, data: { total_desa: 0, types: [] } });
      }

      const countQueries = LEMBAGA_TYPES.map(type => {
        const model = TYPE_TO_MODEL[type];
        return Promise.all([
          prisma[model].count({ where: { desa_id: { in: desaIds } } }),
          prisma[model].count({ where: { desa_id: { in: desaIds }, status_verifikasi: 'verified' } }),
          prisma[model].count({ where: { desa_id: { in: desaIds }, status_verifikasi: 'unverified' } }),
          prisma[model].count({ where: { desa_id: { in: desaIds }, status_verifikasi: 'ditolak' } }),
        ]).then(([total, verified, unverified, ditolak]) => ({
          type,
          route: TYPE_TO_ROUTE[type],
          label: TYPE_LABEL_MAP[type] || type,
          total,
          verified,
          unverified,
          ditolak,
        }));
      });

      const types = await Promise.all(countQueries);

      return res.json({
        success: true,
        data: {
          total_desa: desaIds.length,
          types,
          total_lembaga: types.reduce((s, t) => s + t.total, 0),
          total_verified: types.reduce((s, t) => s + t.verified, 0),
          total_unverified: types.reduce((s, t) => s + t.unverified, 0),
        },
      });
    } catch (error) {
      logger.error('Error in getLembagaSummary:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil ringkasan lembaga', error: error.message });
    }
  }

  /**
   * GET /api/kecamatan/kelembagaan/desa/:desaId/detail
   * Detailed data for a single desa: RW+RT (nested), Posyandu list, Singletons, Lembaga Lainnya
   */
  async getDesaDetail(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'kecamatan') {
        return res.status(403).json({ success: false, message: 'Hanya kecamatan yang dapat mengakses' });
      }

      const kecamatanId = user.kecamatan_id;
      const desaId = parseInt(req.params.desaId);

      if (!kecamatanId) {
        return res.status(403).json({ success: false, message: 'Kecamatan ID tidak ditemukan' });
      }

      // Validate desa belongs to kecamatan
      const desa = await prisma.desas.findFirst({
        where: { id: desaId, kecamatan_id: kecamatanId },
        select: { id: true, nama: true },
      });

      if (!desa) {
        return res.status(403).json({ success: false, message: 'Desa tidak berada di wilayah kecamatan ini' });
      }

      const [rwList, posyanduList, ktList, lpmList, pkkList, satlinmasList, lembagaLainnyaList] = await Promise.all([
        // RW with nested RT
        prisma.rws.findMany({
          where: { desa_id: desaId },
          select: {
            id: true, nomor: true, alamat: true,
            status_kelembagaan: true, status_verifikasi: true,
            rts: {
              select: {
                id: true, nomor: true,
                status_kelembagaan: true, status_verifikasi: true,
              },
              orderBy: { nomor: 'asc' },
            },
          },
          orderBy: { nomor: 'asc' },
        }),
        // Posyandu
        prisma.posyandus.findMany({
          where: { desa_id: desaId },
          select: { id: true, nama: true, status_kelembagaan: true, status_verifikasi: true },
          orderBy: { nama: 'asc' },
        }),
        // Karang Taruna (singleton)
        prisma.karang_tarunas.findFirst({ where: { desa_id: desaId }, select: { id: true, nama: true, status_verifikasi: true, status_kelembagaan: true } }),
        // LPM (singleton)
        prisma.lpms.findFirst({ where: { desa_id: desaId }, select: { id: true, nama: true, status_verifikasi: true, status_kelembagaan: true } }),
        // PKK (singleton)
        prisma.pkks.findFirst({ where: { desa_id: desaId }, select: { id: true, nama: true, status_verifikasi: true, status_kelembagaan: true } }),
        // Satlinmas (singleton)
        prisma.satlinmas.findFirst({ where: { desa_id: desaId }, select: { id: true, nama: true, status_verifikasi: true, status_kelembagaan: true } }),
        // Lembaga Lainnya (multi)
        prisma.lembaga_lainnyas.findMany({
          where: { desa_id: desaId },
          select: { id: true, nama: true, status_kelembagaan: true, status_verifikasi: true },
          orderBy: { nama: 'asc' },
        }),
      ]);

      return res.json({
        success: true,
        data: {
          desa,
          rw_list: rwList,
          posyandu_list: posyanduList,
          singletons: {
            karang_taruna: ktList,
            lpm: lpmList,
            pkk: pkkList,
            satlinmas: satlinmasList,
          },
          lembaga_lainnya_list: lembagaLainnyaList,
        },
      });
    } catch (error) {
      logger.error('Error in getDesaDetail:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil detail lembaga desa', error: error.message });
    }
  }
}

module.exports = new KecamatanKelembagaanController();
