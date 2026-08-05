/**
 * Formulir: pembuat formulir mandiri per bidang.
 *
 * Aturan akses:
 * - Formulir milik satu bidang; hanya pegawai bidang itu yang bisa menyunting
 *   dan melihat responsnya.
 * - Pimpinan (superadmin/kepala_dinas/sekretaris_dinas) melihat semuanya.
 * - Pengisian dibuka lewat tautan publik bertoken, TANPA login — kecuali
 *   formulirnya menyalakan `butuh_login`.
 *
 * Yang perlu diingat saat mengubah berkas ini: seluruh isi `publik()` dan
 * `kirim()` dilayani ke internet terbuka. Apa pun yang tidak perlu diketahui
 * pengisi (mis. id bidang pemilik, jumlah respons masuk) sengaja tidak ikut
 * dikirim, dan setiap jawaban divalidasi ulang di sini — validasi di browser
 * hanya kenyamanan, bukan pengaman.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { FORMULIR_ROOT } = require('../middlewares/formulirUpload');

const PIMPINAN = ['superadmin', 'kepala_dinas', 'sekretaris_dinas'];

// Tipe yang tidak menampung jawaban; hanya pemisah berjudul di formulir.
const TIPE_TANPA_JAWABAN = ['bagian'];

const TIPE_PILIHAN = ['pilihan_ganda', 'kotak_centang', 'dropdown'];

const TIPE_SAH = [
  'bagian',
  'jawaban_singkat',
  'paragraf',
  'pilihan_ganda',
  'kotak_centang',
  'dropdown',
  'skala_linier',
  'tanggal',
  'waktu',
  'unggah_berkas',
];

/** BigInt tidak bisa di-JSON.stringify; semua id dinormalkan ke Number. */
const rapikan = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(rapikan);
  if (obj instanceof Date) return obj;
  if (typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, rapikan(v)]));
  }
  return obj;
};

const teks = (v, maks) => String(v ?? '').trim().slice(0, maks);

/** Apakah pengguna boleh mengelola formulir milik `bidangPemilik`? */
const bolehKelola = (user, bidangPemilik) =>
  PIMPINAN.includes(user.role) || Number(user.bidang_id) === Number(bidangPemilik);

/** Ambil formulir + periksa hak kelola sekaligus. */
const ambilFormulir = async (user, id) => {
  const formulir = await prisma.formulir.findFirst({
    where: { id: BigInt(id), deleted_at: null },
  });
  if (!formulir) return { kode: 404, pesan: 'Formulir tidak ditemukan.' };
  if (!bolehKelola(user, formulir.bidang_id)) {
    return { kode: 403, pesan: 'Formulir ini milik bidang lain.' };
  }
  return { formulir };
};

/**
 * Alasan sebuah formulir tidak (lagi) menerima respons, atau null bila terbuka.
 * Dipakai dua kali — saat membuka formulir dan saat mengirim — supaya jendela
 * antara "halaman dibuka" dan "tombol kirim ditekan" tidak bisa dipakai
 * menyelinapkan respons yang telat.
 */
const alasanTertutup = async (formulir) => {
  if (formulir.status === 'draf') return 'Formulir ini belum diterbitkan.';
  if (formulir.status === 'ditutup') return 'Formulir ini sudah ditutup.';
  if (formulir.tutup_pada && new Date(formulir.tutup_pada) < new Date()) {
    return 'Formulir ini sudah melewati batas waktu pengisian.';
  }
  if (formulir.batas_respons) {
    const masuk = await prisma.formulir_respons.count({ where: { formulir_id: formulir.id } });
    if (masuk >= formulir.batas_respons) return 'Kuota respons formulir ini sudah penuh.';
  }
  return null;
};

/** Bentuk pertanyaan yang aman dikirim ke pengisi. */
const pertanyaanPublik = (p) => ({
  id: Number(p.id),
  tipe: p.tipe,
  label: p.label,
  deskripsi: p.deskripsi,
  wajib: p.wajib,
  urutan: p.urutan,
  opsi: Array.isArray(p.opsi) ? p.opsi : [],
  pengaturan: p.pengaturan || {},
});

/**
 * Normalkan satu pertanyaan yang datang dari editor.
 * Mengembalikan { data } atau { pesan } bila isinya tidak masuk akal.
 */
