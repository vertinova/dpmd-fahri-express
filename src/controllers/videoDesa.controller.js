/**
 * Video Desa: bidang meminta video dari desa lewat tautan publik.
 *
 * Alur:
 * 1. Bidang membuat "permintaan" (judul + arahan konten) dan membagikan
 *    tautannya (/v/<token>) ke desa.
 * 2. Desa membuka tautan tanpa login, memilih desanya, lalu mengunggah video.
 *    Unggahan dipecah per potongan (UKURAN_POTONGAN) — sinyal di desa sering
 *    putus, dan satu request 500 MB yang gagal di 90% harus diulang dari nol.
 *    Dengan potongan, yang diulang hanya potongan terakhir.
 * 3. Bidang meninjau kiriman (setujui/tolak), memutar, dan mengunduhnya untuk
 *    videotron dan media sosial.
 *
 * Penyimpanan di private/video-desa — sejajar dengan storage/, bukan di
 * dalamnya, karena storage/ disajikan statis tanpa login. Satu-satunya jalan
 * memutar/mengunduh adalah /putar/:id dengan tautan bertanda tangan berumur
 * pendek (elemen <video> tidak bisa mengirim header Authorization).
 *
 * Seluruh isi `publik*` dilayani ke internet terbuka: semua masukan divalidasi
 * ulang di sini, dan yang tidak perlu diketahui pengunggah tidak ikut dikirim.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const storageServer = require('../services/serverStorage.service');

const VIDEO_ROOT = path.join(__dirname, '../../private/video-desa');
const SEMENTARA_ROOT = path.join(VIDEO_ROOT, '_sementara');

/**
 * 500 MB per video.
 *
 * Videotron memutar 1080p (sering lebih rendah — resolusi panel LED jarang
 * melampaui itu) dan klipnya pendek, 15–60 detik. Video 1080p H.264 dari HP
 * berbitrate ~10–17 Mbps, jadi 500 MB ≈ 4–6 menit rekaman mentah, atau jauh
 * lebih panjang untuk video yang sudah disunting. Lebih dari itu hampir pasti
 * 4K mentah yang tidak terpakai di videotron dan hanya memakan disk.
 */
const MAKS_UKURAN = 500 * 1024 * 1024;

// 8 MB per potongan: cukup kecil untuk diulang di sinyal lemah, cukup besar
// supaya 500 MB hanya ~63 request (rate limit anonim 1000/15 menit per IP).
const UKURAN_POTONGAN = 8 * 1024 * 1024;

const EKSTENSI_SAH = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'];

const MIME_EKSTENSI = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

// Sesi unggah yang tidak selesai dalam sehari dianggap ditinggalkan.
const UMUR_SESI_MS = 24 * 60 * 60 * 1000;

const UMUR_TAUTAN_PUTAR = '3h';

const PIMPINAN = ['superadmin', 'kepala_dinas', 'sekretaris_dinas'];

fs.mkdirSync(SEMENTARA_ROOT, { recursive: true });

/* ------------------------------------------------------------- bantuan -- */

/** BigInt/Decimal tidak bisa di-JSON.stringify; dinormalkan ke Number. */
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

