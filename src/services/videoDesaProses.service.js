/**
 * Pemeriksa & pembersih video kiriman desa.
 *
 * Video datang dari tautan publik tanpa login, jadi isinya tidak dipercaya
 * sampai terbukti video sungguhan. Setiap kiriman dibangun ULANG menjadi MP4
 * H.264/AAC baru — bukan sekadar diperiksa — karena hanya dengan cara itu
 * semua yang bukan gambar & suara pasti terbuang:
 *  - data yang ditempel setelah/di sela video (berkas poliglot, muatan
 *    tersembunyi), lampiran & stream data/subtitle, chapter;
 *  - metadata, termasuk lokasi GPS yang direkam HP;
 *  - format kontainer yang aneh-aneh: hanya MP4/MOV/Matroska/WebM yang boleh
 *    dibaca (`-format_whitelist`), dan hanya protokol `file`
 *    (`-protocol_whitelist`) — playlist HLS/concat yang menyamar sebagai .mp4
 *    tidak bisa memaksa server mengambil alamat lain (SSRF) atau membaca
 *    berkas lokal.
 * H.264 yuv420p disalin apa adanya (cepat, tanpa turun kualitas, kontainernya
 * tetap baru); codec lain (HEVC iPhone, VP9, dst.) dienkode ulang — hasilnya
 * sekaligus siap untuk pemutar videotron yang paling aman dengan H.264.
 *
 * Antrean berjalan SATU per satu dengan `nice`, supaya unggahan serentak dari
 * ratusan desa tidak menghabiskan CPU aplikasi.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const VIDEO_ROOT = path.join(__dirname, '../../private/video-desa');
const MENTAH_ROOT = path.join(VIDEO_ROOT, '_mentah');

const FORMAT_SAH = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm';
const MASUKAN_AMAN = ['-protocol_whitelist', 'file', '-format_whitelist', FORMAT_SAH];

// Batas wajar untuk video kegiatan desa. Di luar ini hampir pasti salah kirim
// atau berkas yang sengaja dibuat untuk menyiksa dekoder.
const MAKS_DURASI_DETIK = 30 * 60;
const MAKS_SISI_PIKSEL = 8192;
const BATAS_WAKTU_PROSES_MS = 60 * 60 * 1000;

fs.mkdirSync(MENTAH_ROOT, { recursive: true });

/* --------------------------------------------------------------- ffmpeg -- */

