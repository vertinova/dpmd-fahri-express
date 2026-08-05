/**
 * Menyiapkan formulir "Survei Kepuasan Masyarakat (SKM) Tahun 2026" untuk
 * Sekretariat (Umpeg) di modul Formulir.
 *
 * Susunan pertanyaannya disalin dari form master SKM 2026 milik Bagian
 * Organisasi. Dua penyesuaian yang disengaja terhadap sumbernya:
 *
 * 1. Blok penilaian di master TERTULIS DUA KALI (bagian "Sistem, Mekanisme dan
 *    Prosedur" sampai "Penutup" berulang persis), sementara seluruh pemisah
 *    halamannya memakai "lanjut ke bagian berikutnya" — tidak ada percabangan
 *    yang membuat salah satunya dilewati. Responden di form asli karena itu
 *    mengisi 14 pertanyaan yang sama dua kali. Di sini disalin satu kali.
 * 2. Deskripsi master berisi petunjuk untuk OPD yang menyalin ("BUAT SALINAN…
 *    JANGAN EDIT APAPUN DISINI"), bukan untuk masyarakat, jadi diganti pengantar
 *    yang wajar dibaca responden.
 *
 * Formulir sengaja dibuat berstatus DRAF: tautannya belum melayani siapa pun
 * sampai ada yang meninjau lalu menekan "Terbitkan".
 *
 * Pakai:
 *   node scripts/seed-formulir-skm.js               # bidang 2 (Sekretariat)
 *   node scripts/seed-formulir-skm.js --bidang=5    # bidang lain
 *   node scripts/seed-formulir-skm.js --ganti       # timpa yang sudah ada
 *
 * Aman dijalankan berulang: tanpa --ganti, formulir yang sudah ada dilewati.
 */

const crypto = require('crypto');
const prisma = require('../src/config/prisma');

const JUDUL = 'Survei Kepuasan Masyarakat (SKM) Tahun 2026';

const DESKRIPSI = [
  'Survei ini mengukur kepuasan masyarakat atas pelayanan Dinas Pemberdayaan',
  'Masyarakat dan Desa Kabupaten Bogor. Pengisian hanya memakan waktu beberapa',
  'menit dan jawaban Anda kami perlakukan sebagai bahan perbaikan layanan.',
  '',
  'Pada bagian penilaian, pilih angka 1 sampai 4 dengan keterangan:',
  '1 = Sangat Tidak Setuju · 2 = Tidak Setuju · 3 = Setuju · 4 = Sangat Setuju',
].join('\n');

const PESAN_KONFIRMASI = [
  'Terima kasih telah mengisi Survei Kepuasan Masyarakat.',
  'Masukan Anda menjadi bahan perbaikan pelayanan kami.',
].join('\n');

