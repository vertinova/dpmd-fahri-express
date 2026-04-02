// src/controllers/dashboard/desa.dashboard.controller.js
const fs = require('fs');
const path = require('path');
const prisma = require('../../config/prisma');
const Berita = require('../../models/Berita');

/**
 * Validate desa access from request
 */
function validateDesaAccess(req, res) {
  const user = req.user;
  
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return null;
  }

  if (user.role !== 'desa') {
    res.status(403).json({ success: false, message: 'Akses ditolak. Hanya untuk user desa.' });
    return null;
  }

  // Check both desa_id (from middleware) and desaId (camelCase)
  const desaId = user.desa_id ? BigInt(user.desa_id) : (user.desaId ? BigInt(user.desaId) : null);
  
  if (!desaId) {
    res.status(400).json({ success: false, message: 'Desa ID tidak ditemukan' });
    return null;
  }

  return desaId;
}

/**
 * Helper function to read and parse JSON file from public folder
 */
function readPublicJsonFile(filename) {
  try {
    const filePath = path.join(__dirname, '../../../public', filename);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return [];
  }
}

/**
 * Helper function to clean currency string to number
 */
function cleanCurrency(value) {
  if (!value || value === "0") return 0;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }
  
  // Pastikan value adalah string sebelum .replace()
  const str = String(value);
  // Format in JSON uses comma as thousand separator
  // Example: "478,327,869" should become 478327869
  // Remove all commas and dots
  const cleaned = str.replace(/[,.]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Helper function to format number to IDR currency
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(value);
}

function isFilled(value) {
  return value !== null && value !== undefined && value !== '';
}

