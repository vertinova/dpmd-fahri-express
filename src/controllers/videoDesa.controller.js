/**
 * Video Desa: video kegiatan dari desa untuk videotron & media sosial DPMD.
 *
 * Alur:
 * 1. Tiap bidang membuat "kegiatan video" (judul + arahan konten).
 * 2. Bidang Sekretariat membagikan SATU tautan (/v/<token>) ke seluruh desa.
 *    Di dalamnya tampil card semua kegiatan video yang sedang dibuka, dari
 *    semua bidang.
 * 3. Desa membuka tautan TANPA login, memilih desanya, lalu mengunggah satu
 *    video per kegiatan. Unggahan dipecah per potongan (UKURAN_POTONGAN) —
 *    sinyal di desa sering putus, dan yang diulang cukup potongan terakhir.
 * 4. Video dibangun ulang menjadi MP4 bersih (services/videoDesaProses) sebelum
 *    bisa diputar; lalu bidang pemilik kegiatan memverifikasinya.
 *
 * Jalur tanpa login dijaga berlapis: token tautan, kegiatan & tautan harus
 * dibuka, satu video per desa per kegiatan, batas ukuran, batas sesi & jumlah
 * unggahan per IP, pemeriksaan byte awal, ffprobe dengan format dibatasi,
 * lalu pembangunan ulang penuh. Berkas di private/ (bukan storage/ yang
 * statis-publik) dan hanya bisa diambil lewat tautan bertanda tangan.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const storageServer = require('../services/serverStorage.service');
const proses = require('../services/videoDesaProses.service');

const { VIDEO_ROOT, MENTAH_ROOT } = proses;
const SEMENTARA_ROOT = path.join(VIDEO_ROOT, '_sementara');

/**
 * 1 GB per video. Videotron memutar 1080p dan klipnya pendek; 1080p H.264
 * dari HP ~10–17 Mbps, jadi 1 GB ≈ 8–13 menit rekaman mentah — longgar untuk
 * video kegiatan yang belum disunting. Lebih dari itu hampir pasti 4K mentah.
 */
const MAKS_UKURAN = 1024 * 1024 * 1024;

// 8 MB per potongan: kecil untuk diulang di sinyal lemah; 1 GB = 128 request
// (rate limit anonim 1000/15 menit per IP).
const UKURAN_POTONGAN = 8 * 1024 * 1024;

const EKSTENSI_SAH = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'];

const UMUR_SESI_MS = 24 * 60 * 60 * 1000;
const UMUR_TAUTAN_PUTAR = '3h';

// Pembatas penyalahgunaan per IP pada jalur tanpa login.
const MAKS_MULAI_PER_JAM = 30;
const MAKS_SESI_AKTIF_PER_IP = 3;
const SESI_AKTIF_MS = 30 * 60 * 1000;

const PIMPINAN = ['superadmin', 'kepala_dinas', 'sekretaris_dinas'];
const BIDANG_SEKRETARIAT = 2;

fs.mkdirSync(SEMENTARA_ROOT, { recursive: true });

/* ------------------------------------------------------------- bantuan -- */

const rapikan = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(rapikan);
  if (obj instanceof Date) return obj;
  if (typeof obj === 'object') {
    if (typeof obj.toNumber === 'function') return obj.toNumber(); // Prisma Decimal
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, rapikan(v)]));
  }
  return obj;
};

const teks = (v, maks) => String(v ?? '').trim().slice(0, maks);

const bolehKelola = (user, bidangPemilik) =>
  PIMPINAN.includes(user.role) || Number(user.bidang_id) === Number(bidangPemilik);

/** Pengelola tautan tunggal: Bidang Sekretariat (dan pimpinan). */
const bolehKelolaTautan = (user) =>
  PIMPINAN.includes(user.role) || user.role === 'sekretariat' || Number(user.bidang_id) === BIDANG_SEKRETARIAT;

/** Kiriman yang aman dibagikan ke bidang (tanpa jalur disk & IP). */
const kirimanAman = (k) => {
  const { jalur_disk, nama_disk, ip, sha256, ...aman } = k;
  return rapikan(aman);
};

const ambilPermintaan = async (user, id) => {
  let idBig;
  try { idBig = BigInt(id); } catch { return { kode: 404, pesan: 'Kegiatan video tidak ditemukan.' }; }
  const permintaan = await prisma.video_desa_permintaan.findFirst({ where: { id: idBig, deleted_at: null } });
  if (!permintaan) return { kode: 404, pesan: 'Kegiatan video tidak ditemukan.' };
  if (!bolehKelola(user, permintaan.bidang_id)) return { kode: 403, pesan: 'Kegiatan video ini milik bidang lain.' };
  return { permintaan };
};

const ambilKiriman = async (user, id) => {
  let idBig;
  try { idBig = BigInt(id); } catch { return { kode: 404, pesan: 'Video tidak ditemukan.' }; }
  const kiriman = await prisma.video_desa_kiriman.findUnique({ where: { id: idBig } });
  if (!kiriman) return { kode: 404, pesan: 'Video tidak ditemukan.' };
  const { permintaan, kode, pesan } = await ambilPermintaan(user, kiriman.permintaan_id);
  if (!permintaan) return { kode, pesan };
  return { kiriman, permintaan };
};

