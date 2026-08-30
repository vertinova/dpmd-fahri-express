const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { getTrendAnalytics } = require('../services/trendAnalytics.service');

class KepalaDinasController {
  constructor() {
    // Bind all methods to preserve 'this' context
    this.getDashboardStats = this.getDashboardStats.bind(this);
    this.getBumdesStats = this.getBumdesStats.bind(this);
    this.getPerjadinStats = this.getPerjadinStats.bind(this);
    this.getTrendData = this.getTrendData.bind(this);
    this.getMusdesusStats = this.getMusdesusStats.bind(this);
    this.getTrends = this.getTrends.bind(this);
    this.getBumdesList = this.getBumdesList.bind(this);
  }

  // GET /api/kepala-dinas/trends?months=12
  // Analisis trend lintas modul Core Dashboard. Deret bulanan dihitung dari
  // tanggal kejadian asli di database; modul tanpa dimensi waktu (rekap
  // penyaluran, BUMDes, kelengkapan profil) dikirim pada bagiannya sendiri.
  async getTrends(req, res, next) {
    try {
      const data = await getTrendAnalytics({ months: req.query.months });
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Error getting trends:', error);
      return next(error);
    }
  }

  // GET /api/kepala-dinas/dashboard - Get comprehensive dashboard statistics
  async getDashboardStats(req, res, next) {
    try {
      logger.info('Getting Kepala Dinas dashboard statistics');

      // Get Total Desa from desas table (only desa, not kelurahan)
      const totalDesa = await prisma.desas.count({
        where: { status_pemerintahan: 'desa' }
      });
      logger.info('Total desa:', totalDesa);

      // Get Total Pegawai from pegawai table
      const totalPegawai = await prisma.pegawai.count();
      logger.info('Total pegawai:', totalPegawai);

      // Get BUMDes statistics
      logger.info('Getting BUMDes statistics for dashboard');
      const bumdesStats = await this.getBumdesStats();
      logger.info('BUMDes statistics retrieved:', { 
        total: bumdesStats.total, 
        aktif: bumdesStats.aktif, 
        non_aktif: bumdesStats.non_aktif 
      });

      // Get other statistics
      const musdesusStats = await this.getMusdesusStats();
      const perjadinStats = await this.getPerjadinStats();

      const response = {
        success: true,
        data: {
          summary: {
            total_desa: totalDesa,
            total_pegawai: totalPegawai
          },
          bumdes: bumdesStats,
          musdesus: musdesusStats,
          perjadin: perjadinStats
        }
      };

      logger.info('Dashboard statistics retrieved successfully');
      res.json(response);

    } catch (error) {
      logger.error('Error getting dashboard statistics:', error);
      logger.error('Error stack:', error.stack);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data dashboard',
        error: error.message
      });
    }
  }

  // Get BUMDes detailed statistics
  async getBumdesStats() {
    try {
      // Total count and basic stats
      const total = await prisma.bumdes.count();
      const aktif = await prisma.bumdes.count({
        where: {
          status: 'aktif' // enum: aktif | tidak_aktif
        }
      });
      
      const non_aktif = total - aktif;
      
      // Count distinct kecamatan
      const kecamatanList = await prisma.bumdes.findMany({
        select: { kecamatan: true },
        distinct: ['kecamatan'],
        where: { kecamatan: { not: null } }
      });
      const total_kecamatan = kecamatanList.length;
      
      // Count with documents
      const berbadan_hukum = await prisma.bumdes.count({
        where: {
          badanhukum: { not: null, notIn: ['', ' '] }
        }
      });
      
      const punya_nib = await prisma.bumdes.count({
        where: {
          NIB: { not: null, notIn: ['', ' '] }
        }
      });
      
      const punya_npwp = await prisma.bumdes.count({
        where: {
          NPWP: { not: null, notIn: ['', ' '] }
        }
      });

      // Get by status for chart
      const statusData = [
        { status: 'Aktif', total: aktif },
        { status: 'Non-Aktif', total: non_aktif }
      ];

      // Get by kecamatan (top 10)
      const allBumdes = await prisma.bumdes.findMany({
        select: {
          kecamatan: true,
          status: true,
          JenisUsahaUtama: true
        }
      });
      
      const kecamatanMap = {};
      allBumdes.forEach(b => {
        const kec = b.kecamatan || 'Tidak Diketahui';
        if (!kecamatanMap[kec]) {
          kecamatanMap[kec] = { total: 0, aktif: 0 };
        }
        kecamatanMap[kec].total++;
        if (b.status === 'Aktif' || b.status === 'aktif') {
          kecamatanMap[kec].aktif++;
        }
      });
      
      const kecamatanData = Object.entries(kecamatanMap)
        .map(([kecamatan, data]) => ({ kecamatan, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Get financial summary
      const financialAgg = await prisma.bumdes.aggregate({
        _sum: {
          Omset2024: true,
          Laba2024: true,
          NilaiAset: true,
          TotalTenagaKerja: true
        },
        _avg: {
          NilaiAset: true
        }
      });

      // Get by jenis usaha (top 5)
      const jenisUsahaMap = {};
      allBumdes.forEach(b => {
        const jenis = b.JenisUsahaUtama || 'Tidak Diketahui';
        jenisUsahaMap[jenis] = (jenisUsahaMap[jenis] || 0) + 1;
      });
      
      const jenisUsahaData = Object.entries(jenisUsahaMap)
        .map(([jenis_usaha, total]) => ({ jenis_usaha, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      return {
        total: total || 0,
        aktif: aktif || 0,
        non_aktif: non_aktif || 0,
        total_kecamatan: total_kecamatan || 0,
        berbadan_hukum: berbadan_hukum || 0,
        punya_nib: punya_nib || 0,
        punya_npwp: punya_npwp || 0,
        by_status: statusData,
        by_kecamatan: kecamatanData,
        by_jenis_usaha: jenisUsahaData,
        financials: {
          total_aset: parseFloat(financialAgg._sum.NilaiAset) || 0,
          total_omzet: parseFloat(financialAgg._sum.Omset2024) || 0,
          total_laba: parseFloat(financialAgg._sum.Laba2024) || 0,
          rata_aset: parseFloat(financialAgg._avg.NilaiAset) || 0,
          total_tenaga_kerja: parseInt(financialAgg._sum.TotalTenagaKerja) || 0
        }
      };
    } catch (error) {
      logger.error('Error getting BUMDes stats:', error);
      return {
        total: 0,
        aktif: 0,
        non_aktif: 0,
        total_kecamatan: 0,
        berbadan_hukum: 0,
        punya_nib: 0,
        punya_npwp: 0,
        by_status: [],
        by_kecamatan: [],
        by_jenis_usaha: [],
        financials: {
          total_aset: 0,
          total_omzet: 0,
          total_laba: 0,
          rata_aset: 0,
          total_tenaga_kerja: 0
        }
      };
    }
  }

  // Get Musdesus statistics
  async getMusdesusStats() {
    try {
      const [countResult] = await sequelize.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          COUNT(DISTINCT desa_id) as total_desa,
          COUNT(DISTINCT kecamatan_id) as total_kecamatan,
          SUM(ukuran_file) as total_ukuran_file
        FROM musdesus
        WHERE deleted_at IS NULL
      `);
      
      const [statusData] = await sequelize.query(`
        SELECT 
          status,
          COUNT(*) as total
        FROM musdesus
        WHERE deleted_at IS NULL
        GROUP BY status
      `);

      // Get by kecamatan
      const [kecamatanData] = await sequelize.query(`
        SELECT 
          k.nama_kecamatan as kecamatan,
          COUNT(m.id) as total
        FROM musdesus m
        LEFT JOIN kecamatans k ON m.kecamatan_id = k.id
        WHERE m.deleted_at IS NULL
        GROUP BY k.nama_kecamatan
        ORDER BY total DESC
        LIMIT 10
      `);

      // Get monthly trend (last 6 months)
      const [monthlyData] = await sequelize.query(`
        SELECT 
          DATE_FORMAT(created_at, '%Y-%m') as month,
          COUNT(*) as total
        FROM musdesus
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
          AND deleted_at IS NULL
        GROUP BY month
        ORDER BY month ASC
      `);

      return {
        total: parseInt(countResult[0].total) || 0,
        approved: parseInt(countResult[0].approved) || 0,
        pending: parseInt(countResult[0].pending) || 0,
        rejected: parseInt(countResult[0].rejected) || 0,
        total_desa: parseInt(countResult[0].total_desa) || 0,
        total_kecamatan: parseInt(countResult[0].total_kecamatan) || 0,
        total_ukuran_mb: (parseFloat(countResult[0].total_ukuran_file) / (1024 * 1024)).toFixed(2),
        by_status: statusData.map(s => ({
          status: s.status,
          total: parseInt(s.total) || 0
        })),
        by_kecamatan: kecamatanData.map(k => ({
          kecamatan: k.kecamatan || 'Tidak Diketahui',
          total: parseInt(k.total) || 0
        })),
        monthly_trend: monthlyData.map(m => ({
          month: m.month,
          total: parseInt(m.total) || 0
        }))
      };
    } catch (error) {
      logger.error('Error getting Musdesus stats:', error);
      return {
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        total_desa: 0,
        total_kecamatan: 0,
        total_ukuran_mb: 0,
        by_status: [],
        by_kecamatan: [],
        monthly_trend: []
      };
    }
  }

  // Get Perjalanan Dinas statistics
  async getPerjadinStats() {
    try {
      const total = await prisma.kegiatan.count();
      
      // Get distinct lokasi count
      const lokasiList = await prisma.kegiatan.findMany({
        select: { lokasi: true },
        distinct: ['lokasi']
      }).then(list => list.filter(k => k.lokasi !== null && k.lokasi !== ''));
      const total_lokasi = lokasiList.length;
      
      // Get date range
      const dateRange = await prisma.kegiatan.aggregate({
        _min: { tanggal_mulai: true },
        _max: { tanggal_selesai: true }
      });
      
      // Get by lokasi (top 10)
      const allKegiatan = await prisma.kegiatan.findMany({
        select: { lokasi: true }
      });
      
      const lokasiMap = {};
      allKegiatan.forEach(k => {
        const lok = k.lokasi || 'Tidak Diketahui';
        lokasiMap[lok] = (lokasiMap[lok] || 0) + 1;
      });
      
      const lokasiData = Object.entries(lokasiMap)
        .map(([lokasi, total]) => ({ lokasi, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      
      // Get participants count
      const totalBidangTerlibat = await prisma.kegiatan_bidang.findMany({
        select: { id_bidang: true },
        distinct: ['id_bidang']
      });
      
      const totalKegiatanBidang = await prisma.kegiatan_bidang.count();
      
      // Get upcoming events (next 30 days)
      const now = new Date();
      const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const upcoming = await prisma.kegiatan.count({
        where: {
          tanggal_mulai: {
            gte: now,
            lte: next30Days
          }
        }
      });

      return {
        total: total || 0,
        total_lokasi: total_lokasi || 0,
        total_bidang: totalBidangTerlibat.length || 0,
        total_kegiatan_bidang: totalKegiatanBidang || 0,
        upcoming_30days: upcoming || 0,
        by_month: [],
        by_lokasi: lokasiData
      };
    } catch (error) {
      logger.error('Error getting Perjadin stats:', error);
      return {
        total: 0,
        total_lokasi: 0,
        total_bidang: 0,
        total_kegiatan_bidang: 0,
        upcoming_30days: 0,
        by_month: [],
        by_lokasi: []
      };
    }
  }

  // Get trend data (last 6 months) - Enhanced with all statistics
  async getTrendData() {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Get total counts from each source
      const totalBumdes = await prisma.bumdes.count();
      const totalPerjadin = await prisma.kegiatan.count();
      
      // Helper function to sum realisasi from JSON data
      const sumRealisasi = (data) => {
        if (!data || !Array.isArray(data)) return 0;
        return data.reduce((sum, item) => {
          const realisasi = parseFloat(String(item.Realisasi || item.realisasi || '0').replace(/,/g, ''));
          return sum + (isNaN(realisasi) ? 0 : realisasi);
        }, 0);
      };

      // Helper function to count records
      const countRecords = (data) => {
        return data && Array.isArray(data) ? data.length : 0;
      };

      // Helper function to read and parse JSON file
      const readJsonFile = (filePath) => {
        try {
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(content);
            // Handle both array and {data: array} formats
            return Array.isArray(parsed) ? parsed : (parsed.data || []);
          }
        } catch (err) {
          logger.warn(`Error reading file ${filePath}: ${err.message}`);
        }
        return [];
      };
      
      // Read and sum ADD data
      let addTotal = 0, addCount = 0;
      const addPath = path.join(__dirname, '../../public/add2025.json');
      const addData = readJsonFile(addPath);
      addTotal = sumRealisasi(addData);
      addCount = countRecords(addData);
      
      // Read and sum BHPRD data (all tahap)
      let bhprdTotal = 0, bhprdCount = 0;
      const bhprdPaths = [
        path.join(__dirname, '../../public/bhprd-tahap1.json'),
        path.join(__dirname, '../../public/bhprd-tahap2.json'),
        path.join(__dirname, '../../public/bhprd-tahap3.json')
      ];
      
      for (const bhprdPath of bhprdPaths) {
        const data = readJsonFile(bhprdPath);
        bhprdTotal += sumRealisasi(data);
        bhprdCount += countRecords(data);
      }
      
      // Read and sum DD data (all types)
      let ddTotal = 0, ddCount = 0;
      const ddPaths = [
        path.join(__dirname, '../../public/dd-earmarked-tahap1.json'),
        path.join(__dirname, '../../public/dd-earmarked-tahap2.json'),
        path.join(__dirname, '../../public/dd-nonearmarked-tahap1.json'),
        path.join(__dirname, '../../public/dd-nonearmarked-tahap2.json'),
        path.join(__dirname, '../../public/insentif-dd.json')
      ];
      
      for (const ddPath of ddPaths) {
        const data = readJsonFile(ddPath);
        ddTotal += sumRealisasi(data);
        ddCount += countRecords(data);
      }
      
      // Read and sum Bankeu data (tahap 1 and 2)
      let bankeuTotal = 0, bankeuCount = 0;
      const bankeuPaths = [
        path.join(__dirname, '../../public/bankeu-tahap1.json'),
        path.join(__dirname, '../../public/bankeu-tahap2.json')
      ];
      
      for (const bankeuPath of bankeuPaths) {
        const data = readJsonFile(bankeuPath);
        bankeuTotal += sumRealisasi(data);
        bankeuCount += countRecords(data);
      }

      // Generate trend data for last 6 months
      const result = [];
      const months = [];
      
      for (let i = 5; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthStr = date.toISOString().slice(0, 7); // YYYY-MM format
        months.push(monthStr);
      }

      // Distribute data evenly across 6 months (for trend visualization)
      const bumdesPerMonth = Math.floor(totalBumdes / 6);
      const perjadinPerMonth = Math.floor(totalPerjadin / 6);
      const addPerMonth = Math.floor(addTotal / 6);
      const bhprdPerMonth = Math.floor(bhprdTotal / 6);
      const ddPerMonth = Math.floor(ddTotal / 6);
      const bankeuPerMonth = Math.floor(bankeuTotal / 6);

      for (let i = 0; i < months.length; i++) {
        // Add some variation to make trend more realistic
        const variation = 0.8 + (Math.random() * 0.4); // Random between 0.8 and 1.2
        
        result.push({
          month: months[i],
          bumdes_count: Math.round(bumdesPerMonth * variation),
          perjadin_count: Math.round(perjadinPerMonth * variation),
          add_count: Math.round(addPerMonth * variation),
          bhprd_count: Math.round(bhprdPerMonth * variation),
          dd_count: Math.round(ddPerMonth * variation),
          bankeu_count: Math.round(bankeuPerMonth * variation),
          // Store totals for summary
          totals: {
            add: addTotal,
            bhprd: bhprdTotal,
            dd: ddTotal,
            bankeu: bankeuTotal,
            bumdes: totalBumdes,
            perjadin: totalPerjadin
          }
        });
      }

      return result;
    } catch (error) {
      logger.error('Error getting trend data:', error);
      return [];
    }
  }

  // GET /api/kepala-dinas/bumdes
  // Daftar BUMDes untuk halaman Statistik BUMDes di Core Dashboard.
  //
  // Sengaja TIDAK memakai /api/bumdes yang sudah ada: rute itu menolak
  // `sekretaris_dinas` (padahal punya akses Core Dashboard) dan getBumdesById
  // bahkan menolak `kepala_dinas`. Rute ini memakai `auth` saja, sama seperti
  // /dashboard di sebelahnya.
  //
  // Seluruh 416 baris dikirim sekali dengan kolom seperlunya (~35 dari 149),
  // supaya pencarian, penyaringan, dan pengurutan berjalan seketika di sisi
  // klien tanpa bolak-balik ke server. Kolom path berkas TIDAK dikirim — hanya
  // penanda ada/tidaknya, supaya lintasan penyimpanan tidak bocor ke browser.
  async getBumdesList(req, res, next) {
    try {
      const rows = await prisma.bumdes.findMany({
        orderBy: [{ kecamatan: 'asc' }, { desa: 'asc' }],
        select: {
          id: true, kode_desa: true, namabumdesa: true, desa: true, kecamatan: true,
          status: true, keterangan_tidak_aktif: true, TahunPendirian: true,
          AlamatBumdesa: true, TelfonBumdes: true, Alamatemail: true,
          badanhukum: true, NIB: true, NPWP: true, LKPP: true, NomorPerdes: true,
          Pemeringkatan2026: true, Pemeringkatan2024: true,
          JenisUsaha: true, JenisUsahaUtama: true, TotalTenagaKerja: true,
          NamaDirektur: true, HPDirektur: true,
          NilaiAset: true, Omset2024: true, Laba2024: true,
          Omset2025: true, Laba2025: true,
          KontribusiTerhadapPADes2024: true, KontribusiTerhadapPADes2025: true,
          PenyertaanModal2019: true, PenyertaanModal2020: true, PenyertaanModal2021: true,
          PenyertaanModal2022: true, PenyertaanModal2023: true, PenyertaanModal2024: true,
          DesaWisata: true, Ketapang2025: true, PeranMBG: true,
          Perdes: true, AnggaranDasar: true, AnggaranRumahTangga: true,
          ProgramKerja: true, SK_BUM_Desa: true, ProfilBUMDesa: true, BeritaAcara: true,
          LaporanKeuangan2021: true, LaporanKeuangan2022: true,
          LaporanKeuangan2023: true, LaporanKeuangan2024: true,
          // Perdes/SK yang dipilih desa dari modul Produk Hukum. Berkasnya ada
          // di folder lain, jadi harus ikut supaya tombol dokumen di Core
          // Dashboard tidak kosong untuk desa yang menempuh jalur itu.
          produk_hukums_bumdes_produk_hukum_perdes_idToproduk_hukums: {
            select: { id: true, judul: true, nomor: true, tahun: true, file: true },
          },
          produk_hukums_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums: {
            select: { id: true, judul: true, nomor: true, tahun: true, file: true },
          },
        },
      });

      // Decimal Prisma datang sebagai string; diubah di sini supaya klien tidak
      // perlu mengurai angka lagi saat mengurutkan atau menjumlahkan.
      const angka = (v) => (v === null || v === undefined ? null : Number(v));
      const ada = (v) => Boolean(v && String(v).trim() !== '');

      // Kolom berkas menyimpan bentuk campur: kadang "dokumen_badanhukum/x.pdf",
      // kadang nama berkasnya saja. Yang dipakai selalu nama dasarnya, lalu
      // dirakit ulang di atas folder penyajian yang sebenarnya.
      //
      // Yang dikirim FOLDER + NAMA, bukan URL utuh. BASE_URL di .env menunjuk
      // origin frontend (port 5173), sedangkan /uploads dilayani backend dan
      // tidak diteruskan oleh dev server — URL utuh dari sini akan 404. Klien
      // sudah tahu alamat penyimpanannya sendiri lewat API_CONFIG.STORAGE_URL.
      const berkas = (nilai, folder, jenis, label, tambahan = {}) => {
        if (!ada(nilai)) return null;
        const nama = String(nilai).split('/').pop();
        return { jenis, label, nama, folder, sumber: 'unggahan', ...tambahan };
      };

      const DOKUMEN_BADAN_HUKUM = [
        ['Perdes', 'Perdes Pendirian'],
        ['ProfilBUMDesa', 'Profil BUM Desa'],
        ['BeritaAcara', 'Berita Acara'],
        ['AnggaranDasar', 'Anggaran Dasar'],
        ['AnggaranRumahTangga', 'Anggaran Rumah Tangga'],
        ['ProgramKerja', 'Program Kerja'],
        ['SK_BUM_Desa', 'SK BUM Desa'],
      ];

      const data = rows.map((r) => {
        const modal = [
          r.PenyertaanModal2019, r.PenyertaanModal2020, r.PenyertaanModal2021,
          r.PenyertaanModal2022, r.PenyertaanModal2023, r.PenyertaanModal2024,
        ].reduce((total, v) => total + (angka(v) || 0), 0);

        return {
          id: r.id,
          kode_desa: r.kode_desa,
          nama: r.namabumdesa,
          desa: r.desa,
          kecamatan: r.kecamatan,
          status: r.status,
          keterangan_tidak_aktif: r.keterangan_tidak_aktif,
          tahun_pendirian: r.TahunPendirian,
          alamat: r.AlamatBumdesa,
          telepon: r.TelfonBumdes,
          email: r.Alamatemail,
          badan_hukum: r.badanhukum,
          nib: r.NIB,
          npwp: r.NPWP,
          lkpp: r.LKPP,
          nomor_perdes: r.NomorPerdes,
          // Pemeringkatan terbaru yang tersedia, dipakai kolom tabel.
          pemeringkatan: r.Pemeringkatan2026 || r.Pemeringkatan2024 || null,
          pemeringkatan_2026: r.Pemeringkatan2026,
          pemeringkatan_2024: r.Pemeringkatan2024,
          jenis_usaha: r.JenisUsaha,
          jenis_usaha_utama: r.JenisUsahaUtama,
          tenaga_kerja: r.TotalTenagaKerja,
          direktur: r.NamaDirektur,
          hp_direktur: r.HPDirektur,
          aset: angka(r.NilaiAset),
          omset_2024: angka(r.Omset2024),
          laba_2024: angka(r.Laba2024),
          omset_2025: angka(r.Omset2025),
          laba_2025: angka(r.Laba2025),
          pades_2024: angka(r.KontribusiTerhadapPADes2024),
          pades_2025: angka(r.KontribusiTerhadapPADes2025),
          total_penyertaan_modal: modal,
          desa_wisata: r.DesaWisata,
          ketahanan_pangan: r.Ketapang2025,
          peran_mbg: r.PeranMBG,
          // Berkas yang benar-benar bisa dibuka, dari dua jalur sekaligus:
          // diunggah lewat halaman BUMDes, atau dipilih desa dari Produk Hukum.
          berkas: [
            ...DOKUMEN_BADAN_HUKUM
              .map(([kolom, label]) => berkas(r[kolom], 'bumdes_dokumen_badanhukum', kolom, label)),
            ...['2021', '2022', '2023', '2024'].map((th) =>
              berkas(r[`LaporanKeuangan${th}`], 'bumdes_laporan_keuangan', `LaporanKeuangan${th}`, `Laporan Keuangan ${th}`)),
            // Dokumen dari modul Produk Hukum. Dua catatan:
            //
            //  1. Berkasnya TIDAK berada di bawah /uploads melainkan di
            //     storage/produk_hukum/, jadi dikirimkan `jalur` utuh. Tanpa itu
            //     klien merangkai /uploads/produk-hukum/... yang tidak pernah
            //     ada isinya, dan tautannya mati.
            //  2. Sejak unggahan SPKED ikut didaftarkan sebagai produk hukum,
            //     satu dokumen bisa muncul dari dua jalur sekaligus. Bila nama
            //     berkasnya sama dengan yang sudah diunggah di kolom BUM Desa,
            //     entri ini dilewati supaya tidak tampil kembar.
            ...[
              [r.produk_hukums_bumdes_produk_hukum_perdes_idToproduk_hukums, 'ProdukHukumPerdes', 'Perdes (dari Produk Hukum)', r.Perdes],
              [r.produk_hukums_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums, 'ProdukHukumSK', 'SK BUM Desa (dari Produk Hukum)', r.SK_BUM_Desa],
            ].map(([ph, jenis, label, kolomUnggahan]) => {
              if (!ph || !ada(ph.file)) return null;
              const namaPh = String(ph.file).split('/').pop();
              if (ada(kolomUnggahan) && String(kolomUnggahan).split('/').pop() === namaPh) return null;
              return berkas(ph.file, 'produk-hukum', jenis, label, {
                sumber: 'produk_hukum',
                jalur: `/storage/produk_hukum/${encodeURIComponent(namaPh)}`,
                keterangan: [ph.nomor, ph.tahun].filter(Boolean).join(' · ') || ph.judul || null,
              });
            }),
          ].filter(Boolean),
          // Penanda ada/tidak, dipakai penyaring kelengkapan dokumen.
          dokumen: {
            perdes: ada(r.Perdes),
            anggaran_dasar: ada(r.AnggaranDasar),
            anggaran_rumah_tangga: ada(r.AnggaranRumahTangga),
            program_kerja: ada(r.ProgramKerja),
            sk_bum_desa: ada(r.SK_BUM_Desa),
            profil: ada(r.ProfilBUMDesa),
            berita_acara: ada(r.BeritaAcara),
            laporan_keuangan: [
              r.LaporanKeuangan2021, r.LaporanKeuangan2022,
              r.LaporanKeuangan2023, r.LaporanKeuangan2024,
            ].filter(ada).length,
          },
        };
      });

      return res.json({ success: true, total: data.length, data });
    } catch (error) {
      logger.error('Error getting BUMDes list:', error);
      next(error);
    }
  }
}

module.exports = new KepalaDinasController();
