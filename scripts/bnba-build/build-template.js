#!/usr/bin/env node
/**
 * Build Output Template Pengurus Kelembagaan dari workbook BNBA desa.
 *
 * Mengubah file nominatif LKD milik desa (.xlsx/.xls/.ods, tata letak bebas
 * asal masih memakai kepala kolom BNBA) menjadi
 * `output_template_pengurus_kelembagaan_<kecamatan>_<desa>.xlsx` yang langsung
 * bisa diunggah lewat menu Import Pengurus Kelembagaan atau diimpor dengan
 * `scripts/import-output-template.js`.
 *
 * Penggunaan:
 *   node scripts/bnba-build/build-template.js --input "<file BNBA>" [...]
 *                                             [--out-dir <folder>]
 *                                             [--desa <nama>] [--kecamatan <nama>]
 *                                             [--kode-desa <32.01.xx.xxxx>]
 *                                             [--keep-other-desa] [--tolak-bentrok]
 *                                             [--report-file <path.json>]
 *   node scripts/bnba-build/build-template.js --blank [--out-dir <folder>]
 *
 * Contoh:
 *   node scripts/bnba-build/build-template.js \
 *     --input "../DATA SELURUH LKD BARENGKOK FIX DESA BARENGKOK DPMD.ods" \
 *     --out-dir ../hasil-template
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const {
  TEMPLATE_SHEETS,
  LEMBAGA_PREFIX,
  CATEGORY_TARGET,
  columnsForSheet,
  classifySheet,
  text,
  upper,
  pad3,
  digitsOnly,
  parseTanggal,
  parseNik,
  cekTanggalLahirVsNik,
  parseTelepon,
  parseJenisKelamin,
  parsePendidikan,
  parseStatusKawin,
  normalizeJabatan,
} = require('./mapping');

const { readWorkbook, sheetRows, resolveHeader, extractRows, detectWilayah } = require('./reader');
const { loadReference, resolveDesa, normalizeName } = require('./desa-reference');

// Baris contoh yang ikut tercetak di hampir semua salinan format BNBA.
const SAMPLE_NIKS = new Set(['1234567890123456', '6543210987654320']);
const SAMPLE_NAMES = new Set(['MSHAKILARGANTAPHALOSA', 'MSHAFIRAAGATHAPALUPI']);

// Jabatan yang hanya boleh dipegang satu orang per lembaga. "KOMANDAN REGU" dan
// "ANGGOTA"/"KADER" sengaja tidak masuk karena memang boleh lebih dari satu.
const SINGULAR_OFFICE = /^(KETUA|WAKIL KETUA|SEKRETARIS|BENDAHARA|KEPALA)\b/;

const CATEGORY_ORDER = [
  'RTRW',
  'POSYANDU',
  'KADER_POSYANDU',
  'LPM',
  'KARANG_TARUNA',
  'PKK',
  'LINMAS',
  'LAINNYA',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    inputs: [],
    outDir: null,
    desa: null,
    kecamatan: null,
    kodeDesa: null,
    keepOtherDesa: false,
    tolakBentrok: false,
    skipSheets: [],
    reportFile: null,
    blank: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--input': case '-i': opts.inputs.push(argv[++i]); break;
      case '--out-dir': case '-o': opts.outDir = argv[++i]; break;
      case '--desa': opts.desa = argv[++i]; break;
      case '--kecamatan': opts.kecamatan = argv[++i]; break;
      case '--kode-desa': opts.kodeDesa = argv[++i]; break;
      case '--keep-other-desa': opts.keepOtherDesa = true; break;
      case '--tolak-bentrok': opts.tolakBentrok = true; break;
      case '--skip-sheet': opts.skipSheets.push(argv[++i]); break;
      case '--report-file': opts.reportFile = argv[++i]; break;
      case '--blank': opts.blank = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`Argumen tidak dikenali: ${a}`);
        opts.inputs.push(a);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
Build Output Template Pengurus Kelembagaan dari workbook BNBA desa.

  --input, -i <file>     File BNBA desa (.xlsx/.xls/.ods). Boleh diulang.
  --out-dir, -o <dir>    Folder hasil (default: folder file sumber).
  --desa <nama>          Paksa nama desa bila kepala sheet tidak terbaca.
  --kecamatan <nama>     Paksa nama kecamatan.
  --kode-desa <kode>     Paksa kode desa (mis. 32.01.14.2006), melewati pencocokan nama.
  --keep-other-desa      Ikut sertakan baris yang alamat desanya beda dengan desa target.
  --tolak-bentrok        Jabatan tunggal ganda: pakai pemegang pertama saja, sisanya ke _DITOLAK
                         (default: semua pemegang tetap masuk dan diberi catatan).
  --skip-sheet <nama>    Abaikan satu sheet sumber. Boleh diulang. Berguna bila file desa
                         memuat dua versi daftar yang sama (mis. RT_RW dan RTRW).
  --report-file <path>   Tulis ringkasan JSON.
  --blank                Hasilkan template kosong siap isi (tanpa file sumber).
  --help, -h             Tampilkan bantuan ini.

Catatan: satu file sumber = satu desa. Untuk banyak desa, jalankan berulang atau
kirim beberapa --input; tiap file menghasilkan satu workbook template.
`);
}

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

function slug(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function joinAlamat(parts) {
  const joined = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return joined ? joined.toUpperCase() : '';
}

/** Susun alamat lembaga dari kolom alamat + RT/RW/desa/kecamatan/kode pos. */
function composeAlamatLembaga(src, prefix) {
  return joinAlamat([
    text(src[`${prefix}_jalan`]),
    src[`${prefix}_rt`] ? `RT ${pad3(src[`${prefix}_rt`])}` : '',
    src[`${prefix}_rw`] ? `RW ${pad3(src[`${prefix}_rw`])}` : '',
    text(src[`${prefix}_desa`]) ? `DESA ${text(src[`${prefix}_desa`])}` : '',
    text(src[`${prefix}_kecamatan`]) ? `KECAMATAN ${text(src[`${prefix}_kecamatan`])}` : '',
    text(src[`${prefix}_kode_pos`]),
  ]);
}