const alasanTertutup = (p) => {
  if (p.status === 'ditutup') return 'Kegiatan video ini sudah ditutup.';
  if (p.tutup_pada && new Date(p.tutup_pada) < new Date()) return 'Batas waktu unggah kegiatan ini sudah lewat.';
  return null;
};

const tanggalAtauNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const siapkanPengaturan = (body, { parsial = false } = {}) => {
  const data = {};
  if (!parsial || body.judul !== undefined) {
    data.judul = teks(body.judul, 255);
    if (!data.judul) return { pesan: 'Judul kegiatan video wajib diisi.' };
  }
  if (!parsial || body.deskripsi !== undefined) data.deskripsi = teks(body.deskripsi, 5000) || null;
  if (body.orientasi !== undefined) {
    if (!['bebas', 'lanskap', 'potret'].includes(body.orientasi)) return { pesan: 'Orientasi tidak dikenal.' };
    data.orientasi = body.orientasi;
  }
  if (body.maks_durasi_detik !== undefined) {
    if (body.maks_durasi_detik === null || body.maks_durasi_detik === '') {
      data.maks_durasi_detik = null;
    } else {
      const n = Number(body.maks_durasi_detik);
      if (!Number.isInteger(n) || n < 5 || n > 1800) return { pesan: 'Batas durasi harus 5–1800 detik.' };
      data.maks_durasi_detik = n;
    }
  }
  if (body.tutup_pada !== undefined) {
    const d = tanggalAtauNull(body.tutup_pada);
    if (d === undefined) return { pesan: 'Tanggal penutupan tidak valid.' };
    data.tutup_pada = d;
  }
  if (body.status !== undefined) {
    if (!['dibuka', 'ditutup'].includes(body.status)) return { pesan: 'Status tidak dikenal.' };
    data.status = body.status;
  }
  return { data };
};

const petaWilayah = async (desaIds) => {
  if (!desaIds.length) return new Map();
  const desas = await prisma.desas.findMany({
    where: { id: { in: desaIds } },
    select: { id: true, nama: true, status_pemerintahan: true, kecamatan_id: true },
  });
  const kecs = await prisma.kecamatans.findMany({
    where: { id: { in: [...new Set(desas.map((d) => d.kecamatan_id))] } },
    select: { id: true, nama: true },
  });
  const petaKec = new Map(kecs.map((k) => [String(k.id), k.nama]));
  return new Map(desas.map((d) => [String(d.id), {
    desa: d.nama,
    status_pemerintahan: d.status_pemerintahan,
    kecamatan: petaKec.get(String(d.kecamatan_id)) || null,
  }]));
};

/** Kenali kontainer video dari byte awal — ekstensi & MIME bisa dikarang. */
const cekTandaVideo = async (berkas) => {
  const fh = await fsp.open(berkas, 'r');
  try {
    const buf = Buffer.alloc(12);
    await fh.read(buf, 0, 12, 0);
    if (buf.toString('ascii', 4, 8) === 'ftyp') return true; // MP4/MOV/M4V
    if (buf.readUInt32BE(0) === 0x1a45dfa3) return true; // WebM/MKV (EBML)
    return false;
  } finally {
    await fh.close();
  }
};

const hapusBerkasKiriman = (k) => Promise.all([
  fsp.unlink(path.join(VIDEO_ROOT, k.jalur_disk)).catch(() => {}),
  fsp.unlink(path.join(MENTAH_ROOT, k.nama_disk)).catch(() => {}),
]);

/**
 * Kiriman yang "memakai jatah" satu video per desa per kegiatan. Yang ditolak
 * bidang atau gagal diperiksa tidak dihitung — desa harus bisa mengirim ulang.
 */
const kirimanBerlaku = (permintaanId, desaId) =>
  prisma.video_desa_kiriman.findFirst({
    where: {
      permintaan_id: permintaanId,
      desa_id: desaId,
      status: { not: 'ditolak' },
      pemrosesan: { not: 'gagal' },
    },
  });

/* -------------------------------------------------------- tautan tunggal -- */

const ambilTautan = () => prisma.video_desa_tautan.findUnique({ where: { id: 1 } });

/** Tautan sah & dibuka untuk token ini, atau { kode, pesan }. */
const cekTautanPublik = async (token) => {
  const t = await ambilTautan();
  const diberikan = String(token || '');
  const cocok = t && diberikan.length === t.token.length
    && crypto.timingSafeEqual(Buffer.from(diberikan), Buffer.from(t.token));
  if (!cocok) return { kode: 404, pesan: 'Tautan video tidak ditemukan atau sudah diganti. Minta tautan terbaru ke DPMD.' };
  if (t.status === 'ditutup') return { kode: 403, pesan: 'Pengumpulan video desa sedang ditutup.' };
  return { tautan: t };
};