function formatText(value) {
  if (!value) return null;

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateProfileCompletion(profile) {
  const requiredFields = [
    'klasifikasi_desa',
    'status_desa',
    'tipologi_desa',
    'jumlah_penduduk',
    'luas_wilayah',
    'alamat_kantor',
    'no_telp',
    'email'
  ];

  const filled = requiredFields.filter(field => isFilled(profile?.[field])).length;
  const total = requiredFields.length;

  return {
    filled,
    total,
    percentage: total > 0 ? Math.round((filled / total) * 100) : 0
  };
}

function buildBankeuSummary(proposals) {
  const years = [...new Set(
    proposals
      .map(proposal => proposal.tahun_anggaran)
      .filter(Boolean)
  )].sort((left, right) => right - left);

  const totalAnggaranUsulan = proposals.reduce(
    (total, proposal) => total + cleanCurrency(proposal.anggaran_usulan),
    0
  );

  const approved = proposals.filter(
    proposal => proposal.dpmd_status === 'approved' || proposal.status === 'verified'
  ).length;

  const needsAction = proposals.filter(proposal => (
    proposal.status === 'rejected' ||
    proposal.status === 'revision' ||
    proposal.dinas_status === 'rejected' ||
    proposal.dinas_status === 'revision' ||
    proposal.kecamatan_status === 'rejected' ||
    proposal.kecamatan_status === 'revision' ||
    proposal.dpmd_status === 'rejected' ||
    proposal.dpmd_status === 'revision'
  )).length;

  const inProgress = proposals.filter(proposal => {
    const hasWorkflow = Boolean(
      proposal.submitted_to_dinas_at ||
      proposal.dinas_status ||
      proposal.kecamatan_status ||
      proposal.dpmd_status
    );

    const isApproved = proposal.dpmd_status === 'approved' || proposal.status === 'verified';
    const isNeedsAction = (
      proposal.status === 'rejected' ||
      proposal.status === 'revision' ||
      proposal.dinas_status === 'rejected' ||
      proposal.dinas_status === 'revision' ||
      proposal.kecamatan_status === 'rejected' ||
      proposal.kecamatan_status === 'revision' ||
      proposal.dpmd_status === 'rejected' ||
      proposal.dpmd_status === 'revision'
    );

    return hasWorkflow && !isApproved && !isNeedsAction;
  }).length;

  const drafts = proposals.filter(proposal => (
    proposal.status === 'pending' &&
    !proposal.submitted_to_dinas_at &&
    !proposal.dinas_status &&
    !proposal.kecamatan_status &&
    !proposal.dpmd_status
  )).length;

  return {
    total_proposals: proposals.length,
    approved,
    in_progress: inProgress,
    needs_action: needsAction,
    drafts,
    years,
    latest_year: years[0] || null,
    total_anggaran_usulan: totalAnggaranUsulan,
    total_anggaran_usulan_formatted: formatCurrency(totalAnggaranUsulan)
  };
}

async function getLatestBerita(limit = 4) {
  try {
    const latestBerita = await Berita.findAll({
      where: { status: 'published' },
      limit,
      order: [['tanggal_publish', 'DESC'], ['created_at', 'DESC']],
      attributes: [
        'id_berita',
        'slug',
        'judul',
        'ringkasan',
        'kategori',
        'views',
        'tanggal_publish',
        'created_at'
      ]
    });

    return latestBerita.map(item => item.toJSON());
  } catch (error) {
    console.error('Error fetching latest berita:', error);
    return [];
  }
}

/**
 * Get dashboard summary for specific desa
 * GET /api/desa/dashboard/summary
 */
async function getDesaDashboardSummary(req, res) {
  try {
    const desaId = validateDesaAccess(req, res);
    if (!desaId) return;
    const desaIdNumber = Number(desaId);

    // 1. Get desa info
    const desa = await prisma.desas.findUnique({
      where: { id: desaId },
      select: {
        id: true,
        nama: true,
        status_pemerintahan: true,
        kecamatans: {
          select: {
            id: true,
            nama: true
          }
        }
      }
    });

    if (!desa) {
      return res.status(404).json({
        success: false,
        message: 'Data desa tidak ditemukan'
      });
    }

    // 2. Get kelembagaan summary
    const [
      totalRW,
      totalRT,
      totalPosyandu,
      karangTaruna,
      lpm,
      satlinmas,
      pkk,
      profilDesa,
      aparaturDesa,
      totalProdukHukum,
      produkHukumBerlaku,
      produkHukumDicabut,
      bumdes,
      bankeuProposals,
      beritaTerbaru
    ] = await Promise.all([
      prisma.rws.count({ where: { desa_id: desaId } }),
      prisma.rts.count({ where: { desa_id: desaId } }),
      prisma.posyandus.count({ where: { desa_id: desaId } }),
      prisma.karang_tarunas.findFirst({ where: { desa_id: desaId } }),
      prisma.lpms.findFirst({ where: { desa_id: desaId } }),
      prisma.satlinmas.findFirst({ where: { desa_id: desaId } }),
      prisma.pkks.findFirst({ where: { desa_id: desaId } }),
      prisma.profil_desas.findUnique({
        where: { desa_id: desaId },
        select: {
          klasifikasi_desa: true,
          status_desa: true,
          tipologi_desa: true,
          jumlah_penduduk: true,
          luas_wilayah: true,
          alamat_kantor: true,
          no_telp: true,
          email: true,
          foto_kantor_desa_path: true
        }
      }),
      prisma.aparatur_desa.findMany({
        where: { desa_id: desaIdNumber },
        select: {
          status: true
        }
      }),
      prisma.produk_hukums.count({ where: { desa_id: desaId } }),
      prisma.produk_hukums.count({
        where: {
          desa_id: desaId,
          status_peraturan: 'berlaku'
        }
      }),
      prisma.produk_hukums.count({
        where: {
          desa_id: desaId,
          status_peraturan: 'dicabut'
        }
      }),
      prisma.bumdes.findFirst({
        where: { desa_id: desaIdNumber },
        select: {
          namabumdesa: true,
          status: true,
          badanhukum: true,
          JenisUsaha: true,
          TotalTenagaKerja: true,
          NilaiAset: true
        }
      }),
      prisma.bankeu_proposals.findMany({
        where: { desa_id: desaIdNumber },
        select: {
          tahun_anggaran: true,
          anggaran_usulan: true,
          status: true,
          dinas_status: true,
          kecamatan_status: true,
          dpmd_status: true,
          submitted_to_dinas_at: true
        }
      }),
      getLatestBerita(4)
    ]);

    const profilCompletion = calculateProfileCompletion(profilDesa);
    const aparaturAktif = aparaturDesa.filter(item => item.status === 'Aktif').length;
    const kelembagaanStrategis = [karangTaruna, lpm, pkk, satlinmas].filter(Boolean).length;
    const bankeuSummary = buildBankeuSummary(bankeuProposals);
    const bumdesAset = cleanCurrency(bumdes?.NilaiAset);

    // 3. Read financial data from JSON files
    // ADD 2025
    const add2025Data = readPublicJsonFile('add2025.json');
    
    // BHPRD - 3 tahap
    const bhprdTahap1Data = readPublicJsonFile('bhprd-tahap1.json');
    const bhprdTahap2Data = readPublicJsonFile('bhprd-tahap2.json');
    const bhprdTahap3Data = readPublicJsonFile('bhprd-tahap3.json');
    
    // DD - 4 file (earmarked dan nonearmarked masing-masing 2 tahap)
    const ddEarmarkedTahap1Data = readPublicJsonFile('dd-earmarked-tahap1.json');
    const ddEarmarkedTahap2Data = readPublicJsonFile('dd-earmarked-tahap2.json');
    const ddNonearmarkedTahap1Data = readPublicJsonFile('dd-nonearmarked-tahap1.json');
    const ddNonearmarkedTahap2Data = readPublicJsonFile('dd-nonearmarked-tahap2.json');
    
    // Bankeu - 2 tahap
    const bankeuTahap1Data = readPublicJsonFile('bankeu-tahap1.json');
    const bankeuTahap2Data = readPublicJsonFile('bankeu-tahap2.json');

    // Normalize desa name for comparison (uppercase and trim)
    const desaNama = desa.nama.toUpperCase().trim();
    const kecamatanNama = desa.kecamatans?.nama.toUpperCase().trim();

    // 4. Find data for this desa from JSON files
    const findDesaData = (dataArray) => {
      return dataArray.find(item => 
        item.desa?.toUpperCase().trim() === desaNama && 
        item.kecamatan?.toUpperCase().trim() === kecamatanNama
      );
    };

    // Find ADD data
    const addData = findDesaData(add2025Data);
    
    // Find BHPRD data per tahap
    const bhprdTahap1 = findDesaData(bhprdTahap1Data);
    const bhprdTahap2 = findDesaData(bhprdTahap2Data);
    const bhprdTahap3 = findDesaData(bhprdTahap3Data);
    
    // Find DD data per tahap dan jenis
    const ddEarmarkedT1 = findDesaData(ddEarmarkedTahap1Data);
    const ddEarmarkedT2 = findDesaData(ddEarmarkedTahap2Data);
    const ddNonearmarkedT1 = findDesaData(ddNonearmarkedTahap1Data);
    const ddNonearmarkedT2 = findDesaData(ddNonearmarkedTahap2Data);
    
    // Find Bankeu data per tahap
    const bankeuTahap1 = findDesaData(bankeuTahap1Data);
    const bankeuTahap2 = findDesaData(bankeuTahap2Data);

    // 5. Prepare financial data response
    const financialData = {
      add: {
        status: addData?.sts || 'Data tidak tersedia',
        realisasi: addData ? cleanCurrency(addData.Realisasi) : 0,
        realisasiFormatted: addData ? addData.Realisasi : '0',
        hasData: !!addData
      },
      bhprd: {
        tahap1: {
          status: bhprdTahap1?.sts || 'Data tidak tersedia',
          realisasi: bhprdTahap1 ? cleanCurrency(bhprdTahap1.Realisasi) : 0,
          realisasiFormatted: bhprdTahap1 ? bhprdTahap1.Realisasi : '0',
          hasData: !!bhprdTahap1
        },
        tahap2: {
          status: bhprdTahap2?.sts || 'Data tidak tersedia',
          realisasi: bhprdTahap2 ? cleanCurrency(bhprdTahap2.Realisasi) : 0,
          realisasiFormatted: bhprdTahap2 ? bhprdTahap2.Realisasi : '0',
          hasData: !!bhprdTahap2
        },
        tahap3: {
          status: bhprdTahap3?.sts || 'Data tidak tersedia',
          realisasi: bhprdTahap3 ? cleanCurrency(bhprdTahap3.Realisasi) : 0,
          realisasiFormatted: bhprdTahap3 ? bhprdTahap3.Realisasi : '0',
          hasData: !!bhprdTahap3
        },
        total: (bhprdTahap1 ? cleanCurrency(bhprdTahap1.Realisasi) : 0) +
               (bhprdTahap2 ? cleanCurrency(bhprdTahap2.Realisasi) : 0) +
               (bhprdTahap3 ? cleanCurrency(bhprdTahap3.Realisasi) : 0),
        totalFormatted: formatCurrency(
          (bhprdTahap1 ? cleanCurrency(bhprdTahap1.Realisasi) : 0) +
          (bhprdTahap2 ? cleanCurrency(bhprdTahap2.Realisasi) : 0) +
          (bhprdTahap3 ? cleanCurrency(bhprdTahap3.Realisasi) : 0)
        )
      },
      dd: {
        earmarked: {
          tahap1: {
            status: ddEarmarkedT1?.sts || 'Data tidak tersedia',
            realisasi: ddEarmarkedT1 ? cleanCurrency(ddEarmarkedT1.Realisasi) : 0,
            realisasiFormatted: ddEarmarkedT1 ? ddEarmarkedT1.Realisasi : '0',
            hasData: !!ddEarmarkedT1
          },
          tahap2: {
            status: ddEarmarkedT2?.sts || 'Data tidak tersedia',
            realisasi: ddEarmarkedT2 ? cleanCurrency(ddEarmarkedT2.Realisasi) : 0,
            realisasiFormatted: ddEarmarkedT2 ? ddEarmarkedT2.Realisasi : '0',
            hasData: !!ddEarmarkedT2
          },
          total: (ddEarmarkedT1 ? cleanCurrency(ddEarmarkedT1.Realisasi) : 0) +
                 (ddEarmarkedT2 ? cleanCurrency(ddEarmarkedT2.Realisasi) : 0)
        },
        nonearmarked: {
          tahap1: {
            status: ddNonearmarkedT1?.sts || 'Data tidak tersedia',
            realisasi: ddNonearmarkedT1 ? cleanCurrency(ddNonearmarkedT1.Realisasi) : 0,
            realisasiFormatted: ddNonearmarkedT1 ? ddNonearmarkedT1.Realisasi : '0',
            hasData: !!ddNonearmarkedT1
          },
          tahap2: {
            status: ddNonearmarkedT2?.sts || 'Data tidak tersedia',
            realisasi: ddNonearmarkedT2 ? cleanCurrency(ddNonearmarkedT2.Realisasi) : 0,
            realisasiFormatted: ddNonearmarkedT2 ? ddNonearmarkedT2.Realisasi : '0',
            hasData: !!ddNonearmarkedT2
          },
          total: (ddNonearmarkedT1 ? cleanCurrency(ddNonearmarkedT1.Realisasi) : 0) +
                 (ddNonearmarkedT2 ? cleanCurrency(ddNonearmarkedT2.Realisasi) : 0)
        },
        total: (ddEarmarkedT1 ? cleanCurrency(ddEarmarkedT1.Realisasi) : 0) +
               (ddEarmarkedT2 ? cleanCurrency(ddEarmarkedT2.Realisasi) : 0) +
               (ddNonearmarkedT1 ? cleanCurrency(ddNonearmarkedT1.Realisasi) : 0) +
               (ddNonearmarkedT2 ? cleanCurrency(ddNonearmarkedT2.Realisasi) : 0),
        totalFormatted: formatCurrency(
          (ddEarmarkedT1 ? cleanCurrency(ddEarmarkedT1.Realisasi) : 0) +
          (ddEarmarkedT2 ? cleanCurrency(ddEarmarkedT2.Realisasi) : 0) +
          (ddNonearmarkedT1 ? cleanCurrency(ddNonearmarkedT1.Realisasi) : 0) +
          (ddNonearmarkedT2 ? cleanCurrency(ddNonearmarkedT2.Realisasi) : 0)
        )
      },
      bankeu: {
        tahap1: {
          status: bankeuTahap1?.sts || 'Data tidak tersedia',
          realisasi: bankeuTahap1 ? cleanCurrency(bankeuTahap1.Realisasi) : 0,
          realisasiFormatted: bankeuTahap1 ? bankeuTahap1.Realisasi : '0',
          hasData: !!bankeuTahap1
        },
        tahap2: {
          status: bankeuTahap2?.sts || 'Data tidak tersedia',
          realisasi: bankeuTahap2 ? cleanCurrency(bankeuTahap2.Realisasi) : 0,
          realisasiFormatted: bankeuTahap2 ? bankeuTahap2.Realisasi : '0',
          hasData: !!bankeuTahap2
        },
        total: (bankeuTahap1 ? cleanCurrency(bankeuTahap1.Realisasi) : 0) +
               (bankeuTahap2 ? cleanCurrency(bankeuTahap2.Realisasi) : 0),
        totalFormatted: formatCurrency(
          (bankeuTahap1 ? cleanCurrency(bankeuTahap1.Realisasi) : 0) +
          (bankeuTahap2 ? cleanCurrency(bankeuTahap2.Realisasi) : 0)
        )
      }
    };

    // 6. Calculate total financial
    const totalRealisasi = 
      financialData.add.realisasi +
      financialData.bhprd.total +
      financialData.dd.total +
      financialData.bankeu.total;

    // 7. Prepare response
    res.json({
      success: true,
      data: {
        desa: {
          id: desa.id.toString(),
          nama: desa.nama,
          status_pemerintahan: desa.status_pemerintahan,
          kecamatan: desa.kecamatans?.nama || null
        },
        profil: {
          exists: !!profilDesa,
          completion: profilCompletion,
          klasifikasi_desa: formatText(profilDesa?.klasifikasi_desa),
          status_desa: formatText(profilDesa?.status_desa),
          tipologi_desa: formatText(profilDesa?.tipologi_desa),
          jumlah_penduduk: profilDesa?.jumlah_penduduk || 0,
          luas_wilayah: profilDesa?.luas_wilayah || null,
          alamat_kantor: profilDesa?.alamat_kantor || null,
          no_telp: profilDesa?.no_telp || null,
          email: profilDesa?.email || null,
          has_photo: !!profilDesa?.foto_kantor_desa_path
        },
        aparatur: {
          total: aparaturDesa.length,
          aktif: aparaturAktif,
          nonaktif: Math.max(aparaturDesa.length - aparaturAktif, 0)
        },
        produk_hukum: {
          total: totalProdukHukum,
          berlaku: produkHukumBerlaku,
          dicabut: produkHukumDicabut
        },
        bumdes: {
          exists: !!bumdes,
          nama: bumdes?.namabumdesa || null,
          status: formatText(bumdes?.status),
          badan_hukum: formatText(bumdes?.badanhukum),
          jenis_usaha: bumdes?.JenisUsaha || null,
          total_tenaga_kerja: cleanCurrency(bumdes?.TotalTenagaKerja),
          nilai_aset: bumdesAset,
          nilai_aset_formatted: formatCurrency(bumdesAset)
        },
        kelembagaan: {
          rw: totalRW,
          rt: totalRT,
          posyandu: totalPosyandu,
          karang_taruna: karangTaruna ? 1 : 0,
          lpm: lpm ? 1 : 0,
          satlinmas: satlinmas ? 1 : 0,
          pkk: pkk ? 1 : 0,
          lembaga_strategis: kelembagaanStrategis,
          total_lembaga: totalRW + totalRT + totalPosyandu + 
                        (karangTaruna ? 1 : 0) + 
                        (lpm ? 1 : 0) + 
                        (satlinmas ? 1 : 0) + 
                        (pkk ? 1 : 0)
        },
        bankeu: bankeuSummary,
        keuangan: {
          add: financialData.add,
          bhprd: financialData.bhprd,
          dd: financialData.dd,
          bankeu: financialData.bankeu,
          total_realisasi: totalRealisasi,
          total_realisasi_formatted: formatCurrency(totalRealisasi)
        },
        berita: beritaTerbaru
      }
    });

  } catch (error) {
    console.error('Error in getDesaDashboardSummary:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data dashboard',
      error: error.message
    });
  }
}

module.exports = {
  getDesaDashboardSummary
};
