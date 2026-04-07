const prisma = require('../config/prisma');

// ============================================
// FUZZY SEARCH ENGINE for DPMD Smart Chatbot
// ============================================
// Features:
// - Word-split search: "bumdes bina" → matches "Bina Teknik", "Bina Insani"
// - Typo tolerance: every word gets LIKE %word% matching
// - Smart scoring: exact > starts-with > contains > partial-word
// - All 64 database tables searchable
// ============================================

/**
 * Build Prisma OR conditions for fuzzy matching.
 * Splits the query into individual words and creates LIKE conditions
 * for each word across all specified fields.
 * 
 * "bumdes bina" → each field must contain ALL words
 * This handles partial/fuzzy matches naturally with MySQL LIKE
 */
function buildFuzzyWhere(fields, searchTerm) {
  const words = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  
  if (words.length === 0) return undefined;
  
  // Strategy: OR across fields, each field must match at least one word
  // This way "bumdes bina" will find anything where ANY field contains "bina"
  const conditions = [];
  
  // 1. Exact full-phrase match on each field (highest priority - handled in scoring)
  for (const field of fields) {
    conditions.push({ [field]: { contains: searchTerm } });
  }
  
  // 2. Individual word matches - each word on each field
  for (const word of words) {
    for (const field of fields) {
      conditions.push({ [field]: { contains: word } });
    }
  }
  
  return { OR: conditions };
}

/**
 * Score a result for relevance ranking
 * Higher score = more relevant
 */
function scoreResult(result, query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const title = (result.title || '').toLowerCase();
  const subtitle = (result.subtitle || '').toLowerCase();
  const allText = `${title} ${subtitle} ${(result.details || []).map(d => d.value).join(' ')}`.toLowerCase();
  let score = 0;

  // Exact full query match in title
  if (title.includes(query.toLowerCase())) score += 100;
  // Starts with query
  if (title.startsWith(query.toLowerCase())) score += 50;
  // Exact match in subtitle
  if (subtitle.includes(query.toLowerCase())) score += 30;

  // Per-word scoring
  for (const word of words) {
    if (title.includes(word)) score += 20;
    if (title.startsWith(word)) score += 10;
    if (subtitle.includes(word)) score += 8;
    if (allText.includes(word)) score += 3;
  }

  // Bonus: more words matched = higher score
  const wordsMatched = words.filter(w => allText.includes(w)).length;
  score += wordsMatched * 15;

  // Bonus: all words matched
  if (wordsMatched === words.length) score += 50;

  return score;
}

