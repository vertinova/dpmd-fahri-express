const prisma = require('../config/prisma');
const externalApiService = require('../services/externalApiProxy.service');
const crypto = require('crypto');

const CORE_DASHBOARD_API_KEY_ENV = 'CORE_DASHBOARD_API_KEY';

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const safeCount = async (model, args = {}) => {
  try {
    return await prisma[model].count(args);
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to count ${model}:`, error.message);
    return 0;
  }
};

const safeAggregate = async (model, args = {}) => {
  try {
    return await prisma[model].aggregate(args);
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to aggregate ${model}:`, error.message);
    return {};
  }
};

const safeGroupBy = async (model, args = {}) => {
  try {
    return await prisma[model].groupBy(args);
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to group ${model}:`, error.message);
    return [];
  }
};

const timingSafeEquals = (actual, expected) => {
  if (!actual || !expected) return false;

  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));

  if (actualBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const isUnsafeConfiguredApiKey = (apiKey) => {
  if (!apiKey || apiKey.length < 32) return true;

  const normalized = apiKey.toLowerCase();
  return (
    normalized.includes('change-this') ||
    normalized.includes('change_to') ||
    normalized.includes('replace-with') ||
    normalized.includes('replace_with') ||
    normalized.includes('your_api') ||
    normalized.includes('password') ||
    normalized.includes('secret')
  );
};

const getRequestApiKey = (req) => {
  const authorization = req.get('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return (
    req.get('x-api-key') ||
    req.get('x-core-dashboard-key') ||
    (bearerMatch ? bearerMatch[1] : '')
  );
};

const validateCoreDashboardAccess = (req, res) => {
  const configuredApiKey = process.env[CORE_DASHBOARD_API_KEY_ENV];

  if (isUnsafeConfiguredApiKey(configuredApiKey)) {
    console.error(`[PublicDashboard] ${CORE_DASHBOARD_API_KEY_ENV} is not configured with a safe value`);
    res.status(503).json({
      success: false,
      message: 'Core Dashboard API belum dikonfigurasi'
    });
    return false;
  }

  if (!timingSafeEquals(getRequestApiKey(req), configuredApiKey)) {
    res.set('WWW-Authenticate', 'Bearer realm="CoreDashboard"');
    res.status(401).json({
      success: false,
      message: 'API key tidak valid'
    });
    return false;
  }

  return true;
};

const normalizeExternalDashboard = (externalDashboard) => {
  const emptyGroup = {
    total: 0,
    gender: [],
    pendidikan: [],
    usia: []
  };

  if (!externalDashboard || typeof externalDashboard !== 'object') {
    return {
      available: false,
      kepala_desa: emptyGroup,
      perangkat_desa: emptyGroup,
      bpd: emptyGroup
    };
  }

  const sumChart = (items) => Array.isArray(items)
    ? items.reduce((total, item) => total + toNumber(Array.isArray(item.y) ? item.y[0] : item.y), 0)
    : 0;

  return {
    available: true,
    kepala_desa: {
      total: sumChart(externalDashboard.kepala_desa_gender),
      gender: externalDashboard.kepala_desa_gender || [],
      pendidikan: externalDashboard.kepala_desa_pendidikan || [],
      usia: externalDashboard.kepala_desa_usia || []
    },
    perangkat_desa: {
      total: sumChart(externalDashboard.perangkat_desa_gender),
      gender: externalDashboard.perangkat_desa_gender || [],
      pendidikan: externalDashboard.perangkat_desa_pendidikan || [],
      usia: externalDashboard.perangkat_desa_usia || []
    },
    bpd: {
      total: sumChart(externalDashboard.bpd_gender),
      gender: externalDashboard.bpd_gender || [],
      pendidikan: externalDashboard.bpd_pendidikan || [],
      usia: externalDashboard.bpd_usia || []
    }
  };
};

const buildPublicDashboardPayload = async () => {
  const now = new Date();

  const [
    totalKecamatan,
    totalDesa,
    totalKelurahan,
    totalPegawai,
    totalProfilDesa,
    totalProdukHukum,
    totalAparaturLokal,
    totalBumdes,
    bumdesAktif,
    bankeuProposalTotal,
    bankeuSubmittedKecamatan,
    bankeuSubmittedDpmd,
    bankeuApprovedDpmd,
    kegiatanTotal,
    kegiatanUpcoming30Days,
    kelembagaanCounts,
    bumdesFinancials,
    bankeuFinancials,
    produkHukumByJenis,
    externalDashboardResult
  ] = await Promise.all([
    safeCount('kecamatans'),
    safeCount('desas', { where: { status_pemerintahan: 'desa' } }),
    safeCount('desas', { where: { status_pemerintahan: 'kelurahan' } }),
    safeCount('pegawai'),
    safeCount('profil_desas'),
    safeCount('produk_hukums'),
    safeCount('aparatur_desa', { where: { status: 'Aktif' } }),
    safeCount('bumdes'),
    safeCount('bumdes', { where: { status: 'aktif' } }),
    safeCount('bankeu_proposals'),
    safeCount('bankeu_proposals', { where: { submitted_to_kecamatan: true } }),
    safeCount('bankeu_proposals', { where: { submitted_to_dpmd: true } }),
    safeCount('bankeu_proposals', { where: { dpmd_status: 'approved' } }),
    safeCount('kegiatan'),
    safeCount('kegiatan', {
      where: {
        tanggal_mulai: {
          gte: now,
          lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        }
      }
    }),
    Promise.all([
      safeCount('rws'),
      safeCount('rts'),
      safeCount('lpms'),
      safeCount('pkks'),
      safeCount('posyandus'),
      safeCount('karang_tarunas'),
      safeCount('satlinmas'),
      safeCount('lembaga_lainnyas')
    ]),
    safeAggregate('bumdes', {
      _sum: {
        NilaiAset: true,
        Omset2024: true,
        Laba2024: true,
        TotalTenagaKerja: true
      }
    }),
    safeAggregate('bankeu_proposals', {
      _sum: {
        anggaran_usulan: true
      }
    }),
    safeGroupBy('produk_hukums', {
      by: ['singkatan_jenis'],
      _count: { _all: true },
      orderBy: { _count: { singkatan_jenis: 'desc' } },
      take: 10
    }),
    externalApiService.fetchDashboardStats()
      .then((data) => ({ success: true, data }))
      .catch((error) => ({ success: false, error: error.message }))
  ]);

  const [
    totalRw,
    totalRt,
    totalLpm,
    totalPkk,
    totalPosyandu,
    totalKarangTaruna,
    totalSatlinmas,
    totalLembagaLainnya
  ] = kelembagaanCounts;

  const totalKelembagaan =
    totalRw +
    totalRt +
    totalLpm +
    totalPkk +
    totalPosyandu +
    totalKarangTaruna +
    totalSatlinmas +
    totalLembagaLainnya;

  const externalAparatur = normalizeExternalDashboard(
    externalDashboardResult.success ? externalDashboardResult.data : null
  );
  const totalAparaturExternal =
    externalAparatur.kepala_desa.total +
    externalAparatur.perangkat_desa.total +
    externalAparatur.bpd.total;

  return {
    meta: {
      generated_at: now.toISOString(),
      timezone: 'Asia/Jakarta',
      version: '1.0',
      access: 'protected_api_key',
      auth_required: true,
      realtime: true,
      cache: 'no-store'
    },
    endpoints: {
      canonical: '/api/public/core-dashboard',
      alias: '/api/public/dashboard'
    },
    summary: {
      total_kecamatan: totalKecamatan,
      total_desa: totalDesa,
      total_kelurahan: totalKelurahan,
      total_pegawai: totalPegawai,
      total_bumdes: totalBumdes,
      total_aparatur_lokal: totalAparaturLokal,
      total_aparatur_external: totalAparaturExternal,
      total_kelembagaan: totalKelembagaan,
      total_produk_hukum: totalProdukHukum,
      total_profil_desa: totalProfilDesa,
      total_bankeu_proposal: bankeuProposalTotal,
      total_kegiatan: kegiatanTotal
    },
    modules: {
      wilayah: {
        total_kecamatan: totalKecamatan,
        total_desa: totalDesa,
        total_kelurahan: totalKelurahan
      },
      aparatur_desa: {
        source: externalAparatur.available ? 'external_dapur_desa' : 'local_database',
        external_available: externalAparatur.available,
        local_total_aktif: totalAparaturLokal,
        external_total: totalAparaturExternal,
        kepala_desa: externalAparatur.kepala_desa,
        perangkat_desa: externalAparatur.perangkat_desa,
        bpd: externalAparatur.bpd
      },
      bumdes: {
        total: totalBumdes,
        aktif: bumdesAktif,
        tidak_aktif: Math.max(totalBumdes - bumdesAktif, 0),
        total_aset: toNumber(bumdesFinancials._sum?.NilaiAset),
        total_omzet_2024: toNumber(bumdesFinancials._sum?.Omset2024),
        total_laba_2024: toNumber(bumdesFinancials._sum?.Laba2024),
        total_tenaga_kerja: toNumber(bumdesFinancials._sum?.TotalTenagaKerja)
      },
      kelembagaan: {
        total: totalKelembagaan,
        rw: totalRw,
        rt: totalRt,
        lpm: totalLpm,
        pkk: totalPkk,
        posyandu: totalPosyandu,
        karang_taruna: totalKarangTaruna,
        satlinmas: totalSatlinmas,
        lembaga_lainnya: totalLembagaLainnya
      },
      bankeu: {
        total_proposal: bankeuProposalTotal,
        submitted_to_kecamatan: bankeuSubmittedKecamatan,
        submitted_to_dpmd: bankeuSubmittedDpmd,
        approved_by_dpmd: bankeuApprovedDpmd,
        total_anggaran_usulan: toNumber(bankeuFinancials._sum?.anggaran_usulan)
      },
      produk_hukum: {
        total: totalProdukHukum,
        by_jenis: produkHukumByJenis.map((item) => ({
          jenis: item.singkatan_jenis || 'Tidak Diketahui',
          total: toNumber(item._count?._all)
        }))
      },
      profil_desa: {
        total_terisi: totalProfilDesa,
        total_desa: totalDesa,
        persentase_terisi: totalDesa > 0 ? Number(((totalProfilDesa / totalDesa) * 100).toFixed(2)) : 0
      },
      perjadin: {
        total_kegiatan: kegiatanTotal,
        upcoming_30_days: kegiatanUpcoming30Days
      }
    },
    sources: {
      local_database: true,
      external_dapur_desa: {
        available: externalDashboardResult.success,
        status: externalDashboardResult.success ? 'available' : 'unavailable'
      }
    }
  };
};

const getCoreDashboard = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (!validateCoreDashboardAccess(req, res)) {
      return;
    }

    const data = await buildPublicDashboardPayload();

    res.status(200).json({
      success: true,
      message: 'Data Core Dashboard publik berhasil diambil',
      data
    });
  } catch (error) {
    console.error('Error fetching public core dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data Core Dashboard publik',
      error: error.message
    });
  }
};

module.exports = {
  getCoreDashboard
};
