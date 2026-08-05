/**
 * Pembersihan sampah Drive.
 *
 * Menghapus ke sampah hanya menandai `deleted_at`; berkas fisiknya masih ada di
 * disk dan kuotanya masih terhitung terpakai. Tanpa pembersihan berkala, disk
 * dan kuota tidak pernah kembali — bidang bisa terkunci kehabisan kuota padahal
 * isi Drive-nya terlihat kosong.
 *
 * Urutan penghapusan sengaja: berkas fisik dulu, baru barisnya. Kalau dibalik
 * dan proses mati di tengah, barisnya hilang sementara berkasnya tertinggal
 * sebagai yatim yang tidak diketahui siapa pun.
 */

const path = require('path');
const fsp = require('fs/promises');
const prisma = require('../config/prisma');
const { DRIVE_ROOT } = require('../middlewares/driveUpload');

const HARI_SAMPAH = 30;

/**
 * Buang isi sampah yang sudah lewat masa simpan.
 * @param {number} hari masa simpan; bisa diturunkan untuk pengujian.
 */
async function bersihkanSampah(hari = HARI_SAMPAH) {
  const batas = new Date(Date.now() - hari * 24 * 60 * 60 * 1000);

  const berkasKedaluwarsa = await prisma.drive_file.findMany({
    where: { deleted_at: { not: null, lt: batas } },
  });

  const dikembalikan = new Map(); // bidang_id -> total byte
  let gagalHapus = 0;

  for (const berkas of berkasKedaluwarsa) {
    const absolut = path.join(DRIVE_ROOT, berkas.jalur_disk);

    // Pagar keamanan: jangan pernah menghapus di luar DRIVE_ROOT, seandainya
    // ada baris rusak di database.
    if (!absolut.startsWith(DRIVE_ROOT)) {
      console.warn(`[drive-purge] lintasan mencurigakan dilewati: ${berkas.jalur_disk}`);
      continue;
    }

    try {
      await fsp.unlink(absolut);
    } catch (error) {
      // ENOENT berarti berkasnya memang sudah tidak ada — barisnya tetap boleh
      // dihapus. Galat lain (mis. izin) harus menahan penghapusan baris supaya
      // berkasnya tidak jadi yatim.
      if (error.code !== 'ENOENT') {
        console.error(`[drive-purge] gagal menghapus ${absolut}:`, error.message);
        gagalHapus += 1;
        continue;
      }
    }

    await prisma.drive_file.delete({ where: { id: berkas.id } });

    const kunci = Number(berkas.bidang_id);
    dikembalikan.set(kunci, (dikembalikan.get(kunci) || 0n) + berkas.ukuran);
  }

  // Kembalikan kuota per bidang.
  for (const [bidangId, bytes] of dikembalikan) {
    await prisma.drive_kuota.update({
      where: { bidang_id: BigInt(bidangId) },
      data: { terpakai_bytes: { decrement: bytes } },
    });
  }

  // Folder kosong yang sudah lewat masa simpan ikut dibuang. Dilakukan setelah
  // berkas supaya folder yang berkasnya gagal dihapus tetap tertinggal sebagai
  // jejak, bukan hilang menyisakan berkas tanpa induk.
  const folderTerhapus = await prisma.drive_folder.deleteMany({
    where: { deleted_at: { not: null, lt: batas } },
  });

  const ringkasan = {
    berkas_dihapus: berkasKedaluwarsa.length - gagalHapus,
    berkas_gagal: gagalHapus,
    folder_dihapus: folderTerhapus.count,
    kuota_dikembalikan: Object.fromEntries(
      [...dikembalikan].map(([k, v]) => [k, Number(v)])
    ),
  };

  if (ringkasan.berkas_dihapus || ringkasan.folder_dihapus || gagalHapus) {
    console.log('[drive-purge]', JSON.stringify(ringkasan));
  }

  return ringkasan;
}

/**
 * Cocokkan ulang penghitung kuota dengan jumlah sebenarnya.
 *
 * Penghitung bisa melenceng kalau proses mati di antara penulisan berkas dan
 * pembaruan kuota. Dijalankan sekali seminggu supaya penyimpangan tidak
 * menumpuk diam-diam.
 */
async function selaraskanKuota() {
  const kuotaSemua = await prisma.drive_kuota.findMany();
  const perbaikan = [];

  for (const kuota of kuotaSemua) {
    const agregat = await prisma.drive_file.aggregate({
      where: { bidang_id: kuota.bidang_id },
      _sum: { ukuran: true },
    });
    const sebenarnya = agregat._sum.ukuran || 0n;

    if (sebenarnya !== kuota.terpakai_bytes) {
      await prisma.drive_kuota.update({
        where: { bidang_id: kuota.bidang_id },
        data: { terpakai_bytes: sebenarnya },
      });
      perbaikan.push({
        bidang_id: Number(kuota.bidang_id),
        sebelum: Number(kuota.terpakai_bytes),
        sesudah: Number(sebenarnya),
      });
    }
  }

  if (perbaikan.length) {
    console.log('[drive-kuota] penghitung diselaraskan:', JSON.stringify(perbaikan));
  }

  return perbaikan;
}

module.exports = { bersihkanSampah, selaraskanKuota, HARI_SAMPAH };
