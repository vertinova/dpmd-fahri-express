// src/controllers/bankeuPublic.controller.js
// Public controller for Bantuan Keuangan - NO AUTH REQUIRED
// Returns aggregate/safe data only for public transparency page

const prisma = require('../config/prisma');
const logger = require('../utils/logger');

class BankeuPublicController {
  /**
   * GET /api/public/bankeu/tracking-summary
   * Returns aggregate proposal tracking data (safe for public)
   * Query: ?tahun_anggaran=2027
   */
  async getTrackingSummary(req, res) {
    try {
      const { tahun_anggaran } = req.query;
      const tahun = tahun_anggaran ? parseInt(tahun_anggaran) : 2027;

      logger.info(`[PUBLIC] Fetching bankeu tracking summary for tahun ${tahun}`);

      const proposals = await prisma.bankeu_proposals.findMany({
        where: { tahun_anggaran: tahun },
        select: {
          id: true,
          desa_id: true,
          kegiatan_id: true,
          judul_proposal: true,
          nama_kegiatan_spesifik: true,
          volume: true,
          lokasi: true,
          anggaran_usulan: true,
          status: true,
          dinas_status: true,
          kecamatan_status: true,
          dpmd_status: true,
          submitted_to_dinas_at: true,
          submitted_to_kecamatan: true,
          submitted_to_dpmd: true,
          created_at: true,
          bankeu_proposal_kegiatan: {
            select: {
              kegiatan_id: true,
              bankeu_master_kegiatan: {
                select: { id: true, nama_kegiatan: true, dinas_terkait: true }
              }
            }
          },
          desas: {
            select: {
              nama: true,
              kecamatans: {
                select: { nama: true }
              }
            }
          }
        },
        orderBy: { created_at: 'desc' }
      });

      // Get kegiatan info from direct FK
      const allKegiatan = await prisma.bankeu_master_kegiatan.findMany({
        select: { id: true, nama_kegiatan: true, dinas_terkait: true }
      });
      const kegiatanMap = {};
      allKegiatan.forEach(k => { kegiatanMap[Number(k.id)] = k; });

      // Calculate stages for public display
      // SELESAI = submitted_to_dpmd === true (sudah sampai DPMD)
      // Harus sama dengan logic di DPMD Verification Page: submitted_to_dpmd: true AND kecamatan_status: 'approved'
      // Stage logic diselaraskan dengan SPKED frontend (getProposalStage)
      // Cek dari tahap akhir ke awal, termasuk status revision/rejected
      const getStage = (p) => {
        // SELESAI = Sudah dikirim ke DPMD, atau pernah sampai DPMD (dpmd_status set)
        if (p.submitted_to_dpmd === true || p.dpmd_status) {
          return 'selesai';
        }
        
        // Di Kecamatan = Dinas approved (menunggu/proses kecamatan)
        if (p.kecamatan_status === 'approved') return 'di_kecamatan';
        if (p.dinas_status === 'approved') return 'di_kecamatan';
        
        // Di Dinas = Sudah pernah submit ke dinas, ATAU punya dinas_status (termasuk revision/rejected)
        if (p.submitted_to_dinas_at || p.dinas_status) return 'di_dinas';
        
        // Masih di Desa (belum pernah interaksi dengan dinas)
        return 'di_desa';
      };

      // Get all desa (hanya status_pemerintahan = 'desa', bukan kelurahan) with kecamatan
      const allDesaList = await prisma.desas.findMany({
        where: { status_pemerintahan: 'desa' },
        select: { id: true, nama: true, kecamatan_id: true, kecamatans: { select: { nama: true } } },
        orderBy: { nama: 'asc' }
      });
      const totalDesaCount = allDesaList.length;

      // Desa yang sudah mengusulkan = sudah submit ke dinas terkait (submitted_to_dinas_at NOT NULL)
      const proposalsSubmitted = proposals.filter(p => p.submitted_to_dinas_at !== null);
      const desaSudahMengusulkan = new Set(proposalsSubmitted.map(p => Number(p.desa_id)).filter(Boolean));
      // Desa yang punya proposal tapi belum kirim ke dinas
      const desaAllProposals = new Set(proposals.map(p => Number(p.desa_id)).filter(Boolean));

      // Build desa partisipasi per kecamatan (grouped)
      const desaPartisipasi = {};
      allDesaList.forEach(d => {
        const kecName = d.kecamatans?.nama || 'Lainnya';
        if (!desaPartisipasi[kecName]) desaPartisipasi[kecName] = { sudah: [], belum: [] };
        const desaId = Number(d.id);
        if (desaSudahMengusulkan.has(desaId)) {
          desaPartisipasi[kecName].sudah.push(d.nama);
        } else {
          desaPartisipasi[kecName].belum.push(d.nama);
        }
      });

      // Build summary
      const summary = {
        total: proposals.length,
        di_desa: 0,
        di_dinas: 0,
        di_kecamatan: 0,
        selesai: 0,
        total_anggaran: 0,
        total_desa: totalDesaCount,
        desa_mengusulkan: desaSudahMengusulkan.size,
        desa_belum_mengusulkan: totalDesaCount - desaSudahMengusulkan.size,
        desa_draft: desaAllProposals.size - desaSudahMengusulkan.size
      };

      // Build kecamatan aggregation 
      const kecamatanAgg = {};

      // Build sanitized proposal list (public-safe)
      const publicProposals = proposals.map(p => {
        const stage = getStage(p);
        const rawAnggaran = Number(p.anggaran_usulan) || 0;
        // Cap at 1.5 Miliar for public display (avoid outlier/data-entry-error skewing)
        const MAX_ANGGARAN = 1_500_000_000;
        const anggaran = Math.min(rawAnggaran, MAX_ANGGARAN);
        
        // Resolve kegiatan: direct FK first, then pivot table, then nama_kegiatan_spesifik
        let kegiatanName = '-';
        let dinasTerkait = '-';
        
        if (p.kegiatan_id && kegiatanMap[Number(p.kegiatan_id)]) {
          kegiatanName = kegiatanMap[Number(p.kegiatan_id)].nama_kegiatan;
          dinasTerkait = kegiatanMap[Number(p.kegiatan_id)].dinas_terkait || '-';
        } else if (p.bankeu_proposal_kegiatan?.length > 0) {
          // Use first kegiatan from pivot table
          const pivotKeg = p.bankeu_proposal_kegiatan[0]?.bankeu_master_kegiatan;
          if (pivotKeg) {
            kegiatanName = pivotKeg.nama_kegiatan;
            dinasTerkait = pivotKeg.dinas_terkait || '-';
          }
        }
        
        // Fallback to nama_kegiatan_spesifik if available
        if (kegiatanName === '-' && p.nama_kegiatan_spesifik) {
          kegiatanName = p.nama_kegiatan_spesifik;
        }

        // Update summary
        summary[stage] = (summary[stage] || 0) + 1;
        summary.total_anggaran += anggaran;

        // Update kecamatan agg
        const kecName = p.desas?.kecamatans?.nama || 'Lainnya';
        const desaName = p.desas?.nama || 'Lainnya';

        if (!kecamatanAgg[kecName]) {
          kecamatanAgg[kecName] = { count: 0, total: 0, desas: {} };
        }
        kecamatanAgg[kecName].count += 1;
        kecamatanAgg[kecName].total += anggaran;

        if (!kecamatanAgg[kecName].desas[desaName]) {
          kecamatanAgg[kecName].desas[desaName] = { count: 0, total: 0, stage: stage };
        }
        kecamatanAgg[kecName].desas[desaName].count += 1;
        kecamatanAgg[kecName].desas[desaName].total += anggaran;

        return {
          kecamatan: kecName,
          desa: desaName,
          kegiatan: kegiatanName,
          dinas_terkait: dinasTerkait,
          anggaran: anggaran,
          stage: stage,
          lokasi: p.lokasi || '-',
          volume: p.volume || '-'
        };
      });

      // ─── ANGGARAN PER PROGRAM (hanya proposal yang sudah sampai DPMD = stage 'selesai') ───
      const programAgg = {};
      publicProposals.forEach(p => {
        if (p.stage !== 'selesai') return; // Hanya yang sudah di DPMD
        const programKey = p.kegiatan || '-';
        const dinasKey = p.dinas_terkait || '-';
        const compositeKey = `${programKey}|||${dinasKey}`;

        if (!programAgg[compositeKey]) {
          programAgg[compositeKey] = {
            nama_program: programKey,
            dinas_terkait: dinasKey,
            total_anggaran: 0,
            jumlah_proposal: 0,
            desa_set: new Set()
          };
        }
        programAgg[compositeKey].total_anggaran += (p.anggaran || 0);
        programAgg[compositeKey].jumlah_proposal += 1;
        if (p.desa && p.desa !== 'Lainnya') {
          programAgg[compositeKey].desa_set.add(p.desa);
        }
      });

      const anggaranPerProgram = Object.values(programAgg)
        .map(item => ({
          nama_program: item.nama_program,
          dinas_terkait: item.dinas_terkait,
          total_anggaran: item.total_anggaran,
          jumlah_proposal: item.jumlah_proposal,
          jumlah_desa: item.desa_set.size
        }))
        .sort((a, b) => b.total_anggaran - a.total_anggaran);

      const totalAnggaranFinal = anggaranPerProgram.reduce((s, p) => s + p.total_anggaran, 0);
      const totalDesaFinal = new Set(
        publicProposals.filter(p => p.stage === 'selesai' && p.desa && p.desa !== 'Lainnya').map(p => p.desa)
      ).size;
      const totalProposalFinal = publicProposals.filter(p => p.stage === 'selesai').length;

      logger.info(`[PUBLIC] Tracking summary: ${proposals.length} proposals for tahun ${tahun}, ${anggaranPerProgram.length} programs at DPMD`);

      return res.json({
        success: true,
        summary,
        proposals: publicProposals,
        kecamatan: kecamatanAgg,
        desa_partisipasi: desaPartisipasi,
        anggaran_per_program: {
          programs: anggaranPerProgram,
          total_anggaran_final: totalAnggaranFinal,
          total_desa_final: totalDesaFinal,
          total_proposal_final: totalProposalFinal
        },
        tahun_anggaran: tahun
      });

    } catch (error) {
      logger.error('Error fetching public tracking summary:', error);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data tracking'
      });
    }
  }

  /**
   * GET /api/public/bankeu/available-years
   * Returns list of years that have proposal data
   */
  async getAvailableYears(req, res) {
    try {
      const years = await prisma.bankeu_proposals.findMany({
        select: { tahun_anggaran: true },
        distinct: ['tahun_anggaran'],
        orderBy: { tahun_anggaran: 'desc' }
      });

      return res.json({
        success: true,
        years: years.map(y => y.tahun_anggaran)
      });
    } catch (error) {
      logger.error('Error fetching available years:', error);
      return res.json({ success: true, years: [2027, 2026] });
    }
  }
}

module.exports = new BankeuPublicController();