function emptyTemplateRow(sheetName) {
  const row = {};
  for (const col of columnsForSheet(sheetName)) row[col] = '';
  return row;
}

// ---------------------------------------------------------------------------
// Konversi satu baris pengurus
// ---------------------------------------------------------------------------

/**
 * @returns {{row:object, notes:string[]} | {reject:string}}
 */
function buildPengurusRow(src, ctx) {
  const { sheetName, targetSheet, sourceFile, keepOtherDesa, desa } = ctx;
  const notes = [];

  const nama = upper(src.nama_lengkap);
  if (!nama) {
    const filled = Object.keys(src).filter((k) => !k.startsWith('__') && text(src[k])).length;
    return filled >= 4 ? { reject: 'nama kosong' } : { reject: null };
  }

  if (SAMPLE_NAMES.has(nama.replace(/[^A-Z]/g, ''))) return { reject: 'baris contoh bawaan format BNBA' };

  const nikParsed = parseNik(src.nik);
  if (nikParsed.value && SAMPLE_NIKS.has(nikParsed.value)) {
    return { reject: 'baris contoh bawaan format BNBA (NIK contoh)' };
  }
  if (nikParsed.note) notes.push(nikParsed.note);

  const desaAlamat = upper(src.desa_alamat);
  if (desaAlamat && normalizeName(desaAlamat) !== normalizeName(desa.nama)) {
    if (!keepOtherDesa) {
      return { reject: `alamat desa '${desaAlamat}' bukan desa target (${desa.nama.toUpperCase()})` };
    }
    notes.push(`alamat desa '${desaAlamat}' beda dengan desa target`);
  }

  const row = emptyTemplateRow(targetSheet);
  row.kode_desa = desa.kode;
  row.nama_lengkap = nama;
  row.nik = nikParsed.value || '';
  row.tempat_lahir = upper(src.tempat_lahir);
  row.jenis_kelamin = parseJenisKelamin(src.jenis_kelamin);

  const lahir = parseTanggal(src.tanggal_lahir, { allowYearOnly: false });
  row.tanggal_lahir = lahir.value || '';
  if (lahir.note) notes.push(lahir.note);
  const nikNote = cekTanggalLahirVsNik(row.tanggal_lahir, row.nik);
  if (nikNote) notes.push(nikNote);

  const akhir = parseTanggal(src.tanggal_akhir_jabatan, { allowYearOnly: true });
  row.tanggal_akhir_jabatan = akhir.value || '';
  if (akhir.note) notes.push(akhir.note);

  // Format Desk LKD hanya punya tanggal SK pengangkatan. Tanggal di masa depan
  // jelas akhir masa bhakti; selain itu dianggap tanggal mulai menjabat.
  if (text(src._tanggal_sk)) {
    const sk = parseTanggal(src._tanggal_sk, { allowYearOnly: false });
    if (sk.value && sk.value > new Date().toISOString().slice(0, 10)) {
      if (!row.tanggal_akhir_jabatan) row.tanggal_akhir_jabatan = sk.value;
    } else if (sk.value) {
      row.tanggal_mulai_jabatan = sk.value;
    } else if (sk.note) {
      notes.push(`tanggal SK: ${sk.note}`);
    }
  }

  const pend = parsePendidikan(src.pendidikan);
  row.pendidikan = pend.value;
  if (pend.note) notes.push(pend.note);

  const kawin = parseStatusKawin(src.status_perkawinan);
  row.status_perkawinan = kawin.value;
  if (kawin.note) notes.push(kawin.note);

  row.alamat_rumah = upper(src.alamat_rumah);
  row.rt_rumah = pad3(src.rt_rumah);
  row.rw_rumah = pad3(src.rw_rumah);
  row.desa_alamat = desaAlamat;
  row.kecamatan_alamat = upper(src.kecamatan_alamat);
  row.kode_pos = digitsOnly(src.kode_pos);
  row.no_telepon = parseTelepon(src.no_telepon) || '';
  row.nama_bank = upper(src.nama_bank);
  row.nomor_rekening = text(src.nomor_rekening);
  row.nama_rekening = upper(src.nama_rekening);
  row.status_jabatan = 'aktif';
  row.status_verifikasi_pengurus = 'unverified';

  // Kolom "KECAMATAN" kadang diisi kata "KECAMATAN" saja — buang supaya alamat bersih.
  if (row.kecamatan_alamat === 'KECAMATAN') row.kecamatan_alamat = '';

  row._sumber_file = sourceFile;
  row._sumber_sheet = sheetName;
  row._sumber_baris = String(src.__row);
  row._nomor_perkades = text(src._nomor_perkades);
  row._nomor_sk = text(src._nomor_sk);
  row._jabatan_asli = upper(src.jabatan);

  return { row, notes };
}