const siapkanPertanyaan = (p, urutan) => {
  const tipe = TIPE_SAH.includes(p.tipe) ? p.tipe : 'jawaban_singkat';
  const label = teks(p.label, 500);
  if (!label) return { pesan: `Pertanyaan ke-${urutan + 1} belum diberi judul.` };

  // Opsi hanya bermakna untuk tipe pilihan; disimpan kosong untuk tipe lain
  // supaya sisa data lama tidak ikut terbawa saat tipe pertanyaan diganti.
  let opsi = [];
  if (TIPE_PILIHAN.includes(tipe)) {
    opsi = (Array.isArray(p.opsi) ? p.opsi : [])
      .map((o) => teks(o, 255))
      .filter(Boolean);
    if (!opsi.length) return { pesan: `"${label}" belum punya pilihan jawaban.` };
    if (new Set(opsi).size !== opsi.length) {
      return { pesan: `"${label}" punya pilihan jawaban yang sama persis lebih dari satu.` };
    }
  }

  const asal = p.pengaturan || {};
  const pengaturan = {};

  if (tipe === 'skala_linier') {
    const min = Number.isFinite(Number(asal.min)) ? Number(asal.min) : 1;
    const maks = Number.isFinite(Number(asal.maks)) ? Number(asal.maks) : 5;
    if (maks <= min) return { pesan: `Skala pada "${label}" harus naik dari kecil ke besar.` };
    // Dibatasi 0..10 mengikuti Google Forms; skala lebih panjang dari itu tidak
    // terbaca lagi sebagai skala dan lebih cocok jadi jawaban angka.
    if (min < 0 || maks > 10) return { pesan: `Skala pada "${label}" hanya boleh di rentang 0–10.` };
    pengaturan.min = min;
    pengaturan.maks = maks;
    pengaturan.label_min = teks(asal.label_min, 100);
    pengaturan.label_maks = teks(asal.label_maks, 100);
  }

  if (['pilihan_ganda', 'kotak_centang'].includes(tipe)) {
    pengaturan.opsi_lainnya = Boolean(asal.opsi_lainnya);
  }

  if (tipe === 'kotak_centang') {
    const min = Number(asal.min_pilih) || 0;
    const maks = Number(asal.maks_pilih) || 0;
    if (min && maks && min > maks) {
      return { pesan: `Batas pilihan pada "${label}" terbalik (minimal lebih besar dari maksimal).` };
    }
    if (maks && maks > opsi.length + (pengaturan.opsi_lainnya ? 1 : 0)) {
      return { pesan: `Batas maksimal pilihan pada "${label}" melebihi jumlah pilihannya.` };
    }
    pengaturan.min_pilih = min;
    pengaturan.maks_pilih = maks;
  }

  if (['jawaban_singkat', 'paragraf'].includes(tipe)) {
    const validasi = ['email', 'angka', 'url'].includes(asal.validasi) ? asal.validasi : '';
    if (validasi) pengaturan.validasi = validasi;
  }

  if (tipe === 'unggah_berkas') {
    const maksBerkas = Math.min(Math.max(Number(asal.maks_berkas) || 1, 1), 5);
    pengaturan.maks_berkas = maksBerkas;
  }

  return {
    data: {
      tipe,
      label,
      deskripsi: teks(p.deskripsi, 2000) || null,
      // Pemisah bagian tidak punya jawaban, jadi "wajib" tidak berlaku.
      wajib: TIPE_TANPA_JAWABAN.includes(tipe) ? false : Boolean(p.wajib),
      urutan,
      opsi,
      pengaturan,
    },
  };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;
const WAKTU_RE = /^\d{2}:\d{2}$/;

/**
 * Periksa satu jawaban terhadap definisi pertanyaannya.
 * Mengembalikan { nilai, nilai_json } atau { pesan }.
 */
const validasiJawaban = (p, masuk, jumlahBerkas) => {
  const opsi = Array.isArray(p.opsi) ? p.opsi : [];
  const set = p.pengaturan || {};
  const wajib = Boolean(p.wajib);

  if (p.tipe === 'unggah_berkas') {
    if (wajib && !jumlahBerkas) return { pesan: `"${p.label}" wajib dilampiri berkas.` };
    const maks = Number(set.maks_berkas) || 1;
    if (jumlahBerkas > maks) {
      return { pesan: `"${p.label}" hanya boleh dilampiri ${maks} berkas.` };
    }
    return { nilai: null, nilai_json: null };
  }

  if (p.tipe === 'kotak_centang') {
    const dipilih = (Array.isArray(masuk) ? masuk : [])
      .map((v) => teks(v, 255))
      .filter(Boolean);

    const sah = dipilih.filter((v) => opsi.includes(v));
    const lain = dipilih.filter((v) => !opsi.includes(v));
    if (lain.length && !set.opsi_lainnya) {
      return { pesan: `Ada pilihan pada "${p.label}" yang tidak dikenali.` };
    }
    // "Lainnya" hanya boleh sekali; lebih dari itu berarti jawaban dikarang di
    // luar formulir.
    if (lain.length > 1) return { pesan: `"${p.label}" hanya boleh punya satu isian lainnya.` };

    const semua = [...sah, ...lain];
    if (!semua.length) {
      if (wajib) return { pesan: `"${p.label}" wajib diisi.` };
      return { nilai: null, nilai_json: [] };
    }
    if (set.min_pilih && semua.length < set.min_pilih) {
      return { pesan: `"${p.label}" minimal ${set.min_pilih} pilihan.` };
    }
    if (set.maks_pilih && semua.length > set.maks_pilih) {
      return { pesan: `"${p.label}" maksimal ${set.maks_pilih} pilihan.` };
    }
    return { nilai: null, nilai_json: semua };
  }

  const nilai = teks(masuk, 10000);
  if (!nilai) {
    if (wajib) return { pesan: `"${p.label}" wajib diisi.` };
    return { nilai: null, nilai_json: null };
  }

  if (['pilihan_ganda', 'dropdown'].includes(p.tipe)) {
    const dikenal = opsi.includes(nilai);
    // Dropdown tidak pernah punya "lainnya" — sama seperti Google Forms.
    const bolehLain = p.tipe === 'pilihan_ganda' && Boolean(set.opsi_lainnya);
    if (!dikenal && !bolehLain) {
      return { pesan: `Pilihan pada "${p.label}" tidak dikenali.` };
    }
  }

  if (p.tipe === 'skala_linier') {
    const angka = Number(nilai);
    const min = Number(set.min ?? 1);
    const maks = Number(set.maks ?? 5);
    if (!Number.isFinite(angka) || angka < min || angka > maks) {
      return { pesan: `Nilai pada "${p.label}" harus antara ${min} dan ${maks}.` };
    }
  }

  if (p.tipe === 'tanggal' && !TANGGAL_RE.test(nilai)) {
    return { pesan: `Tanggal pada "${p.label}" tidak sah.` };
  }
  if (p.tipe === 'waktu' && !WAKTU_RE.test(nilai)) {
    return { pesan: `Waktu pada "${p.label}" tidak sah.` };
  }

  if (set.validasi === 'email' && !EMAIL_RE.test(nilai)) {
    return { pesan: `"${p.label}" harus berupa alamat email.` };
  }
  if (set.validasi === 'angka' && !Number.isFinite(Number(nilai))) {
    return { pesan: `"${p.label}" harus berupa angka.` };
  }
  if (set.validasi === 'url' && !/^https?:\/\/\S+$/i.test(nilai)) {
    return { pesan: `"${p.label}" harus berupa tautan (diawali http:// atau https://).` };
  }

  return { nilai, nilai_json: null };
};

/** Satu sel CSV, aman untuk dibuka di Excel. */
const selCsv = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Sel yang diawali =, +, -, atau @ dieksekusi Excel sebagai rumus. Diberi
  // kutip satu supaya isian responden tidak bisa jadi formula di komputer
  // orang yang membuka ekspornya.
  const aman = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${aman.replace(/"/g, '""')}"`;
};

class FormulirController {
  // ============================================================
  // Pengelolaan
  // ============================================================
  async daftar(req, res) {
    try {
      const bidangId = BigInt(req.params.bidangId);
      const formulirs = await prisma.formulir.findMany({
        where: { bidang_id: bidangId, deleted_at: null },
        orderBy: { updated_at: 'desc' },
      });

      // Jumlah respons diambil sekali untuk semua formulir; satu count per baris
      // membuat daftar dengan 30 formulir menembak 30 query.
      const idFormulir = formulirs.map((f) => f.id);
      const hitung = idFormulir.length
        ? await prisma.formulir_respons.groupBy({
            by: ['formulir_id'],
            where: { formulir_id: { in: idFormulir } },
            _count: { _all: true },
          })
        : [];
      const petaHitung = new Map(hitung.map((h) => [Number(h.formulir_id), h._count._all]));

      const jumlahPertanyaan = idFormulir.length
        ? await prisma.formulir_pertanyaan.groupBy({
            by: ['formulir_id'],
            where: { formulir_id: { in: idFormulir } },
            _count: { _all: true },
          })
        : [];
      const petaPertanyaan = new Map(jumlahPertanyaan.map((h) => [Number(h.formulir_id), h._count._all]));

      res.json({
        success: true,
        data: formulirs.map((f) => ({
          ...rapikan(f),
          jumlah_respons: petaHitung.get(Number(f.id)) || 0,
          jumlah_pertanyaan: petaPertanyaan.get(Number(f.id)) || 0,
        })),
      });
    } catch (error) {
      console.error('Error daftar formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat daftar formulir.' });
    }
  }

  async buat(req, res) {
    try {
      const bidangId = BigInt(req.params.bidangId);
      const formulir = await prisma.formulir.create({
        data: {
          bidang_id: bidangId,
          judul: teks(req.body.judul, 255) || 'Formulir tanpa judul',
          deskripsi: teks(req.body.deskripsi, 5000) || null,
          token: crypto.randomBytes(16).toString('hex'),
          created_by: BigInt(req.user.id),
          updated_by: BigInt(req.user.id),
        },
      });

      // Formulir kosong tidak bisa disunting dengan enak; satu pertanyaan awal
      // membuat editor langsung punya sesuatu untuk dikerjakan.
      await prisma.formulir_pertanyaan.create({
        data: {
          formulir_id: formulir.id,
          tipe: 'jawaban_singkat',
          label: 'Pertanyaan tanpa judul',
          urutan: 0,
          opsi: [],
          pengaturan: {},
        },
      });

      res.status(201).json({ success: true, data: rapikan(formulir) });
    } catch (error) {
      console.error('Error buat formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat formulir.' });
    }
  }

  async detail(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const [pertanyaan, jumlahRespons] = await Promise.all([
        prisma.formulir_pertanyaan.findMany({
          where: { formulir_id: formulir.id },
          orderBy: { urutan: 'asc' },
        }),
        prisma.formulir_respons.count({ where: { formulir_id: formulir.id } }),
      ]);

      res.json({
        success: true,
        data: {
          ...rapikan(formulir),
          jumlah_respons: jumlahRespons,
          pertanyaan: pertanyaan.map(pertanyaanPublik),
        },
      });
    } catch (error) {
      console.error('Error detail formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat formulir.' });
    }
  }

  async ubah(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const b = req.body;
      const data = { updated_by: BigInt(req.user.id) };

      if (b.judul !== undefined) {
        const judul = teks(b.judul, 255);
        if (!judul) return res.status(400).json({ success: false, message: 'Judul wajib diisi.' });
        data.judul = judul;
      }
      if (b.deskripsi !== undefined) data.deskripsi = teks(b.deskripsi, 5000) || null;
      if (b.pesan_konfirmasi !== undefined) data.pesan_konfirmasi = teks(b.pesan_konfirmasi, 2000) || null;

      if (b.status !== undefined) {
        if (!['draf', 'terbit', 'ditutup'].includes(b.status)) {
          return res.status(400).json({ success: false, message: 'Status formulir tidak sah.' });
        }
        if (b.status === 'terbit') {
          const jumlah = await prisma.formulir_pertanyaan.count({
            where: { formulir_id: formulir.id, tipe: { not: 'bagian' } },
          });
          if (!jumlah) {
            return res.status(400).json({
              success: false,
              message: 'Formulir belum punya pertanyaan yang bisa dijawab.',
            });
          }
        }
        data.status = b.status;
      }

      for (const kunci of ['butuh_login', 'satu_respons', 'kumpulkan_email', 'acak_pertanyaan', 'respons_terbuka']) {
        if (b[kunci] !== undefined) data[kunci] = Boolean(b[kunci]);
      }

      // Membatasi satu respons per orang mustahil tanpa identitas; menyalakannya
      // sendirian hanya memberi rasa aman palsu, jadi login ikut dinyalakan.
      if (data.satu_respons && !(data.butuh_login ?? formulir.butuh_login)) {
        data.butuh_login = true;
      }
      if (data.kumpulkan_email && !(data.butuh_login ?? formulir.butuh_login)) {
        data.butuh_login = true;
      }

      if (b.tutup_pada !== undefined) {
        if (!b.tutup_pada) {
          data.tutup_pada = null;
        } else {
          const waktu = new Date(b.tutup_pada);
          if (Number.isNaN(waktu.getTime())) {
            return res.status(400).json({ success: false, message: 'Batas waktu tidak sah.' });
          }
          data.tutup_pada = waktu;
        }
      }

      if (b.batas_respons !== undefined) {
        const batas = Number(b.batas_respons);
        data.batas_respons = b.batas_respons && batas > 0 ? Math.floor(batas) : null;
      }

      const hasil = await prisma.formulir.update({ where: { id: formulir.id }, data });
      res.json({ success: true, data: rapikan(hasil) });
    } catch (error) {
      console.error('Error ubah formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan formulir.' });
    }
  }

  /**
   * Simpan SELURUH daftar pertanyaan sekaligus.
   *
   * Editor mengirim susunan lengkapnya, bukan perubahan per pertanyaan. Alasannya
   * praktis: menyeret satu pertanyaan mengubah urutan banyak pertanyaan lain
   * sekaligus, dan mengirim itu sebagai belasan permintaan terpisah membuat
   * urutan di server bisa berbeda dari yang terlihat di layar kalau salah satunya
   * gagal.
   */
  async simpanPertanyaan(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const masuk = Array.isArray(req.body.pertanyaan) ? req.body.pertanyaan : [];
      if (masuk.length > 200) {
        return res.status(400).json({ success: false, message: 'Satu formulir maksimal 200 pertanyaan.' });
      }

      const disiapkan = [];
      for (let i = 0; i < masuk.length; i += 1) {
        const hasil = siapkanPertanyaan(masuk[i], i);
        if (hasil.pesan) return res.status(400).json({ success: false, message: hasil.pesan });
        disiapkan.push({ id: masuk[i].id, ...hasil.data });
      }

      const lama = await prisma.formulir_pertanyaan.findMany({
        where: { formulir_id: formulir.id },
        select: { id: true },
      });
      const idLama = new Set(lama.map((p) => Number(p.id)));
      const idBertahan = new Set(
        disiapkan.map((p) => Number(p.id)).filter((id) => Number.isFinite(id) && idLama.has(id))
      );
      const idHilang = [...idLama].filter((id) => !idBertahan.has(id));

      await prisma.$transaction(async (tx) => {
        // Jawaban lama ikut dibuang bersama pertanyaannya. Membiarkannya
        // menggantung berarti tabel respons menyimpan jawaban yang tidak bisa
        // lagi dijelaskan pertanyaannya.
        if (idHilang.length) {
          const idBig = idHilang.map((id) => BigInt(id));
          await tx.formulir_jawaban.deleteMany({ where: { pertanyaan_id: { in: idBig } } });
          await tx.formulir_berkas.deleteMany({ where: { pertanyaan_id: { in: idBig } } });
          await tx.formulir_pertanyaan.deleteMany({ where: { id: { in: idBig } } });
        }

        for (const p of disiapkan) {
          const { id, ...isi } = p;
          if (Number.isFinite(Number(id)) && idBertahan.has(Number(id))) {
            await tx.formulir_pertanyaan.update({ where: { id: BigInt(id) }, data: isi });
          } else {
            await tx.formulir_pertanyaan.create({ data: { formulir_id: formulir.id, ...isi } });
          }
        }

        await tx.formulir.update({
          where: { id: formulir.id },
          data: { updated_by: BigInt(req.user.id), updated_at: new Date() },
        });
      });

      const segar = await prisma.formulir_pertanyaan.findMany({
        where: { formulir_id: formulir.id },
        orderBy: { urutan: 'asc' },
      });

      res.json({ success: true, data: segar.map(pertanyaanPublik) });
    } catch (error) {
      console.error('Error simpan pertanyaan:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan pertanyaan.' });
    }
  }

  async duplikat(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const pertanyaan = await prisma.formulir_pertanyaan.findMany({
        where: { formulir_id: formulir.id },
        orderBy: { urutan: 'asc' },
      });

      // Salinan selalu lahir sebagai draf dengan token baru: menyalin token akan
      // membuat dua formulir berebut satu tautan, dan menyalin status "terbit"
      // diam-diam membuka formulir yang belum sempat diperiksa.
      const salinan = await prisma.formulir.create({
        data: {
          bidang_id: formulir.bidang_id,
          judul: `${formulir.judul} (salinan)`.slice(0, 255),
          deskripsi: formulir.deskripsi,
          token: crypto.randomBytes(16).toString('hex'),
          status: 'draf',
          butuh_login: formulir.butuh_login,
          satu_respons: formulir.satu_respons,
          kumpulkan_email: formulir.kumpulkan_email,
          acak_pertanyaan: formulir.acak_pertanyaan,
          respons_terbuka: formulir.respons_terbuka,
          pesan_konfirmasi: formulir.pesan_konfirmasi,
          batas_respons: formulir.batas_respons,
          created_by: BigInt(req.user.id),
          updated_by: BigInt(req.user.id),
        },
      });

      if (pertanyaan.length) {
        await prisma.formulir_pertanyaan.createMany({
          data: pertanyaan.map((p) => ({
            formulir_id: salinan.id,
            tipe: p.tipe,
            label: p.label,
            deskripsi: p.deskripsi,
            wajib: p.wajib,
            urutan: p.urutan,
            opsi: p.opsi ?? [],
            pengaturan: p.pengaturan ?? {},
          })),
        });
      }

      res.status(201).json({ success: true, data: rapikan(salinan) });
    } catch (error) {
      console.error('Error duplikat formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal menyalin formulir.' });
    }
  }

  async hapus(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      // Soft delete: responnya ikut menghilang dari layar tapi tidak dibuang.
      // Formulir yang sudah dijawab orang adalah data, bukan sekadar konfigurasi,
      // dan salah klik hapus tidak boleh berarti kehilangan seluruh isian.
      await prisma.formulir.update({
        where: { id: formulir.id },
        data: { deleted_at: new Date(), deleted_by: BigInt(req.user.id), status: 'ditutup' },
      });

      res.json({ success: true, message: 'Formulir dihapus.' });
    } catch (error) {
      console.error('Error hapus formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus formulir.' });
    }
  }

  // ============================================================
  // Sisi pengisi (publik)
  // ============================================================
  async publik(req, res) {
    try {
      const formulir = await prisma.formulir.findFirst({
        where: { token: String(req.params.token || '').slice(0, 32), deleted_at: null },
      });
      if (!formulir) {
        return res.status(404).json({ success: false, message: 'Formulir tidak ditemukan.' });
      }

      const tertutup = await alasanTertutup(formulir);
      const dasar = {
        judul: formulir.judul,
        deskripsi: formulir.deskripsi,
        butuh_login: formulir.butuh_login,
        kumpulkan_email: formulir.kumpulkan_email,
      };

      if (tertutup) {
        return res.json({ success: true, data: { ...dasar, tertutup: true, alasan: tertutup } });
      }

      if (formulir.butuh_login && !req.user) {
        return res.json({
          success: true,
          data: { ...dasar, perlu_masuk: true, alasan: 'Formulir ini hanya bisa diisi setelah masuk akun.' },
        });
      }

      if (formulir.satu_respons && req.user) {
        const sudah = await prisma.formulir_respons.findFirst({
          where: { formulir_id: formulir.id, user_id: BigInt(req.user.id) },
        });
        if (sudah) {
          return res.json({
            success: true,
            data: {
              ...dasar,
              sudah_mengisi: true,
              alasan: 'Anda sudah mengirim jawaban untuk formulir ini.',
              dikirim_pada: sudah.dikirim_pada,
            },
          });
        }
      }

      const pertanyaan = await prisma.formulir_pertanyaan.findMany({
        where: { formulir_id: formulir.id },
        orderBy: { urutan: 'asc' },
      });

      let daftar = pertanyaan.map(pertanyaanPublik);
      if (formulir.acak_pertanyaan) {
        // Diacak per BAGIAN, bukan seluruh formulir: pemisah bagian kehilangan
        // artinya kalau pertanyaan bisa pindah ke bawah judul bagian lain.
        const kelompok = [];
        let sekarang = [];
        for (const p of daftar) {
          if (p.tipe === 'bagian') {
            if (sekarang.length) kelompok.push(sekarang);
            kelompok.push([p]);
            sekarang = [];
          } else {
            sekarang.push(p);
          }
        }
        if (sekarang.length) kelompok.push(sekarang);

        daftar = kelompok.flatMap((k) => {
          if (k.length <= 1) return k;
          const acak = [...k];
          for (let i = acak.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [acak[i], acak[j]] = [acak[j], acak[i]];
          }
          return acak;
        });
      }

      res.json({
        success: true,
        data: {
          ...dasar,
          tertutup: false,
          token: formulir.token,
          pertanyaan: daftar,
          responden: req.user ? { nama: req.user.name, email: req.user.email } : null,
        },
      });
    } catch (error) {
      console.error('Error buka formulir publik:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat formulir.' });
    }
  }

  async kirim(req, res) {
    const berkasMasuk = req.files || [];
    const bersihkanBerkas = () =>
      Promise.all(berkasMasuk.map((f) => fsp.unlink(f.path).catch(() => {})));

    try {
      const formulir = await prisma.formulir.findFirst({
        where: { token: String(req.params.token || '').slice(0, 32), deleted_at: null },
      });
      if (!formulir) {
        await bersihkanBerkas();
        return res.status(404).json({ success: false, message: 'Formulir tidak ditemukan.' });
      }

      const tertutup = await alasanTertutup(formulir);
      if (tertutup) {
        await bersihkanBerkas();
        return res.status(409).json({ success: false, message: tertutup });
      }

      if (formulir.butuh_login && !req.user) {
        await bersihkanBerkas();
        return res.status(401).json({ success: false, message: 'Formulir ini hanya bisa diisi setelah masuk akun.' });
      }

      if (formulir.satu_respons && req.user) {
        const sudah = await prisma.formulir_respons.findFirst({
          where: { formulir_id: formulir.id, user_id: BigInt(req.user.id) },
        });
        if (sudah) {
          await bersihkanBerkas();
          return res.status(409).json({ success: false, message: 'Anda sudah mengirim jawaban untuk formulir ini.' });
        }
      }

      // Jawaban dikirim sebagai satu field JSON di dalam multipart supaya
      // pengiriman dengan dan tanpa lampiran memakai jalur yang sama persis.
      let jawabanMasuk = {};
      try {
        jawabanMasuk = req.body.jawaban ? JSON.parse(req.body.jawaban) : {};
      } catch {
        await bersihkanBerkas();
        return res.status(400).json({ success: false, message: 'Format jawaban tidak terbaca.' });
      }

      const pertanyaan = await prisma.formulir_pertanyaan.findMany({
        where: { formulir_id: formulir.id },
        orderBy: { urutan: 'asc' },
      });

      // Berkas dikelompokkan per pertanyaan lewat nama field "berkas_<id>".
      const berkasPer = new Map();
      for (const f of berkasMasuk) {
        const id = Number(String(f.fieldname).replace('berkas_', ''));
        if (!Number.isFinite(id)) continue;
        if (!berkasPer.has(id)) berkasPer.set(id, []);
        berkasPer.get(id).push(f);
      }

      const idPertanyaan = new Set(pertanyaan.map((p) => Number(p.id)));
      for (const id of berkasPer.keys()) {
        if (!idPertanyaan.has(id)) {
          await bersihkanBerkas();
          return res.status(400).json({ success: false, message: 'Ada lampiran untuk pertanyaan yang tidak dikenali.' });
        }
      }

      const tersimpan = [];
      for (const p of pertanyaan) {
        if (TIPE_TANPA_JAWABAN.includes(p.tipe)) continue;
        const id = Number(p.id);
        const hasil = validasiJawaban(p, jawabanMasuk[id], (berkasPer.get(id) || []).length);
        if (hasil.pesan) {
          await bersihkanBerkas();
          return res.status(400).json({ success: false, message: hasil.pesan });
        }
        // Pertanyaan tak wajib yang dilewati tidak perlu menyisakan baris kosong.
        // Jawaban tipe unggah_berkas juga tidak lewat sini — berkasnya dicatat
        // di tabel `formulir_berkas`, bukan sebagai nilai jawaban.
        if (hasil.nilai === null && !hasil.nilai_json?.length) continue;
        tersimpan.push({ pertanyaan_id: p.id, nilai: hasil.nilai, nilai_json: hasil.nilai_json });
      }

      const respons = await prisma.$transaction(async (tx) => {
        const baru = await tx.formulir_respons.create({
          data: {
            formulir_id: formulir.id,
            user_id: req.user ? BigInt(req.user.id) : null,
            nama_responden: req.user ? teks(req.user.name, 255) : teks(req.body.nama_responden, 255) || null,
            email: formulir.kumpulkan_email && req.user ? teks(req.user.email, 255) : null,
            ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim().slice(0, 45),
          },
        });

        if (tersimpan.length) {
          await tx.formulir_jawaban.createMany({
            data: tersimpan.map((j) => ({
              respons_id: baru.id,
              pertanyaan_id: j.pertanyaan_id,
              nilai: j.nilai,
              nilai_json: j.nilai_json === null ? undefined : j.nilai_json,
            })),
          });
        }

        for (const [idPertanyaan2, daftar] of berkasPer.entries()) {
          await tx.formulir_berkas.createMany({
            data: daftar.map((f) => ({
              respons_id: baru.id,
              pertanyaan_id: BigInt(idPertanyaan2),
              nama: teks(f.originalname, 255),
              mime: f.mimetype?.slice(0, 150) || null,
              ukuran: BigInt(f.size),
              nama_disk: f.filename,
              jalur_disk: path.join(req.formulirSegmen || '', f.filename).replace(/\\/g, '/'),
            })),
          });
        }

        return baru;
      });

      res.status(201).json({
        success: true,
        message: 'Jawaban terkirim.',
        data: {
          id: Number(respons.id),
          dikirim_pada: respons.dikirim_pada,
          pesan_konfirmasi: formulir.pesan_konfirmasi,
        },
      });
    } catch (error) {
      // Berkas yang sudah mendarat tidak boleh tertinggal kalau pencatatannya
      // gagal — kalau dibiarkan, disk terisi berkas yang tidak dirujuk siapa pun.
      await bersihkanBerkas();
      console.error('Error kirim formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal mengirim jawaban.' });
    }
  }

  // ============================================================
  // Respons
  // ============================================================
  async daftarRespons(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const [pertanyaan, respons] = await Promise.all([
        prisma.formulir_pertanyaan.findMany({
          where: { formulir_id: formulir.id },
          orderBy: { urutan: 'asc' },
        }),
        prisma.formulir_respons.findMany({
          where: { formulir_id: formulir.id },
          orderBy: { dikirim_pada: 'desc' },
        }),
      ]);

      const idRespons = respons.map((r) => r.id);
      const [jawaban, berkas] = await Promise.all([
        idRespons.length
          ? prisma.formulir_jawaban.findMany({ where: { respons_id: { in: idRespons } } })
          : [],
        idRespons.length
          ? prisma.formulir_berkas.findMany({ where: { respons_id: { in: idRespons } } })
          : [],
      ]);

      const peta = new Map(idRespons.map((id) => [Number(id), {}]));
      for (const j of jawaban) {
        const isi = peta.get(Number(j.respons_id));
        if (isi) isi[Number(j.pertanyaan_id)] = j.nilai_json ?? j.nilai;
      }
      const petaBerkas = new Map();
      for (const b of berkas) {
        const kunci = `${Number(b.respons_id)}:${Number(b.pertanyaan_id)}`;
        if (!petaBerkas.has(kunci)) petaBerkas.set(kunci, []);
        petaBerkas.get(kunci).push({ id: Number(b.id), nama: b.nama, ukuran: Number(b.ukuran) });
      }

      res.json({
        success: true,
        data: {
          formulir: { id: Number(formulir.id), judul: formulir.judul, status: formulir.status },
          pertanyaan: pertanyaan.map(pertanyaanPublik),
          respons: respons.map((r) => ({
            id: Number(r.id),
            nama_responden: r.nama_responden,
            email: r.email,
            dikirim_pada: r.dikirim_pada,
            jawaban: peta.get(Number(r.id)) || {},
            berkas: Object.fromEntries(
              pertanyaan
                .filter((p) => p.tipe === 'unggah_berkas')
                .map((p) => [Number(p.id), petaBerkas.get(`${Number(r.id)}:${Number(p.id)}`) || []])
                .filter(([, v]) => v.length)
            ),
          })),
        },
      });
    } catch (error) {
      console.error('Error daftar respons:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat respons.' });
    }
  }

  /** Rekap per pertanyaan untuk tab "Ringkasan". */
  async ringkasan(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const [pertanyaan, totalRespons] = await Promise.all([
        prisma.formulir_pertanyaan.findMany({
          where: { formulir_id: formulir.id, tipe: { not: 'bagian' } },
          orderBy: { urutan: 'asc' },
        }),
        prisma.formulir_respons.count({ where: { formulir_id: formulir.id } }),
      ]);

      const idPertanyaan = pertanyaan.map((p) => p.id);
      const jawaban = idPertanyaan.length
        ? await prisma.formulir_jawaban.findMany({ where: { pertanyaan_id: { in: idPertanyaan } } })
        : [];

      const perPertanyaan = new Map(idPertanyaan.map((id) => [Number(id), []]));
      for (const j of jawaban) {
        const daftar = perPertanyaan.get(Number(j.pertanyaan_id));
        if (!daftar) continue;
        if (Array.isArray(j.nilai_json)) daftar.push(...j.nilai_json);
        else if (j.nilai !== null) daftar.push(j.nilai);
      }
      // Jumlah RESPONDEN yang menjawab, berbeda dari jumlah nilai: satu responden
      // bisa mencentang tiga pilihan sekaligus.
      const penjawab = new Map(idPertanyaan.map((id) => [Number(id), 0]));
      for (const j of jawaban) {
        const punyaIsi = Array.isArray(j.nilai_json) ? j.nilai_json.length > 0 : j.nilai !== null;
        if (punyaIsi) penjawab.set(Number(j.pertanyaan_id), (penjawab.get(Number(j.pertanyaan_id)) || 0) + 1);
      }

      const berkasPerPertanyaan = idPertanyaan.length
        ? await prisma.formulir_berkas.groupBy({
            by: ['pertanyaan_id'],
            where: { pertanyaan_id: { in: idPertanyaan } },
            _count: { _all: true },
          })
        : [];
      const petaBerkas = new Map(berkasPerPertanyaan.map((b) => [Number(b.pertanyaan_id), b._count._all]));

      const hasil = pertanyaan.map((p) => {
        const id = Number(p.id);
        const nilai = perPertanyaan.get(id) || [];
        const dasar = {
          id,
          tipe: p.tipe,
          label: p.label,
          jumlah_jawab: p.tipe === 'unggah_berkas' ? petaBerkas.get(id) || 0 : penjawab.get(id) || 0,
        };

        if (TIPE_PILIHAN.includes(p.tipe)) {
          const opsi = Array.isArray(p.opsi) ? p.opsi : [];
          const hitung = new Map(opsi.map((o) => [o, 0]));
          const lainnya = new Map();
          for (const v of nilai) {
            if (hitung.has(v)) hitung.set(v, hitung.get(v) + 1);
            else lainnya.set(v, (lainnya.get(v) || 0) + 1);
          }
          return {
            ...dasar,
            sebaran: [
              ...[...hitung.entries()].map(([opsi2, jumlah]) => ({ label: opsi2, jumlah, lainnya: false })),
              ...[...lainnya.entries()].map(([opsi2, jumlah]) => ({ label: opsi2, jumlah, lainnya: true })),
            ],
          };
        }

        if (p.tipe === 'skala_linier') {
          const set = p.pengaturan || {};
          const min = Number(set.min ?? 1);
          const maks = Number(set.maks ?? 5);
          const angka = nilai.map(Number).filter(Number.isFinite);
          const sebaran = [];
          for (let n = min; n <= maks; n += 1) {
            sebaran.push({ label: String(n), jumlah: angka.filter((a) => a === n).length });
          }
          return {
            ...dasar,
            rata_rata: angka.length ? Number((angka.reduce((s, a) => s + a, 0) / angka.length).toFixed(2)) : null,
            sebaran,
          };
        }

        if (p.tipe === 'unggah_berkas') return dasar;

        // Tipe teks/tanggal/waktu: tidak ada yang bisa diagregasi, jadi yang
        // ditampilkan adalah jawabannya sendiri. Dibatasi 200 supaya formulir
        // dengan puluhan ribu respons tidak mengirim seluruh isinya ke browser.
        return { ...dasar, jawaban: nilai.slice(0, 200), dipotong: nilai.length > 200 };
      });

      res.json({
        success: true,
        data: { total_respons: totalRespons, pertanyaan: hasil },
      });
    } catch (error) {
      console.error('Error ringkasan formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat ringkasan.' });
    }
  }

  async hapusRespons(req, res) {
    try {
      const respons = await prisma.formulir_respons.findUnique({
        where: { id: BigInt(req.params.responsId) },
      });
      if (!respons) return res.status(404).json({ success: false, message: 'Respons tidak ditemukan.' });

      const { formulir, kode, pesan } = await ambilFormulir(req.user, respons.formulir_id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const berkas = await prisma.formulir_berkas.findMany({ where: { respons_id: respons.id } });

      await prisma.$transaction([
        prisma.formulir_jawaban.deleteMany({ where: { respons_id: respons.id } }),
        prisma.formulir_berkas.deleteMany({ where: { respons_id: respons.id } }),
        prisma.formulir_respons.delete({ where: { id: respons.id } }),
      ]);

      // Berkas fisik dibuang setelah barisnya hilang: kalau transaksi gagal,
      // berkasnya masih utuh dan responsnya masih bisa dibuka.
      await Promise.all(
        berkas.map((b) => fsp.unlink(path.join(FORMULIR_ROOT, b.jalur_disk)).catch(() => {}))
      );

      res.json({ success: true, message: 'Respons dihapus.' });
    } catch (error) {
      console.error('Error hapus respons:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus respons.' });
    }
  }

  /** Unduh satu lampiran jawaban. Hanya pengelola formulirnya. */
  async unduhBerkas(req, res) {
    try {
      const berkas = await prisma.formulir_berkas.findUnique({
        where: { id: BigInt(req.params.id) },
      });
      if (!berkas) return res.status(404).json({ success: false, message: 'Berkas tidak ditemukan.' });

      const respons = await prisma.formulir_respons.findUnique({ where: { id: berkas.respons_id } });
      if (!respons) return res.status(404).json({ success: false, message: 'Respons tidak ditemukan.' });

      const { formulir, kode, pesan } = await ambilFormulir(req.user, respons.formulir_id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const absolut = path.join(FORMULIR_ROOT, berkas.jalur_disk);
      // Pagar terakhir: pastikan lintasan gabungan tidak keluar dari FORMULIR_ROOT,
      // seandainya ada baris rusak di database.
      if (!absolut.startsWith(FORMULIR_ROOT) || !fs.existsSync(absolut)) {
        return res.status(404).json({ success: false, message: 'Berkas fisik tidak ditemukan.' });
      }

      res.setHeader('Content-Type', berkas.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(berkas.nama)}"`);
      res.setHeader('Content-Length', Number(berkas.ukuran));
      res.setHeader('Cache-Control', 'private, no-store');
      fs.createReadStream(absolut).pipe(res);
    } catch (error) {
      console.error('Error unduh berkas formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal mengunduh berkas.' });
    }
  }

  /** Ekspor seluruh respons sebagai CSV (satu baris = satu responden). */
  async ekspor(req, res) {
    try {
      const { formulir, kode, pesan } = await ambilFormulir(req.user, req.params.id);
      if (!formulir) return res.status(kode).json({ success: false, message: pesan });

      const [pertanyaan, respons] = await Promise.all([
        prisma.formulir_pertanyaan.findMany({
          where: { formulir_id: formulir.id, tipe: { not: 'bagian' } },
          orderBy: { urutan: 'asc' },
        }),
        prisma.formulir_respons.findMany({
          where: { formulir_id: formulir.id },
          orderBy: { dikirim_pada: 'asc' },
        }),
      ]);

      const idRespons = respons.map((r) => r.id);
      const [jawaban, berkas] = await Promise.all([
        idRespons.length ? prisma.formulir_jawaban.findMany({ where: { respons_id: { in: idRespons } } }) : [],
        idRespons.length ? prisma.formulir_berkas.findMany({ where: { respons_id: { in: idRespons } } }) : [],
      ]);

      const peta = new Map();
      for (const j of jawaban) {
        peta.set(`${Number(j.respons_id)}:${Number(j.pertanyaan_id)}`, Array.isArray(j.nilai_json) ? j.nilai_json.join('; ') : j.nilai);
      }
      for (const b of berkas) {
        const kunci = `${Number(b.respons_id)}:${Number(b.pertanyaan_id)}`;
        peta.set(kunci, peta.get(kunci) ? `${peta.get(kunci)}; ${b.nama}` : b.nama);
      }

      const baris = [
        ['Waktu kirim', 'Nama', 'Email', ...pertanyaan.map((p) => p.label)].map(selCsv).join(','),
        ...respons.map((r) =>
          [
            r.dikirim_pada ? new Date(r.dikirim_pada).toLocaleString('id-ID') : '',
            r.nama_responden || '',
            r.email || '',
            ...pertanyaan.map((p) => peta.get(`${Number(r.id)}:${Number(p.id)}`) ?? ''),
          ]
            .map(selCsv)
            .join(',')
        ),
      ];

      const namaBerkas = `${formulir.judul.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'formulir'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(namaBerkas)}"`);
      // BOM di depan: tanpa ini Excel di Windows membaca UTF-8 sebagai ANSI dan
      // semua huruf beraksen jadi rusak.
      res.send(`﻿${baris.join('\r\n')}`);
    } catch (error) {
      console.error('Error ekspor formulir:', error);
      res.status(500).json({ success: false, message: 'Gagal mengekspor respons.' });
    }
  }
}

module.exports = new FormulirController();