/* ------------------------------------------------------- sesi unggahan -- */

const ID_SESI_RE = /^[a-f0-9]{32}$/;
const sedangDitulis = new Set();

const folderSesi = (id) => path.join(SEMENTARA_ROOT, id);
const berkasMeta = (id) => path.join(folderSesi(id), 'meta.json');
const berkasData = (id) => path.join(folderSesi(id), 'data.part');

const bacaSesi = async (token, uploadId) => {
  if (!ID_SESI_RE.test(String(uploadId))) return null;
  try {
    const meta = JSON.parse(await fsp.readFile(berkasMeta(uploadId), 'utf8'));
    return meta.token === token ? meta : null;
  } catch {
    return null;
  }
};

const tulisSesi = (meta) => fsp.writeFile(berkasMeta(meta.upload_id), JSON.stringify({ ...meta, aktif: Date.now() }));

const hapusSesi = (id) => fsp.rm(folderSesi(id), { recursive: true, force: true }).catch(() => {});

/** Semua sesi yang masih tersimpan (jumlahnya kecil; dibaca dari disk). */
const daftarSesi = async () => {
  const hasil = [];
  try {
    for (const nama of await fsp.readdir(SEMENTARA_ROOT)) {
      try { hasil.push(JSON.parse(await fsp.readFile(berkasMeta(nama), 'utf8'))); } catch { /* sesi rusak */ }
    }
  } catch { /* abaikan */ }
  return hasil;
};

let terakhirBersih = 0;
const bersihkanSesiLama = async () => {
  if (Date.now() - terakhirBersih < 60 * 60 * 1000) return;
  terakhirBersih = Date.now();
  try {
    for (const nama of await fsp.readdir(SEMENTARA_ROOT)) {
      const st = await fsp.stat(path.join(SEMENTARA_ROOT, nama)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > UMUR_SESI_MS) await hapusSesi(nama);
    }
  } catch { /* abaikan */ }
};

/** Jejak "mulai unggah" per IP selama sejam terakhir. */
const jejakMulai = new Map();
const catatMulai = (ip) => {
  const kini = Date.now();
  const daftar = (jejakMulai.get(ip) || []).filter((t) => kini - t < 3600000);
  if (daftar.length >= MAKS_MULAI_PER_JAM) return false;
  daftar.push(kini);
  jejakMulai.set(ip, daftar);
  if (jejakMulai.size > 5000) jejakMulai.clear();
  return true;
};

const desaDariToken = (req) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  try {
    const p = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    return p.desa_id ? Number(p.desa_id) : null;
  } catch {
    return null;
  }
};

const kegiatanTerbuka = async () => {
  const daftar = await prisma.video_desa_permintaan.findMany({
    where: { deleted_at: null, status: 'dibuka', OR: [{ tutup_pada: null }, { tutup_pada: { gt: new Date() } }] },
    orderBy: [{ bidang_id: 'asc' }, { created_at: 'asc' }],
  });
  const bidangs = await prisma.bidangs.findMany({
    where: { id: { in: [...new Set(daftar.map((p) => p.bidang_id))] } },
    select: { id: true, nama: true },
  });
  const nama = new Map(bidangs.map((b) => [String(b.id), b.nama]));
  return daftar.map((p) => ({
    id: Number(p.id),
    bidang_id: Number(p.bidang_id),
    bidang: nama.get(String(p.bidang_id)) || null,
    judul: p.judul,
    deskripsi: p.deskripsi,
    orientasi: p.orientasi,
    maks_durasi_detik: p.maks_durasi_detik,
    tutup_pada: p.tutup_pada,
  }));
};

/* ========================================================== controller == */

class VideoDesaController {
  /* ------------------------------------------------ tautan (Sekretariat) -- */