// ---------------------------------------------------------------------------
// Penanganan khusus per kategori
// ---------------------------------------------------------------------------

function fillRtRw(row, src, notes, rwSebelumnya) {
  const rwMarker = upper(src._wilayah_rw);
  const rtMarker = upper(src._wilayah_rt);
  const jabatanAsli = upper(src.jabatan);

  let jenis = null;
  if (rtMarker) jenis = 'RT';
  else if (rwMarker) jenis = 'RW';
  else if (/\bRT\b/.test(jabatanAsli)) jenis = 'RT';
  else if (/\bRW\b/.test(jabatanAsli)) jenis = 'RW';

  if (!jenis) return 'jenis wilayah (RT/RW) tidak bisa ditentukan';

  // Nomor bisa ada di kolom penanda, tertulis di jabatan, atau ikut alamat rumah.
  const fromJabatanRw = (jabatanAsli.match(/\bRW\s*0*(\d{1,3})\b/) || [])[1];
  const fromJabatanRt = (jabatanAsli.match(/\bRT\s*0*(\d{1,3})\b/) || [])[1];
  const fromJabatanRtRw = jabatanAsli.match(/\bRT\s*0*(\d{1,3})\s*[/\\]\s*0*(\d{1,3})\b/) || [];
  const fromAlamat = text(row.alamat_rumah).match(/\bRT\.?\s*0*(\d{1,3})\s*[/\\]\s*0*(\d{1,3})\b/i) || [];

  let nomorRw = pad3(rwMarker) || pad3(fromJabatanRw) || row.rw_rumah || pad3(fromJabatanRtRw[2]) || pad3(fromAlamat[2]);
  let nomorRt = jenis === 'RT' ? (pad3(rtMarker) || pad3(fromJabatanRt) || row.rt_rumah || pad3(fromJabatanRtRw[1]) || pad3(fromAlamat[1])) : '';

  // Format Desk LKD menulis ketua RW lalu ketua-ketua RT di bawahnya tanpa
  // mengulang nomor RW.
  let rwDariUrutan = false;
  if (!nomorRw && jenis === 'RT' && rwSebelumnya) {
    nomorRw = rwSebelumnya;
    rwDariUrutan = true;
  }

  if (!nomorRw) return 'nomor RW tidak ditemukan';
  if (/[A-Z]/.test(rtMarker)) notes.push(`nomor RT asli '${rtMarker}' memuat huruf`);
  if (jenis === 'RT' && !nomorRt) return 'nomor RT tidak ditemukan';

  if (rwDariUrutan) notes.push(`nomor RW ${nomorRw} diambil dari baris ketua RW di atasnya`);
  else if (!pad3(rwMarker) && !fromJabatanRw && !fromJabatanRtRw[2]) notes.push(`nomor RW ${nomorRw} diambil dari kolom alamat rumah`);
  if (jenis === 'RT' && !pad3(rtMarker) && !fromJabatanRt && !fromJabatanRtRw[1]) notes.push(`nomor RT ${nomorRt} diambil dari kolom alamat rumah`);

  row.jenis_wilayah = jenis;
  row.nomor_rw = nomorRw;
  row.nomor_rt = nomorRt;
  return null;
}

function posyanduKey(nama) {
  return normalizeName(nama);
}

// ---------------------------------------------------------------------------
// Build satu workbook BNBA
// ---------------------------------------------------------------------------