const ambilPermintaan = async (user, id) => {
  let idBig;
  try { idBig = BigInt(id); } catch { return { kode: 404, pesan: 'Permintaan tidak ditemukan.' }; }
  const permintaan = await prisma.video_desa_permintaan.findFirst({
    where: { id: idBig, deleted_at: null },
  });
  if (!permintaan) return { kode: 404, pesan: 'Permintaan tidak ditemukan.' };
  if (!bolehKelola(user, permintaan.bidang_id)) {
    return { kode: 403, pesan: 'Permintaan video ini milik bidang lain.' };
  }
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

/** Alasan permintaan tidak menerima unggahan, atau null bila terbuka. */
const alasanTertutup = (p) => {
  if (p.status === 'ditutup') return 'Permintaan video ini sudah ditutup oleh bidang.';
  if (p.tutup_pada && new Date(p.tutup_pada) < new Date()) {
    return 'Batas waktu pengunggahan video ini sudah lewat.';
  }
  return null;
};

const tanggalAtauNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Bersihkan & validasi isian pengaturan permintaan. { data } atau { pesan }. */
const siapkanPengaturan = (body, { parsial = false } = {}) => {
  const data = {};
  if (!parsial || body.judul !== undefined) {
    data.judul = teks(body.judul, 255);
    if (!data.judul) return { pesan: 'Judul video wajib diisi.' };
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
      if (!Number.isInteger(n) || n < 5 || n > 3600) return { pesan: 'Batas durasi harus 5–3600 detik.' };
      data.maks_durasi_detik = n;
    }
  }
  if (body.maks_per_desa !== undefined) {
    const n = Number(body.maks_per_desa);
    if (!Number.isInteger(n) || n < 1 || n > 10) return { pesan: 'Batas video per desa harus 1–10.' };
    data.maks_per_desa = n;
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

/** Peta id → { desa, kecamatan } untuk daftar kiriman. */
const petaWilayah = async (desaIds) => {
  if (!desaIds.length) return new Map();
  const desas = await prisma.desas.findMany({
    where: { id: { in: desaIds } },
    select: { id: true, nama: true, status_pemerintahan: true, kecamatan_id: true },
  });
  const kecIds = [...new Set(desas.map((d) => d.kecamatan_id))];
  const kecs = await prisma.kecamatans.findMany({
    where: { id: { in: kecIds } },
    select: { id: true, nama: true },
  });
  const petaKec = new Map(kecs.map((k) => [String(k.id), k.nama]));
  return new Map(desas.map((d) => [String(d.id), {
    desa: d.nama,
    status_pemerintahan: d.status_pemerintahan,
    kecamatan: petaKec.get(String(d.kecamatan_id)) || null,
  }]));
};

/** Kenali video dari byte awalnya — ekstensi dan MIME dari browser bisa dikarang. */
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

/**
 * Baca durasi & resolusi dengan ffprobe. Fail-open: tanpa ffprobe (atau bila
 * gagal membaca) video tetap diterima, hanya metadatanya kosong.
 */
const bacaMetadata = (berkas) => new Promise((resolve) => {
  let keluar = '';
  let selesai = false;
  const akhiri = (hasil) => { if (!selesai) { selesai = true; resolve(hasil); } };
  try {
    const p = spawn('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', berkas,
    ]);
    const batas = setTimeout(() => { p.kill('SIGKILL'); akhiri({}); }, 30000);
    p.stdout.on('data', (d) => { keluar += d; });
    p.on('error', () => { clearTimeout(batas); akhiri({}); });
    p.on('close', () => {
      clearTimeout(batas);
      try {
        const j = JSON.parse(keluar);
        const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
        // Video HP sering direkam lanskap lalu diberi tanda rotasi 90°.
        const rotasi = Math.abs(Number(
          v.tags?.rotate ?? (v.side_data_list || []).find((s) => s.rotation !== undefined)?.rotation ?? 0
        ));
        const tegak = rotasi === 90 || rotasi === 270;
        const durasi = Number(j.format?.duration);
        akhiri({
          durasi_detik: Number.isFinite(durasi) ? Math.round(durasi * 100) / 100 : null,
          lebar: (tegak ? v.height : v.width) || null,
          tinggi: (tegak ? v.width : v.height) || null,
          codec: v.codec_name ? String(v.codec_name).slice(0, 30) : null,
        });
      } catch {
        akhiri({});
      }
    });
  } catch {
    akhiri({});
  }
});

/* ------------------------------------------------------- sesi unggahan -- */

const ID_SESI_RE = /^[a-f0-9]{32}$/;
const sedangDitulis = new Set();

const folderSesi = (uploadId) => path.join(SEMENTARA_ROOT, uploadId);
const berkasMeta = (uploadId) => path.join(folderSesi(uploadId), 'meta.json');
const berkasData = (uploadId) => path.join(folderSesi(uploadId), 'data.part');

const bacaSesi = async (token, uploadId) => {
  if (!ID_SESI_RE.test(String(uploadId))) return null;
  try {
    const meta = JSON.parse(await fsp.readFile(berkasMeta(uploadId), 'utf8'));
    return meta.token === token ? meta : null;
  } catch {
    return null;
  }
};

const tulisSesi = (meta) => fsp.writeFile(berkasMeta(meta.upload_id), JSON.stringify(meta));

const hapusSesi = (uploadId) =>
  fsp.rm(folderSesi(uploadId), { recursive: true, force: true }).catch(() => {});

let terakhirBersih = 0;
/** Buang sesi yang ditinggalkan. Paling sering sejam sekali, fail-open. */
const bersihkanSesiLama = async () => {
  if (Date.now() - terakhirBersih < 60 * 60 * 1000) return;
  terakhirBersih = Date.now();
  try {
    const isi = await fsp.readdir(SEMENTARA_ROOT);
    await Promise.all(isi.map(async (nama) => {
      const st = await fsp.stat(path.join(SEMENTARA_ROOT, nama)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > UMUR_SESI_MS) await hapusSesi(nama);
    }));
  } catch { /* abaikan */ }
};

/**
 * Jumlah kiriman sebuah desa yang dihitung ke batas per desa. Kiriman yang
 * ditolak tidak dihitung — desa harus bisa mengirim ulang versi perbaikannya.
 */
const hitungKirimanDesa = (permintaanId, desaId) =>
  prisma.video_desa_kiriman.count({
    where: { permintaan_id: permintaanId, desa_id: desaId, status: { not: 'ditolak' } },
  });

/** Desa yang terkunci untuk akun desa yang sedang login (bila ada). */
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

const ambilPermintaanPublik = (token) =>
  prisma.video_desa_permintaan.findFirst({
    where: { token: String(token || '').slice(0, 32), deleted_at: null },
  });

/* ========================================================== controller == */

class VideoDesaController {
  /* ---------------------------------------------------- pengelolaan -- */

  async daftar(req, res) {
    try {
      const bidangId = BigInt(req.params.bidangId);
      const daftar = await prisma.video_desa_permintaan.findMany({
        where: { bidang_id: bidangId, deleted_at: null },
        orderBy: { created_at: 'desc' },
      });

      const ids = daftar.map((p) => p.id);
      const hitung = ids.length
        ? await prisma.video_desa_kiriman.groupBy({
            by: ['permintaan_id', 'status'],
            where: { permintaan_id: { in: ids } },
            _count: { _all: true },
            _sum: { ukuran: true },
          })
        : [];
      const desaPer = ids.length
        ? await prisma.video_desa_kiriman.groupBy({
            by: ['permintaan_id', 'desa_id'],
            where: { permintaan_id: { in: ids } },
          })
        : [];

      const ringkas = new Map();
      for (const h of hitung) {
        const k = String(h.permintaan_id);
        const r = ringkas.get(k) || { jumlah_video: 0, menunggu: 0, disetujui: 0, ukuran_total: 0, jumlah_desa: 0 };
        r.jumlah_video += h._count._all;
        if (h.status === 'masuk') r.menunggu += h._count._all;
        if (h.status === 'disetujui') r.disetujui += h._count._all;
        r.ukuran_total += Number(h._sum.ukuran || 0);
        ringkas.set(k, r);
      }
      for (const d of desaPer) {
        const r = ringkas.get(String(d.permintaan_id));
        if (r) r.jumlah_desa += 1;
      }

      res.json({
        success: true,
        data: daftar.map((p) => ({
          ...rapikan(p),
          tertutup: alasanTertutup(p),
          ...(ringkas.get(String(p.id)) || { jumlah_video: 0, menunggu: 0, disetujui: 0, ukuran_total: 0, jumlah_desa: 0 }),
        })),
      });
    } catch (error) {
      console.error('Error daftar video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat permintaan video.' });
    }
  }

  async buat(req, res) {
    try {
      const { data, pesan } = siapkanPengaturan(req.body || {});
      if (pesan) return res.status(400).json({ success: false, message: pesan });

      const permintaan = await prisma.video_desa_permintaan.create({
        data: {
          ...data,
          bidang_id: BigInt(req.params.bidangId),
          token: crypto.randomBytes(16).toString('hex'),
          created_by: BigInt(req.user.id),
          updated_by: BigInt(req.user.id),
        },
      });
      res.status(201).json({ success: true, data: rapikan(permintaan) });
    } catch (error) {
      console.error('Error buat permintaan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat permintaan video.' });
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

      res.json({
        success: true,
        data: {
          ...rapikan(permintaan),
          tertutup: alasanTertutup(permintaan),
          maks_ukuran: MAKS_UKURAN,
          kiriman: kiriman.map((k) => {
            const { jalur_disk, nama_disk, ip, ...aman } = k;
            return { ...rapikan(aman), ...(wilayah.get(String(k.desa_id)) || {}) };
          }),
        },
      });
    } catch (error) {
      console.error('Error detail video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat permintaan video.' });
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
      res.json({ success: true, data: { ...rapikan(baru), tertutup: alasanTertutup(baru) } });
    } catch (error) {
      console.error('Error ubah video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan perubahan.' });
    }
  }

  /**
   * Hapus permintaan beserta SELURUH videonya dari disk. Permintaan sendiri
   * hanya ditandai terhapus (jejak tetap ada), tapi videonya benar-benar
   * dibuang — menyisakan ratusan MB per kiriman tanpa jalan mengaksesnya hanya
   * menghabiskan disk.
   */
  async hapus(req, res) {
    try {
      const { permintaan, kode, pesan } = await ambilPermintaan(req.user, req.params.id);
      if (!permintaan) return res.status(kode).json({ success: false, message: pesan });

      const kiriman = await prisma.video_desa_kiriman.findMany({
        where: { permintaan_id: permintaan.id },
        select: { jalur_disk: true },
      });
      await prisma.$transaction([
        prisma.video_desa_kiriman.deleteMany({ where: { permintaan_id: permintaan.id } }),
        prisma.video_desa_permintaan.update({
          where: { id: permintaan.id },
          data: { deleted_at: new Date(), deleted_by: BigInt(req.user.id) },
        }),
      ]);
      await Promise.all(kiriman.map((k) => fsp.unlink(path.join(VIDEO_ROOT, k.jalur_disk)).catch(() => {})));

      res.json({ success: true, message: 'Permintaan video dihapus.' });
    } catch (error) {
      console.error('Error hapus video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus permintaan video.' });
    }
  }

  async tinjau(req, res) {
    try {
      const { kiriman, kode, pesan } = await ambilKiriman(req.user, req.params.id);
      if (!kiriman) return res.status(kode).json({ success: false, message: pesan });

      const status = req.body?.status;
      if (!['masuk', 'disetujui', 'ditolak'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status tinjauan tidak dikenal.' });
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
      const { jalur_disk, nama_disk, ip, ...aman } = baru;
      res.json({ success: true, data: rapikan(aman) });
    } catch (error) {
      console.error('Error tinjau video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan tinjauan.' });
    }
  }

  async hapusKiriman(req, res) {
    try {
      const { kiriman, kode, pesan } = await ambilKiriman(req.user, req.params.id);
      if (!kiriman) return res.status(kode).json({ success: false, message: pesan });

      await prisma.video_desa_kiriman.delete({ where: { id: kiriman.id } });
      await fsp.unlink(path.join(VIDEO_ROOT, kiriman.jalur_disk)).catch(() => {});
      res.json({ success: true, message: 'Video dihapus.' });
    } catch (error) {
      console.error('Error hapus kiriman video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus video.' });
    }
  }

  /**
   * Tautan putar/unduh bertanda tangan. Elemen <video> dan tautan unduhan
   * biasa tidak bisa mengirim header Authorization, dan mengunduh 500 MB lewat
   * blob di memori browser tidak masuk akal — jadi izinnya ditaruh di tautan,
   * berumur pendek dan hanya untuk satu video.
   */
  async tautan(req, res) {
    try {
      const { kiriman, kode, pesan } = await ambilKiriman(req.user, req.params.id);
      if (!kiriman) return res.status(kode).json({ success: false, message: pesan });

      const t = jwt.sign({ k: 'video-desa', id: String(kiriman.id) }, process.env.JWT_SECRET, {
        expiresIn: UMUR_TAUTAN_PUTAR,
      });
      const dasar = `/api/video-desa/putar/${kiriman.id}?t=${encodeURIComponent(t)}`;
      res.json({ success: true, data: { putar: dasar, unduh: `${dasar}&unduh=1` } });
    } catch (error) {
      console.error('Error tautan video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menyiapkan tautan video.' });
    }
  }

  /** Sajikan video (mendukung Range, jadi bisa digeser di pemutar). */
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

      const kiriman = await prisma.video_desa_kiriman.findUnique({ where: { id: BigInt(req.params.id) } });
      if (!kiriman) return res.status(404).json({ success: false, message: 'Video tidak ditemukan.' });

      const jalur = path.join(VIDEO_ROOT, kiriman.jalur_disk);
      if (!jalur.startsWith(VIDEO_ROOT + path.sep) || !fs.existsSync(jalur)) {
        return res.status(404).json({ success: false, message: 'Berkas video tidak ada di server.' });
      }

      if (req.query.unduh) {
        const ext = path.extname(kiriman.jalur_disk);
        const dasarNama = path.basename(kiriman.nama_berkas, path.extname(kiriman.nama_berkas)) || 'video-desa';
        return res.download(jalur, `${dasarNama}${ext}`);
      }
      res.setHeader('Content-Type', kiriman.mime || MIME_EKSTENSI[path.extname(jalur)] || 'video/mp4');
      return res.sendFile(jalur);
    } catch (error) {
      console.error('Error putar video desa:', error);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Gagal memutar video.' });
    }
  }

  /* -------------------------------------------------------- publik -- */

  async publik(req, res) {
    try {
      const p = await ambilPermintaanPublik(req.params.token);
      if (!p) return res.status(404).json({ success: false, message: 'Tautan video tidak ditemukan atau sudah dihapus.' });

      const [kecamatan, desa] = await Promise.all([
        prisma.kecamatans.findMany({ select: { id: true, nama: true }, orderBy: { nama: 'asc' } }),
        prisma.desas.findMany({
          select: { id: true, nama: true, kecamatan_id: true, status_pemerintahan: true },
          orderBy: { nama: 'asc' },
        }),
      ]);

      res.json({
        success: true,
        data: {
          judul: p.judul,
          deskripsi: p.deskripsi,
          orientasi: p.orientasi,
          maks_durasi_detik: p.maks_durasi_detik,
          maks_per_desa: p.maks_per_desa,
          tutup_pada: p.tutup_pada,
          tertutup: alasanTertutup(p),
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

  /** Mulai sesi unggah: validasi isian & kuota, lalu kembalikan upload_id. */
  async mulaiUnggah(req, res) {
    try {
      bersihkanSesiLama();

      const p = await ambilPermintaanPublik(req.params.token);
      if (!p) return res.status(404).json({ success: false, message: 'Tautan video tidak ditemukan.' });
      const tertutup = alasanTertutup(p);
      if (tertutup) return res.status(403).json({ success: false, message: tertutup });

      const b = req.body || {};
      const nama_pengirim = teks(b.nama_pengirim, 150);
      const no_hp = teks(b.no_hp, 30).replace(/[^\d+]/g, '');
      const keterangan = teks(b.keterangan, 2000) || null;
      const nama_berkas = path.basename(teks(b.nama_berkas, 255)) || 'video';
      const ukuran = Number(b.ukuran);
      const ext = path.extname(nama_berkas).toLowerCase();

      if (!nama_pengirim) return res.status(400).json({ success: false, message: 'Nama pengirim wajib diisi.' });
      if (no_hp.length < 9) return res.status(400).json({ success: false, message: 'Nomor HP/WhatsApp wajib diisi dengan benar.' });
      if (!EKSTENSI_SAH.includes(ext)) {
        return res.status(400).json({ success: false, message: `Format video harus ${EKSTENSI_SAH.join(', ')}. Disarankan MP4.` });
      }
      if (!Number.isInteger(ukuran) || ukuran <= 0) return res.status(400).json({ success: false, message: 'Ukuran berkas tidak valid.' });
      if (ukuran > MAKS_UKURAN) {
        return res.status(413).json({ success: false, message: `Ukuran video maksimal ${MAKS_UKURAN / 1048576} MB.` });
      }

      let desaId;
      try { desaId = BigInt(b.desa_id); } catch { desaId = null; }
      const desa = desaId ? await prisma.desas.findUnique({ where: { id: desaId }, select: { id: true } }) : null;
      if (!desa) return res.status(400).json({ success: false, message: 'Pilih desa terlebih dahulu.' });

      const sudah = await hitungKirimanDesa(p.id, desa.id);
      if (sudah >= p.maks_per_desa) {
        return res.status(409).json({
          success: false,
          message: `Desa ini sudah mengirim ${sudah} video — batas untuk permintaan ini ${p.maks_per_desa} video per desa.`,
        });
      }

      const tolakKuota = storageServer.cekUnggahan(ukuran);
      if (tolakKuota) return res.status(tolakKuota.status).json({ success: false, message: tolakKuota.message });

      const upload_id = crypto.randomBytes(16).toString('hex');
      await fsp.mkdir(folderSesi(upload_id), { recursive: true });
      await fsp.writeFile(berkasData(upload_id), Buffer.alloc(0));
      await tulisSesi({
        upload_id,
        token: p.token,
        permintaan_id: String(p.id),
        desa_id: String(desa.id),
        nama_pengirim,
        no_hp,
        keterangan,
        nama_berkas,
        ext,
        ukuran,
        jumlah_potongan: Math.ceil(ukuran / UKURAN_POTONGAN),
        diterima: 0,
        dibuat: Date.now(),
      });

      res.status(201).json({
        success: true,
        data: { upload_id, ukuran_potongan: UKURAN_POTONGAN, jumlah_potongan: Math.ceil(ukuran / UKURAN_POTONGAN) },
      });
    } catch (error) {
      console.error('Error mulai unggah video desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memulai unggahan.' });
    }
  }

  /** Status sesi — dipakai klien untuk melanjutkan setelah koneksi putus. */
  async statusUnggah(req, res) {
    const meta = await bacaSesi(req.params.token, req.params.uploadId);
    if (!meta) return res.status(404).json({ success: false, message: 'Sesi unggah tidak ditemukan. Mulai ulang unggahan.' });
    res.json({ success: true, data: { diterima: meta.diterima, jumlah_potongan: meta.jumlah_potongan } });
  }

  /**
   * Terima satu potongan (body mentah). Potongan wajib datang berurutan; potongan
   * yang sudah diterima dianggap sukses (pengulangan setelah balasan hilang).
   */
  async potongan(req, res) {
    const { token, uploadId } = req.params;
    const indeks = Number(req.params.indeks);
    if (sedangDitulis.has(uploadId)) {
      return res.status(409).json({ success: false, message: 'Potongan sebelumnya masih diproses.' });
    }
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
      if (!Buffer.isBuffer(isi) || !isi.length) {
        return res.status(400).json({ success: false, message: 'Potongan kosong.' });
      }
      const terakhir = indeks === meta.jumlah_potongan - 1;
      const seharusnya = terakhir ? meta.ukuran - indeks * UKURAN_POTONGAN : UKURAN_POTONGAN;
      if (isi.length !== seharusnya) {
        return res.status(400).json({ success: false, message: 'Ukuran potongan tidak sesuai.' });
      }

      // Tulis di posisi yang pasti (bukan append) supaya potongan yang sempat
      // tertulis sebagian sebelum server mati tertimpa dengan benar.
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

  /** Rakit: periksa kelengkapan & jenis berkas, pindahkan, catat kiriman. */
  async selesaiUnggah(req, res) {
    const { token, uploadId } = req.params;
    try {
      const meta = await bacaSesi(token, uploadId);
      if (!meta) return res.status(404).json({ success: false, message: 'Sesi unggah tidak ditemukan. Mulai ulang unggahan.' });
      if (meta.diterima !== meta.jumlah_potongan) {
        return res.status(409).json({ success: false, message: 'Video belum terunggah seluruhnya.', data: { diterima: meta.diterima } });
      }

      const p = await ambilPermintaanPublik(token);
      if (!p) return res.status(404).json({ success: false, message: 'Tautan video tidak ditemukan.' });
      const tertutup = alasanTertutup(p);
      if (tertutup) {
        await hapusSesi(uploadId);
        return res.status(403).json({ success: false, message: tertutup });
      }

      const sementara = berkasData(uploadId);
      const st = await fsp.stat(sementara);
      if (st.size !== meta.ukuran) {
        await hapusSesi(uploadId);
        return res.status(400).json({ success: false, message: 'Berkas yang diterima tidak utuh. Silakan unggah ulang.' });
      }
      if (!(await cekTandaVideo(sementara))) {
        await hapusSesi(uploadId);
        return res.status(400).json({ success: false, message: 'Berkas ini bukan video yang dikenali. Gunakan MP4, MOV, atau WebM.' });
      }

      // Diperiksa ulang: dua sesi dari desa yang sama bisa berjalan bersamaan.
      const sudah = await hitungKirimanDesa(p.id, BigInt(meta.desa_id));
      if (sudah >= p.maks_per_desa) {
        await hapusSesi(uploadId);
        return res.status(409).json({
          success: false,
          message: `Desa ini sudah mengirim ${sudah} video — batas untuk permintaan ini ${p.maks_per_desa} video per desa.`,
        });
      }

      const kini = new Date();
      const segmen = path.join(String(p.id), String(kini.getFullYear()), String(kini.getMonth() + 1).padStart(2, '0'));
      await fsp.mkdir(path.join(VIDEO_ROOT, segmen), { recursive: true });
      const nama_disk = `${crypto.randomBytes(24).toString('hex')}${meta.ext}`;
      const jalur_disk = path.join(segmen, nama_disk);
      await fsp.rename(sementara, path.join(VIDEO_ROOT, jalur_disk));
      await hapusSesi(uploadId);

      const info = await bacaMetadata(path.join(VIDEO_ROOT, jalur_disk));

      const kiriman = await prisma.video_desa_kiriman.create({
        data: {
          permintaan_id: p.id,
          desa_id: BigInt(meta.desa_id),
          nama_pengirim: meta.nama_pengirim,
          no_hp: meta.no_hp || null,
          keterangan: meta.keterangan,
          nama_berkas: meta.nama_berkas,
          mime: MIME_EKSTENSI[meta.ext] || null,
          ukuran: BigInt(meta.ukuran),
          durasi_detik: info.durasi_detik ?? null,
          lebar: info.lebar ?? null,
          tinggi: info.tinggi ?? null,
          codec: info.codec ?? null,
          nama_disk,
          jalur_disk,
          ip: String(req.ip || '').slice(0, 45),
        },
      });

      res.status(201).json({
        success: true,
        data: {
          id: Number(kiriman.id),
          durasi_detik: info.durasi_detik ?? null,
          lebar: info.lebar ?? null,
          tinggi: info.tinggi ?? null,
        },
      });
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
module.exports.VIDEO_ROOT = VIDEO_ROOT;
module.exports.MAKS_UKURAN = MAKS_UKURAN;
module.exports.UKURAN_POTONGAN = UKURAN_POTONGAN;
