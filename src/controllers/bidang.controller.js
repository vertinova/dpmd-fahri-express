const prisma = require('../config/prisma');
const fs = require('fs');
const path = require('path');
const { filterJenis } = require('./pemdes-aparatur.controller');

class BidangController {
  /**
   * Get dashboard data for specific bidang
   * Includes stats and recent activity logs
   */
  async getDashboard(req, res) {
    try {
      const { bidangId } = req.params;
      const userId = req.user.id;
      
      // Get bidang stats
      const stats = await this.getBidangStats(bidangId);
      
      // Get recent activity logs for this bidang
      const activityLogs = await prisma.$queryRaw`
        SELECT 
          id,
          user_name,
          user_role,
          module,
          action,
          entity_type,
          entity_name,
          description,
          created_at
        FROM activity_logs
        WHERE bidang_id = ${parseInt(bidangId)}
        ORDER BY created_at DESC
        LIMIT 20
      `;
      
      // Get bidang info
      const bidang = await prisma.bidangs.findUnique({
        where: { id: BigInt(bidangId) },
        select: {
          id: true,
          nama: true
        }
      });
      
      res.json({
        success: true,
        data: {
          bidang: bidang ? {
            id: Number(bidang.id),
            nama: bidang.nama
          } : null,
          stats,
          activityLogs: activityLogs.map(log => ({
            id: Number(log.id),
            userName: log.user_name,
            userRole: log.user_role,
            module: log.module,
            action: log.action,
            entityType: log.entity_type,
            entityName: log.entity_name,
            description: log.description,
            createdAt: log.created_at
          }))
        }
      });
    } catch (error) {
      console.error('Error getting bidang dashboard:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memuat dashboard bidang',
        error: error.message
      });
    }
  }

  /**
   * Get statistics based on bidang type
   */
  async getBidangStats(bidangId) {
    const bidangIdInt = parseInt(bidangId);
    
    try {
      switch (bidangIdInt) {
        case 2: // Sekretariat
          return {
            total_surat_masuk: await prisma.surat_masuk.count(),
            disposisi_pending: await prisma.disposisi.count({ 
              where: { status: 'pending' } 
            }),
            total_perjalanan_dinas: await prisma.kegiatan.count(),
            perjadin_bulan_ini: await prisma.kegiatan.count({
              where: {
                tanggal_mulai: {
                  gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                }
              }
            }),
            total_pegawai: await prisma.pegawai.count()
          };
          
        case 3: // Sarana Prasarana (SPKED - Bankeu & BUMDes)
          const totalBumdes = await prisma.bumdes.count();
          const activeBumdes = await prisma.bumdes.count({ 
            where: { status: 'aktif' } 
          });
          
          return {
            total_bumdes: totalBumdes,
            active_bumdes: activeBumdes,
            inactive_bumdes: totalBumdes - activeBumdes,
            total_unit_usaha: 0, // Field removed - unit usaha tracked separately
            // Bankeu stats (dari JSON files)
            bankeu_tahap1_uploaded: this.checkFileExists('public/bankeu-tahap1.json'),
            bankeu_tahap2_uploaded: this.checkFileExists('public/bankeu-tahap2.json'),
            bankeu_2025_uploaded: this.checkFileExists('public/bankeu2025.json')
          };
          
        case 4: { // Kekayaan Keuangan Desa (KKD - ADD, DD, BHPRD)
          const tahun = new Date().getFullYear();
          const totalDesa = await prisma.desas.count({
            where: { status_pemerintahan: 'desa' }
          });

          const penerimaAdd = this.countJsonRecords('public/add2025.json', r => r.sts && r.sts.includes('Dicairkan'));
          const penerimaDD  = this.countUniqueJsonField('public/dd2025.json', r => `${r.desa}|${r.kecamatan}`);

          const paguAgg4 = await prisma.anggaran_pagu.aggregate({
            where: { tahun, master_kegiatan: { bidang_id: BigInt(4) } },
            _sum: { pagu: true }
          });

          return {
            total_desa: totalDesa,
            penerima_add: penerimaAdd,
            penerima_dd: penerimaDD,
            pagu: Number(paguAgg4._sum.pagu ?? 0),
            // file flags (masih dipakai di halaman detail)
            add_uploaded: this.checkFileExists('public/add2025.json'),
            dd_uploaded: this.checkFileExists('public/dd2025.json'),
            dd_earmarked_t1: this.checkFileExists('public/dd-earmarked-tahap1.json'),
            dd_earmarked_t2: this.checkFileExists('public/dd-earmarked-tahap2.json'),
            dd_nonearmarked_t1: this.checkFileExists('public/dd-nonearmarked-tahap1.json'),
            dd_nonearmarked_t2: this.checkFileExists('public/dd-nonearmarked-tahap2.json'),
            bhprd_uploaded: this.checkFileExists('public/bhprd2025.json'),
            bhprd_t1: this.checkFileExists('public/bhprd-tahap1.json'),
            bhprd_t2: this.checkFileExists('public/bhprd-tahap2.json'),
            bhprd_t3: this.checkFileExists('public/bhprd-tahap3.json'),
            insentif_dd: this.checkFileExists('public/insentif-dd.json')
          };
        }
          
        case 5: // Pemberdayaan Masyarakat (PMD - Kelembagaan)
          return {
            total_rw: await prisma.rws.count(),
            total_rt: await prisma.rts.count(),
            total_posyandu: await prisma.posyandus.count(),
            total_karang_taruna: await prisma.karang_tarunas.count(),
            total_lpm: await prisma.lpms.count(),
            total_pkk: await prisma.pkks.count(),
            total_satlinmas: await prisma.satlinmas.count(),
            aktif_rw: await prisma.rws.count({ 
              where: { status_kelembagaan: 'aktif' } 
            }),
            aktif_rt: await prisma.rts.count({ 
              where: { status_kelembagaan: 'aktif' } 
            })
          };
          
        case 6: { // Pemerintahan Desa (PEMDES)
          const tahun6 = new Date().getFullYear();
          const paguAgg6 = await prisma.anggaran_pagu.aggregate({
            where: { tahun: tahun6, master_kegiatan: { bidang_id: BigInt(6) } },
            _sum: { pagu: true }
          });
          return {
            total_desa: await prisma.desas.count({ where: { status_pemerintahan: 'desa' } }),
            total_aparatur: await prisma.aparatur_desa.count(),
            total_perangkat: await prisma.aparatur_desa.count({ where: filterJenis('perangkat') }),
            total_bpd: await prisma.aparatur_desa.count({ where: filterJenis('bpd') }),
            total_produk_hukum: await prisma.produk_hukums.count(),
            produk_hukum_berlaku: await prisma.produk_hukums.count({
              where: { status_peraturan: 'berlaku' }
            }),
            pagu: Number(paguAgg6._sum.pagu ?? 0),
          };
        }
          
        default:
          return {};
      }
    } catch (error) {
      console.error(`Error getting stats for bidang ${bidangId}:`, error);
      return {};
    }
  }

  countJsonRecords(filePath, filterFn) {
    try {
      const fullPath = path.join(__dirname, '../../', filePath);
      if (!fs.existsSync(fullPath)) return 0;
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      return Array.isArray(data) ? (filterFn ? data.filter(filterFn).length : data.length) : 0;
    } catch { return 0; }
  }

  countUniqueJsonField(filePath, keyFn) {
    try {
      const fullPath = path.join(__dirname, '../../', filePath);
      if (!fs.existsSync(fullPath)) return 0;
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (!Array.isArray(data)) return 0;
      return new Set(data.map(keyFn)).size;
    } catch { return 0; }
  }

  /**
   * Helper: Check if file exists
   */
  checkFileExists(filePath) {
    try {
      const fullPath = path.join(__dirname, '../../', filePath);
      return fs.existsSync(fullPath);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get activity logs for specific bidang
   */
  async getActivityLogs(req, res) {
    try {
      const { bidangId } = req.params;
      const { limit = 50, module, action } = req.query;
      
      // Build where clause safely with Prisma
      const where = {
        bidang_id: parseInt(bidangId)
      };
      
      if (module) {
        where.module = module;
      }
      
      if (action) {
        where.action = action;
      }
      
      const logs = await prisma.activity_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        select: {
          id: true,
          user_name: true,
          user_role: true,
          module: true,
          action: true,
          entity_type: true,
          entity_name: true,
          description: true,
          created_at: true
        }
      });
      
      res.json({
        success: true,
        data: logs.map(log => ({
          id: Number(log.id),
          userName: log.user_name,
          userRole: log.user_role,
          module: log.module,
          action: log.action,
          entityType: log.entity_type,
          entityName: log.entity_name,
          description: log.description,
          createdAt: log.created_at
        }))
      });
    } catch (error) {
      console.error('Error getting activity logs:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memuat log aktivitas',
        error: error.message
      });
    }
  }

  /**
   * Get list of pegawai for specific bidang
   */
  async getPegawai(req, res) {
    try {
      const { bidangId } = req.params;
      const bidangIdInt = parseInt(bidangId);
      const { all: showAll } = req.query; // ?all=true to show all DPMD pegawai
      
      // Get all users yang merupakan pegawai di bidang ini
      const pegawaiList = await prisma.users.findMany({
        where: {
          ...(showAll === 'true' ? {} : { bidang_id: bidangIdInt }),
          pegawai_id: {
            not: null
          },
          is_active: true
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatar: true,
          pegawai_id: true,
          bidang_id: true,
          pegawai: {
            select: {
              id_pegawai: true,
              nama_pegawai: true,
              nip: true,
              jabatan: true,
              golongan: true,
              pangkat: true,
              no_hp: true,
              status_kepegawaian: true,
              id_bidang: true,
              bidangs: {
                select: {
                  id: true,
                  nama: true
                }
              }
            }
          }
        },
        orderBy: [
          {
            role: 'asc' // kepala_bidang first, then others
          },
          {
            name: 'asc'
          }
        ]
      });

      // Format response
      const formattedData = pegawaiList.map(user => {
        // Pemetaan role akun -> label peran di daftar pegawai.
        //
        // Sebelumnya semua role di luar daftar ini jatuh ke 'staff', sehingga
        // Kepala Dinas dan Sekretaris Dinas ikut tampil sebagai "Staff" di
        // daftar pegawai. Pimpinan sekarang punya nilainya sendiri; hanya role
        // pelaksana (`pegawai`) yang memang berarti staf.
        const ROLE_MAP = {
          kepala_dinas: 'kepala_dinas',
          sekretaris_dinas: 'sekretaris_dinas',
          kepala_bidang: 'kepala_bidang',
          sekretaris_bidang: 'sekretaris',
          koordinator: 'koordinator',
          ketua_tim: 'ketua_tim',
          bendahara: 'bendahara',
        };
        const pegawaiRole = ROLE_MAP[user.role] || 'staff';

        return {
          id: Number(user.id),
          role: pegawaiRole,
          user: {
            id: Number(user.id),
            fullname: user.name,
            email: user.email,
            nip: user.pegawai?.nip || null,
            jabatan: user.pegawai?.jabatan || null,
            golongan: user.pegawai?.golongan || null,
            pangkat: user.pegawai?.pangkat || null,
            phone: user.pegawai?.no_hp || null,
            status_kepegawaian: user.pegawai?.status_kepegawaian || null,
            avatar: user.avatar || null,
            bidang_nama: user.pegawai?.bidangs?.nama || null
          }
        };
      });
      
      res.json({
        success: true,
        message: 'Pegawai retrieved successfully',
        data: formattedData
      });
    } catch (error) {
      console.error('Error getting pegawai:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memuat data pegawai',
        error: error.message
      });
    }
  }
}

module.exports = new BidangController();