function buildFromWorkbook(filePath, opts, reference) {
  const sourceFile = path.basename(filePath);
  const wb = readWorkbook(filePath);

  // --- kumpulkan sheet + header ---
  const parsed = [];
  const skippedSheets = [];
  const skipSet = new Set((opts.skipSheets || []).map((s) => String(s).trim().toUpperCase()));
  for (const name of wb.SheetNames) {
    if (skipSet.has(name.trim().toUpperCase())) {
      skippedSheets.push({ sheet: name, alasan: 'diabaikan lewat --skip-sheet' });
      continue;
    }
    const ws = wb.Sheets[name];
    const rows = sheetRows(ws);
    const header = resolveHeader(ws, rows);
    if (!header) { skippedSheets.push({ sheet: name, alasan: 'baris header tidak ditemukan' }); continue; }
    parsed.push({ name, ws, rows, header, category: classifySheet(name, rows.slice(0, 10).flat().join(' ')) });
  }
  if (parsed.length === 0) throw new Error(`Tidak ada sheet berformat BNBA di ${sourceFile}`);

  // --- tentukan desa & kecamatan ---
  const voteDesa = new Map();
  const voteKec = new Map();
  for (const s of parsed) {
    const w = detectWilayah(s.rows);
    if (w.desa) voteDesa.set(w.desa, (voteDesa.get(w.desa) || 0) + 1);
    if (w.kecamatan) voteKec.set(w.kecamatan, (voteKec.get(w.kecamatan) || 0) + 1);
  }
  const pickTop = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const namaDesa = opts.desa || pickTop(voteDesa);
  const namaKecamatan = opts.kecamatan || pickTop(voteKec);

  const resolved = resolveDesa(reference, {
    kodeDesa: opts.kodeDesa,
    namaDesa,
    namaKecamatan,
  });
  if (!resolved.ok) {
    const hint = resolved.candidates.length
      ? `\n  Kandidat: ${resolved.candidates.map((c) => `${c.kode} ${c.nama} (${c.kecamatan})`).join(', ')}`
      : '';
    throw new Error(
      `${sourceFile}: ${resolved.reason}.` +
      ` Terbaca desa='${namaDesa || '-'}' kecamatan='${namaKecamatan || '-'}'.` +
      ` Gunakan --desa/--kecamatan atau --kode-desa.${hint}`
    );
  }
  const desa = resolved.desa;

  const ctxBase = { sourceFile, keepOtherDesa: opts.keepOtherDesa, desa };

  // --- registri posyandu (nama → alamat) dari sheet POSYANDU ---
  const posyanduRegistry = new Map();
  for (const s of parsed.filter((p) => p.category === 'POSYANDU')) {
    for (const src of extractRows(s.rows, s.header)) {
      const nama = upper(src.nama_posyandu || src.nama_lengkap);
      if (!nama) continue;
      const alamat = composeAlamatLembaga(src, '_posyandu');
      posyanduRegistry.set(posyanduKey(nama), {
        nama,
        alamat,
        ketua: upper(src._nama_ketua),
        pendidikanKetua: src.pendidikan,
        teleponKetua: src.no_telepon,
        bank: upper(src.nama_bank),
        rekening: text(src.nomor_rekening),
        namaRekening: upper(src.nama_rekening),
        nomorPerkades: text(src._nomor_perkades),
        sheet: s.name,
        baris: src.__row,
      });
    }
  }

  // --- indeks pengaya (sheet linmas tambahan: rekening/telepon per NIK) ---
  const enrichByNik = new Map();
  for (const s of parsed.filter((p) => p.category === 'LINMAS_EXTRA')) {
    const bankFromLabel = (Object.values(s.header.labels)
      .map((l) => l && l.top).filter(Boolean)
      .find((l) => /^REKENING\s+\w+/.test(l)) || '').replace(/^REKENING\s+/, '');
    for (const src of extractRows(s.rows, s.header)) {
      const nik = parseNik(src.nik).value;
      if (!nik) continue;
      enrichByNik.set(nik, {
        no_telepon: parseTelepon(src.no_telepon) || '',
        nomor_rekening: text(src.nomor_rekening),
        nama_bank: upper(src.nama_bank) || bankFromLabel,
        sheet: s.name,
      });
    }
  }

  // --- konversi baris pengurus ---
  const out = {};
  for (const def of TEMPLATE_SHEETS) out[def.name] = [];
  const rejected = [];
  const ketuaPosyanduTerisi = new Set();

  const orderedSheets = parsed
    .filter((p) => CATEGORY_TARGET[p.category])
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  for (const s of orderedSheets) {
    const targetSheet = CATEGORY_TARGET[s.category];
    const ctx = { ...ctxBase, sheetName: s.name, targetSheet };
    let namaPosyanduAktif = '';
    let rwSebelumnya = '';

    // Sheet POSYANDU adalah daftar lembaga, bukan daftar pengurus — ketuanya
    // diambil belakangan, setelah sheet kader diproses.
    if (s.category === 'POSYANDU') continue;

    for (const src of extractRows(s.rows, s.header)) {
      // Daftar pilihan yang tercetak setelah tabel BNBA bukan data pengurus.
      if (s.category === 'KARANG_TARUNA' && !text(src.jabatan) && !parseNik(src.nik).value && !text(src.tanggal_lahir)) continue;
      const built = buildPengurusRow(src, ctx);
      if (built.reject !== undefined) {
        if (built.reject) {
          rejected.push({ file: sourceFile, sheet: s.name, baris: src.__row, nama: upper(src.nama_lengkap), alasan: built.reject });
        }
        continue;
      }
      const { row, notes } = built;

      if (targetSheet === '01_RTRW') {
        const err = fillRtRw(row, src, notes, s.header.format === 'desk' ? rwSebelumnya : '');
        if (err) {
          rejected.push({ file: sourceFile, sheet: s.name, baris: src.__row, nama: row.nama_lengkap, alasan: err });
          continue;
        }
        if (row.jenis_wilayah === 'RW') rwSebelumnya = row.nomor_rw;
      } else if (targetSheet === '02_POSYANDU') {
        const dariJabatan = upper(src.jabatan).match(/\bPOSYANDU\s+(.+)$/);
        if (dariJabatan) namaPosyanduAktif = `POSYANDU ${dariJabatan[1]}`;
        const nama = upper(src.nama_posyandu) || namaPosyanduAktif;
        if (!nama) {
          rejected.push({ file: sourceFile, sheet: s.name, baris: src.__row, nama: row.nama_lengkap, alasan: 'nama posyandu kosong' });
          continue;
        }
        const reg = posyanduRegistry.get(posyanduKey(nama));
        row.nama_posyandu = reg ? reg.nama : nama;
        row.alamat_posyandu = reg ? reg.alamat : '';
        if (!reg) notes.push(`posyandu '${nama}' tidak ada di sheet POSYANDU, alamat dikosongkan`);
      } else if (targetSheet === '07_LEMBAGA_LAINNYA') {
        row.nama_lembaga = upper(s.name).replace(/[_]+/g, ' ');
        row.alamat_sekretariat = upper(src.alamat_sekretariat);
        notes.push(`sheet '${s.name}' tidak dikenali, dimasukkan sebagai lembaga lainnya`);
      } else {
        row.nama_lembaga = `${LEMBAGA_PREFIX[targetSheet]} ${desa.nama.toUpperCase()}`;
        row.alamat_sekretariat = upper(src.alamat_sekretariat);
      }

      const jab = normalizeJabatan(src.jabatan, targetSheet, row.jenis_wilayah || null);
      row.jabatan = jab.value;
      if (jab.note) notes.push(jab.note);
      if (!row.jabatan) {
        rejected.push({ file: sourceFile, sheet: s.name, baris: src.__row, nama: row.nama_lengkap, alasan: 'jabatan kosong' });
        continue;
      }

      if (targetSheet === '02_POSYANDU' && row.jabatan === 'KETUA POSYANDU') {
        ketuaPosyanduTerisi.add(posyanduKey(row.nama_posyandu));
      }

      row._catatan = notes.join('; ');
      out[targetSheet].push(row);
    }
  }

  // --- ketua posyandu dari sheet POSYANDU (hanya bila belum ada di sheet kader) ---
  for (const [key, reg] of posyanduRegistry) {
    if (!reg.ketua || ketuaPosyanduTerisi.has(key)) continue;

    // Bila orangnya sudah terdaftar sebagai kader di posyandu yang sama, naikkan
    // jabatannya supaya NIK dan data pribadinya tidak hilang jadi baris kembar.
    const sudahAda = out['02_POSYANDU'].find(
      (r) => posyanduKey(r.nama_posyandu) === key && normalizeName(r.nama_lengkap) === normalizeName(reg.ketua)
    );
    if (sudahAda) {
      sudahAda._catatan = [sudahAda._catatan, `jabatan dinaikkan dari '${sudahAda.jabatan}' karena tercatat sebagai ketua di sheet ${reg.sheet}`]
        .filter(Boolean).join('; ');
      sudahAda.jabatan = 'KETUA POSYANDU';
      sudahAda._bank_operasional = reg.bank;
      sudahAda._rekening_operasional = reg.rekening;
      continue;
    }

    const row = emptyTemplateRow('02_POSYANDU');
    row.kode_desa = desa.kode;
    row.nama_posyandu = reg.nama;
    row.alamat_posyandu = reg.alamat;
    row.nama_lengkap = reg.ketua;
    row.jabatan = 'KETUA POSYANDU';
    const pend = parsePendidikan(reg.pendidikanKetua);
    row.pendidikan = pend.value;
    row.no_telepon = parseTelepon(reg.teleponKetua) || '';
    row.status_jabatan = 'aktif';
    row.status_verifikasi_pengurus = 'unverified';
    row._sumber_file = sourceFile;
    row._sumber_sheet = reg.sheet;
    row._sumber_baris = String(reg.baris);
    row._nomor_perkades = reg.nomorPerkades;
    row._jabatan_asli = 'NAMA KETUA POSYANDU';
    row._bank_operasional = reg.bank;
    row._rekening_operasional = reg.rekening;
    row._catatan = ['ketua diambil dari kolom NAMA KETUA POSYANDU (tanpa NIK)', pend.note].filter(Boolean).join('; ');
    out['02_POSYANDU'].push(row);
  }

  // --- pengaya rekening/telepon linmas ---
  let enriched = 0;
  for (const row of out['06_LINMAS']) {
    const extra = row.nik ? enrichByNik.get(row.nik) : null;
    if (!extra) continue;
    let touched = false;
    for (const field of ['no_telepon', 'nomor_rekening', 'nama_bank']) {
      if (!row[field] && extra[field]) { row[field] = extra[field]; touched = true; }
    }
    if (touched) {
      enriched += 1;
      row._catatan = [row._catatan, `dilengkapi dari sheet '${extra.sheet}'`].filter(Boolean).join('; ');
    }
  }

  // --- dedupe (sheet RT_RW dan RTRW sering salinan satu sama lain) ---
  let duplicates = 0;
  for (const def of TEMPLATE_SHEETS) {
    const seen = new Map();
    const kept = [];
    for (const row of out[def.name]) {
      const lembagaKey = def.lembaga.map((c) => row[c] || '').join('|');
      const identity = row.nik || row.nama_lengkap;
      const key = `${lembagaKey}|${identity}|${row.jabatan}`;
      if (seen.has(key)) {
        duplicates += 1;
        // Simpan baris yang paling banyak terisi.
        const prevIdx = seen.get(key);
        const score = (r) => Object.values(r).filter(Boolean).length;
        if (score(row) > score(kept[prevIdx])) kept[prevIdx] = row;
        continue;
      }
      seen.set(key, kept.length);
      kept.push(row);
    }
    out[def.name] = kept;
  }

  // --- bentrok jabatan tunggal (satu lembaga punya dua ketua, dst.) ---
  // Default: semua pemegang tetap masuk dan diberi catatan; --tolak-bentrok
  // hanya memakai pemegang pertama.
  let conflicts = 0;
  for (const def of TEMPLATE_SHEETS) {
    const holder = new Map();
    const kept = [];
    for (const row of out[def.name]) {
      if (!SINGULAR_OFFICE.test(row.jabatan)) { kept.push(row); continue; }
      const lembagaKey = def.lembaga.map((c) => row[c] || '').join('/');
      const key = `${lembagaKey}|${row.jabatan}`;
      const prev = holder.get(key);
      if (!prev) { holder.set(key, row); kept.push(row); continue; }
      conflicts += 1;
      if (!opts.tolakBentrok) {
        const note = (other) => `jabatan ganda: ${row.jabatan} ${lembagaKey} juga diisi ${other.nama_lengkap} (sheet ${other._sumber_sheet} baris ${other._sumber_baris})`;
        row._catatan = [row._catatan, note(prev)].filter(Boolean).join('; ');
        if (!prev.__ditandai) {
          prev._catatan = [prev._catatan, note(row)].filter(Boolean).join('; ');
          prev.__ditandai = true;
        }
        kept.push(row);
        continue;
      }
      rejected.push({
        file: sourceFile,
        sheet: row._sumber_sheet,
        baris: row._sumber_baris,
        nama: row.nama_lengkap,
        alasan: `bentrok: ${row.jabatan} ${lembagaKey} sudah diisi ${prev.nama_lengkap} (sheet ${prev._sumber_sheet} baris ${prev._sumber_baris}) — periksa sumbernya`,
      });
    }
    out[def.name] = kept;
  }

  return {
    sourceFile,
    filePath,
    desa,
    detected: { desa: namaDesa, kecamatan: namaKecamatan },
    sheets: out,
    rejected,
    skippedSheets,
    stats: {
      per_sheet: Object.fromEntries(TEMPLATE_SHEETS.map((d) => [d.name, out[d.name].length])),
      total: TEMPLATE_SHEETS.reduce((a, d) => a + out[d.name].length, 0),
      ditolak: rejected.length,
      duplikat: duplicates,
      bentrok: conflicts,
      dilengkapi: enriched,
      posyandu_terdaftar: posyanduRegistry.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Penulisan workbook
// ---------------------------------------------------------------------------

function aoaSheet(headers, rows, widths) {
  const aoa = [headers, ...rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? '' : String(r[h]))))];
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h) => ({ wch: (widths && widths[h]) || Math.min(Math.max(h.length + 2, 12), 34) }));
  return ws;
}