  async lihatTautan(req, res) {
    try {
      const t = await ambilTautan();
      res.json({
        success: true,
        data: { ada: !!t, token: t?.token || null, status: t?.status || null, boleh_kelola: bolehKelolaTautan(req.user) },
      });
    } catch (error) {
      console.error('Error tautan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat tautan video desa.' });
    }
  }

  /** Buat tautan, atau ganti tokennya (tautan lama langsung mati). */
  async buatTautan(req, res) {
    try {
      if (!bolehKelolaTautan(req.user)) {
        return res.status(403).json({ success: false, message: 'Tautan video desa dikelola Bidang Sekretariat.' });
      }
      const token = crypto.randomBytes(16).toString('hex');
      const t = await prisma.video_desa_tautan.upsert({
        where: { id: 1 },
        create: { id: 1, token, status: 'dibuka', updated_by: BigInt(req.user.id) },
        update: { token, updated_by: BigInt(req.user.id), updated_at: new Date() },
      });
      res.json({ success: true, data: { ada: true, token: t.token, status: t.status, boleh_kelola: true } });
    } catch (error) {
      console.error('Error buat tautan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat tautan.' });
    }
  }

  async ubahTautan(req, res) {
    try {
      if (!bolehKelolaTautan(req.user)) {
        return res.status(403).json({ success: false, message: 'Tautan video desa dikelola Bidang Sekretariat.' });
      }
      const status = req.body?.status;
      if (!['dibuka', 'ditutup'].includes(status)) return res.status(400).json({ success: false, message: 'Status tidak dikenal.' });
      if (!(await ambilTautan())) return res.status(404).json({ success: false, message: 'Tautan belum dibuat.' });
      const t = await prisma.video_desa_tautan.update({
        where: { id: 1 },
        data: { status, updated_by: BigInt(req.user.id), updated_at: new Date() },
      });
      res.json({ success: true, data: { ada: true, token: t.token, status: t.status, boleh_kelola: true } });
    } catch (error) {
      console.error('Error ubah tautan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah tautan.' });
    }
  }

  /* ------------------------------------------------ kegiatan per bidang -- */

  async daftar(req, res) {
    try {
      const daftar = await prisma.video_desa_permintaan.findMany({
        where: { bidang_id: BigInt(req.params.bidangId), deleted_at: null },
        orderBy: { created_at: 'desc' },
      });
      const ids = daftar.map((p) => p.id);
      const kiriman = ids.length
        ? await prisma.video_desa_kiriman.findMany({
            where: { permintaan_id: { in: ids } },
            select: { permintaan_id: true, desa_id: true, status: true, pemrosesan: true, ukuran: true },
          })
        : [];

      const ringkas = new Map();
      for (const k of kiriman) {
        const kunci = String(k.permintaan_id);
        const r = ringkas.get(kunci) || { jumlah_video: 0, menunggu: 0, disetujui: 0, diproses: 0, ukuran_total: 0, desa: new Set() };
        r.jumlah_video += 1;
        r.desa.add(String(k.desa_id));
        if (['antre', 'diproses'].includes(k.pemrosesan)) r.diproses += 1;
        else if (k.pemrosesan === 'siap' && k.status === 'masuk') r.menunggu += 1;
        if (k.status === 'disetujui') r.disetujui += 1;
        r.ukuran_total += Number(k.ukuran || 0);
        ringkas.set(kunci, r);
      }

      res.json({
        success: true,
        data: daftar.map((p) => {
          const r = ringkas.get(String(p.id));
          const { token, maks_per_desa, ...aman } = p;
          return {
            ...rapikan(aman),
            tertutup: alasanTertutup(p),
            jumlah_video: r?.jumlah_video || 0,
            menunggu: r?.menunggu || 0,
            disetujui: r?.disetujui || 0,
            diproses: r?.diproses || 0,
            ukuran_total: r?.ukuran_total || 0,
            jumlah_desa: r?.desa.size || 0,
          };
        }),
      });
    } catch (error) {
      console.error('Error daftar video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat kegiatan video.' });
    }
  }

  async buat(req, res) {
    try {
      const { data, pesan } = siapkanPengaturan(req.body || {});
      if (pesan) return res.status(400).json({ success: false, message: pesan });
      const p = await prisma.video_desa_permintaan.create({
        data: {
          ...data,
          bidang_id: BigInt(req.params.bidangId),
          // Kolom lama dari versi tautan-per-kegiatan; tetap diisi karena unik
          // & wajib, tapi tidak dipakai di jalur publik mana pun.
          token: crypto.randomBytes(16).toString('hex'),
          maks_per_desa: 1,
          created_by: BigInt(req.user.id),
          updated_by: BigInt(req.user.id),
        },
      });
      res.status(201).json({ success: true, data: { id: Number(p.id) } });
    } catch (error) {
      console.error('Error buat kegiatan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat kegiatan video.' });
    }
  }

  async detail(req, res) {
    try {
      const { permintaan, kode, pesan } = await ambilPermintaan(req.user, req.params.id);
      if (!permintaan) return res.status(kode).json({ success: false, message: pesan });

      const kiriman = await prisma.video_desa_kiriman.findMany({
        where: { permintaan_id: permintaan.id },
        orderBy: { created_at: 'desc' },
      });
      const wilayah = await petaWilayah([...new Set(kiriman.map((k) => k.desa_id))]);
      const { token, maks_per_desa, ...aman } = permintaan;

      res.json({
        success: true,
        data: {
          ...rapikan(aman),
          tertutup: alasanTertutup(permintaan),
          maks_ukuran: MAKS_UKURAN,
          kiriman: kiriman.map((k) => ({
            ...kirimanAman(k),
            ...(wilayah.get(String(k.desa_id)) || {}),
            posisi_antrean: k.pemrosesan === 'antre' ? proses.posisiAntrean(k.id) : null,
          })),
        },
      });
    } catch (error) {
      console.error('Error detail video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat kegiatan video.' });
    }
  }

  async ubah(req, res) {
    try {
      const { permintaan, kode, pesan } = await ambilPermintaan(req.user, req.params.id);
      if (!permintaan) return res.status(kode).json({ success: false, message: pesan });
      const hasil = siapkanPengaturan(req.body || {}, { parsial: true });
      if (hasil.pesan) return res.status(400).json({ success: false, message: hasil.pesan });
      const baru = await prisma.video_desa_permintaan.update({
        where: { id: permintaan.id },
        data: { ...hasil.data, updated_by: BigInt(req.user.id), updated_at: new Date() },
      });
      res.json({ success: true, data: { id: Number(baru.id), tertutup: alasanTertutup(baru) } });
    } catch (error) {
      console.error('Error ubah video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan perubahan.' });
    }
  }

  /** Hapus kegiatan + SELURUH videonya dari disk (jejak kegiatan tetap ada). */
  async hapus(req, res) {
    try {
      const { permintaan, kode, pesan } = await ambilPermintaan(req.user, req.params.id);
      if (!permintaan) return res.status(kode).json({ success: false, message: pesan });
      const kiriman = await prisma.video_desa_kiriman.findMany({ where: { permintaan_id: permintaan.id } });
      await prisma.$transaction([
        prisma.video_desa_kiriman.deleteMany({ where: { permintaan_id: permintaan.id } }),
        prisma.video_desa_permintaan.update({
          where: { id: permintaan.id },
          data: { deleted_at: new Date(), deleted_by: BigInt(req.user.id) },
        }),
      ]);
      await Promise.all(kiriman.map(hapusBerkasKiriman));
      res.json({ success: true, message: 'Kegiatan video dihapus.' });
    } catch (error) {
      console.error('Error hapus video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus kegiatan video.' });
    }
  }

  /* --------------------------------------------------- verifikasi bidang -- */

  async tinjau(req, res) {
    try {
      const { kiriman, kode, pesan } = await ambilKiriman(req.user, req.params.id);
      if (!kiriman) return res.status(kode).json({ success: false, message: pesan });
      const status = req.body?.status;
      if (!['masuk', 'disetujui', 'ditolak'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status verifikasi tidak dikenal.' });
      }
      if (status === 'disetujui' && kiriman.pemrosesan !== 'siap') {
        return res.status(409).json({ success: false, message: 'Video belum selesai diperiksa sistem.' });
      }
      const baru = await prisma.video_desa_kiriman.update({
        where: { id: kiriman.id },
        data: {
          status,
          catatan: req.body?.catatan !== undefined ? (teks(req.body.catatan, 2000) || null) : kiriman.catatan,
          ditinjau_oleh: status === 'masuk' ? null : BigInt(req.user.id),
          ditinjau_pada: status === 'masuk' ? null : new Date(),
        },
      });
      res.json({ success: true, data: kirimanAman(baru) });
    } catch (error) {
      console.error('Error tinjau video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan verifikasi.' });
    }
  }

  async hapusKiriman(req, res) {
    try {
      const { kiriman, kode, pesan } = await ambilKiriman(req.user, req.params.id);
      if (!kiriman) return res.status(kode).json({ success: false, message: pesan });
      if (kiriman.pemrosesan === 'diproses') {
        return res.status(409).json({ success: false, message: 'Video sedang diproses; hapus setelah selesai.' });
      }
      await prisma.video_desa_kiriman.delete({ where: { id: kiriman.id } });
      await hapusBerkasKiriman(kiriman);
      res.json({ success: true, message: 'Video dihapus.' });
    } catch (error) {
      console.error('Error hapus kiriman video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus video.' });
    }
  }

  /**
   * Tautan putar/unduh bertanda tangan. Elemen <video> tidak bisa mengirim
   * header Authorization, dan mengunduh ratusan MB lewat blob di memori browser
   * tidak masuk akal — izinnya di tautan, berumur pendek, untuk satu video.
   */
  async tautanPutar(req, res) {
    try {
      const { kiriman, kode, pesan } = await ambilKiriman(req.user, req.params.id);
      if (!kiriman) return res.status(kode).json({ success: false, message: pesan });
      if (kiriman.pemrosesan !== 'siap') {
        return res.status(409).json({ success: false, message: 'Video belum selesai diperiksa sistem.' });
      }
      const t = jwt.sign({ k: 'video-desa', id: String(kiriman.id) }, process.env.JWT_SECRET, { expiresIn: UMUR_TAUTAN_PUTAR });
      const dasar = `/api/video-desa/putar/${kiriman.id}?t=${encodeURIComponent(t)}`;
      res.json({ success: true, data: { putar: dasar, unduh: `${dasar}&unduh=1` } });
    } catch (error) {
      console.error('Error tautan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyiapkan tautan video.' });
    }
  }

  async putar(req, res) {
    try {
      let muatan;
      try {
        muatan = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({ success: false, message: 'Tautan video sudah kedaluwarsa. Buka ulang dari aplikasi.' });
      }
      if (muatan.k !== 'video-desa' || muatan.id !== String(req.params.id)) {
        return res.status(403).json({ success: false, message: 'Tautan tidak berlaku untuk video ini.' });
      }
      const k = await prisma.video_desa_kiriman.findUnique({ where: { id: BigInt(req.params.id) } });
      if (!k || k.pemrosesan !== 'siap') return res.status(404).json({ success: false, message: 'Video tidak tersedia.' });

      const jalur = path.join(VIDEO_ROOT, k.jalur_disk);
      if (!jalur.startsWith(VIDEO_ROOT + path.sep) || !fs.existsSync(jalur)) {
        return res.status(404).json({ success: false, message: 'Berkas video tidak ada di server.' });
      }

      // Disajikan hanya sebagai video: tidak boleh ditafsirkan sebagai halaman.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (req.query.unduh) {
        const dasar = path.basename(k.nama_berkas, path.extname(k.nama_berkas)).replace(/[^\w\- .()]/g, '_') || 'video-desa';
        return res.download(jalur, `${dasar}.mp4`, { headers: { 'Content-Type': 'video/mp4' } });
      }
      return res.sendFile(jalur, { headers: { 'Content-Type': 'video/mp4' } });
    } catch (error) {
      console.error('Error putar video desa:', error);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Gagal memutar video.' });
    }
  }

  /* -------------------------------------------------------- publik -- */

  async publik(req, res) {
    try {
      const { tautan, kode, pesan } = await cekTautanPublik(req.params.token);
      if (!tautan) return res.status(kode).json({ success: false, message: pesan });

      const [kegiatan, kecamatan, desa] = await Promise.all([
        kegiatanTerbuka(),
        prisma.kecamatans.findMany({ select: { id: true, nama: true }, orderBy: { nama: 'asc' } }),
        prisma.desas.findMany({
          select: { id: true, nama: true, kecamatan_id: true, status_pemerintahan: true },
          orderBy: { nama: 'asc' },
        }),
      ]);
      res.json({
        success: true,
        data: {
          kegiatan,
          maks_ukuran: MAKS_UKURAN,
          ukuran_potongan: UKURAN_POTONGAN,
          ekstensi: EKSTENSI_SAH,
          desa_terkunci: desaDariToken(req),
          kecamatan: rapikan(kecamatan),
          desa: rapikan(desa),
        },
      });
    } catch (error) {
      console.error('Error publik video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat halaman unggah.' });
    }
  }

  /**
   * Status kiriman satu desa per kegiatan — supaya card bisa menampilkan
   * "sudah terkirim / ditolak, kirim ulang". Hanya status & alasan penolakan;
   * nama pengirim, nomor HP, dan berkasnya tidak ikut.
   */
  async statusDesa(req, res) {
    try {
      const { tautan, kode, pesan } = await cekTautanPublik(req.params.token);
      if (!tautan) return res.status(kode).json({ success: false, message: pesan });
      let desaId;
      try { desaId = BigInt(req.params.desaId); } catch { return res.status(400).json({ success: false, message: 'Desa tidak valid.' }); }
      const kiriman = await prisma.video_desa_kiriman.findMany({
        where: { desa_id: desaId },
        orderBy: { created_at: 'desc' },
        select: { permintaan_id: true, status: true, pemrosesan: true, catatan: true, pesan_proses: true, created_at: true },
      });
      // Hanya kiriman terbaru per kegiatan yang relevan bagi desa.
      const terbaru = new Map();
      for (const k of kiriman) if (!terbaru.has(String(k.permintaan_id))) terbaru.set(String(k.permintaan_id), k);
      res.json({
        success: true,
        data: [...terbaru.values()].map((k) => ({
          permintaan_id: Number(k.permintaan_id),
          status: k.status,
          pemrosesan: k.pemrosesan,
          alasan: k.status === 'ditolak' ? k.catatan : (k.pemrosesan === 'gagal' ? k.pesan_proses : null),
          dikirim_pada: k.created_at,
        })),
      });
    } catch (error) {
      console.error('Error status desa video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat status desa.' });
    }
  }

  async mulaiUnggah(req, res) {
    try {
      bersihkanSesiLama();
      const { tautan, kode, pesan } = await cekTautanPublik(req.params.token);
      if (!tautan) return res.status(kode).json({ success: false, message: pesan });

      const ip = String(req.ip || '');
      const b = req.body || {};
      const nama_pengirim = teks(b.nama_pengirim, 150);
      const no_hp = teks(b.no_hp, 30).replace(/[^\d+]/g, '');
      const keterangan = teks(b.keterangan, 2000) || null;
      const nama_berkas = path.basename(teks(b.nama_berkas, 255)).replace(/[\u0000-\u001f]/g, '') || 'video';
      const ukuran = Number(b.ukuran);
      const ext = path.extname(nama_berkas).toLowerCase();

      if (!nama_pengirim) return res.status(400).json({ success: false, message: 'Nama pengirim wajib diisi.' });
      if (no_hp.length < 9) return res.status(400).json({ success: false, message: 'Nomor HP/WhatsApp wajib diisi dengan benar.' });
      if (!EKSTENSI_SAH.includes(ext)) {
        return res.status(400).json({ success: false, message: `Format video harus ${EKSTENSI_SAH.join(', ')}. Disarankan MP4.` });
      }
      if (!Number.isInteger(ukuran) || ukuran <= 0) return res.status(400).json({ success: false, message: 'Ukuran berkas tidak valid.' });
      if (ukuran > MAKS_UKURAN) return res.status(413).json({ success: false, message: 'Ukuran video maksimal 1 GB.' });

      let permintaanId;
      let desaId;
      try { permintaanId = BigInt(b.permintaan_id); desaId = BigInt(b.desa_id); } catch { /* divalidasi di bawah */ }
      const p = permintaanId
        ? await prisma.video_desa_permintaan.findFirst({ where: { id: permintaanId, deleted_at: null } })
        : null;
      if (!p) return res.status(400).json({ success: false, message: 'Kegiatan video tidak ditemukan.' });
      const tertutup = alasanTertutup(p);
      if (tertutup) return res.status(403).json({ success: false, message: tertutup });
      const desa = desaId ? await prisma.desas.findUnique({ where: { id: desaId }, select: { id: true } }) : null;
      if (!desa) return res.status(400).json({ success: false, message: 'Pilih desa terlebih dahulu.' });

      if (await kirimanBerlaku(p.id, desa.id)) {
        return res.status(409).json({ success: false, message: 'Desa ini sudah mengirim video untuk kegiatan ini.' });
      }

      const sesi = await daftarSesi();
      const kini = Date.now();
      // Sesi paralel untuk desa & kegiatan yang sama: yang lama digantikan.
      await Promise.all(sesi
        .filter((s) => s.permintaan_id === String(p.id) && s.desa_id === String(desa.id))
        .map((s) => hapusSesi(s.upload_id)));
      const aktifIp = sesi.filter((s) => s.ip === ip && kini - (s.aktif || s.dibuat) < SESI_AKTIF_MS
        && !(s.permintaan_id === String(p.id) && s.desa_id === String(desa.id)));
      if (aktifIp.length >= MAKS_SESI_AKTIF_PER_IP) {
        return res.status(429).json({ success: false, message: 'Terlalu banyak unggahan berjalan dari jaringan ini. Selesaikan yang lain dulu.' });
      }
      if (!catatMulai(ip)) {
        return res.status(429).json({ success: false, message: 'Terlalu banyak unggahan dari jaringan ini. Coba lagi sejam lagi.' });
      }

      // Disk: berkas mentah + hasil bersih sempat berdampingan saat diproses.
      const tolakKuota = storageServer.cekUnggahan(ukuran * 2);
      if (tolakKuota) return res.status(tolakKuota.status).json({ success: false, message: tolakKuota.message });

      const upload_id = crypto.randomBytes(16).toString('hex');
      await fsp.mkdir(folderSesi(upload_id), { recursive: true });
      await fsp.writeFile(berkasData(upload_id), Buffer.alloc(0));
      const jumlah_potongan = Math.ceil(ukuran / UKURAN_POTONGAN);
      await tulisSesi({
        upload_id,
        token: tautan.token,
        permintaan_id: String(p.id),
        desa_id: String(desa.id),
        nama_pengirim,
        no_hp,
        keterangan,
        nama_berkas,
        ext,
        ukuran,
        jumlah_potongan,
        diterima: 0,
        ip,
        dibuat: kini,
      });
      res.status(201).json({ success: true, data: { upload_id, ukuran_potongan: UKURAN_POTONGAN, jumlah_potongan } });
    } catch (error) {
      console.error('Error mulai unggah video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memulai unggahan.' });
    }
  }

  async statusUnggah(req, res) {
    const meta = await bacaSesi(req.params.token, req.params.uploadId);
    if (!meta) return res.status(404).json({ success: false, message: 'Sesi unggah tidak ditemukan. Mulai ulang unggahan.' });
    res.json({ success: true, data: { diterima: meta.diterima, jumlah_potongan: meta.jumlah_potongan } });
  }

  /** Satu potongan (body mentah), wajib berurutan; pengulangan dianggap sukses. */
  async potongan(req, res) {
    const { token, uploadId } = req.params;
    const indeks = Number(req.params.indeks);
    if (sedangDitulis.has(uploadId)) return res.status(409).json({ success: false, message: 'Potongan sebelumnya masih diproses.' });
    sedangDitulis.add(uploadId);
    try {
      const meta = await bacaSesi(token, uploadId);
      if (!meta) return res.status(404).json({ success: false, message: 'Sesi unggah tidak ditemukan. Mulai ulang unggahan.' });
      if (!Number.isInteger(indeks) || indeks < 0 || indeks >= meta.jumlah_potongan) {
        return res.status(400).json({ success: false, message: 'Nomor potongan tidak valid.' });
      }
      if (indeks < meta.diterima) return res.json({ success: true, data: { diterima: meta.diterima } });
      if (indeks > meta.diterima) {
        return res.status(409).json({ success: false, message: 'Potongan tidak berurutan.', data: { diterima: meta.diterima } });
      }
      const isi = req.body;
      if (!Buffer.isBuffer(isi) || !isi.length) return res.status(400).json({ success: false, message: 'Potongan kosong.' });
      const terakhir = indeks === meta.jumlah_potongan - 1;
      const seharusnya = terakhir ? meta.ukuran - indeks * UKURAN_POTONGAN : UKURAN_POTONGAN;
      if (isi.length !== seharusnya) return res.status(400).json({ success: false, message: 'Ukuran potongan tidak sesuai.' });
      // Potongan pertama langsung diperiksa: berkas yang jelas bukan video
      // tidak perlu dibiarkan mengirim ratusan MB lagi.
      if (indeks === 0 && (isi.length < 12 || (isi.toString('ascii', 4, 8) !== 'ftyp' && isi.readUInt32BE(0) !== 0x1a45dfa3))) {
        await hapusSesi(uploadId);
        return res.status(400).json({ success: false, message: 'Berkas ini bukan video yang dikenali. Gunakan MP4, MOV, atau WebM.' });
      }

      const fh = await fsp.open(berkasData(uploadId), 'r+');
      try {
        await fh.write(isi, 0, isi.length, indeks * UKURAN_POTONGAN);
      } finally {
        await fh.close();
      }
      meta.diterima = indeks + 1;
      await tulisSesi(meta);
      res.json({ success: true, data: { diterima: meta.diterima } });
    } catch (error) {
      console.error('Error potongan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan potongan video.' });
    } finally {
      sedangDitulis.delete(uploadId);
    }
  }

  /** Rakit, periksa cepat, lalu serahkan ke antrean pembersih. */
  async selesaiUnggah(req, res) {
    const { token, uploadId } = req.params;
    try {
      const meta = await bacaSesi(token, uploadId);
      if (!meta) return res.status(404).json({ success: false, message: 'Sesi unggah tidak ditemukan. Mulai ulang unggahan.' });
      if (meta.diterima !== meta.jumlah_potongan) {
        return res.status(409).json({ success: false, message: 'Video belum terunggah seluruhnya.', data: { diterima: meta.diterima } });
      }
      const { tautan, kode, pesan } = await cekTautanPublik(token);
      if (!tautan) { await hapusSesi(uploadId); return res.status(kode).json({ success: false, message: pesan }); }
      const p = await prisma.video_desa_permintaan.findFirst({ where: { id: BigInt(meta.permintaan_id), deleted_at: null } });
      const tertutup = p ? alasanTertutup(p) : 'Kegiatan video tidak ditemukan.';
      if (tertutup) { await hapusSesi(uploadId); return res.status(403).json({ success: false, message: tertutup }); }

      const sementara = berkasData(uploadId);
      const st = await fsp.stat(sementara);
      const tolak = async (kodeHttp, pesanTolak) => { await hapusSesi(uploadId); return res.status(kodeHttp).json({ success: false, message: pesanTolak }); };
      if (st.size !== meta.ukuran) return tolak(400, 'Berkas yang diterima tidak utuh. Silakan unggah ulang.');
      if (!(await cekTandaVideo(sementara))) return tolak(400, 'Berkas ini bukan video yang dikenali. Gunakan MP4, MOV, atau WebM.');
      const info = await proses.periksa(sementara);
      if (info.galat) return tolak(400, `${info.galat} Periksa kembali berkasnya.`);

      // Diperiksa ulang: dua sesi untuk desa & kegiatan yang sama bisa selesai bersamaan.
      if (await kirimanBerlaku(p.id, BigInt(meta.desa_id))) return tolak(409, 'Desa ini sudah mengirim video untuk kegiatan ini.');

      const kini = new Date();
      const segmen = path.join(String(p.id), String(kini.getFullYear()), String(kini.getMonth() + 1).padStart(2, '0'));
      const nama_disk = `${crypto.randomBytes(24).toString('hex')}${meta.ext}`;
      await fsp.rename(sementara, path.join(MENTAH_ROOT, nama_disk));
      await hapusSesi(uploadId);

      const kiriman = await prisma.video_desa_kiriman.create({
        data: {
          permintaan_id: p.id,
          desa_id: BigInt(meta.desa_id),
          nama_pengirim: meta.nama_pengirim,
          no_hp: meta.no_hp || null,
          keterangan: meta.keterangan,
          nama_berkas: meta.nama_berkas,
          ukuran: BigInt(meta.ukuran),
          ukuran_asli: BigInt(meta.ukuran),
          nama_disk,
          jalur_disk: path.join(segmen, nama_disk),
          pemrosesan: 'antre',
          ip: String(req.ip || '').slice(0, 45),
        },
      });
      proses.masukkan(kiriman.id);

      res.status(201).json({ success: true, data: { id: Number(kiriman.id), pemrosesan: 'antre' } });
    } catch (error) {
      console.error('Error selesai unggah video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan video.' });
    }
  }

  async batalUnggah(req, res) {
    const meta = await bacaSesi(req.params.token, req.params.uploadId);
    if (meta) await hapusSesi(meta.upload_id);
    res.json({ success: true });
  }
}

module.exports = new VideoDesaController();
module.exports.UKURAN_POTONGAN = UKURAN_POTONGAN;
module.exports.MAKS_UKURAN = MAKS_UKURAN;
