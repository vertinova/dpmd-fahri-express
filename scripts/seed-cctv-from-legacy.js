/**
 * Impor data legacy Smart CCTV dari dashboard Laravel (dashboard-face-recognition)
 * ke tabel cctv_* super app.
 *
 *   node scripts/seed-cctv-from-legacy.js
 *
 * Yang diimpor:
 *   - cameras            → cctv_cameras     (ID DIPERTAHANKAN agar go2rtc & thread AI yang sudah
 *                                             berjalan tetap cocok: stream cam16_main dsb.)
 *   - employees          → cctv_faces        (ID dipertahankan = id employee)
 *   - employee_photos    → cctv_face_embeddings (ID dipertahankan; berkas foto disalin)
 *
 * Idempoten: baris dengan ID yang sudah ada dilewati (upsert). Aman dijalankan
 * berulang. Setelah impor, stream kamera didaftarkan ulang ke go2rtc.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../src/utils/cctvSecret');
const go2rtc = require('../src/services/go2rtc.service');
const { pisahKredensial } = require('../src/services/smartCctv.service');

const prisma = new PrismaClient();

// Sumber: .env milik dashboard-face-recognition (default mysql dashboard-cctv).
const LEGACY = {
  host: process.env.LEGACY_DB_HOST || '127.0.0.1',
  port: Number(process.env.LEGACY_DB_PORT || 3306),
  user: process.env.LEGACY_DB_USER || 'root',
  password: process.env.LEGACY_DB_PASSWORD || '',
  database: process.env.LEGACY_DB_NAME || 'dashboard-cctv'
};

const LEGACY_STORAGE = path.join(__dirname, '../../dashboard-face-recognition/storage/app/public');
const DIR_FOTO = path.join(__dirname, '../storage/uploads/cctv/faces');

const STATUS_MAP = { active: 'active', inactive: 'inactive', maintenance: 'maintenance' };

const salinFoto = (relatifLama, photoId) => {
  try {
    if (!relatifLama) return null;
    const sumber = path.join(LEGACY_STORAGE, relatifLama.replace(/^\/+/, ''));
    if (!fs.existsSync(sumber)) return null;
    fs.mkdirSync(DIR_FOTO, { recursive: true });
    const nama = `legacy_${photoId}${path.extname(sumber) || '.jpg'}`;
    const tujuan = path.join(DIR_FOTO, nama);
    if (!fs.existsSync(tujuan)) fs.copyFileSync(sumber, tujuan);
    return `storage/uploads/cctv/faces/${nama}`.replace(/\\/g, '/');
  } catch (err) {
    console.warn(`  ⚠ Foto ${relatifLama} gagal disalin: ${err.message}`);
    return null;
  }
};

const imporKamera = async (db) => {
  const [kamera] = await db.query(
    'SELECT id, name, location, status, recognition_enabled, rtsp_url, rtsp_url_main, rtsp_url_sub, username, password FROM cameras'
  );
  let baru = 0;
  for (const k of kamera) {
    const ada = await prisma.cctv_cameras.findUnique({ where: { id: BigInt(k.id) } });
    if (ada) {
      console.log(`  • kamera #${k.id} "${k.name}" sudah ada — dilewati`);
      continue;
    }
    // URL legacy membawa kredensial embedded; pisahkan ke kolom terenkripsi.
    const { urlBersih, username, password } = pisahKredensial(
      k.rtsp_url,
      k.username,
      k.password !== null && k.password !== undefined ? k.password : undefined
    );
    const src = `cam${k.id}_main`;
    await prisma.cctv_cameras.create({
      data: {
        id: BigInt(k.id),
        name: k.name || `Kamera ${k.id}`,
        lokasi: k.location || null,
        rtsp_url: urlBersih,
        rtsp_url_main: k.rtsp_url_main || null,
        rtsp_url_sub: k.rtsp_url_sub || null,
        username: username || null,
        password_enc: encrypt(password),
        status: STATUS_MAP[k.status] || 'active',
        recognition_enabled: !!k.recognition_enabled,
        fall_detection_enabled: true,
        go2rtc_src: src
      }
    });
    baru += 1;
    console.log(`  ✔ kamera #${k.id} "${k.name}" diimpor (src: ${src})`);

    // Pastikan stream terdaftar di go2rtc (panggilan best-effort).
    const url = k.rtsp_url_main || k.rtsp_url;
    await go2rtc.tambahStream(src, url);
  }
  return baru;
};

const imporWajah = async (db) => {
  const [employees] = await db.query(
    'SELECT id, employee_code, name, department FROM employees ORDER BY id'
  );
  const [photos] = await db.query(
    'SELECT id, employee_id, image_path, embedding FROM employee_photos WHERE embedding IS NOT NULL ORDER BY id'
  );

  let wajahBaru = 0;
  let embBaru = 0;

  for (const e of employees) {
    const ada = await prisma.cctv_faces.findUnique({ where: { id: BigInt(e.id) } });
    if (!ada) {
      // foto utama = photo pertama milik employee ini
      const utama = photos.find((p) => Number(p.employee_id) === Number(e.id));
      const fotoPath = utama ? salinFoto(utama.image_path, utama.id) : null;
      await prisma.cctv_faces.create({
        data: {
          id: BigInt(e.id),
          nama: e.name || `Wajah ${e.id}`,
          kode_pegawai: e.employee_code || null,
          departemen: e.department || null,
          foto_path: fotoPath
        }
      });
      wajahBaru += 1;
      console.log(`  ✔ wajah #${e.id} "${e.name}" diimpor`);
    }

    for (const p of photos) {
      if (Number(p.employee_id) !== Number(e.id)) continue;
      const embAda = await prisma.cctv_face_embeddings.findUnique({
        where: { id: BigInt(p.id) }
      });
      if (embAda) continue;
      let embedding = p.embedding;
      if (typeof embedding === 'string') embedding = JSON.parse(embedding);
      if (!Array.isArray(embedding)) continue;
      await prisma.cctv_face_embeddings.create({
        data: {
          id: BigInt(p.id),
          face_id: BigInt(e.id),
          image_path: salinFoto(p.image_path, p.id) || `legacy/${p.image_path}`,
          embedding
        }
      });
      embBaru += 1;
    }
  }
  console.log(`  ✔ embedding: ${embBaru} ditambahkan`);
  return { wajahBaru, embBaru };
};

(async () => {
  console.log('📡 Menghubungkan DB legacy', `${LEGACY.user}@${LEGACY.host}:${LEGACY.port}/${LEGACY.database}`);
  let db;
  try {
    db = await mysql.createConnection(LEGACY);
  } catch (err) {
    console.error('❌ DB legacy tidak terjangkau:', err.message);
    process.exit(1);
  }

  console.log('\n🎥 Mengimpor kamera…');
  const kameraBaru = await imporKamera(db);

  console.log('\n🧑 Mengimpor wajah & embedding…');
  const { wajahBaru, embBaru } = await imporWajah(db);

  await db.end();

  const totalKamera = await prisma.cctv_cameras.count();
  const totalWajah = await prisma.cctv_faces.count();
  const totalEmb = await prisma.cctv_face_embeddings.count();
  console.log('\nRingkasan:');
  console.log(`  kamera     : +${kameraBaru} (total ${totalKamera})`);
  console.log(`  wajah      : +${wajahBaru} (total ${totalWajah})`);
  console.log(`  embedding  : +${embBaru} (total ${totalEmb})`);

  const go2rtcSehat = await go2rtc.sehat();
  console.log(go2rtcSehat ? '\n✅ go2rtc terjangkau — stream siap.' : '\n⚠ go2rtc tidak terjangkau — stream akan didaftarkan ulang saat CRUD kamera.');

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('❌ Seeder gagal:', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