function writeOutputWorkbook(result, outPath) {
  const wb = xlsx.utils.book_new();

  const info = [
    ['Output Template Pengurus Kelembagaan'],
    [],
    ['File sumber', result.sourceFile],
    ['Desa', `${result.desa.nama} (${result.desa.status})`],
    ['Kode desa', result.desa.kode],
    ['Kecamatan', result.desa.kecamatan],
    ['Terbaca dari workbook', `desa='${result.detected.desa || '-'}' kecamatan='${result.detected.kecamatan || '-'}'`],
    ['Dibuat', new Date().toISOString()],
    [],
    ['Sheet', 'Jumlah baris'],
    ...TEMPLATE_SHEETS.map((d) => [d.name, result.stats.per_sheet[d.name]]),
    ['TOTAL', result.stats.total],
    [],
    ['Baris ditolak', result.stats.ditolak],
    ['Baris duplikat dibuang', result.stats.duplikat],
    ['Bentrok jabatan tunggal', result.stats.bentrok],
    ['Baris dilengkapi dari sheet tambahan', result.stats.dilengkapi],
    [],
    ['Catatan', 'Sheet 00_INFO dan _DITOLAK diabaikan importer; hanya sheet 01_ s.d. 07_ yang dibaca.'],
    ['', 'Kolom berawalan "_" adalah jejak asal data dan juga diabaikan importer.'],
  ];
  const wsInfo = xlsx.utils.aoa_to_sheet(info);
  wsInfo['!cols'] = [{ wch: 38 }, { wch: 70 }];
  xlsx.utils.book_append_sheet(wb, wsInfo, '00_INFO');

  for (const def of TEMPLATE_SHEETS) {
    const headers = columnsForSheet(def.name);
    xlsx.utils.book_append_sheet(wb, aoaSheet(headers, result.sheets[def.name]), def.name);
  }

  const rejHeaders = ['file', 'sheet', 'baris', 'nama', 'alasan'];
  const wsRej = aoaSheet(rejHeaders, result.rejected, { alasan: 60, nama: 30, file: 40 });
  xlsx.utils.book_append_sheet(wb, wsRej, '_DITOLAK');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  xlsx.writeFile(wb, outPath);
}

