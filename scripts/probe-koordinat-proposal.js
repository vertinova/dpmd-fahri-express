#!/usr/bin/env node
/**
 * probe-koordinat-proposal.js — PENGINTAI, BUKAN PENGEKSTRAK.
 *
 * Menjawab satu pertanyaan sebelum kita membangun apa pun:
 * "Dari PDF proposal Bankeu Perubahan yang sudah masuk, berapa persen yang
 *  titik koordinatnya benar-benar bisa dibaca mesin?"
 *
 * Skrip ini TIDAK mengubah apa pun di database. Hanya membaca file, mencocokkan
 * pola, lalu melaporkan angkanya. Keputusan membangun ekstraktor diambil
 * setelah melihat laporan ini — bukan sebaliknya.
 *
 * Yang dicari, berurutan dari yang paling murah:
 *   1. Derajat desimal          -6.5432, 106.7891
 *   2. Tautan Google Maps       maps.app.goo.gl/... , /@-6.54,106.78,17z
 *   3. Derajat-menit-detik      6°32'35.5"S 106°47'20.8"E
 *   4. UTM                      48M 700000 9270000
 * Bila keempatnya nihil tapi halaman berisi gambar besar, berarti titiknya
 * hanya ada sebagai TANGKAPAN LAYAR — jalan satu-satunya OCR, dan itu
 * dilaporkan terpisah supaya tidak tercampur dengan yang benar-benar terbaca.
 *
 * Cara pakai (di server, dari /var/www/backend):
 *   npm i --no-save pdfjs-dist@4.6.82
 *   node scripts/probe-koordinat-proposal.js            # sampel 100 berkas
 *   node scripts/probe-koordinat-proposal.js --semua    # seluruh berkas
 *   node scripts/probe-koordinat-proposal.js --limit 300 --csv hasil.csv
 *
 * `--no-save` disengaja: pdfjs-dist tidak masuk package.json sampai kita tahu
 * pendekatan ini layak dipakai.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const UPLOAD_DIR = path.join(__dirname, '../storage/uploads/bankeu-perubahan');

// Kegiatan infrastruktur pada Bankeu Perubahan (jalan, jalan lingkungan,
// jembatan, TPT, drainase) — hanya ini yang wajib melampirkan peta titik lokasi.
const KEGIATAN_INFRA = [4, 5, 6, 7, 9];

// Batas wajar Kabupaten Bogor, dipakai membuang angka yang kebetulan mirip
// koordinat (nomor rekening, nominal rupiah, ukuran).
const BOGOR = { latMin: -7.0, latMax: -6.0, lngMin: 106.2, lngMax: 107.3 };

const dalamBogor = (lat, lng) =>
  lat >= BOGOR.latMin && lat <= BOGOR.latMax && lng >= BOGOR.lngMin && lng <= BOGOR.lngMax;

// ------------------------------------------------------------------
// Pencocok pola
// ------------------------------------------------------------------
const pencocok = [
  {
    nama: 'desimal',
    jalankan: (teks) => {
      const hasil = [];
      const re = /(-?\d{1,2}[.,]\d{4,})\s*[,;/]\s*(-?\d{2,3}[.,]\d{4,})/g;
      let m;
      while ((m = re.exec(teks))) {
        const a = parseFloat(m[1].replace(',', '.'));
        const b = parseFloat(m[2].replace(',', '.'));
        // Toleransi urutan terbalik (bujur ditulis duluan).
        if (dalamBogor(a, b)) hasil.push({ lat: a, lng: b });
        else if (dalamBogor(b, a)) hasil.push({ lat: b, lng: a });
      }
      return hasil;
    },
  },
  {
    nama: 'tautan-maps',
    jalankan: (teks) => {
      const hasil = [];
      const re = /@(-?\d{1,2}\.\d+),(-?\d{2,3}\.\d+)/g;
      let m;
      while ((m = re.exec(teks))) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (dalamBogor(lat, lng)) hasil.push({ lat, lng });
      }
      // Tautan pendek tidak memuat koordinat — dicatat agar terlihat berapa
      // banyak yang perlu dibuka manual.
      const pendek = (teks.match(/(maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+/g) || []).length;
      return hasil.length ? hasil : pendek ? [{ pendek }] : [];
    },
  },
  {
    nama: 'dms',
    jalankan: (teks) => {
      const hasil = [];
      const re =
        /(\d{1,2})°\s*(\d{1,2})['′]\s*([\d.]+)?["″]?\s*([SU NS])\D{0,4}(\d{2,3})°\s*(\d{1,2})['′]\s*([\d.]+)?["″]?\s*([ETBW])/gi;
      let m;
      while ((m = re.exec(teks))) {
        const ke = (d, mnt, dtk) => Number(d) + Number(mnt) / 60 + Number(dtk || 0) / 3600;
        let lat = ke(m[1], m[2], m[3]);
        let lng = ke(m[5], m[6], m[7]);
        if (/S/i.test(m[4])) lat = -lat;
        if (/[BW]/i.test(m[8])) lng = -lng;
        if (dalamBogor(lat, lng)) hasil.push({ lat, lng });
      }
      return hasil;
    },
  },
  {
    nama: 'utm',
    jalankan: (teks) => {
      const cocok = teks.match(/\b4[89]\s*[MS]\b[\s\S]{0,30}?\b\d{6}\b[\s\S]{0,20}?\b\d{7}\b/g) || [];
      return cocok.map(() => ({ utm: true }));
    },
  },
];

// ------------------------------------------------------------------
// Pembaca PDF
// ------------------------------------------------------------------
let pdfjs = null;
const muatPdfjs = async () => {
  if (pdfjs) return pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs;
  } catch {
    console.error('\n  pdfjs-dist belum terpasang. Jalankan dulu:\n');
    console.error('    npm i --no-save pdfjs-dist@4.6.82\n');
    process.exit(1);
  }
};

/** @returns {{teks: string, halaman: number, gambar: number}} */
const bacaPdf = async (berkas) => {
  const lib = await muatPdfjs();
  const data = new Uint8Array(fs.readFileSync(berkas));
  const dok = await lib.getDocument({ data, disableWorker: true, verbosity: 0 }).promise;

  let teks = '';
  let gambar = 0;
  for (let i = 1; i <= dok.numPages; i += 1) {
    const halaman = await dok.getPage(i);
    const isi = await halaman.getTextContent();
    teks += isi.items.map((item) => item.str).join(' ') + '\n';
    // Hitung operator gambar — penanda halaman berisi tangkapan layar peta.
    try {
      const ops = await halaman.getOperatorList();
      gambar += ops.fnArray.filter(
        (fn) => fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintJpegXObject
      ).length;
    } catch {
      /* abaikan: gagal baca operator tidak menggugurkan pembacaan teks */
    }
  }
  await dok.destroy();
  return { teks, halaman: dok.numPages, gambar };
};

