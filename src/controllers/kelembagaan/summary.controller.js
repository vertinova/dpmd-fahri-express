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
        pkkVerifiedData
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

        kelembagaanData.push({
          id: kecamatan.id,
          nama: kecamatan.nama,
          desas: desasWithKelembagaan,
          totalKelembagaan,
          verifiedKelembagaan
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

      const [desa, totalRW, totalRT, totalPosyandu, karangTaruna, lpm, satlinmas, pkk] = await Promise.all([
        prisma.desas.findUnique({ 
          where: { id: desaId }, 
          select: { id: true, nama: true, status_pemerintahan: true } 
        }),
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
          has_karang_taruna: !!karangTaruna,
          has_lpm: !!lpm,
          has_satlinmas: !!satlinmas,
          has_pkk: !!pkk
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
      const [rws, posyandus, karangTaruna, lpm, satlinmas, pkk] = await Promise.all([
        prisma.rws.findMany({ 
          where: { desa_id: parseInt(id) },
          orderBy: { nomor: 'asc' },
          include: {
            rts: {
              select: { id: true }
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
        })
      ]);

      // Map RW with RT count and provide frontend-compatible field names
      const rwsWithRtCount = rws.map(rw => ({
        id: rw.id,
        nomor_rw: rw.nomor,
        nomor: rw.nomor,
        alamat: rw.alamat,
        desa_id: rw.desa_id,
        status_kelembagaan: rw.status_kelembagaan,
        status_verifikasi: rw.status_verifikasi,
        rt_count: rw.rts.length,
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
            rw: rwsWithRtCount,
            posyandu: posyandus,
            karang_taruna: karangTaruna,
            lpm: lpm,
            satlinmas: satlinmas,
            pkk: pkk
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
}

module.exports = new SummaryController();