// ---------------------------------------------------------------------------
// Template kosong
// ---------------------------------------------------------------------------

const PETUNJUK = [
  ['TEMPLATE IMPORT PENGURUS KELEMBAGAAN DESA'],
  [],
  ['Cara pakai'],
  ['1', 'Isi hanya sheet 01_RTRW s.d. 07_LEMBAGA_LAINNYA. Baris pertama tiap sheet adalah nama kolom — jangan diubah.'],
  ['2', 'kode_desa wajib diisi persis seperti di sheet 08_REFERENSI_DESA (contoh: 32.01.14.2006).'],
  ['3', 'Satu baris = satu orang pengurus. Lembaga dibuat otomatis dari kolom identitas lembaga di tiap sheet.'],
  ['4', 'Tanggal ditulis YYYY-MM-DD (contoh 1980-08-13). Kosongkan bila tidak diketahui.'],
  ['5', 'Nomor RT/RW ditulis 3 digit (001, 012). NIK 16 digit, format sel Teks agar nol depan tidak hilang.'],
  ['6', 'Simpan sebagai .xlsx lalu unggah di menu Import Pengurus Kelembagaan.'],
  [],
  ['Kolom identitas lembaga per sheet'],
  ['01_RTRW', 'jenis_wilayah (RW atau RT), nomor_rw, nomor_rt (nomor_rt hanya untuk jenis_wilayah=RT)'],
  ['02_POSYANDU', 'nama_posyandu, alamat_posyandu'],
  ['03_LPM s.d. 07_LEMBAGA_LAINNYA', 'nama_lembaga, alamat_sekretariat'],
  [],
  ['Perilaku import'],
  ['', 'Baris baru masuk dengan tanda imported = true.'],
  ['', 'Baris lama yang bertanda imported akan diperbarui.'],
  ['', 'Data yang diinput manual lewat web TIDAK akan ditimpa.'],
];

