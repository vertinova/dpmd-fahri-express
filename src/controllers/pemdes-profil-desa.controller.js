const prisma = require('../config/prisma');

const PROFILE_COMPLETION_FIELDS = [
  'klasifikasi_desa',
  'status_desa',
  'tipologi_desa',
  'jumlah_penduduk',
  'luas_wilayah',
  'alamat_kantor',
  'no_telp',
  'email',
];

const PROFILE_SIGNAL_FIELDS = [
  ...PROFILE_COMPLETION_FIELDS,
  'sejarah_desa',
  'demografi',
  'potensi_desa',
  'instagram_url',
  'youtube_url',
  'foto_kantor_desa_path',
  'latitude',
  'longitude',
];

const DESA_PROFILE_SELECT = {
  id: true,
  kode: true,
  nama: true,
  status_pemerintahan: true,
  kecamatans: {
    select: {
      id: true,
      nama: true,
    },
  },
  profil_desas: {
    select: {
      id: true,
      klasifikasi_desa: true,
      status_desa: true,
      tipologi_desa: true,
      jumlah_penduduk: true,
      sejarah_desa: true,
      demografi: true,
      potensi_desa: true,
      no_telp: true,
      email: true,
      instagram_url: true,
      youtube_url: true,
      luas_wilayah: true,
      alamat_kantor: true,
      radius_ke_kecamatan: true,
      foto_kantor_desa_path: true,
      latitude: true,
      longitude: true,
      created_at: true,
      updated_at: true,
    },
  },
};

function isFilled(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  return true;
}

function formatLabel(value) {
  if (!isFilled(value)) {
    return 'Belum diisi';
  }

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value) {
  if (!isFilled(value)) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function parseBigIntParam(value) {
  const normalizedValue = String(value || '').trim();

  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  try {
    return BigInt(normalizedValue);
  } catch (error) {
    return null;
  }
}

function calculateProfileCompletion(profile) {
  const filled = PROFILE_COMPLETION_FIELDS.filter((field) => isFilled(profile?.[field])).length;
  const total = PROFILE_COMPLETION_FIELDS.length;
  const percentage = total > 0 ? Math.round((filled / total) * 100) : 0;

  return {
    filled,
    total,
    percentage,
  };
}

function hasAnyProfileContent(profile) {
  return PROFILE_SIGNAL_FIELDS.some((field) => isFilled(profile?.[field]));
}

function getCompletionStatus(profile, completion) {
  if (!hasAnyProfileContent(profile)) {
    return {
      key: 'belum_diisi',
      label: 'Belum diisi',
    };
  }

  if (completion.percentage >= 75) {
    return {
      key: 'lengkap',
      label: 'Lengkap',
    };
  }

  return {
    key: 'perlu_dilengkapi',
    label: 'Perlu dilengkapi',
  };
}

function createSerializedProfile(desa) {
  const profile = desa.profil_desas;
  const completion = calculateProfileCompletion(profile);
  const completionStatus = getCompletionStatus(profile, completion);
  const latitude = toNumber(profile?.latitude);
  const longitude = toNumber(profile?.longitude);

  return {
    desa_id: desa.id.toString(),
    kode_desa: desa.kode,
    nama_desa: desa.nama,
    status_pemerintahan: desa.status_pemerintahan,
    kecamatan: {
      id: desa.kecamatans.id.toString(),
      nama: desa.kecamatans.nama,
    },
    profil_id: profile?.id ? profile.id.toString() : null,
    profil_tersimpan: Boolean(profile),
    profil_terisi: hasAnyProfileContent(profile),
    klasifikasi_desa: profile?.klasifikasi_desa || null,
    klasifikasi_desa_label: formatLabel(profile?.klasifikasi_desa),
    status_desa: profile?.status_desa || null,
    status_desa_label: formatLabel(profile?.status_desa),
    tipologi_desa: profile?.tipologi_desa || null,
    tipologi_desa_label: formatLabel(profile?.tipologi_desa),
    jumlah_penduduk: profile?.jumlah_penduduk || null,
    luas_wilayah: profile?.luas_wilayah || null,
    alamat_kantor: profile?.alamat_kantor || null,
    no_telp: profile?.no_telp || null,
    email: profile?.email || null,
    instagram_url: profile?.instagram_url || null,
    youtube_url: profile?.youtube_url || null,
    radius_ke_kecamatan: profile?.radius_ke_kecamatan || null,
    foto_kantor_desa_path: profile?.foto_kantor_desa_path || null,
    latitude,
    longitude,
    updated_at: profile?.updated_at || null,
    created_at: profile?.created_at || null,
    completion: {
      ...completion,
      status_key: completionStatus.key,
      status_label: completionStatus.label,
    },
    flags: {
      has_contact: isFilled(profile?.no_telp) || isFilled(profile?.email),
      has_coordinates: latitude !== null && longitude !== null,
      has_office_photo: isFilled(profile?.foto_kantor_desa_path),
      has_social_media: isFilled(profile?.instagram_url) || isFilled(profile?.youtube_url),
      has_narratives: ['sejarah_desa', 'demografi', 'potensi_desa'].every((field) => isFilled(profile?.[field])),
    },
  };
}

function createSerializedProfileDetail(desa) {
  const profile = desa.profil_desas;
  const baseProfile = createSerializedProfile(desa);

  return {
    ...baseProfile,
    sejarah_desa: profile?.sejarah_desa || null,
    demografi: profile?.demografi || null,
    potensi_desa: profile?.potensi_desa || null,
    maps_url: baseProfile.flags.has_coordinates
      ? `https://www.google.com/maps?q=${baseProfile.latitude},${baseProfile.longitude}`
      : null,
  };
}

function createFilterOptions(records, valueKey, labelKey) {
  const optionMap = new Map();

  records.forEach((record) => {
    if (!isFilled(record[valueKey])) {
      return;
    }

    optionMap.set(record[valueKey], record[labelKey]);
  });

  return [...optionMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'id'));
}