// Disalin apa adanya dari form master, kecuali dua penyesuaian di atas.
const PERTANYAAN = [
  { tipe: 'jawaban_singkat', label: 'Nama Lengkap', wajib: true },
  {
    tipe: 'paragraf',
    label: 'Layanan apa yang sedang Anda urus pada kunjungan hari ini?',
    deskripsi: 'Contoh : Pembuatan KTP, KK Dan AKTA KELAHIRAN',
    wajib: true,
  },
  { tipe: 'jawaban_singkat', label: 'No Telepon', wajib: true },
  {
    tipe: 'pilihan_ganda',
    label: 'Pendidikan',
    wajib: true,
    opsi: ['Tidak Sekolah', 'SD/Sederajat', 'SMP/Sederajat', 'SMA/Sederajat', 'D4/S1', 'S2', 'S3'],
  },
  { tipe: 'jawaban_singkat', label: 'Usia', wajib: true },
  {
    tipe: 'pilihan_ganda',
    label: 'Pekerjaan',
    wajib: true,
    opsi: [
      'ASN (PNS/PPPK)',
      'TNI/POLRI',
      'SWASTA',
      'WIRASWASTA',
      'Pelajar/Mahasiswa',
      'Petani/Nelayan',
      'Pekerja Lapas/Freelance',
      'Pensiunan',
    ],
  },
  {
    tipe: 'pilihan_ganda',
    label: 'Apakah Anda merupakan penyandang disabilitas/pendamping penyandang disabilitas?',
    wajib: false,
    opsi: [
      'Disabilitas Fisik',
      'Disabilitas Intelektual',
      'Disabilitas Mentalan',
      'Disabilitas Sensory',
    ],
  },
  { tipe: 'pilihan_ganda', label: 'Jenis Kelamin', wajib: true, opsi: ['Laki-laki', 'Perempuan'] },

  { tipe: 'bagian', label: 'Persyaratan', deskripsi: PETUNJUK_SKALA() },
  {
    tipe: 'skala_linier',
    label: 'Informasi pelayanan tersedia melalui media elektronik maupun nonelektronik',
    wajib: true,
  },
  {
    tipe: 'skala_linier',
    label: 'Persyaratan yang diminta sesuai dengan yang diinformasikan',
    wajib: true,
  },

  { tipe: 'bagian', label: 'Sistem, Mekanisme dan Prosedur', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Standar dan prosedur layanan diinformasikan dengan jelas', wajib: true },
  { tipe: 'skala_linier', label: 'Prosedur/Alur layanan mudah dipahami dan dilakukan', wajib: true },

  { tipe: 'bagian', label: 'Waktu Penyelesaian', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Jangka waktu layanan sesuai dengan yang diinformasikan', wajib: true },

  { tipe: 'bagian', label: 'Biaya/Tarif', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Biaya layanan sesuai dengan yang diinformasikan', wajib: true },

  { tipe: 'bagian', label: 'Produk Spesifikasi Jenis Pelayanan', deskripsi: PETUNJUK_SKALA() },
  {
    tipe: 'skala_linier',
    label: 'Produk layanan yang diterima sesuai dengan yang dipublikasikan',
    wajib: true,
  },

  { tipe: 'bagian', label: 'Kompetensi pelaksana', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Petugas merespon kebutuhan dengan cepat', wajib: true },

  { tipe: 'bagian', label: 'Perilaku Pelaksana', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Petugas melayani saya dengan ramah', wajib: true },

  { tipe: 'bagian', label: 'Penanganan Pengaduan, Saran dan Masukan', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Layanan konsultasi dan pengaduan mudah diakses', wajib: true },

  { tipe: 'bagian', label: 'Sarana dan Prasarana', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Sarana prasarana nyaman dan mudah digunakan', wajib: true },

  { tipe: 'bagian', label: 'Diskriminasi Layanan', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Saya dilayani secara adil tanpa diskriminasi', wajib: true },

  { tipe: 'bagian', label: 'Kecurangan Pelayanan', deskripsi: PETUNJUK_SKALA() },
  {
    tipe: 'skala_linier',
    label: 'Layanan diberikan sesuai prosedur tanpa adanya kecurangan',
    wajib: true,
  },

  { tipe: 'bagian', label: 'Penerimaan Di Luar Ketentuan', deskripsi: PETUNJUK_SKALA() },
  {
    tipe: 'skala_linier',
    label: 'Pelayanan diberikan tanpa imbalan uang, barang, atau fasilitas di luar aturan',
    wajib: true,
  },

  { tipe: 'bagian', label: 'Pungutan Liar', deskripsi: PETUNJUK_SKALA() },
  { tipe: 'skala_linier', label: 'Tidak ada pungutan liar (pungli) dalam pelayanan', wajib: true },

  { tipe: 'bagian', label: 'Percaloan', deskripsi: PETUNJUK_SKALA() },
  {
    tipe: 'skala_linier',
    label: 'Tidak ada percaloan/perantara tidak resmi dalam pelayanan',
    wajib: true,
  },

  {
    tipe: 'bagian',
    label: 'Penutup',
    deskripsi: [
      'Setiap masukan Anda sangat berharga menciptakan kemajuan nyata bagi kepentingan banyak orang.',
      'Mari berkolaborasi dengan memberikan gagasan kreatif atau kritik membangun.',
    ].join('\n'),
  },
  { tipe: 'paragraf', label: 'Kritik dan Saran', wajib: true },
];

function PETUNJUK_SKALA() {
  return [
    'Petunjuk pengisian:',
    '1 = Sangat Tidak Setuju',
    '2 = Tidak Setuju',
    '3 = Setuju',
    '4 = Sangat Setuju',
  ].join('\n');
}

// Semua pertanyaan skala di SKM memakai rentang yang sama, jadi setelannya
// dipasang di satu tempat daripada diulang 14 kali di daftar atas.
const SETELAN_SKALA = {
  min: 1,
  maks: 4,
  label_min: 'Sangat Tidak Setuju',
  label_maks: 'Sangat Setuju',
};

const argumen = (nama, bawaan) => {
  const cocok = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return cocok ? cocok.split('=')[1] : bawaan;
};

(async () => {
  const bidangId = BigInt(argumen('bidang', '2'));
  const ganti = process.argv.includes('--ganti');

  try {
    const bidang = await prisma.bidangs.findUnique({ where: { id: bidangId } });
    if (!bidang) {
      console.error(`Bidang ${bidangId} tidak ada.`);
      process.exit(1);
    }

    const sudahAda = await prisma.formulir.findFirst({
      where: { bidang_id: bidangId, judul: JUDUL, deleted_at: null },
    });

    if (sudahAda && !ganti) {
      console.log(`Formulir "${JUDUL}" sudah ada di ${bidang.nama} (id ${Number(sudahAda.id)}).`);
      console.log('Jalankan dengan --ganti kalau ingin menimpanya.');
      return;
    }

    if (sudahAda) {
      // Menimpa hanya boleh selama belum ada yang menjawab; kalau sudah, isinya
      // adalah data warga yang tidak boleh hilang karena satu perintah ulang.
      const respons = await prisma.formulir_respons.count({ where: { formulir_id: sudahAda.id } });
      if (respons > 0) {
        console.error(
          `Formulir lama sudah punya ${respons} respons — dibiarkan. Hapus lewat aplikasi kalau memang mau diganti.`
        );
        process.exit(1);
      }
      await prisma.formulir_pertanyaan.deleteMany({ where: { formulir_id: sudahAda.id } });
      await prisma.formulir.delete({ where: { id: sudahAda.id } });
      console.log('Formulir lama (tanpa respons) dihapus.');
    }

    const formulir = await prisma.formulir.create({
      data: {
        bidang_id: bidangId,
        judul: JUDUL,
        deskripsi: DESKRIPSI,
        token: crypto.randomBytes(16).toString('hex'),
        status: 'draf',
        pesan_konfirmasi: PESAN_KONFIRMASI,
      },
    });

    await prisma.formulir_pertanyaan.createMany({
      data: PERTANYAAN.map((p, i) => ({
        formulir_id: formulir.id,
        tipe: p.tipe,
        label: p.label,
        deskripsi: p.deskripsi || null,
        wajib: Boolean(p.wajib),
        urutan: i,
        opsi: p.opsi || [],
        pengaturan: p.tipe === 'skala_linier' ? SETELAN_SKALA : {},
      })),
    });

    const jumlahPertanyaan = PERTANYAAN.filter((p) => p.tipe !== 'bagian').length;
    console.log(`Formulir dibuat di ${bidang.nama}.`);
    console.log(`  id      : ${Number(formulir.id)}`);
    console.log(`  isi     : ${jumlahPertanyaan} pertanyaan, ${PERTANYAAN.length - jumlahPertanyaan} bagian`);
    console.log(`  status  : draf — terbitkan dulu sebelum tautannya dibagikan`);
    console.log(`  sunting : /formulir/${Number(formulir.id)}`);
    console.log(`  tautan  : /f/${formulir.token}`);
  } catch (error) {
    console.error('Gagal menyiapkan formulir SKM:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