const KOSAKATA = [
  ['kolom', 'nilai yang diizinkan'],
  ['jenis_kelamin', 'L, P'],
  ['status_perkawinan', 'BELUM MENIKAH, MENIKAH, CERAI HIDUP, CERAI MATI'],
  ['pendidikan', 'SD, SMP, SMA/SMK, D1, D2, D3, S1, S2, S3'],
  ['agama', 'ISLAM, KRISTEN, KATOLIK, HINDU, BUDDHA, KONGHUCU'],
  ['golongan_darah', 'A, B, AB, O'],
  ['status_jabatan', 'aktif, selesai'],
  ['status_verifikasi_pengurus', 'unverified, verified'],
  ['jenis_wilayah', 'RW, RT'],
  ['jabatan (RW)', 'KETUA RW, SEKRETARIS RW, BENDAHARA RW, SEKSI ...'],
  ['jabatan (RT)', 'KETUA RT, SEKRETARIS RT, BENDAHARA RT, SEKSI ...'],
  ['jabatan (POSYANDU)', 'KETUA POSYANDU, SEKRETARIS POSYANDU, BENDAHARA POSYANDU, KADER POSYANDU, KETUA BIDANG ...'],
  ['jabatan (LPM)', 'KETUA LPM, SEKRETARIS LPM, BENDAHARA LPM, KETUA BIDANG ..., ANGGOTA'],
  ['jabatan (KARANG TARUNA)', 'KETUA KARANG TARUNA, WAKIL KETUA KARANG TARUNA, SEKRETARIS KARANG TARUNA, SEKSI ..., ANGGOTA'],
  ['jabatan (PKK)', 'KETUA PKK, WAKIL KETUA PKK, SEKRETARIS PKK, BENDAHARA PKK, KETUA/SEKRETARIS/BENDAHARA/ANGGOTA POKJA I-IV'],
  ['jabatan (LINMAS)', 'KEPALA SATLINMAS, KEPALA PELAKSANA, KOMANDAN REGU ..., ANGGOTA SATLINMAS'],
];