const jalankan = (perintah, argumen, batasMs) => new Promise((resolve) => {
  let keluar = '';
  let galat = '';
  let selesai = false;
  const akhiri = (hasil) => { if (!selesai) { selesai = true; resolve(hasil); } };
  let p;
  try {
    p = spawn(perintah, argumen, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    akhiri({ kode: -1, keluar, galat: e.message });
    return;
  }
  const waktu = setTimeout(() => { p.kill('SIGKILL'); akhiri({ kode: -1, keluar, galat: 'melewati batas waktu' }); }, batasMs);
  p.stdout.on('data', (d) => { if (keluar.length < 2e6) keluar += d; });
  p.stderr.on('data', (d) => { if (galat.length < 2e4) galat += d; });
  p.on('error', (e) => { clearTimeout(waktu); akhiri({ kode: -1, keluar, galat: e.message }); });
  p.on('close', (kode) => { clearTimeout(waktu); akhiri({ kode, keluar, galat }); });
});

/**
 * Baca isi berkas dengan ffprobe (format dibatasi). Mengembalikan
 * { video, audio, durasi } atau { galat } bila bukan video yang bisa dipakai.
 */
const periksa = async (berkas) => {
  const r = await jalankan('ffprobe', [
    '-v', 'error', ...MASUKAN_AMAN,
    '-print_format', 'json', '-show_format', '-show_streams', berkas,
  ], 60000);
  if (r.kode !== 0) return { galat: 'Berkas tidak bisa dibaca sebagai video.' };
  let j;
  try { j = JSON.parse(r.keluar); } catch { return { galat: 'Berkas tidak bisa dibaca sebagai video.' }; }

  const video = (j.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video) return { galat: 'Berkas tidak berisi gambar video.' };
  const audio = (j.streams || []).find((s) => s.codec_type === 'audio') || null;
  const durasi = Number(j.format?.duration ?? video.duration);
  if (!Number.isFinite(durasi) || durasi <= 0) return { galat: 'Durasi video tidak terbaca.' };
  if (durasi > MAKS_DURASI_DETIK) return { galat: `Video lebih dari ${MAKS_DURASI_DETIK / 60} menit.` };
  if (!video.width || !video.height || video.width > MAKS_SISI_PIKSEL || video.height > MAKS_SISI_PIKSEL) {
    return { galat: 'Resolusi video tidak wajar.' };
  }
  const rotasi = Math.abs(Number(video.tags?.rotate ?? (video.side_data_list || []).find((s) => s.rotation !== undefined)?.rotation ?? 0));
  return { video, audio, durasi, tegak: rotasi === 90 || rotasi === 270 };
};

const argumenBersih = ({ video, audio }, masuk, keluar) => {
  const salinVideo = video.codec_name === 'h264' && video.pix_fmt === 'yuv420p';
  const salinAudio = audio && audio.codec_name === 'aac';
  return [
    '-v', 'error', '-nostdin', '-y', ...MASUKAN_AMAN, '-i', masuk,
    // Hanya satu stream gambar + (bila ada) satu stream suara. Sisanya —
    // data, subtitle, lampiran, chapter, metadata — tidak ikut.
    '-map', '0:v:0', '-map', '0:a:0?',
    '-map_metadata', '-1', '-map_chapters', '-1', '-dn', '-sn',
    ...(salinVideo
      ? ['-c:v', 'copy']
      : [
          // Sisi terpanjang maks 1920 (cukup untuk videotron & medsos), orientasi tetap.
          '-vf', "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'",
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
        ]),
    ...(audio ? (salinAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']) : []),
    '-threads', '4', '-movflags', '+faststart', '-f', 'mp4', keluar,
  ];
};

const sidikJari = (berkas) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(berkas).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

/* --------------------------------------------------------------- antrean -- */

const antrean = [];
let berjalan = false;

const prosesSatu = async (id) => {
  const k = await prisma.video_desa_kiriman.findUnique({ where: { id: BigInt(id) } });
  if (!k || !['antre', 'diproses'].includes(k.pemrosesan)) return;
  const mentah = path.join(MENTAH_ROOT, k.nama_disk);

  const gagal = async (pesan) => {
    await prisma.video_desa_kiriman.update({
      where: { id: k.id },
      data: { pemrosesan: 'gagal', pesan_proses: pesan.slice(0, 500) },
    }).catch(() => {});
    await fsp.unlink(mentah).catch(() => {});
    logger.warn(`[VideoDesa] kiriman ${id} gagal diperiksa: ${pesan}`);
  };

  if (!fs.existsSync(mentah)) return gagal('Berkas unggahan hilang dari server. Minta desa mengunggah ulang.');
  await prisma.video_desa_kiriman.update({ where: { id: k.id }, data: { pemrosesan: 'diproses' } });

  const info = await periksa(mentah);
  if (info.galat) return gagal(info.galat);

  const segmen = path.dirname(k.jalur_disk);
  await fsp.mkdir(path.join(VIDEO_ROOT, segmen), { recursive: true });
  const namaAkhir = `${path.basename(k.nama_disk, path.extname(k.nama_disk))}.mp4`;
  const akhir = path.join(VIDEO_ROOT, segmen, namaAkhir);
  const sementara = `${akhir}.proses`;

  const argumen = argumenBersih(info, mentah, sementara);
  // `nice` hanya ada di Linux (server); di Windows (pengembangan) langsung ffmpeg.
  const r = process.platform === 'win32'
    ? await jalankan('ffmpeg', argumen, BATAS_WAKTU_PROSES_MS)
    : await jalankan('nice', ['-n', '15', 'ffmpeg', ...argumen], BATAS_WAKTU_PROSES_MS);
  if (r.kode !== 0) {
    await fsp.unlink(sementara).catch(() => {});
    return gagal(`Video tidak bisa diproses (${(r.galat || '').trim().split('\n').pop() || 'ffmpeg gagal'}).`);
  }

  // Hasilnya diperiksa lagi: yang disajikan ke bidang harus video yang sah.
  const hasil = await periksa(sementara);
  if (hasil.galat) {
    await fsp.unlink(sementara).catch(() => {});
    return gagal(`Hasil pemrosesan tidak sah: ${hasil.galat}`);
  }
  await fsp.rename(sementara, akhir);
  await fsp.unlink(mentah).catch(() => {});
  const st = await fsp.stat(akhir);

  const v = hasil.video;
  await prisma.video_desa_kiriman.update({
    where: { id: k.id },
    data: {
      pemrosesan: 'siap',
      pesan_proses: null,
      nama_disk: namaAkhir,
      jalur_disk: path.join(segmen, namaAkhir),
      mime: 'video/mp4',
      ukuran: BigInt(st.size),
      sha256: await sidikJari(akhir),
      durasi_detik: Math.round(hasil.durasi * 100) / 100,
      lebar: (hasil.tegak ? v.height : v.width) || null,
      tinggi: (hasil.tegak ? v.width : v.height) || null,
      codec: String(v.codec_name || '').slice(0, 30) || null,
    },
  });
  logger.info(`[VideoDesa] kiriman ${id} bersih (${Math.round(st.size / 1048576)} MB)`);
};

const jalankanAntrean = async () => {
  if (berjalan) return;
  berjalan = true;
  try {
    while (antrean.length) {
      const id = antrean.shift();
      try {
        await prosesSatu(id);
      } catch (e) {
        logger.error(`[VideoDesa] gagal memproses kiriman ${id}: ${e.message}`);
        await prisma.video_desa_kiriman.update({
          where: { id: BigInt(id) },
          data: { pemrosesan: 'gagal', pesan_proses: 'Kesalahan server saat memproses video.' },
        }).catch(() => {});
      }
    }
  } finally {
    berjalan = false;
  }
};

const masukkan = (id) => {
  const s = String(id);
  if (!antrean.includes(s)) antrean.push(s);
  setImmediate(jalankanAntrean);
};

const posisiAntrean = (id) => antrean.indexOf(String(id)) + 1;

/** Server dinyalakan ulang di tengah pemrosesan: lanjutkan yang tertinggal. */
const pulihkan = async () => {
  try {
    const sisa = await prisma.video_desa_kiriman.findMany({
      where: { pemrosesan: { in: ['antre', 'diproses'] } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    sisa.forEach((k) => masukkan(k.id));
    if (sisa.length) logger.info(`[VideoDesa] melanjutkan ${sisa.length} video yang belum diproses`);
  } catch (e) {
    logger.warn(`[VideoDesa] gagal memulihkan antrean: ${e.message}`);
  }
};

setTimeout(pulihkan, 15000).unref();

module.exports = { VIDEO_ROOT, MENTAH_ROOT, masukkan, posisiAntrean, periksa };