function filterRecords(records, query) {
  const {
    search,
    kecamatan_id,
    desa_id,
    klasifikasi_desa,
    status_desa,
    tipologi_desa,
    completion_status,
  } = query;

  const searchTerm = normalizeText(search);

  return records.filter((record) => {
    if (kecamatan_id && record.kecamatan.id !== String(kecamatan_id)) {
      return false;
    }

    if (desa_id && record.desa_id !== String(desa_id)) {
      return false;
    }

    if (klasifikasi_desa && normalizeText(record.klasifikasi_desa) !== normalizeText(klasifikasi_desa)) {
      return false;
    }

    if (status_desa && normalizeText(record.status_desa) !== normalizeText(status_desa)) {
      return false;
    }

    if (tipologi_desa && normalizeText(record.tipologi_desa) !== normalizeText(tipologi_desa)) {
      return false;
    }

    if (completion_status && record.completion.status_key !== completion_status) {
      return false;
    }

    if (!searchTerm) {
      return true;
    }

    const searchableFields = [
      record.nama_desa,
      record.kode_desa,
      record.kecamatan.nama,
      record.klasifikasi_desa_label,
      record.status_desa_label,
      record.tipologi_desa_label,
      record.no_telp,
      record.email,
    ];

    return searchableFields.some((value) => normalizeText(value).includes(searchTerm));
  });
}

async function getProfileRecords(query = {}) {
  const where = {};

  if (query.kecamatan_id) {
    where.kecamatan_id = BigInt(query.kecamatan_id);
  }

  if (query.desa_id) {
    where.id = BigInt(query.desa_id);
  }

  const desaRows = await prisma.desas.findMany({
    where,
    select: DESA_PROFILE_SELECT,
    orderBy: [
      { kecamatans: { nama: 'asc' } },
      { nama: 'asc' },
    ],
  });

  const records = desaRows.map(createSerializedProfile);
  return filterRecords(records, query);
}

async function getProfileRecordById(desaId) {
  return prisma.desas.findUnique({
    where: {
      id: desaId,
    },
    select: DESA_PROFILE_SELECT,
  });
}

