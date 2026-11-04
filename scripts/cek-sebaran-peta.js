/**
 * Pemeriksaan mandiri `/api/asta-desa/sebaran-peta`.
 *
 * Yang diperiksa adalah tiga hal yang membuat endpoint ini cepat, dan ketiganya
 * mudah rusak tanpa suara: muatan yang sudah dipangkas, koordinat yang
 * dibulatkan, dan muatan gzip yang dipakai ulang selama penyusurannya tidak
 * berubah. Kalau yang terakhir rusak, endpointnya tetap benar — hanya kembali
 * memakan dua detik CPU per pembukaan halaman, dan tidak ada yang memberi tahu.
 *
 * Jalankan: node scripts/cek-sebaran-peta.js
 */

const assert = require('assert');
const zlib = require('zlib');

const asta = require('../src/services/astadesa.service');

let dipanggil = 0;
let susur = null;
asta.ambilSemua = async () => {
  dipanggil += 1;
  return susur;
};

let detail = null;
asta.ambil = async () => detail;

const controller = require('../src/controllers/astadesa.controller');

const baris = (n) => ({
  id: n,
  rumah_lat: -6.59712345678901,
  rumah_lon: 106.84561234567,
  kecamatan: ' Cibinong ',
  desa: 'Pabuaran',
  status: 'terverifikasi',
  kk_nama: 'Nama KK',
  kk_nik: '3201234567890123',
  nama_petugas: 'Petugas A',
  tanggal_pendataan: '2026-10-07T03:00:00.000Z',
  foto_rumah_urls: ['https://astadesa.rmlabs.id/storage/1/foto.jpg']
});

const susurDari = (rows, lebih = {}) => ({
  rows,
  terbaca: rows.length,
  truncated: false,
  belum_siap: false,
  basi: false,
  ...lebih
});

const panggil = async (gzipDiterima = true) => {
  const req = { query: {}, headers: gzipDiterima ? { 'accept-encoding': 'gzip, deflate' } : {} };
  let keluar = null;
  const res = {
    headers: {},
    type() {
      return this;
    },
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    send(isi) {
      keluar = isi;
      return this;
    },
    status() {
      return this;
    },
    json(isi) {
      keluar = isi;
      return this;
    }
  };
  await controller.getSebaranPeta(req, res);
  assert.ok(Buffer.isBuffer(keluar), `balasan bukan buffer: ${JSON.stringify(keluar)}`);
  if (res.headers['Content-Encoding'] === 'gzip') keluar = zlib.gunzipSync(keluar);
  return { res, body: JSON.parse(keluar.toString('utf8')) };
};