// ------------------------------------------------------------------
// Utama
// ------------------------------------------------------------------
const argv = process.argv.slice(2);
const ambilArg = (nama, bawaan) => {
  const i = argv.indexOf(nama);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : bawaan;
};
const semua = argv.includes('--semua');
const limit = semua ? 0 : parseInt(ambilArg('--limit', '100'), 10);
const csvOut = ambilArg('--csv', null);

(async () => {
  const baris = await prisma.$queryRawUnsafe(
    `SELECT bpp.id, bpp.file_proposal, bpp.nama_kegiatan_spesifik, bpp.lokasi,
            d.nama AS nama_desa, k.nama AS nama_kecamatan
     FROM bankeu_perubahan_proposals bpp
     JOIN desas d ON d.id = bpp.desa_id
     LEFT JOIN kecamatans k ON k.id = d.kecamatan_id
     WHERE bpp.kegiatan_id IN (${KEGIATAN_INFRA.join(',')})
       AND bpp.file_proposal IS NOT NULL AND bpp.file_proposal <> ''
     ORDER BY bpp.id DESC
     ${limit ? `LIMIT ${limit}` : ''}`
  );

  console.log(`\nMengintai ${baris.length} proposal infrastruktur...`);
  console.log(`Folder: ${UPLOAD_DIR}\n`);

  const rekap = {
    diperiksa: 0,
    berkasHilang: 0,
    gagalBaca: 0,
    tanpaTeks: 0,
    ketemu: 0,
    perPola: {},
    hanyaTautanPendek: 0,
    kandidatOcr: 0,
  };
  const temuan = [];

  for (const row of baris) {
    const berkas = path.join(UPLOAD_DIR, row.file_proposal);
    if (!fs.existsSync(berkas)) {
      rekap.berkasHilang += 1;
      continue;
    }

    rekap.diperiksa += 1;
    let hasil;
    try {
      hasil = await bacaPdf(berkas);
    } catch (error) {
      rekap.gagalBaca += 1;
      continue;
    }

    const teks = hasil.teks.replace(/\s+/g, ' ');
    if (teks.trim().length < 50) rekap.tanpaTeks += 1;

    let koordinat = null;
    let polaTerpakai = null;
    let tautanPendek = false;

    for (const pola of pencocok) {
      const cocok = pola.jalankan(teks);
      if (!cocok.length) continue;
      if (cocok[0].pendek) {
        tautanPendek = true;
        continue;
      }
      if (cocok[0].utm) {
        rekap.perPola.utm = (rekap.perPola.utm || 0) + 1;
        polaTerpakai = 'utm';
        break;
      }
      koordinat = cocok[0];
      polaTerpakai = pola.nama;
      rekap.perPola[pola.nama] = (rekap.perPola[pola.nama] || 0) + 1;
      break;
    }

    if (koordinat) {
      rekap.ketemu += 1;
      temuan.push({
        id: Number(row.id),
        desa: row.nama_desa,
        kecamatan: row.nama_kecamatan,
        kegiatan: row.nama_kegiatan_spesifik,
        lokasi: row.lokasi,
        lat: koordinat.lat,
        lng: koordinat.lng,
        pola: polaTerpakai,
      });
    } else if (tautanPendek) {
      rekap.hanyaTautanPendek += 1;
    } else if (hasil.gambar > 0) {
      rekap.kandidatOcr += 1;
    }

    if (rekap.diperiksa % 25 === 0) {
      process.stdout.write(`  ...${rekap.diperiksa} berkas, ${rekap.ketemu} berkoordinat\r`);
    }
  }

  const persen = (n) => (rekap.diperiksa ? `${Math.round((n / rekap.diperiksa) * 1000) / 10}%` : '-');

  console.log('\n' + '='.repeat(62));
  console.log('HASIL PENGINTAIAN');
  console.log('='.repeat(62));
  console.log(`Berkas diperiksa          : ${rekap.diperiksa}`);
  console.log(`Berkas tidak ditemukan    : ${rekap.berkasHilang}`);
  console.log(`Gagal dibaca              : ${rekap.gagalBaca}`);
  console.log(`PDF tanpa lapisan teks    : ${rekap.tanpaTeks}  (hasil pindaian — hanya OCR yang bisa)`);
  console.log('-'.repeat(62));
  console.log(`KOORDINAT TERBACA         : ${rekap.ketemu}  (${persen(rekap.ketemu)})`);
  Object.entries(rekap.perPola).forEach(([pola, jumlah]) => {
    console.log(`   via ${pola.padEnd(20)} : ${jumlah}`);
  });
  console.log(`Hanya tautan maps pendek  : ${rekap.hanyaTautanPendek}  (perlu dibuka agar tahu titiknya)`);
  console.log(`Kandidat OCR (ada gambar) : ${rekap.kandidatOcr}  (${persen(rekap.kandidatOcr)})`);
  console.log('='.repeat(62));

  if (temuan.length) {
    console.log('\nContoh temuan:');
    temuan.slice(0, 10).forEach((t) => {
      console.log(
        `  #${String(t.id).padEnd(6)} ${String(t.desa).padEnd(18)} ${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}  [${t.pola}]`
      );
    });
  }

  if (csvOut) {
    const header = 'proposal_id,desa,kecamatan,kegiatan,lokasi_teks,latitude,longitude,pola\n';
    const isi = temuan
      .map((t) =>
        [t.id, t.desa, t.kecamatan, t.kegiatan, t.lokasi, t.lat, t.lng, t.pola]
          .map((sel) => `"${String(sel ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    fs.writeFileSync(csvOut, header + isi);
    console.log(`\nCSV ditulis: ${csvOut} (${temuan.length} baris)`);
  }

  console.log('\nCatatan: skrip ini tidak menulis apa pun ke database.\n');
  process.exit(0);
})().catch((error) => {
  console.error('Gagal:', error);
  process.exit(1);
});