function buildStats(records) {
  const totalDesa = records.length;
  const profilTersimpan = records.filter((record) => record.profil_tersimpan).length;
  const profilTerisi = records.filter((record) => record.profil_terisi).length;
  const profilLengkap = records.filter((record) => record.completion.status_key === 'lengkap').length;
  const profilPerluDilengkapi = records.filter((record) => record.completion.status_key === 'perlu_dilengkapi').length;
  const profilBelumDiisi = records.filter((record) => record.completion.status_key === 'belum_diisi').length;
  const totalPendudukTerlapor = records.reduce((total, record) => total + (record.jumlah_penduduk || 0), 0);
  const rataRataKelengkapan = totalDesa > 0
    ? Math.round(records.reduce((total, record) => total + record.completion.percentage, 0) / totalDesa)
    : 0;

  const byKecamatan = new Map();
  records.forEach((record) => {
    const key = record.kecamatan.id;
    const existing = byKecamatan.get(key) || {
      id: record.kecamatan.id,
      name: record.kecamatan.nama,
      total_desa: 0,
      total_completion: 0,
      lengkap: 0,
      belum_diisi: 0,
    };

    existing.total_desa += 1;
    existing.total_completion += record.completion.percentage;
    if (record.completion.status_key === 'lengkap') {
      existing.lengkap += 1;
    }
    if (record.completion.status_key === 'belum_diisi') {
      existing.belum_diisi += 1;
    }

    byKecamatan.set(key, existing);
  });

  const kecamatanCompletion = [...byKecamatan.values()]
    .map((item) => ({
      id: item.id,
      name: item.name,
      value: item.total_desa > 0 ? Math.round(item.total_completion / item.total_desa) : 0,
      total_desa: item.total_desa,
      lengkap: item.lengkap,
      belum_diisi: item.belum_diisi,
    }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, 'id'));

  const topCompleted = [...records]
    .sort((left, right) => right.completion.percentage - left.completion.percentage || left.nama_desa.localeCompare(right.nama_desa, 'id'))
    .slice(0, 5)
    .map((record) => ({
      desa_id: record.desa_id,
      nama_desa: record.nama_desa,
      kecamatan_nama: record.kecamatan.nama,
      completion_percentage: record.completion.percentage,
      status_label: record.completion.status_label,
    }));

  const needsAttention = [...records]
    .filter((record) => record.completion.status_key !== 'lengkap')
    .sort((left, right) => left.completion.percentage - right.completion.percentage || left.nama_desa.localeCompare(right.nama_desa, 'id'))
    .slice(0, 5)
    .map((record) => ({
      desa_id: record.desa_id,
      nama_desa: record.nama_desa,
      kecamatan_nama: record.kecamatan.nama,
      completion_percentage: record.completion.percentage,
      status_label: record.completion.status_label,
    }));

  return {
    total_desa: totalDesa,
    profil_tersimpan: profilTersimpan,
    profil_terisi: profilTerisi,
    profil_lengkap: profilLengkap,
    profil_perlu_dilengkapi: profilPerluDilengkapi,
    profil_belum_diisi: profilBelumDiisi,
    rata_rata_kelengkapan: rataRataKelengkapan,
    total_penduduk_terlapor: totalPendudukTerlapor,
    desa_dengan_kontak: records.filter((record) => record.flags.has_contact).length,
    desa_dengan_koordinat: records.filter((record) => record.flags.has_coordinates).length,
    desa_dengan_foto: records.filter((record) => record.flags.has_office_photo).length,
    desa_dengan_narasi: records.filter((record) => record.flags.has_narratives).length,
    completion_status: [
      { name: 'Lengkap', key: 'lengkap', value: profilLengkap },
      { name: 'Perlu dilengkapi', key: 'perlu_dilengkapi', value: profilPerluDilengkapi },
      { name: 'Belum diisi', key: 'belum_diisi', value: profilBelumDiisi },
    ],
    klasifikasi: createFilterOptions(records, 'klasifikasi_desa', 'klasifikasi_desa_label')
      .map((item) => ({ name: item.label, key: item.value, value: records.filter((record) => record.klasifikasi_desa === item.value).length })),
    status_desa: createFilterOptions(records, 'status_desa', 'status_desa_label')
      .map((item) => ({ name: item.label, key: item.value, value: records.filter((record) => record.status_desa === item.value).length })),
    tipologi_desa: createFilterOptions(records, 'tipologi_desa', 'tipologi_desa_label')
      .map((item) => ({ name: item.label, key: item.value, value: records.filter((record) => record.tipologi_desa === item.value).length })),
    kecamatan_completion: kecamatanCompletion,
    top_completed: topCompleted,
    needs_attention: needsAttention,
    filter_options: {
      completion_status: [
        { value: 'lengkap', label: 'Lengkap' },
        { value: 'perlu_dilengkapi', label: 'Perlu dilengkapi' },
        { value: 'belum_diisi', label: 'Belum diisi' },
      ],
      klasifikasi_desa: createFilterOptions(records, 'klasifikasi_desa', 'klasifikasi_desa_label'),
      status_desa: createFilterOptions(records, 'status_desa', 'status_desa_label'),
      tipologi_desa: createFilterOptions(records, 'tipologi_desa', 'tipologi_desa_label'),
    },
  };
}

const getAllProfilDesa = async (req, res) => {
  try {
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const records = await getProfileRecords(req.query);
    const totalItems = records.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limitNum));
    const startIndex = (pageNum - 1) * limitNum;

    res.json({
      success: true,
      message: 'Daftar profil desa',
      data: records.slice(startIndex, startIndex + limitNum),
      meta: {
        page: pageNum,
        limit: limitNum,
        totalItems,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error fetching profil desa (pemdes):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data profil desa',
      error: error.message,
    });
  }
};

const getStats = async (req, res) => {
  try {
    const records = await getProfileRecords(req.query);

    res.json({
      success: true,
      data: buildStats(records),
    });
  } catch (error) {
    console.error('Error fetching profil desa stats (pemdes):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil statistik profil desa',
      error: error.message,
    });
  }
};

const getProfilDesaDetail = async (req, res) => {
  try {
    const desaId = parseBigIntParam(req.params.desaId);

    if (!desaId) {
      return res.status(400).json({
        success: false,
        message: 'ID desa tidak valid',
      });
    }

    const desa = await getProfileRecordById(desaId);

    if (!desa) {
      return res.status(404).json({
        success: false,
        message: 'Profil desa tidak ditemukan',
      });
    }

    return res.json({
      success: true,
      message: 'Detail profil desa',
      data: createSerializedProfileDetail(desa),
    });
  } catch (error) {
    console.error('Error fetching profil desa detail (pemdes):', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil detail profil desa',
      error: error.message,
    });
  }
};

module.exports = {
  getAllProfilDesa,
  getStats,
  getProfilDesaDetail,
};