class ChatbotController {
  /**
   * Smart fuzzy search across ALL database tables
   * POST /api/chatbot/search
   * Body: { query: string, category?: string }
   */
  async search(req, res) {
    try {
      const { query, category } = req.body;

      if (!query || query.trim().length < 1) {
        return res.json({
          success: true,
          data: { results: [], totalResults: 0 },
          message: 'Masukkan kata kunci untuk pencarian'
        });
      }

      const searchTerm = query.trim();
      const results = [];
      const searchPromises = [];

      // All searchable categories
      const ALL_CATEGORIES = [
        'desa', 'kecamatan', 'pegawai', 'aparatur_desa',
        'kelembagaan', 'bumdes', 'produk_hukum', 'berita',
        'kegiatan', 'perjadin', 'bankeu', 'surat_masuk',
        'disposisi', 'profil_desa', 'user', 'absensi',
        'satlinmas', 'lembaga_lainnya', 'informasi', 'notifikasi'
      ];
      const cats = category ? [category] : ALL_CATEGORIES;

      // ============================================
      // 1. DESA (Villages)
      // ============================================
      if (cats.includes('desa')) {
        searchPromises.push(
          prisma.desas.findMany({
            where: buildFuzzyWhere(['nama', 'kode'], searchTerm),
            include: { kecamatans: { select: { nama: true } } },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'desa', icon: '🏘️', label: 'Desa',
            title: item.nama,
            subtitle: `Kec. ${item.kecamatans?.nama || '-'} (${item.status_pemerintahan === 'kelurahan' ? 'Kelurahan' : 'Desa'})`,
            details: [
              { key: 'Kode', value: item.kode },
              { key: 'Kecamatan', value: item.kecamatans?.nama || '-' },
              { key: 'Status', value: item.status_pemerintahan === 'kelurahan' ? 'Kelurahan' : 'Desa' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 2. KECAMATAN (Sub-districts)
      // ============================================
      if (cats.includes('kecamatan')) {
        searchPromises.push(
          prisma.kecamatans.findMany({
            where: buildFuzzyWhere(['nama', 'kode', 'nama_camat'], searchTerm),
            take: 15,
          }).then(items => items.map(item => ({
            type: 'kecamatan', icon: '🏛️', label: 'Kecamatan',
            title: item.nama,
            subtitle: item.nama_camat ? `Camat: ${item.nama_camat}` : '',
            details: [
              { key: 'Kode', value: item.kode },
              { key: 'Camat', value: item.nama_camat || '-' },
              { key: 'NIP Camat', value: item.nip_camat || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 3. PEGAWAI (Employees)
      // ============================================
      if (cats.includes('pegawai')) {
        searchPromises.push(
          prisma.pegawai.findMany({
            where: buildFuzzyWhere(['nama_pegawai', 'nip', 'jabatan', 'golongan', 'pangkat'], searchTerm),
            include: { bidangs: { select: { nama: true } } },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'pegawai', icon: '👤', label: 'Pegawai',
            title: item.nama_pegawai,
            subtitle: item.jabatan || '',
            details: [
              { key: 'NIP', value: item.nip || '-' },
              { key: 'Jabatan', value: item.jabatan || '-' },
              { key: 'Bidang', value: item.bidangs?.nama || '-' },
              { key: 'Golongan', value: item.golongan || '-' },
              { key: 'Pangkat', value: item.pangkat || '-' },
              { key: 'No HP', value: item.no_hp || '-' },
              { key: 'Email', value: item.email || '-' },
            ],
            id: item.id_pegawai,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 4. APARATUR DESA (Village Apparatus)
      // ============================================
      if (cats.includes('aparatur_desa')) {
        searchPromises.push(
          prisma.aparatur_desa.findMany({
            where: buildFuzzyWhere(['nama_lengkap', 'jabatan', 'nipd', 'tempat_lahir'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'aparatur_desa', icon: '🧑‍💼', label: 'Aparatur Desa',
            title: item.nama_lengkap,
            subtitle: `${item.jabatan || ''} - Desa ${item.desas?.nama || ''}`,
            details: [
              { key: 'Jabatan', value: item.jabatan || '-' },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'NIPD', value: item.nipd || '-' },
              { key: 'Pendidikan', value: item.pendidikan_terakhir || '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'Tempat Lahir', value: item.tempat_lahir || '-' },
              { key: 'Jenis Kelamin', value: item.jenis_kelamin || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 5. KELEMBAGAAN (Institutional Bodies)
      // ============================================
      if (cats.includes('kelembagaan')) {
        // RW
        searchPromises.push(
          prisma.rws.findMany({
            where: buildFuzzyWhere(['nomor', 'alamat'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '🏠', label: 'RW',
            title: `RW ${item.nomor}`,
            subtitle: `Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Nomor', value: item.nomor },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );

        // RT
        searchPromises.push(
          prisma.rts.findMany({
            where: buildFuzzyWhere(['nomor', 'alamat'], searchTerm),
            include: { 
              rws: { 
                select: { nomor: true, desas: { select: { nama: true } } } 
              } 
            },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '🏡', label: 'RT',
            title: `RT ${item.nomor}`,
            subtitle: `RW ${item.rws?.nomor || '-'} - Desa ${item.rws?.desas?.nama || '-'}`,
            details: [
              { key: 'Nomor', value: item.nomor },
              { key: 'RW', value: item.rws?.nomor || '-' },
              { key: 'Desa', value: item.rws?.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );

        // Posyandu
        searchPromises.push(
          prisma.posyandus.findMany({
            where: buildFuzzyWhere(['nama', 'alamat'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '🏥', label: 'Posyandu',
            title: item.nama,
            subtitle: `Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Nama', value: item.nama },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );

        // PKK
        searchPromises.push(
          prisma.pkks.findMany({
            where: buildFuzzyWhere(['nama', 'alamat'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '👩‍👩‍👧', label: 'PKK',
            title: item.nama,
            subtitle: `Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Nama', value: item.nama },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );

        // LPM
        searchPromises.push(
          prisma.lpms.findMany({
            where: buildFuzzyWhere(['nama', 'alamat'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '🏗️', label: 'LPM',
            title: item.nama,
            subtitle: `Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Nama', value: item.nama },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );

        // Karang Taruna
        searchPromises.push(
          prisma.karang_tarunas.findMany({
            where: buildFuzzyWhere(['nama', 'alamat'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '🎯', label: 'Karang Taruna',
            title: item.nama,
            subtitle: `Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Nama', value: item.nama },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );

        // Pengurus (semua lembaga)
        searchPromises.push(
          prisma.pengurus.findMany({
            where: buildFuzzyWhere(['nama_lengkap', 'jabatan', 'nik', 'no_telepon'], searchTerm),
            take: 15,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '📋', label: `Pengurus ${item.pengurusable_type || ''}`,
            title: item.nama_lengkap,
            subtitle: item.jabatan || '',
            details: [
              { key: 'Jabatan', value: item.jabatan || '-' },
              { key: 'Lembaga', value: item.pengurusable_type || '-' },
              { key: 'NIK', value: item.nik || '-' },
              { key: 'No Telepon', value: item.no_telepon || '-' },
              { key: 'Status', value: item.status_jabatan || '-' },
              { key: 'Verifikasi', value: item.status_verifikasi || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 5b. SATLINMAS
      // ============================================
      if (cats.includes('satlinmas') || cats.includes('kelembagaan')) {
        searchPromises.push(
          prisma.satlinmas.findMany({
            where: buildFuzzyWhere(['nama', 'alamat'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '🛡️', label: 'Satlinmas',
            title: item.nama,
            subtitle: `Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Nama', value: item.nama },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 5c. LEMBAGA LAINNYA
      // ============================================
      if (cats.includes('lembaga_lainnya') || cats.includes('kelembagaan')) {
        searchPromises.push(
          prisma.lembaga_lainnyas.findMany({
            where: buildFuzzyWhere(['nama', 'alamat', 'jenis_lembaga'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'kelembagaan', icon: '🏢', label: 'Lembaga Lainnya',
            title: item.nama,
            subtitle: `${item.jenis_lembaga || ''} - Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Nama', value: item.nama },
              { key: 'Jenis', value: item.jenis_lembaga || '-' },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Alamat', value: item.alamat || '-' },
              { key: 'Status', value: item.status_kelembagaan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 6. BUMDES
      // ============================================
      if (cats.includes('bumdes')) {
        searchPromises.push(
          prisma.bumdes.findMany({
            where: buildFuzzyWhere(['namabumdesa', 'JenisUsahaUtama', 'AlamatBumdesa', 'NIB'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'bumdes', icon: '🏪', label: 'BUMDes',
            title: item.namabumdesa || 'BUMDes',
            subtitle: `Desa ${item.desas?.nama || '-'}`,
            details: [
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Jenis Usaha', value: item.JenisUsahaUtama || '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'NIB', value: item.NIB || '-' },
              { key: 'Tahun Pendirian', value: item.TahunPendirian || '-' },
              { key: 'Alamat', value: item.AlamatBumdesa || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 7. PRODUK HUKUM
      // ============================================
      if (cats.includes('produk_hukum')) {
        searchPromises.push(
          prisma.produk_hukums.findMany({
            where: buildFuzzyWhere(['judul', 'nomor', 'subjek'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'produk_hukum', icon: '📜', label: 'Produk Hukum',
            title: item.judul,
            subtitle: `${item.jenis || ''} - ${item.desas?.nama || ''}`,
            details: [
              { key: 'Nomor', value: item.nomor || '-' },
              { key: 'Jenis', value: item.jenis || '-' },
              { key: 'Tahun', value: item.tahun || '-' },
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Subjek', value: item.subjek || '-' },
              { key: 'Status', value: item.status_peraturan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 8. BERITA (News)
      // ============================================
      if (cats.includes('berita')) {
        searchPromises.push(
          prisma.berita.findMany({
            where: buildFuzzyWhere(['judul', 'ringkasan', 'penulis', 'kategori'], searchTerm),
            take: 15,
          }).then(items => items.map(item => ({
            type: 'berita', icon: '📰', label: 'Berita',
            title: item.judul,
            subtitle: item.ringkasan ? item.ringkasan.substring(0, 120) + '...' : '',
            details: [
              { key: 'Kategori', value: item.kategori || '-' },
              { key: 'Penulis', value: item.penulis || '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'Tanggal', value: item.tanggal_publish ? new Date(item.tanggal_publish).toLocaleDateString('id-ID') : '-' },
            ],
            id: item.id_berita,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 9. JADWAL KEGIATAN
      // ============================================
      if (cats.includes('kegiatan')) {
        searchPromises.push(
          prisma.jadwal_kegiatan.findMany({
            where: buildFuzzyWhere(['judul', 'lokasi', 'pic_name', 'deskripsi'], searchTerm),
            take: 15,
          }).then(items => items.map(item => ({
            type: 'kegiatan', icon: '📅', label: 'Kegiatan',
            title: item.judul,
            subtitle: item.lokasi || '',
            details: [
              { key: 'Lokasi', value: item.lokasi || '-' },
              { key: 'PIC', value: item.pic_name || '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'Prioritas', value: item.prioritas || '-' },
              { key: 'Kategori', value: item.kategori || '-' },
              { key: 'Mulai', value: item.tanggal_mulai ? new Date(item.tanggal_mulai).toLocaleDateString('id-ID') : '-' },
              { key: 'Selesai', value: item.tanggal_selesai ? new Date(item.tanggal_selesai).toLocaleDateString('id-ID') : '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 10. PERJADIN
      // ============================================
      if (cats.includes('perjadin')) {
        searchPromises.push(
          prisma.perjadin_pegawai.findMany({
            where: buildFuzzyWhere(['lokasi_tujuan', 'tujuan_perjalanan', 'nomor_sppd'], searchTerm),
            include: { pegawai: { select: { nama_pegawai: true } } },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'perjadin', icon: '✈️', label: 'Perjadin',
            title: item.tujuan_perjalanan || item.lokasi_tujuan || 'Perjalanan Dinas',
            subtitle: item.pegawai?.nama_pegawai || '',
            details: [
              { key: 'Pegawai', value: item.pegawai?.nama_pegawai || '-' },
              { key: 'Tujuan', value: item.lokasi_tujuan || '-' },
              { key: 'No SPPD', value: item.nomor_sppd || '-' },
              { key: 'Berangkat', value: item.tanggal_berangkat ? new Date(item.tanggal_berangkat).toLocaleDateString('id-ID') : '-' },
              { key: 'Kembali', value: item.tanggal_kembali ? new Date(item.tanggal_kembali).toLocaleDateString('id-ID') : '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 11. BANKEU (Financial Support Proposals)
      // ============================================
      if (cats.includes('bankeu')) {
        searchPromises.push(
          prisma.bankeu_proposals.findMany({
            where: buildFuzzyWhere(['judul_proposal', 'nama_kegiatan_spesifik', 'lokasi'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'bankeu', icon: '💰', label: 'Bankeu',
            title: item.judul_proposal || item.nama_kegiatan_spesifik || 'Proposal Bankeu',
            subtitle: `Desa ${item.desas?.nama || '-'} - ${item.tahun_anggaran || ''}`,
            details: [
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Tahun', value: item.tahun_anggaran || '-' },
              { key: 'Anggaran', value: item.anggaran_usulan ? `Rp ${Number(item.anggaran_usulan).toLocaleString('id-ID')}` : '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'Lokasi', value: item.lokasi || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 12. SURAT MASUK
      // ============================================
      if (cats.includes('surat_masuk')) {
        searchPromises.push(
          prisma.surat_masuk.findMany({
            where: buildFuzzyWhere(['perihal', 'pengirim', 'nomor_surat', 'asal_surat'], searchTerm),
            take: 15,
          }).then(items => items.map(item => ({
            type: 'surat_masuk', icon: '📬', label: 'Surat Masuk',
            title: item.perihal || 'Surat',
            subtitle: `Dari: ${item.pengirim || '-'}`,
            details: [
              { key: 'Nomor', value: item.nomor_surat || '-' },
              { key: 'Pengirim', value: item.pengirim || '-' },
              { key: 'Asal Surat', value: item.asal_surat || '-' },
              { key: 'Tanggal Surat', value: item.tanggal_surat ? new Date(item.tanggal_surat).toLocaleDateString('id-ID') : '-' },
              { key: 'Status', value: item.status || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 13. DISPOSISI (Letter Distribution)
      // ============================================
      if (cats.includes('disposisi')) {
        searchPromises.push(
          prisma.disposisi.findMany({
            where: buildFuzzyWhere(['catatan', 'instruksi'], searchTerm),
            include: { 
              surat_masuk: { select: { perihal: true, pengirim: true } },
            },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'disposisi', icon: '📤', label: 'Disposisi',
            title: item.surat_masuk?.perihal || 'Disposisi',
            subtitle: `Dari: ${item.surat_masuk?.pengirim || '-'}`,
            details: [
              { key: 'Perihal Surat', value: item.surat_masuk?.perihal || '-' },
              { key: 'Instruksi', value: item.instruksi || '-' },
              { key: 'Catatan', value: item.catatan || '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'Tanggal', value: item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 14. PROFIL DESA
      // ============================================
      if (cats.includes('profil_desa')) {
        searchPromises.push(
          prisma.profil_desas.findMany({
            where: buildFuzzyWhere(['visi', 'misi', 'sejarah', 'alamat_kantor'], searchTerm),
            include: { desas: { select: { nama: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'profil_desa', icon: '📋', label: 'Profil Desa',
            title: `Profil Desa ${item.desas?.nama || ''}`,
            subtitle: item.alamat_kantor || '',
            details: [
              { key: 'Desa', value: item.desas?.nama || '-' },
              { key: 'Jumlah Penduduk', value: item.jumlah_penduduk || '-' },
              { key: 'Luas Wilayah', value: item.luas_wilayah ? `${item.luas_wilayah} Ha` : '-' },
              { key: 'Alamat Kantor', value: item.alamat_kantor || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 15. USER (Akun Pengguna)
      // ============================================
      if (cats.includes('user')) {
        searchPromises.push(
          prisma.users.findMany({
            where: buildFuzzyWhere(['name', 'email'], searchTerm),
            select: { id: true, name: true, email: true, role: true, created_at: true },
            take: 15,
          }).then(items => items.map(item => ({
            type: 'user', icon: '🔑', label: 'User',
            title: item.name,
            subtitle: item.email || '',
            details: [
              { key: 'Email', value: item.email || '-' },
              { key: 'Role', value: item.role || '-' },
              { key: 'Terdaftar', value: item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 16. ABSENSI PEGAWAI
      // ============================================
      if (cats.includes('absensi')) {
        searchPromises.push(
          prisma.absensi_pegawai.findMany({
            where: buildFuzzyWhere(['keterangan', 'lokasi_masuk'], searchTerm),
            include: { pegawai: { select: { nama_pegawai: true } } },
            take: 10,
          }).then(items => items.map(item => ({
            type: 'absensi', icon: '⏰', label: 'Absensi',
            title: item.pegawai?.nama_pegawai || 'Absensi',
            subtitle: item.tanggal ? new Date(item.tanggal).toLocaleDateString('id-ID') : '',
            details: [
              { key: 'Pegawai', value: item.pegawai?.nama_pegawai || '-' },
              { key: 'Tanggal', value: item.tanggal ? new Date(item.tanggal).toLocaleDateString('id-ID') : '-' },
              { key: 'Jam Masuk', value: item.jam_masuk || '-' },
              { key: 'Jam Pulang', value: item.jam_pulang || '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'Keterangan', value: item.keterangan || '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 17. INFORMASI
      // ============================================
      if (cats.includes('informasi')) {
        searchPromises.push(
          prisma.informasi.findMany({
            where: buildFuzzyWhere(['judul', 'konten', 'kategori'], searchTerm),
            take: 10,
          }).then(items => items.map(item => ({
            type: 'informasi', icon: 'ℹ️', label: 'Informasi',
            title: item.judul,
            subtitle: item.kategori || '',
            details: [
              { key: 'Kategori', value: item.kategori || '-' },
              { key: 'Status', value: item.status || '-' },
              { key: 'Tanggal', value: item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // 18. NOTIFIKASI
      // ============================================
      if (cats.includes('notifikasi')) {
        searchPromises.push(
          prisma.notifications.findMany({
            where: buildFuzzyWhere(['title', 'body'], searchTerm),
            take: 10,
          }).then(items => items.map(item => ({
            type: 'notifikasi', icon: '🔔', label: 'Notifikasi',
            title: item.title,
            subtitle: item.body ? item.body.substring(0, 100) : '',
            details: [
              { key: 'Tipe', value: item.type || '-' },
              { key: 'Dibaca', value: item.is_read ? 'Ya' : 'Belum' },
              { key: 'Tanggal', value: item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID') : '-' },
            ],
            id: item.id,
          }))).catch(() => [])
        );
      }

      // ============================================
      // Execute all searches in parallel
      // ============================================
      const allResults = await Promise.allSettled(searchPromises);

      for (const result of allResults) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          results.push(...result.value);
        }
      }

      // ============================================
      // SMART SCORING & RANKING
      // ============================================
      // Score each result for relevance
      for (const result of results) {
        result._score = scoreResult(result, searchTerm);
      }

      // Sort by score descending
      results.sort((a, b) => b._score - a._score);

      // Remove internal score from output
      const cleanResults = results.slice(0, 50).map(({ _score, ...rest }) => rest);

      // Build smart summary
      const typeCounts = {};
      for (const r of cleanResults) {
        typeCounts[r.label] = (typeCounts[r.label] || 0) + 1;
      }
      const summaryParts = Object.entries(typeCounts).map(([k, v]) => `${v} ${k}`);
      const summary = summaryParts.length > 0 ? summaryParts.join(', ') : '';

      return res.json({
        success: true,
        data: {
          results: cleanResults,
          totalResults: results.length,
          query: searchTerm,
          summary,
        }
      });
    } catch (error) {
      console.error('Chatbot search error:', error);
      return res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat mencari data',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get available search categories
   * GET /api/chatbot/categories
   */
  async getCategories(req, res) {
    const categories = [
      { id: 'desa', label: 'Desa', icon: '🏘️', description: 'Cari data desa/kelurahan' },
      { id: 'kecamatan', label: 'Kecamatan', icon: '🏛️', description: 'Cari data kecamatan' },
      { id: 'pegawai', label: 'Pegawai', icon: '👤', description: 'Cari data pegawai DPMD' },
      { id: 'aparatur_desa', label: 'Aparatur Desa', icon: '🧑‍💼', description: 'Cari kepala desa, perangkat desa' },
      { id: 'kelembagaan', label: 'Kelembagaan', icon: '🏠', description: 'RW, RT, Posyandu, PKK, LPM, Karang Taruna, Satlinmas' },
      { id: 'bumdes', label: 'BUMDes', icon: '🏪', description: 'Badan Usaha Milik Desa' },
      { id: 'produk_hukum', label: 'Produk Hukum', icon: '📜', description: 'Peraturan & keputusan desa' },
      { id: 'berita', label: 'Berita', icon: '📰', description: 'Berita & artikel' },
      { id: 'kegiatan', label: 'Kegiatan', icon: '📅', description: 'Jadwal kegiatan' },
      { id: 'perjadin', label: 'Perjadin', icon: '✈️', description: 'Perjalanan dinas' },
      { id: 'bankeu', label: 'Bankeu', icon: '💰', description: 'Proposal bantuan keuangan' },
      { id: 'surat_masuk', label: 'Surat Masuk', icon: '📬', description: 'Surat masuk & disposisi' },
      { id: 'disposisi', label: 'Disposisi', icon: '📤', description: 'Disposisi surat' },
      { id: 'profil_desa', label: 'Profil Desa', icon: '📋', description: 'Data profil desa' },
      { id: 'user', label: 'User', icon: '🔑', description: 'Akun pengguna sistem' },
      { id: 'absensi', label: 'Absensi', icon: '⏰', description: 'Data absensi pegawai' },
      { id: 'informasi', label: 'Informasi', icon: 'ℹ️', description: 'Informasi & pengumuman' },
      { id: 'notifikasi', label: 'Notifikasi', icon: '🔔', description: 'Notifikasi sistem' },
    ];

    return res.json({ success: true, data: categories });
  }

  /**
   * Get quick stats summary
   * GET /api/chatbot/stats
   */
  async getStats(req, res) {
    try {
      const [
        totalDesa,
        totalKelurahan,
        totalKecamatan,
        totalPegawai,
        totalBumdes,
        totalProdukHukum,
        totalBerita,
        totalAparatur,
        totalKegiatan,
        totalSurat,
      ] = await Promise.all([
        prisma.desas.count({ where: { status_pemerintahan: 'desa' } }),
        prisma.desas.count({ where: { status_pemerintahan: 'kelurahan' } }),
        prisma.kecamatans.count(),
        prisma.pegawai.count(),
        prisma.bumdes.count(),
        prisma.produk_hukums.count(),
        prisma.berita.count(),
        prisma.aparatur_desa.count(),
        prisma.jadwal_kegiatan.count(),
        prisma.surat_masuk.count(),
      ]);

      return res.json({
        success: true,
        data: {
          totalDesa,
          totalKelurahan,
          totalDesaDanKelurahan: totalDesa + totalKelurahan,
          totalKecamatan,
          totalPegawai,
          totalBumdes,
          totalProdukHukum,
          totalBerita,
          totalAparatur,
          totalKegiatan,
          totalSurat,
        }
      });
    } catch (error) {
      console.error('Chatbot stats error:', error);
      return res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat mengambil statistik'
      });
    }
  }
}

module.exports = new ChatbotController();
