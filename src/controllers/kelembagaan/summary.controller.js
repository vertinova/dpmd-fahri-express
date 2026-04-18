/**
 * Summary Controller
 * Handles summary, aggregation, and overview endpoints for kelembagaan
 */

const { prisma, validateDesaAccess } = require('./base.controller');

class SummaryController {
  /**
   * Get overall kelembagaan index with kecamatan and desa data
   * GET /api/kelembagaan/
   */
  async index(req, res) {
    try {
      const kecamatans = await prisma.kecamatans.findMany({
        include: {
          desas: {
            select: { 
              id: true, 
              nama: true, 
              kode: true, 
              status_pemerintahan: true 
            }
          }
        },
        orderBy: { id: 'asc' }
      });

      // Get all desa IDs for batch queries
      const allDesaIds = kecamatans.flatMap(k => k.desas.map(d => d.id));

      // Batch query untuk semua data kelembagaan dan pengurus sekaligus
      const [
        rwData,
        rtData,
        posyanduData,
        karangTarunaData,
        lpmData,
        satlinmasData,
        pkkData,
        // Get verified data
        rwVerifiedData,
        rtVerifiedData,
        posyanduVerifiedData,
        karangTarunaVerifiedData,
        lpmVerifiedData,
        satlinmasVerifiedData,
        pkkVerifiedData,
        // Get ditolak data
        rwDitolakData,
        rtDitolakData,
        posyanduDitolakData,
        karangTarunaDitolakData,
        lpmDitolakData,
        satlinmasDitolakData,
        pkkDitolakData
      ] = await Promise.all([
        prisma.rws.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' }
        }),
        prisma.rts.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' }
        }),
        prisma.posyandus.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' }
        }),
        prisma.karang_tarunas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.lpms.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.satlinmas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.pkks.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        // Get verified data
        prisma.rws.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' }
        }),
        prisma.rts.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' }
        }),
        prisma.posyandus.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' }
        }),
        prisma.karang_tarunas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.lpms.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.satlinmas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.pkks.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        // Get ditolak data
        prisma.rws.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' }
        }),
        prisma.rts.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' }
        }),
        prisma.posyandus.groupBy({
          by: ['desa_id'],
          _count: { id: true },
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' }
        }),
        prisma.karang_tarunas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.lpms.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.satlinmas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        }),
        prisma.pkks.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' },
          select: { id: true, desa_id: true, status_kelembagaan: true }
        })
      ]);

      // Convert to lookup maps
      const rwMap = new Map(rwData.map(item => [item.desa_id.toString(), item._count.id]));
      const rtMap = new Map(rtData.map(item => [item.desa_id.toString(), item._count.id]));
      const posyanduMap = new Map(posyanduData.map(item => [item.desa_id.toString(), item._count.id]));
      const karangTarunaMap = new Map(karangTarunaData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const lpmMap = new Map(lpmData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const satlinmasMap = new Map(satlinmasData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const pkkMap = new Map(pkkData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));

      // Convert verified data to lookup maps
      const rwVerifiedMap = new Map(rwVerifiedData.map(item => [item.desa_id.toString(), item._count.id]));
      const rtVerifiedMap = new Map(rtVerifiedData.map(item => [item.desa_id.toString(), item._count.id]));
      const posyanduVerifiedMap = new Map(posyanduVerifiedData.map(item => [item.desa_id.toString(), item._count.id]));
      const karangTarunaVerifiedMap = new Map(karangTarunaVerifiedData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const lpmVerifiedMap = new Map(lpmVerifiedData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const satlinmasVerifiedMap = new Map(satlinmasVerifiedData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const pkkVerifiedMap = new Map(pkkVerifiedData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));

      // Convert ditolak data to lookup maps
      const rwDitolakMap = new Map(rwDitolakData.map(item => [item.desa_id.toString(), item._count.id]));
      const rtDitolakMap = new Map(rtDitolakData.map(item => [item.desa_id.toString(), item._count.id]));
      const posyanduDitolakMap = new Map(posyanduDitolakData.map(item => [item.desa_id.toString(), item._count.id]));
      const karangTarunaDitolakMap = new Map(karangTarunaDitolakData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const lpmDitolakMap = new Map(lpmDitolakData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const satlinmasDitolakMap = new Map(satlinmasDitolakData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));
      const pkkDitolakMap = new Map(pkkDitolakData.map(item => [item.desa_id.toString(), item.status_kelembagaan === 'aktif' ? 'Terbentuk' : 'Belum Terbentuk']));

      const kelembagaanData = [];

      for (const kecamatan of kecamatans) {
        const desasWithKelembagaan = kecamatan.desas.map(desa => {
          const desaIdStr = desa.id.toString();
          
          return {
            id: desa.id,
            nama: desa.nama,
            kode: desa.kode,
            status: desa.status_pemerintahan,
            kelembagaan: {
              rw: rwMap.get(desaIdStr) || 0,
              rt: rtMap.get(desaIdStr) || 0,
              posyandu: posyanduMap.get(desaIdStr) || 0,
              karangTaruna: karangTarunaMap.get(desaIdStr) || 'Belum Terbentuk',
              lpm: lpmMap.get(desaIdStr) || 'Belum Terbentuk',
              satlinmas: satlinmasMap.get(desaIdStr) || 'Belum Terbentuk',
              pkk: pkkMap.get(desaIdStr) || 'Belum Terbentuk'
            },
            verifiedKelembagaan: {
              rw: rwVerifiedMap.get(desaIdStr) || 0,
              rt: rtVerifiedMap.get(desaIdStr) || 0,
              posyandu: posyanduVerifiedMap.get(desaIdStr) || 0,
              karangTaruna: karangTarunaVerifiedMap.get(desaIdStr) || 'Belum Terbentuk',
              lpm: lpmVerifiedMap.get(desaIdStr) || 'Belum Terbentuk',
              satlinmas: satlinmasVerifiedMap.get(desaIdStr) || 'Belum Terbentuk',
              pkk: pkkVerifiedMap.get(desaIdStr) || 'Belum Terbentuk'
            },
            ditolakKelembagaan: {
              rw: rwDitolakMap.get(desaIdStr) || 0,
              rt: rtDitolakMap.get(desaIdStr) || 0,
              posyandu: posyanduDitolakMap.get(desaIdStr) || 0,
              karangTaruna: karangTarunaDitolakMap.get(desaIdStr) || 'Belum Terbentuk',
              lpm: lpmDitolakMap.get(desaIdStr) || 'Belum Terbentuk',
              satlinmas: satlinmasDitolakMap.get(desaIdStr) || 'Belum Terbentuk',
              pkk: pkkDitolakMap.get(desaIdStr) || 'Belum Terbentuk'
            }
          };
        });

        // Calculate total for kecamatan
        const totalKelembagaan = desasWithKelembagaan.reduce((acc, desa) => ({
          rw: acc.rw + desa.kelembagaan.rw,
          rt: acc.rt + desa.kelembagaan.rt,
          posyandu: acc.posyandu + desa.kelembagaan.posyandu,
          karangTaruna: acc.karangTaruna + (desa.kelembagaan.karangTaruna === 'Terbentuk' ? 1 : 0),
          lpm: acc.lpm + (desa.kelembagaan.lpm === 'Terbentuk' ? 1 : 0),
          satlinmas: acc.satlinmas + (desa.kelembagaan.satlinmas === 'Terbentuk' ? 1 : 0),
          pkk: acc.pkk + (desa.kelembagaan.pkk === 'Terbentuk' ? 1 : 0)
        }), { rw: 0, rt: 0, posyandu: 0, karangTaruna: 0, lpm: 0, satlinmas: 0, pkk: 0 });

        const verifiedKelembagaan = desasWithKelembagaan.reduce((acc, desa) => ({
          rw: acc.rw + desa.verifiedKelembagaan.rw,
          rt: acc.rt + desa.verifiedKelembagaan.rt,
          posyandu: acc.posyandu + desa.verifiedKelembagaan.posyandu,
          karangTaruna: acc.karangTaruna + (desa.verifiedKelembagaan.karangTaruna === 'Terbentuk' ? 1 : 0),
          lpm: acc.lpm + (desa.verifiedKelembagaan.lpm === 'Terbentuk' ? 1 : 0),
          satlinmas: acc.satlinmas + (desa.verifiedKelembagaan.satlinmas === 'Terbentuk' ? 1 : 0),
          pkk: acc.pkk + (desa.verifiedKelembagaan.pkk === 'Terbentuk' ? 1 : 0)
        }), { rw: 0, rt: 0, posyandu: 0, karangTaruna: 0, lpm: 0, satlinmas: 0, pkk: 0 });

        const ditolakKelembagaan = desasWithKelembagaan.reduce((acc, desa) => ({
          rw: acc.rw + desa.ditolakKelembagaan.rw,
          rt: acc.rt + desa.ditolakKelembagaan.rt,
          posyandu: acc.posyandu + desa.ditolakKelembagaan.posyandu,
          karangTaruna: acc.karangTaruna + (desa.ditolakKelembagaan.karangTaruna === 'Terbentuk' ? 1 : 0),
          lpm: acc.lpm + (desa.ditolakKelembagaan.lpm === 'Terbentuk' ? 1 : 0),
          satlinmas: acc.satlinmas + (desa.ditolakKelembagaan.satlinmas === 'Terbentuk' ? 1 : 0),
          pkk: acc.pkk + (desa.ditolakKelembagaan.pkk === 'Terbentuk' ? 1 : 0)
        }), { rw: 0, rt: 0, posyandu: 0, karangTaruna: 0, lpm: 0, satlinmas: 0, pkk: 0 });

        kelembagaanData.push({
          id: kecamatan.id,
          nama: kecamatan.nama,
          desas: desasWithKelembagaan,
          totalKelembagaan,
          verifiedKelembagaan,
          ditolakKelembagaan
        });
      }

      res.json({ success: true, data: kelembagaanData });
    } catch (error) {
      console.error('Error in index:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data kelembagaan', error: error.message });
    }
  }

  /**
   * Get summary statistics
   * GET /api/kelembagaan/summary
   */
  async summary(req, res) {
    try {
      const [desaDesas, desaKelurahan, kecamatanCount] = await Promise.all([
        prisma.desas.findMany({ where: { status_pemerintahan: 'desa' }, select: { id: true } }),
        prisma.desas.findMany({ where: { status_pemerintahan: 'kelurahan' }, select: { id: true } }),
        prisma.kecamatans.count()
      ]);

      const desaDesaIds = desaDesas.map(d => d.id);
      const desaKelurahanIds = desaKelurahan.map(d => d.id);
      const allDesaIds = [...desaDesaIds, ...desaKelurahanIds];

      // Get total counts for all kelembagaan types (active only)
      const [rwTotal, rtTotal, posyanduTotal, karangTarunaTotal, lpmTotal, satlinmasTotal, pkkTotal] = await Promise.all([
        prisma.rws.count({ where: { status_kelembagaan: 'aktif' } }),
        prisma.rts.count({ where: { status_kelembagaan: 'aktif' } }),
        prisma.posyandus.count({ where: { status_kelembagaan: 'aktif' } }),
        prisma.karang_tarunas.count({ where: { status_kelembagaan: 'aktif' } }),
        prisma.lpms.count({ where: { status_kelembagaan: 'aktif' } }),
        prisma.satlinmas.count({ where: { status_kelembagaan: 'aktif' } }),
        prisma.pkks.count({ where: { status_kelembagaan: 'aktif' } })
      ]);

      // Get verified counts for all kelembagaan types (active and verified)
      const [rwVerified, rtVerified, posyanduVerified, karangTarunaVerified, lpmVerified, satlinmasVerified, pkkVerified] = await Promise.all([
        prisma.rws.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.rts.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.posyandus.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.karang_tarunas.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.lpms.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.satlinmas.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.pkks.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'verified' } })
      ]);

      // Get ditolak counts for all kelembagaan types
      const [rwDitolak, rtDitolak, posyanduDitolak, karangTarunaDitolak, lpmDitolak, satlinmasDitolak, pkkDitolak] = await Promise.all([
        prisma.rws.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' } }),
        prisma.rts.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' } }),
        prisma.posyandus.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' } }),
        prisma.karang_tarunas.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' } }),
        prisma.lpms.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' } }),
        prisma.satlinmas.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' } }),
        prisma.pkks.count({ where: { status_kelembagaan: 'aktif', status_verifikasi: 'ditolak' } })
      ]);

      // Get counts by desa/kelurahan status (active only)
      const [
        rwDesa, rtDesa, posyanduDesa, karangTarunaDesa, lpmDesa, satlinmasDesa, pkkDesa,
        rwKelurahan, rtKelurahan, posyanduKelurahan, karangTarunaKelurahan, lpmKelurahan, satlinmasKelurahan, pkkKelurahan
      ] = await Promise.all([
        prisma.rws.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif' } }),
        prisma.rts.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif' } }),
        prisma.posyandus.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif' } }),
        prisma.karang_tarunas.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif' } }),
        prisma.lpms.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif' } }),
        prisma.satlinmas.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif' } }),
        prisma.pkks.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif' } }),
        prisma.rws.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif' } }),
        prisma.rts.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif' } }),
        prisma.posyandus.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif' } }),
        prisma.karang_tarunas.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif' } }),
        prisma.lpms.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif' } }),
        prisma.satlinmas.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif' } }),
        prisma.pkks.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif' } })
      ]);

      // Get verified counts by desa/kelurahan status (active and verified)
      const [
        rwDesaVerified, rtDesaVerified, posyanduDesaVerified, karangTarunaDesaVerified, lpmDesaVerified, satlinmasDesaVerified, pkkDesaVerified,
        rwKelurahanVerified, rtKelurahanVerified, posyanduKelurahanVerified, karangTarunaKelurahanVerified, lpmKelurahanVerified, satlinmasKelurahanVerified, pkkKelurahanVerified
      ] = await Promise.all([
        prisma.rws.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.rts.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.posyandus.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.karang_tarunas.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.lpms.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.satlinmas.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.pkks.count({ where: { desa_id: { in: desaDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.rws.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.rts.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.posyandus.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.karang_tarunas.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.lpms.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.satlinmas.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } }),
        prisma.pkks.count({ where: { desa_id: { in: desaKelurahanIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' } })
      ]);

      // Calculate formation percentages
      const totalDesa = desaDesas.length + desaKelurahan.length;
      const formationStats = {
        karangTaruna: {
          total: totalDesa,
          aktif: karangTarunaTotal,
          persentase: totalDesa > 0 ? Math.round((karangTarunaTotal / totalDesa) * 100) : 0
        },
        lpm: {
          total: totalDesa,
          aktif: lpmTotal,
          persentase: totalDesa > 0 ? Math.round((lpmTotal / totalDesa) * 100) : 0
        },
        satlinmas: {
          total: totalDesa,
          aktif: satlinmasTotal,
          persentase: totalDesa > 0 ? Math.round((satlinmasTotal / totalDesa) * 100) : 0
        },
        pkk: {
          total: totalDesa,
          aktif: pkkTotal,
          persentase: totalDesa > 0 ? Math.round((pkkTotal / totalDesa) * 100) : 0
        }
      };

      // Get stats for desa and kelurahan
      const getStatsForStatus = async (ids, count) => {
        if (ids.length === 0) {
          return {
            total: 0,
            aktif: 0,
            tidak_aktif: 0,
            belum_dibentuk: 0
          };
        }

        const [rw, rt, posyandu, karangTaruna, lpm, satlinmas, pkk] = await Promise.all([
          prisma.rws.count({ where: { desa_id: { in: ids }, status_kelembagaan: 'aktif' } }),
          prisma.rts.count({ where: { desa_id: { in: ids }, status_kelembagaan: 'aktif' } }),
          prisma.posyandus.count({ where: { desa_id: { in: ids }, status_kelembagaan: 'aktif' } }),
          prisma.karang_tarunas.count({ where: { desa_id: { in: ids }, status_kelembagaan: 'aktif' } }),
          prisma.lpms.count({ where: { desa_id: { in: ids }, status_kelembagaan: 'aktif' } }),
          prisma.satlinmas.count({ where: { desa_id: { in: ids }, status_kelembagaan: 'aktif' } }),
          prisma.pkks.count({ where: { desa_id: { in: ids }, status_kelembagaan: 'aktif' } })
        ]);

        const total = rw + rt + posyandu + karangTaruna + lpm + satlinmas + pkk;
        const countActive = count || 0;

        return {
          total: countActive,
          aktif: total,
          tidak_aktif: 0,
          belum_dibentuk: countActive - total
        };
      };

      const [desaStats, kelurahanStats] = await Promise.all([
        getStatsForStatus(desaDesaIds, desaDesas.length),
        getStatsForStatus(desaKelurahanIds, desaKelurahan.length)
      ]);

      res.json({ 
        success: true, 
        data: { 
          overview: {
            kecamatan: kecamatanCount,
            desa: desaDesas.length,
            kelurahan: desaKelurahan.length,
            desa_kelurahan_total: totalDesa
          },
          total_kelembagaan: {
            rw: rwTotal,
            rt: rtTotal,
            posyandu: posyanduTotal,
            karangTaruna: karangTarunaTotal,
            lpm: lpmTotal,
            satlinmas: satlinmasTotal,
            pkk: pkkTotal
          },
          verified_kelembagaan: {
            rw: rwVerified,
            rt: rtVerified,
            posyandu: posyanduVerified,
            karangTaruna: karangTarunaVerified,
            lpm: lpmVerified,
            satlinmas: satlinmasVerified,
            pkk: pkkVerified
          },
          ditolak_kelembagaan: {
            rw: rwDitolak,
            rt: rtDitolak,
            posyandu: posyanduDitolak,
            karangTaruna: karangTarunaDitolak,
            lpm: lpmDitolak,
            satlinmas: satlinmasDitolak,
            pkk: pkkDitolak
          },
          formation_stats: formationStats,
          by_status: {
            desa: {
              count: desaDesas.length,
              rw: rwDesa,
              rt: rtDesa,
              posyandu: posyanduDesa,
              karangTaruna: karangTarunaDesa,
              lpm: lpmDesa,
              satlinmas: satlinmasDesa,
              pkk: pkkDesa
            },
            kelurahan: {
              count: desaKelurahan.length,
              rw: rwKelurahan,
              rt: rtKelurahan,
              posyandu: posyanduKelurahan,
              karangTaruna: karangTarunaKelurahan,
              lpm: lpmKelurahan,
              satlinmas: satlinmasKelurahan,
              pkk: pkkKelurahan
            }
          },
          verified_by_status: {
            desa: {
              count: desaDesas.length,
              rw: rwDesaVerified,
              rt: rtDesaVerified,
              posyandu: posyanduDesaVerified,
              karangTaruna: karangTarunaDesaVerified,
              lpm: lpmDesaVerified,
              satlinmas: satlinmasDesaVerified,
              pkk: pkkDesaVerified
            },
            kelurahan: {
              count: desaKelurahan.length,
              rw: rwKelurahanVerified,
              rt: rtKelurahanVerified,
              posyandu: posyanduKelurahanVerified,
              karangTaruna: karangTarunaKelurahanVerified,
              lpm: lpmKelurahanVerified,
              satlinmas: satlinmasKelurahanVerified,
              pkk: pkkKelurahanVerified
            }
          },
          desa: desaStats, 
          kelurahan: kelurahanStats 
        } 
      });
    } catch (error) {
      console.error('Error in summary:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil summary kelembagaan', error: error.message });
    }
  }

  /**
   * Get kelembagaan by kecamatan
   * GET /api/kelembagaan/kecamatan/:id
   */
  async byKecamatan(req, res) {
    try {
      const { id } = req.params;

      const kecamatan = await prisma.kecamatans.findUnique({
        where: { id: parseInt(id) },
        include: {
          desas: {
            select: { id: true, nama: true }
          }
        }
      });

      if (!kecamatan) {
        return res.status(404).json({ success: false, message: 'Kecamatan tidak ditemukan' });
      }

      const desaIds = kecamatan.desas.map(d => d.id);

      const [totalRW, totalRT, totalPosyandu] = await Promise.all([
        prisma.rws.count({ where: { desa_id: { in: desaIds } } }),
        prisma.rts.count({ where: { desa_id: { in: desaIds } } }),
        prisma.posyandus.count({ where: { desa_id: { in: desaIds } } })
      ]);

      res.json({
        success: true,
        data: {
          kecamatan: {
            id: kecamatan.id,
            nama: kecamatan.nama,
            total_desa: kecamatan.desas.length
          },
          kelembagaan: {
            total_rw: totalRW,
            total_rt: totalRT,
            total_posyandu: totalPosyandu
          }
        }
      });
    } catch (error) {
      console.error('Error in byKecamatan:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data kecamatan', error: error.message });
    }
  }

  /**
   * Get summary for specific desa (for logged-in desa user)
   * GET /api/desa/kelembagaan/summary
   */
  async getDesaSummary(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const [desa, totalRW, totalRT, totalPosyandu, karangTaruna, lpm, satlinmas, pkk, totalLembagaLainnya] = await Promise.all([
        prisma.desas.findUnique({ 
          where: { id: desaId }, 
          select: { id: true, nama: true, status_pemerintahan: true } 
        }),
        prisma.rws.count({ where: { desa_id: desaId } }),
        prisma.rts.count({ where: { desa_id: desaId } }),
        prisma.posyandus.count({ where: { desa_id: desaId } }),
        prisma.karang_tarunas.findFirst({ where: { desa_id: desaId }, select: { id: true, status_verifikasi: true, alamat: true, produk_hukum_id: true } }),
        prisma.lpms.findFirst({ where: { desa_id: desaId }, select: { id: true, status_verifikasi: true, alamat: true, produk_hukum_id: true } }),
        prisma.satlinmas.findFirst({ where: { desa_id: desaId }, select: { id: true, status_verifikasi: true, alamat: true, produk_hukum_id: true } }),
        prisma.pkks.findFirst({ where: { desa_id: desaId }, select: { id: true, status_verifikasi: true, alamat: true, produk_hukum_id: true } }),
        prisma.lembaga_lainnyas.count({ where: { desa_id: desaId } })
      ]);

      // Build verification detail for singleton lembaga
      const buildVerifDetail = async (record, type) => {
        if (!record) return null;
        const pengurusCount = await prisma.pengurus.count({
          where: { pengurusable_id: record.id, pengurusable_type: type }
        });
        return {
          status_verifikasi: record.status_verifikasi || 'unverified',
          has_sk: !!record.produk_hukum_id,
          has_alamat: !!record.alamat,
          pengurus_count: pengurusCount,
        };
      };

      // Build verification detail for multi-type (RW, RT, Posyandu)
      const buildMultiVerifDetail = async (model, type) => {
        const records = await prisma[model].findMany({
          where: { desa_id: desaId },
          select: { id: true, status_verifikasi: true, alamat: true, produk_hukum_id: true,
            ...(model === 'rts' ? { jumlah_jiwa: true, jumlah_kk: true } : {})
          }
        });
        if (records.length === 0) return null;
        const verifiedCount = records.filter(r => r.status_verifikasi === 'verified').length;
        const ditolakCount = records.filter(r => r.status_verifikasi === 'ditolak').length;
        // Count records missing requirements
        const missingSk = records.filter(r => !r.produk_hukum_id).length;
        const missingAlamat = records.filter(r => !r.alamat).length;
        let missingData = 0;
        if (model === 'rts') {
          missingData = records.filter(r => !r.jumlah_jiwa && !r.jumlah_kk).length;
        }
        // Count pengurus per record
        const pengurusCounts = await prisma.pengurus.groupBy({
          by: ['pengurusable_id'],
          _count: { id: true },
          where: { pengurusable_type: type, pengurusable_id: { in: records.map(r => r.id) } }
        });
        const pengurusMap = new Map(pengurusCounts.map(p => [p.pengurusable_id, p._count.id]));
        const missingPengurus = records.filter(r => !pengurusMap.has(r.id)).length;
        return {
          total: records.length,
          verified: verifiedCount,
          unverified: records.length - verifiedCount - ditolakCount,
          ditolak: ditolakCount,
          missing_sk: missingSk,
          missing_alamat: missingAlamat,
          missing_pengurus: missingPengurus,
          ...(model === 'rts' ? { missing_data_penduduk: missingData } : {}),
        };
      };

      const [rwVerif, rtVerif, posyanduVerif, ktVerif, lpmVerif, satlinmasVerif, pkkVerif, lembagaLainnyaVerif] = await Promise.all([
        buildMultiVerifDetail('rws', 'rw'),
        buildMultiVerifDetail('rts', 'rt'),
        buildMultiVerifDetail('posyandus', 'posyandu'),
        buildVerifDetail(karangTaruna, 'karang_taruna'),
        buildVerifDetail(lpm, 'lpm'),
        buildVerifDetail(satlinmas, 'satlinmas'),
        buildVerifDetail(pkk, 'pkk'),
        buildMultiVerifDetail('lembaga_lainnyas', 'lembaga-lainnya'),
      ]);

      res.json({
        success: true,
        data: {
          desa_id: desa?.id || desaId,
          desa_nama: desa?.nama || null,
          status_pemerintahan: desa?.status_pemerintahan || 'desa',
          rw: totalRW,
          rt: totalRT,
          posyandu: totalPosyandu,
          karang_taruna: karangTaruna ? 1 : 0,
          lpm: lpm ? 1 : 0,
          satlinmas: satlinmas ? 1 : 0,
          pkk: pkk ? 1 : 0,
          lembaga_lainnya: totalLembagaLainnya,
          has_karang_taruna: !!karangTaruna,
          has_lpm: !!lpm,
          has_satlinmas: !!satlinmas,
          has_pkk: !!pkk,
          verifikasi: {
            rw: rwVerif,
            rt: rtVerif,
            posyandu: posyanduVerif,
            karang_taruna: ktVerif,
            lpm: lpmVerif,
            satlinmas: satlinmasVerif,
            pkk: pkkVerif,
            lembaga_lainnya: lembagaLainnyaVerif,
          }
        }
      });
    } catch (error) {
      console.error('Error in getDesaSummary:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil ringkasan desa', error: error.message });
    }
  }

  /**
   * Get summary by desa (for admin)
   * GET /api/kelembagaan/desa/:id/summary
   */
  async summaryByDesa(req, res) {
    try {
      const { id } = req.params;
      const desaId = BigInt(id);

      const desa = await prisma.desas.findUnique({
        where: { id: desaId },
        include: {
          kecamatans: {
            select: { id: true, nama: true }
          }
        }
      });

      if (!desa) {
        return res.status(404).json({ success: false, message: 'Desa tidak ditemukan' });
      }

      const [totalRW, totalRT, totalPosyandu, karangTaruna, lpm, satlinmas, pkk] = await Promise.all([
        prisma.rws.count({ where: { desa_id: desaId } }),
        prisma.rts.count({ where: { desa_id: desaId } }),
        prisma.posyandus.count({ where: { desa_id: desaId } }),
        prisma.karang_tarunas.findFirst({ where: { desa_id: desaId } }),
        prisma.lpms.findFirst({ where: { desa_id: desaId } }),
        prisma.satlinmas.findFirst({ where: { desa_id: desaId } }),
        prisma.pkks.findFirst({ where: { desa_id: desaId } })
      ]);

      res.json({
        success: true,
        data: {
          desa: {
            id: desa.id,
            nama: desa.nama,
            kecamatan: desa.kecamatans?.nama || null
          },
          kelembagaan: {
            rw: totalRW,
            rt: totalRT,
            posyandu: totalPosyandu,
            karang_taruna: karangTaruna ? 1 : 0,
            lpm: lpm ? 1 : 0,
            satlinmas: satlinmas ? 1 : 0,
            pkk: pkk ? 1 : 0
          }
        }
      });
    } catch (error) {
      console.error('Error in summaryByDesa:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil ringkasan desa', error: error.message });
    }
  }

  /**
   * Get detail kelembagaan for desa (for admin)
   * GET /api/kelembagaan/desa-detail/:id
   */
  async getDesaKelembagaanDetail(req, res) {
    try {
      const { id } = req.params;
      const desa = await prisma.desas.findUnique({ 
        where: { id: parseInt(id) },
        include: {
          kecamatans: {
            select: { id: true, nama: true }
          }
        }
      });

      if (!desa) {
        return res.status(404).json({ success: false, message: 'Desa tidak ditemukan' });
      }

      // Fetch all kelembagaan data
      const [rws, posyandus, karangTaruna, lpm, satlinmas, pkk, lembagaLainnya] = await Promise.all([
        prisma.rws.findMany({ 
          where: { desa_id: parseInt(id) },
          orderBy: { nomor: 'asc' },
          include: {
            rts: {
              select: { id: true, nomor: true, status_kelembagaan: true, status_verifikasi: true },
              orderBy: { nomor: 'asc' }
            }
          }
        }),
        prisma.posyandus.findMany({ 
          where: { desa_id: parseInt(id) },
          orderBy: { nama: 'asc' }
        }),
        prisma.karang_tarunas.findFirst({ 
          where: { desa_id: parseInt(id) }
        }),
        prisma.lpms.findFirst({ 
          where: { desa_id: parseInt(id) }
        }),
        prisma.satlinmas.findFirst({ 
          where: { desa_id: parseInt(id) }
        }),
        prisma.pkks.findFirst({ 
          where: { desa_id: parseInt(id) }
        }),
        prisma.lembaga_lainnyas.findMany({ 
          where: { desa_id: parseInt(id) },
          orderBy: { nama: 'asc' }
        })
      ]);

      // Map RW with RT data and provide frontend-compatible field names
      const rwIds = rws.map(rw => rw.id);
      const rtIds = rws.flatMap(rw => rw.rts.map(rt => rt.id));

      // Count pengurus for each RW and RT (polymorphic: pengurusable_type + pengurusable_id)
      const [rwPengurusCounts, rtPengurusCounts] = await Promise.all([
        rwIds.length > 0
          ? prisma.pengurus.groupBy({
              by: ['pengurusable_id'],
              where: { pengurusable_type: 'rws', pengurusable_id: { in: rwIds } },
              _count: { id: true }
            })
          : [],
        rtIds.length > 0
          ? prisma.pengurus.groupBy({
              by: ['pengurusable_id'],
              where: { pengurusable_type: 'rts', pengurusable_id: { in: rtIds } },
              _count: { id: true }
            })
          : []
      ]);

      const rwPengMap = Object.fromEntries(rwPengurusCounts.map(r => [r.pengurusable_id, r._count.id]));
      const rtPengMap = Object.fromEntries(rtPengurusCounts.map(r => [r.pengurusable_id, r._count.id]));

      const rwsWithRts = rws.map(rw => ({
        id: rw.id,
        nomor_rw: rw.nomor,
        nomor: rw.nomor,
        alamat: rw.alamat,
        desa_id: rw.desa_id,
        status_kelembagaan: rw.status_kelembagaan,
        status_verifikasi: rw.status_verifikasi,
        rt_count: rw.rts.length,
        pengurus_count: rwPengMap[rw.id] || 0,
        rts: rw.rts.map(rt => ({
          ...rt,
          pengurus_count: rtPengMap[rt.id] || 0,
        })),
        created_at: rw.created_at,
        updated_at: rw.updated_at
      }));

      res.json({
        success: true,
        data: {
          desa: {
            id: desa.id,
            nama: desa.nama,        
            nama_kecamatan: desa.kecamatans?.nama || null,
            kecamatan_id: desa.kecamatan_id,
            status_pemerintahan: desa.status_pemerintahan
          },
          kelembagaan: {
            rw: rwsWithRts,
            posyandu: posyandus,
            karang_taruna: karangTaruna,
            lpm: lpm,
            satlinmas: satlinmas,
            pkk: pkk,
            lembaga_lainnya: lembagaLainnya
          }
        }
      });
    } catch (error) {
      console.error('Error in getDesaKelembagaanDetail:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil detail kelembagaan desa', error: error.message });
    }
  }

  /**
   * Get RW by desa (for admin)
   * GET /api/kelembagaan/desa/:id/rw
   */
  async getDesaRW(req, res) {
    try {
      const { id } = req.params;
      const rws = await prisma.rws.findMany({
        where: { desa_id: parseInt(id) },
        orderBy: { nomor: 'asc' },
        include: {
          rts: { select: { id: true } }
        }
      });

      const data = rws.map(rw => ({
        ...rw,
        rt_count: rw.rts.length
      }));

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error in getDesaRW:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RW', error: error.message });
    }
  }

  /**
   * Get RT by desa (for admin)
   * GET /api/kelembagaan/desa/:id/rt
   */
  async getDesaRT(req, res) {
    try {
      const { id } = req.params;
      const rts = await prisma.rts.findMany({
        where: { desa_id: parseInt(id) },
        include: {
          rws: {
            select: { id: true, nomor: true }
          }
        },
        orderBy: { nomor: 'asc' }
      });

      res.json({ success: true, data: rts });
    } catch (error) {
      console.error('Error in getDesaRT:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RT', error: error.message });
    }
  }

  /**
   * Get Posyandu by desa (for admin)
   * GET /api/kelembagaan/desa/:id/posyandu
   */
  async getDesaPosyandu(req, res) {
    try {
      const { id } = req.params;
      const posyandus = await prisma.posyandus.findMany({
        where: { desa_id: parseInt(id) },
        orderBy: { nama: 'asc' }
      });

      res.json({ success: true, data: posyandus });
    } catch (error) {
      console.error('Error in getDesaPosyandu:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Posyandu', error: error.message });
    }
  }

  /**
   * Get Karang Taruna by desa (for admin)
   * GET /api/kelembagaan/desa/:id/karang-taruna
   */
  async getDesaKarangTaruna(req, res) {
    try {
      const { id } = req.params;
      const karangTaruna = await prisma.karang_tarunas.findFirst({
        where: { desa_id: parseInt(id) }
      });

      res.json({ success: true, data: karangTaruna });
    } catch (error) {
      console.error('Error in getDesaKarangTaruna:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Karang Taruna', error: error.message });
    }
  }

  /**
   * Get LPM by desa (for admin)
   * GET /api/kelembagaan/desa/:id/lpm
   */
  async getDesaLPM(req, res) {
    try {
      const { id } = req.params;
      const lpm = await prisma.lpms.findFirst({
        where: { desa_id: parseInt(id) }
      });

      res.json({ success: true, data: lpm });
    } catch (error) {
      console.error('Error in getDesaLPM:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data LPM', error: error.message });
    }
  }

  /**
   * Get Satlinmas by desa (for admin)
   * GET /api/kelembagaan/desa/:id/satlinmas
   */
  async getDesaSatlinmas(req, res) {
    try {
      const { id } = req.params;
      const satlinmas = await prisma.satlinmas.findFirst({
        where: { desa_id: parseInt(id) }
      });

      res.json({ success: true, data: satlinmas });
    } catch (error) {
      console.error('Error in getDesaSatlinmas:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Satlinmas', error: error.message });
    }
  }

  /**
   * Get PKK by desa (for admin)
   * GET /api/kelembagaan/desa/:id/pkk
   */
  async getDesaPKK(req, res) {
    try {
      const { id } = req.params;
      const pkk = await prisma.pkks.findFirst({
        where: { desa_id: parseInt(id) }
      });

      res.json({ success: true, data: pkk });
    } catch (error) {
      console.error('Error in getDesaPKK:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data PKK', error: error.message });
    }
  }

  /**
   * Get yearly statistics for kelembagaan trends
   * GET /api/kelembagaan/statistik-tahunan
   */
  async statistikTahunan(req, res) {
    try {
      const tables = [
        { key: 'rw', model: 'rws', label: 'RW' },
        { key: 'rt', model: 'rts', label: 'RT' },
        { key: 'posyandu', model: 'posyandus', label: 'Posyandu' },
        { key: 'karangTaruna', model: 'karang_tarunas', label: 'Karang Taruna' },
        { key: 'lpm', model: 'lpms', label: 'LPM' },
        { key: 'pkk', model: 'pkks', label: 'PKK' },
      ];

      const results = await Promise.all(
        tables.map(async (t) => {
          const [byYear, byYearVerified, byYearNonaktif, cumulativeActive, cumulativeVerified, totals] = await Promise.all([
            // Records created per year
            prisma.$queryRawUnsafe(
              `SELECT YEAR(created_at) as tahun, COUNT(*) as jumlah FROM ${t.model} WHERE created_at IS NOT NULL GROUP BY YEAR(created_at) ORDER BY tahun`
            ),
            // Records verified per year
            prisma.$queryRawUnsafe(
              `SELECT YEAR(verified_at) as tahun, COUNT(*) as jumlah FROM ${t.model} WHERE verified_at IS NOT NULL GROUP BY YEAR(verified_at) ORDER BY tahun`
            ),
            // Records nonaktif per year (by updated_at as proxy)
            prisma.$queryRawUnsafe(
              `SELECT YEAR(updated_at) as tahun, COUNT(*) as jumlah FROM ${t.model} WHERE status_kelembagaan = 'nonaktif' AND updated_at IS NOT NULL GROUP BY YEAR(updated_at) ORDER BY tahun`
            ),
            // Cumulative active count per year: created that year (aktif) minus deactivated that year
            prisma.$queryRawUnsafe(
              `SELECT y.tahun,
                (SELECT COUNT(*) FROM ${t.model} WHERE YEAR(created_at) <= y.tahun) -
                (SELECT COUNT(*) FROM ${t.model} WHERE status_kelembagaan = 'nonaktif' AND YEAR(updated_at) <= y.tahun) as jumlah_aktif,
                (SELECT COUNT(*) FROM ${t.model} WHERE YEAR(created_at) <= y.tahun) as jumlah_total
              FROM (SELECT DISTINCT YEAR(created_at) as tahun FROM ${t.model} WHERE created_at IS NOT NULL) y
              ORDER BY y.tahun`
            ),
            // Cumulative verified count per year
            // Naik: lembaga verified yang dibuat (created_at) s/d tahun tsb
            // Turun: lembaga verified yang dinonaktifkan (nonaktif_at) s/d tahun tsb
            prisma.$queryRawUnsafe(
              `SELECT y.tahun,
                (SELECT COUNT(*) FROM ${t.model} WHERE status_verifikasi = 'verified' AND YEAR(created_at) <= y.tahun) -
                (SELECT COUNT(*) FROM ${t.model} WHERE status_verifikasi = 'verified' AND status_kelembagaan = 'nonaktif' AND nonaktif_at IS NOT NULL AND YEAR(nonaktif_at) <= y.tahun) as jumlah_verified
              FROM (SELECT DISTINCT YEAR(created_at) as tahun FROM ${t.model} WHERE created_at IS NOT NULL) y
              ORDER BY y.tahun`
            ),
            // Current totals
            prisma.$queryRawUnsafe(
              `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status_kelembagaan = 'aktif' THEN 1 ELSE 0 END) as aktif,
                SUM(CASE WHEN status_kelembagaan = 'nonaktif' THEN 1 ELSE 0 END) as nonaktif,
                SUM(CASE WHEN status_verifikasi = 'verified' THEN 1 ELSE 0 END) as verified,
                SUM(CASE WHEN status_verifikasi = 'unverified' THEN 1 ELSE 0 END) as unverified,
                SUM(CASE WHEN status_verifikasi = 'ditolak' THEN 1 ELSE 0 END) as ditolak
              FROM ${t.model}`
            ),
          ]);

          return {
            key: t.key,
            label: t.label,
            created_per_year: byYear.map(r => ({ tahun: Number(r.tahun), jumlah: Number(r.jumlah) })),
            verified_per_year: byYearVerified.map(r => ({ tahun: Number(r.tahun), jumlah: Number(r.jumlah) })),
            nonaktif_per_year: byYearNonaktif.map(r => ({ tahun: Number(r.tahun), jumlah: Number(r.jumlah) })),
            cumulative_active: cumulativeActive.map(r => ({ tahun: Number(r.tahun), jumlah_aktif: Number(r.jumlah_aktif), jumlah_total: Number(r.jumlah_total) })),
            cumulative_verified: cumulativeVerified.map(r => ({ tahun: Number(r.tahun), jumlah_verified: Number(r.jumlah_verified) })),
            totals: {
              total: Number(totals[0]?.total || 0),
              aktif: Number(totals[0]?.aktif || 0),
              nonaktif: Number(totals[0]?.nonaktif || 0),
              verified: Number(totals[0]?.verified || 0),
              unverified: Number(totals[0]?.unverified || 0),
              ditolak: Number(totals[0]?.ditolak || 0),
            }
          };
        })
      );

      // Collect all unique years
      const allYears = new Set();
      results.forEach(r => {
        r.created_per_year.forEach(y => allYears.add(y.tahun));
        r.verified_per_year.forEach(y => allYears.add(y.tahun));
        r.nonaktif_per_year.forEach(y => allYears.add(y.tahun));
        r.cumulative_active.forEach(y => allYears.add(y.tahun));
        r.cumulative_verified.forEach(y => allYears.add(y.tahun));
      });
      const years = [...allYears].sort((a, b) => a - b);

      // Build per-lembaga data keyed by type
      const perLembaga = {};
      results.forEach(r => {
        perLembaga[r.key] = {
          label: r.label,
          totals: r.totals,
          created_per_year: r.created_per_year,
          verified_per_year: r.verified_per_year,
          nonaktif_per_year: r.nonaktif_per_year,
          cumulative_active: r.cumulative_active,
          cumulative_verified: r.cumulative_verified,
        };
      });

      // Grand totals (exclude satlinmas)
      const grandTotals = {
        total: 0, aktif: 0, nonaktif: 0, verified: 0, unverified: 0, ditolak: 0,
      };
      results.forEach(r => {
        grandTotals.total += r.totals.total;
        grandTotals.aktif += r.totals.aktif;
        grandTotals.nonaktif += r.totals.nonaktif;
        grandTotals.verified += r.totals.verified;
        grandTotals.unverified += r.totals.unverified;
        grandTotals.ditolak += r.totals.ditolak;
      });
      grandTotals.persentase_verifikasi = grandTotals.total > 0
        ? Math.round((grandTotals.verified / grandTotals.total) * 100)
        : 0;
      grandTotals.persentase_aktif = grandTotals.total > 0
        ? Math.round((grandTotals.aktif / grandTotals.total) * 100)
        : 0;

      res.json({
        success: true,
        data: {
          years,
          per_lembaga: perLembaga,
          grand_totals: grandTotals,
        }
      });
    } catch (error) {
      console.error('Error in statistikTahunan:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil statistik tahunan', error: error.message });
    }
  }

  /**
   * Dashboard for Kelembagaan Lainnya (Satlinmas + Lembaga Custom)
   * GET /api/kelembagaan/lainnya-dashboard
   */
  async lainnyaDashboard(req, res) {
    try {
      const kecamatans = await prisma.kecamatans.findMany({
        include: {
          desas: {
            select: { id: true, nama: true, kode: true, status_pemerintahan: true }
          }
        },
        orderBy: { id: 'asc' }
      });

      const allDesaIds = kecamatans.flatMap(k => k.desas.map(d => d.id));

      // Batch query satlinmas + lembaga_lainnya (total and verified)
      const [
        satlinmasAll,
        satlinmasVerified,
        lembagaLainnyaAll,
        lembagaLainnyaVerified
      ] = await Promise.all([
        prisma.satlinmas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' },
          select: { id: true, desa_id: true, nama: true, status_verifikasi: true }
        }),
        prisma.satlinmas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' },
          select: { id: true, desa_id: true }
        }),
        prisma.lembaga_lainnyas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif' },
          select: { id: true, desa_id: true, nama: true, status_verifikasi: true }
        }),
        prisma.lembaga_lainnyas.findMany({
          where: { desa_id: { in: allDesaIds }, status_kelembagaan: 'aktif', status_verifikasi: 'verified' },
          select: { id: true, desa_id: true }
        })
      ]);

      // Build lookup maps per desa
      const satlinmasMap = new Map();
      const lembagaLainnyaMap = new Map();

      for (const s of satlinmasAll) {
        const key = s.desa_id.toString();
        if (!satlinmasMap.has(key)) satlinmasMap.set(key, []);
        satlinmasMap.get(key).push(s);
      }
      for (const l of lembagaLainnyaAll) {
        const key = l.desa_id.toString();
        if (!lembagaLainnyaMap.has(key)) lembagaLainnyaMap.set(key, []);
        lembagaLainnyaMap.get(key).push(l);
      }

      const satlinmasVerifiedSet = new Set(satlinmasVerified.map(s => s.desa_id.toString()));
      const lembagaLainnyaVerifiedMap = new Map();
      for (const l of lembagaLainnyaVerified) {
        const key = l.desa_id.toString();
        lembagaLainnyaVerifiedMap.set(key, (lembagaLainnyaVerifiedMap.get(key) || 0) + 1);
      }

      // Global stats
      const totalSatlinmas = satlinmasAll.length;
      const totalSatlinmasVerified = satlinmasVerified.length;
      const totalLembagaLainnya = lembagaLainnyaAll.length;
      const totalLembagaLainnyaVerified = lembagaLainnyaVerified.length;
      const totalDesa = allDesaIds.length;
      const desaDenganSatlinmas = satlinmasMap.size;
      const desaDenganLembagaLainnya = lembagaLainnyaMap.size;

      // Recently unverified items (for quick list)
      const unverifiedItems = [
        ...satlinmasAll.filter(s => s.status_verifikasi !== 'verified').map(s => ({
          id: s.id, nama: s.nama, type: 'satlinmas', desa_id: s.desa_id.toString()
        })),
        ...lembagaLainnyaAll.filter(l => l.status_verifikasi !== 'verified').map(l => ({
          id: l.id, nama: l.nama, type: 'lembaga-lainnya', desa_id: l.desa_id.toString()
        }))
      ];

      // Build kecamatan->desa structure
      const data = kecamatans.map(kec => {
        const desas = kec.desas.map(desa => {
          const desaIdStr = desa.id.toString();
          const satlinmasList = satlinmasMap.get(desaIdStr) || [];
          const lembagaLainnyaList = lembagaLainnyaMap.get(desaIdStr) || [];
          const satlinmasVerifiedCount = satlinmasVerifiedSet.has(desaIdStr) ? 1 : 0;
          const lembagaLainnyaVerifiedCount = lembagaLainnyaVerifiedMap.get(desaIdStr) || 0;

          return {
            id: Number(desa.id),
            nama: desa.nama,
            kode: desa.kode,
            status: desa.status_pemerintahan,
            satlinmas: {
              total: satlinmasList.length,
              verified: satlinmasVerifiedCount,
              unverified: satlinmasList.length - satlinmasVerifiedCount,
              terbentuk: satlinmasList.length > 0,
              items: satlinmasList.map(s => ({
                id: s.id, nama: s.nama, status_verifikasi: s.status_verifikasi
              }))
            },
            lembaga_lainnya: {
              total: lembagaLainnyaList.length,
              verified: lembagaLainnyaVerifiedCount,
              unverified: lembagaLainnyaList.length - lembagaLainnyaVerifiedCount,
              items: lembagaLainnyaList.map(l => ({
                id: l.id, nama: l.nama, status_verifikasi: l.status_verifikasi
              }))
            }
          };
        });

        const totalSatlinmasKec = desas.reduce((a, d) => a + d.satlinmas.total, 0);
        const verifiedSatlinmasKec = desas.reduce((a, d) => a + d.satlinmas.verified, 0);
        const totalLembagaKec = desas.reduce((a, d) => a + d.lembaga_lainnya.total, 0);
        const verifiedLembagaKec = desas.reduce((a, d) => a + d.lembaga_lainnya.verified, 0);
        const desaDgnSatlinmas = desas.filter(d => d.satlinmas.terbentuk).length;

        return {
          id: Number(kec.id),
          nama: kec.nama,
          totalDesa: desas.length,
          desas,
          summary: {
            satlinmas: { total: totalSatlinmasKec, verified: verifiedSatlinmasKec, unverified: totalSatlinmasKec - verifiedSatlinmasKec, desaTerbentuk: desaDgnSatlinmas },
            lembaga_lainnya: { total: totalLembagaKec, verified: verifiedLembagaKec, unverified: totalLembagaKec - verifiedLembagaKec }
          }
        };
      });

      res.json({
        success: true,
        data,
        summary: {
          totalDesa,
          satlinmas: {
            total: totalSatlinmas,
            verified: totalSatlinmasVerified,
            unverified: totalSatlinmas - totalSatlinmasVerified,
            desaTerbentuk: desaDenganSatlinmas,
            desaBelumTerbentuk: totalDesa - desaDenganSatlinmas
          },
          lembaga_lainnya: {
            total: totalLembagaLainnya,
            verified: totalLembagaLainnyaVerified,
            unverified: totalLembagaLainnya - totalLembagaLainnyaVerified,
            desaDenganLembaga: desaDenganLembagaLainnya
          }
        },
        unverified: unverifiedItems
      });
    } catch (error) {
      console.error('Error in lainnyaDashboard:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data dashboard lainnya', error: error.message });
    }
  }

  /**
   * Dashboard for all Pengurus across all kelembagaan
   * GET /api/kelembagaan/pengurus-dashboard
   * Query params: ?kecamatan_id, ?desa_id, ?pengurusable_type, ?search, ?verification_scope
   */
  async pengurusDashboard(req, res) {
    try {
      const { kecamatan_id, desa_id, pengurusable_type, search, verification_scope } = req.query;
      const requestedScope = String(verification_scope || 'verified').toLowerCase();
      const verificationScope = ['verified', 'unverified', 'ditolak', 'all'].includes(requestedScope)
        ? requestedScope
        : 'verified';
      const typeAliases = {
        rw: ['rw', 'rws'],
        rws: ['rw', 'rws'],
        rt: ['rt', 'rts'],
        rts: ['rt', 'rts'],
        posyandu: ['posyandu', 'posyandus'],
        posyandus: ['posyandu', 'posyandus'],
        karang_taruna: ['karang_taruna', 'karang_tarunas'],
        karang_tarunas: ['karang_taruna', 'karang_tarunas'],
        lpm: ['lpm', 'lpms'],
        lpms: ['lpm', 'lpms'],
        pkk: ['pkk', 'pkks'],
        pkks: ['pkk', 'pkks'],
        satlinmas: ['satlinmas'],
        'lembaga-lainnya': ['lembaga-lainnya', 'lembaga_lainnyas'],
        lembaga_lainnyas: ['lembaga-lainnya', 'lembaga_lainnyas'],
      };

      // Build where clause
      const where = { status_jabatan: 'aktif' };
      if (desa_id) where.desa_id = BigInt(desa_id);
      if (pengurusable_type) {
        const normalizedType = String(pengurusable_type).trim();
        const allowedTypes = typeAliases[normalizedType] || [normalizedType];
        where.pengurusable_type = allowedTypes.length === 1
          ? allowedTypes[0]
          : { in: allowedTypes };
      }
      if (search) {
        where.OR = [
          { nama_lengkap: { contains: search } },
          { jabatan: { contains: search } },
          { nik: { contains: search } },
        ];
      }

      // If kecamatan_id filter, get desa IDs in that kecamatan
      if (kecamatan_id && !desa_id) {
        const desasInKec = await prisma.desas.findMany({
          where: { kecamatan_id: BigInt(kecamatan_id) },
          select: { id: true }
        });
        where.desa_id = { in: desasInKec.map(d => d.id) };
      }

      // Fetch all matching pengurus with desa+kecamatan relation
      const allPengurus = await prisma.pengurus.findMany({
        where,
        include: {
          desas: {
            select: {
              id: true, nama: true,
              kecamatans: { select: { id: true, nama: true } }
            }
          }
        },
        orderBy: [{ created_at: 'desc' }]
      });

      // Build summary from the same filtered dataset used by the table.
      const verifiedPengurus = allPengurus.filter((pengurus) => pengurus.status_verifikasi === 'verified');
      const unverifiedPengurus = allPengurus.filter((pengurus) => pengurus.status_verifikasi === 'unverified');
      const rejectedPengurus = allPengurus.filter((pengurus) => pengurus.status_verifikasi === 'ditolak');
      const scopedPengurus = verificationScope === 'all'
        ? allPengurus
        : verificationScope === 'unverified'
          ? unverifiedPengurus
          : verificationScope === 'ditolak'
            ? rejectedPengurus
          : verifiedPengurus;
      const totalPengurus = scopedPengurus.length;
      const verifiedCount = scopedPengurus.filter((pengurus) => pengurus.status_verifikasi === 'verified').length;
      const unverifiedCount = scopedPengurus.filter((pengurus) => pengurus.status_verifikasi === 'unverified').length;
      const rejectedCount = scopedPengurus.filter((pengurus) => pengurus.status_verifikasi === 'ditolak').length;

      const now = new Date();

      // Gender distribution
      const genderStats = { L: 0, P: 0, unknown: 0 };
      scopedPengurus.forEach(p => {
        if (p.jenis_kelamin === 'Laki_laki') genderStats.L++;
        else if (p.jenis_kelamin === 'Perempuan') genderStats.P++;
        else genderStats.unknown++;
      });

      // Education distribution
      const educationStats = {};
      scopedPengurus.forEach(p => {
        const edu = p.pendidikan || 'Tidak Diketahui';
        educationStats[edu] = (educationStats[edu] || 0) + 1;
      });

      // Age distribution
      const ageRanges = { '<20': 0, '20-30': 0, '31-40': 0, '41-50': 0, '51-60': 0, '>60': 0, 'unknown': 0 };
      scopedPengurus.forEach(p => {
        if (!p.tanggal_lahir) { ageRanges['unknown']++; return; }
        const age = Math.floor((now - new Date(p.tanggal_lahir)) / (365.25 * 24 * 60 * 60 * 1000));
        if (age < 20) ageRanges['<20']++;
        else if (age <= 30) ageRanges['20-30']++;
        else if (age <= 40) ageRanges['31-40']++;
        else if (age <= 50) ageRanges['41-50']++;
        else if (age <= 60) ageRanges['51-60']++;
        else ageRanges['>60']++;
      });

      // Verification stats
      const totalVerified = verifiedCount;
      const totalUnverified = unverifiedCount;

      // Per kelembagaan type count
      const typeStats = {};
      const TYPE_LABELS = {
        'rw': 'RW', 'rws': 'RW',
        'rt': 'RT', 'rts': 'RT',
        'posyandu': 'Posyandu', 'posyandus': 'Posyandu',
        'karang_taruna': 'Karang Taruna', 'karang_tarunas': 'Karang Taruna',
        'lpm': 'LPM', 'lpms': 'LPM',
        'pkk': 'PKK', 'pkks': 'PKK',
        'satlinmas': 'Satlinmas',
        'lembaga-lainnya': 'Lembaga Lainnya', 'lembaga_lainnyas': 'Lembaga Lainnya',
      };
      scopedPengurus.forEach(p => {
        const label = TYPE_LABELS[p.pengurusable_type] || p.pengurusable_type;
        typeStats[label] = (typeStats[label] || 0) + 1;
      });

      // Yearly pengurus count per kelembagaan type for the current filtered dataset.
      const yearlyStats = {};
      scopedPengurus.forEach(p => {
        const year = p.created_at ? new Date(p.created_at).getFullYear() : null;
        if (!year) return;
        if (!yearlyStats[year]) yearlyStats[year] = {};
        const label = TYPE_LABELS[p.pengurusable_type] || p.pengurusable_type;
        yearlyStats[year][label] = (yearlyStats[year][label] || 0) + 1;
      });

      // Unverified pengurus list (limited to 50 most recent)
      const unverifiedList = unverifiedPengurus
        .slice(0, 50)
        .map(p => ({
          id: p.id,
          nama_lengkap: p.nama_lengkap,
          jabatan: p.jabatan,
          pengurusable_type: p.pengurusable_type,
          desa_nama: p.desas?.nama || '',
          kecamatan_nama: p.desas?.kecamatans?.nama || '',
        }));

      const rejectedList = rejectedPengurus
        .slice(0, 50)
        .map(p => ({
          id: p.id,
          nama_lengkap: p.nama_lengkap,
          jabatan: p.jabatan,
          pengurusable_type: p.pengurusable_type,
          desa_nama: p.desas?.nama || '',
          kecamatan_nama: p.desas?.kecamatans?.nama || '',
        }));

      // Serialize BigInt
        const serializedPengurus = scopedPengurus.map(p => ({
        id: p.id,
        nama_lengkap: p.nama_lengkap,
        jabatan: p.jabatan,
        jenis_kelamin: p.jenis_kelamin,
        pendidikan: p.pendidikan,
        tanggal_lahir: p.tanggal_lahir,
        no_telepon: p.no_telepon,
        pengurusable_type: p.pengurusable_type,
        pengurusable_id: p.pengurusable_id,
        status_verifikasi: p.status_verifikasi,
        desa_id: p.desa_id ? Number(p.desa_id) : null,
        desa_nama: p.desas?.nama || '',
        kecamatan_id: p.desas?.kecamatans?.id ? Number(p.desas.kecamatans.id) : null,
        kecamatan_nama: p.desas?.kecamatans?.nama || '',
      }));

      // Get kecamatan list for filter dropdown
      const kecamatans = await prisma.kecamatans.findMany({
        select: { id: true, nama: true },
        orderBy: { nama: 'asc' }
      });

      // Get desa list for filter dropdown (optionally filtered by kecamatan)
      const desaWhere = kecamatan_id ? { kecamatan_id: BigInt(kecamatan_id) } : {};
      const desas = await prisma.desas.findMany({
        where: desaWhere,
        select: { id: true, nama: true, kecamatan_id: true },
        orderBy: { nama: 'asc' }
      });

      res.json({
        success: true,
        data: serializedPengurus,
        summary: {
          total: totalPengurus,
          verified: totalVerified,
          unverified: totalUnverified,
          ditolak: rejectedCount,
          pendingVerificationCount: unverifiedPengurus.length,
          rejectedVerificationCount: rejectedPengurus.length,
          scope: verificationScope,
          matchingCounts: {
            all: allPengurus.length,
            verified: verifiedPengurus.length,
            unverified: unverifiedPengurus.length,
            ditolak: rejectedPengurus.length,
          },
          genderStats,
          educationStats,
          ageRanges,
          typeStats,
          yearlyStats,
        },
        unverified: unverifiedList,
        ditolak: rejectedList,
        filters: {
          kecamatans: kecamatans.map(k => ({ id: Number(k.id), nama: k.nama })),
          desas: desas.map(d => ({ id: Number(d.id), nama: d.nama, kecamatan_id: Number(d.kecamatan_id) })),
        }
      });
    } catch (error) {
      console.error('Error in pengurusDashboard:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data dashboard pengurus', error: error.message });
    }
  }
}

module.exports = new SummaryController();