(async () => {
  // Satu baris wajar, satu tanpa koordinat, satu di luar Kabupaten Bogor.
  susur = susurDari([
    baris(1),
    { ...baris(2), rumah_lat: null, rumah_lon: null, lokasi_lat: null, lokasi_lon: null },
    { ...baris(3), rumah_lat: -8.1, rumah_lon: 115.2 }
  ]);

  const { res, body } = await panggil();
  const d = body.data;

  assert.strictEqual(d.titik.length, 1, 'hanya baris berkoordinat sah yang jadi titik');
  assert.strictEqual(d.tanpa_koordinat, 1);
  assert.strictEqual(d.di_luar_wilayah, 1);
  assert.strictEqual(d.total_baris, 3);
  assert.strictEqual(d.pakai_koordinat_rumah, 1);
  assert.strictEqual(d.rincian_siap, true);

  const t = d.titik[0];
  // Koordinat dibulatkan — ini yang memangkas belasan megabyte.
  assert.strictEqual(t.lat, -6.597123, `lat tidak dibulatkan: ${t.lat}`);
  assert.strictEqual(t.lng, 106.845612, `lng tidak dibulatkan: ${t.lng}`);
  // Kolom yang tidak dibaca halaman peta tidak boleh ikut terkirim.
  assert.ok(!('status' in t), 'kolom status kembali terkirim');
  assert.ok(!('sumber_koordinat' in t), 'kolom sumber_koordinat kembali terkirim');
  // Kolom yang DIBACA halaman peta wajib tetap ada.
  ['id', 'lat', 'lng', 'kecamatan', 'desa', 'kk_nama', 'nik', 'petugas', 'tanggal'].forEach((k) =>
    assert.ok(k in t, `kolom ${k} hilang dari titik`)
  );
  // Foto adalah kolom termahal di muatan ini (±5 MB terkompresi untuk 191 ribu
  // titik) dan hanya dilihat saat satu titik diklik — tempatnya di endpoint
  // detail, diperiksa di bawah.
  assert.ok(!('foto' in t), 'URL foto kembali ikut di setiap titik');
  assert.strictEqual(t.kecamatan, 'Cibinong');
  assert.strictEqual(t.nik, '320123**********', 'NIK wajib tetap tersamar');
  assert.strictEqual(t.tanggal, '2026-10-07');
  assert.strictEqual(res.headers['Content-Encoding'], 'gzip');
  assert.strictEqual(res.headers['Cache-Control'], 'private, max-age=120');

  // Nilai kosong hilang kuncinya, bukan terkirim sebagai null.
  susur = susurDari([{ ...baris(4), kk_nama: null, kk_nik: null, nama_petugas: null, foto_rumah_urls: null }]);
  const kosong = (await panggil()).body.data.titik[0];
  ['kk_nama', 'nik', 'petugas'].forEach((k) =>
    assert.ok(!(k in kosong), `kolom kosong ${k} masih terkirim`)
  );

  // Penyusuran yang belum utuh TIDAK boleh di-cache peramban: halaman
  // menanyakannya ulang tiap 20 detik justru untuk melihat kemajuannya.
  susur = susurDari([baris(5)], { belum_siap: true, truncated: true, progres: { halaman: 3, dari: 958 } });
  const belum = await panggil();
  assert.strictEqual(belum.res.headers['Cache-Control'], 'no-store');
  assert.strictEqual(belum.body.data.rincian_siap, false);
  assert.deepStrictEqual(belum.body.data.rincian_progres, { halaman: 3, dari: 958 });

  // Muatan dipakai ulang selama penyusurannya sama, dan dibangun ulang begitu
  // barisnya bertambah. Ditandai lewat nilai yang ikut berubah bersama muatan.
  const rows = [baris(6)];
  susur = susurDari(rows);
  assert.strictEqual((await panggil()).body.data.total_baris, 1);
  // Objek `semua` baru tiap permintaan (jalur "basi"), tetapi barisnya sama —
  // muatan lama harus tetap dipakai.
  susur = susurDari(rows);
  assert.strictEqual((await panggil()).body.data.total_baris, 1);
  rows.push(baris(7));
  susur = susurDari(rows);
  assert.strictEqual((await panggil()).body.data.total_baris, 2, 'muatan tidak dibangun ulang saat baris bertambah');

  // Permintaan yang berbarengan ikut menunggu SATU pembangunan muatan.
  rows.push(baris(8));
  susur = susurDari(rows);
  const bareng = await Promise.all([panggil(), panggil(), panggil()]);
  bareng.forEach((b) => assert.strictEqual(b.body.data.total_baris, 3));

  // Peramban tanpa gzip tetap dilayani JSON biasa.
  const polos = await panggil(false);
  assert.ok(!polos.res.headers['Content-Encoding']);
  assert.strictEqual(polos.body.data.total_baris, 3);

  assert.ok(dipanggil >= 7, 'penyusuran tidak dipanggil sebanyak permintaan');

  // ── Foto rumah pada endpoint detail ──────────────────────────────────────
  //
  // Inilah pengganti `titik.foto`. Kalau ini rusak, peta tetap bekerja dan
  // panel tetap terisi — hanya fotonya hilang tanpa satu pun pesan galat.
  const urlFoto = 'https://astadesa.rmlabs.id/storage/9/01K8ZQ/foto.jpg';
  susur = susurDari([{ ...baris(9), id: 8, foto_rumah_urls: [urlFoto] }]);
  // Balasan ASTA DESA untuk /sensuses/{id}: amplop, dan TANPA URL media.
  detail = { data: { sensus: { id: 8, kk_nama: 'Nama KK', foto_rumah_urls: null }, anggotas: [], petugas: null } };

  const resDetail = {
    body: null,
    set() {
      return this;
    },
    status() {
      return this;
    },
    json(isi) {
      this.body = isi;
      return this;
    }
  };
  await controller.getSensusDetail({ params: { id: '8' }, query: {} }, resDetail);
  assert.deepStrictEqual(
    resDetail.body.data.sensus.foto_rumah_urls,
    [urlFoto],
    'URL foto tidak dilampirkan dari penyusuran yang tersimpan'
  );
  // Balasan yang tersimpan di cache service TIDAK boleh ikut berubah.
  assert.strictEqual(detail.data.sensus.foto_rumah_urls, null, 'objek cache service ikut diubah');

  // Baris yang tidak ada di penyusuran tetap dilayani, tanpa foto.
  detail = { data: { sensus: { id: 999, kk_nama: 'Nama KK' }, anggotas: [], petugas: null } };
  const resHilang = { ...resDetail, body: null };
  await controller.getSensusDetail({ params: { id: '999' }, query: {} }, resHilang);
  assert.ok(resHilang.body.success, 'detail gagal hanya karena fotonya tidak ketemu');
  assert.ok(!resHilang.body.data.sensus.foto_rumah_urls, 'foto baris lain ikut terlampir');
  console.log('OK — sebaran-peta: muatan terpangkas, koordinat dibulatkan, cache gzip hidup');
})().catch((err) => {
  console.error("GAGAL —", err.stack);
  process.exit(1);
});