function writeBlankTemplate(reference, outPath) {
  const wb = xlsx.utils.book_new();

  const wsPetunjuk = xlsx.utils.aoa_to_sheet(PETUNJUK);
  wsPetunjuk['!cols'] = [{ wch: 34 }, { wch: 110 }];
  xlsx.utils.book_append_sheet(wb, wsPetunjuk, '00_PETUNJUK');

  for (const def of TEMPLATE_SHEETS) {
    // Kolom jejak "_" tidak perlu ada di template isian manual.
    const headers = columnsForSheet(def.name).filter((c) => !c.startsWith('_'));
    xlsx.utils.book_append_sheet(wb, aoaSheet(headers, []), def.name);
  }

  const refRows = reference.desas.map((d) => ({
    kode_desa: d.kode, nama_desa: d.nama, status: d.status, kecamatan: d.kecamatan,
  }));
  xlsx.utils.book_append_sheet(
    wb,
    aoaSheet(['kode_desa', 'nama_desa', 'status', 'kecamatan'], refRows, { nama_desa: 28, kecamatan: 24 }),
    '08_REFERENSI_DESA'
  );

  const wsKosakata = xlsx.utils.aoa_to_sheet(KOSAKATA);
  wsKosakata['!cols'] = [{ wch: 28 }, { wch: 110 }];
  xlsx.utils.book_append_sheet(wb, wsKosakata, '09_KOSAKATA');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  xlsx.writeFile(wb, outPath);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.blank && opts.inputs.length === 0)) {
    printHelp();
    process.exitCode = opts.help ? 0 : 1;
    return;
  }

  const reference = loadReference();

  if (opts.blank) {
    const outDir = path.resolve(process.cwd(), opts.outDir || '.');
    const outPath = path.join(outDir, 'template_pengurus_kelembagaan_kosong.xlsx');
    writeBlankTemplate(reference, outPath);
    console.log(`Template kosong ditulis: ${outPath}`);
    if (opts.inputs.length === 0) return;
  }

  const reports = [];
  let failed = 0;

  for (const input of opts.inputs) {
    const filePath = path.resolve(process.cwd(), input);
    if (!fs.existsSync(filePath)) {
      console.error(`GAGAL  ${input}: file tidak ditemukan`);
      failed += 1;
      continue;
    }
    try {
      const result = buildFromWorkbook(filePath, opts, reference);
      const outDir = opts.outDir ? path.resolve(process.cwd(), opts.outDir) : path.dirname(filePath);
      const outName = `output_template_pengurus_kelembagaan_${slug(result.desa.kecamatan)}_${slug(result.desa.nama)}.xlsx`;
      const outPath = path.join(outDir, outName);
      writeOutputWorkbook(result, outPath);

      console.log(`\n=== ${result.sourceFile}`);
      console.log(`    Desa      : ${result.desa.nama} (${result.desa.kode}) — Kec. ${result.desa.kecamatan}`);
      for (const def of TEMPLATE_SHEETS) {
        const n = result.stats.per_sheet[def.name];
        if (n) console.log(`    ${def.name.padEnd(22)}: ${n} baris`);
      }
      console.log(`    TOTAL     : ${result.stats.total} baris pengurus`);
      console.log(`    Ditolak   : ${result.stats.ditolak} baris (lihat sheet _DITOLAK)`);
      if (result.stats.duplikat) console.log(`    Duplikat  : ${result.stats.duplikat} baris dibuang`);
      if (result.stats.bentrok) {
        const nasib = opts.tolakBentrok ? 'yang ganda ditolak' : 'semua tetap dimasukkan, lihat _catatan';
        console.log(`    Bentrok   : ${result.stats.bentrok} jabatan tunggal ganda (${nasib}) — PERLU DIPERIKSA`);
      }
      if (result.stats.dilengkapi) console.log(`    Dilengkapi: ${result.stats.dilengkapi} baris linmas dapat rekening/telepon`);
      for (const s of result.skippedSheets) console.log(`    Sheet dilewati: ${s.sheet} (${s.alasan})`);
      console.log(`    Output    : ${outPath}`);

      reports.push({
        sumber: result.sourceFile,
        desa: result.desa,
        stats: result.stats,
        output: outPath,
        ditolak: result.rejected,
        sheet_dilewati: result.skippedSheets,
      });
    } catch (err) {
      console.error(`\nGAGAL  ${path.basename(filePath)}: ${err.message}`);
      failed += 1;
      reports.push({ sumber: path.basename(filePath), error: err.message });
    }
  }

  if (opts.reportFile) {
    const reportPath = path.resolve(process.cwd(), opts.reportFile);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2), 'utf8');
    console.log(`\nLaporan JSON: ${reportPath}`);
  }

  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { buildFromWorkbook, writeOutputWorkbook, writeBlankTemplate };
