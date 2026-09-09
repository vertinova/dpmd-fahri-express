/**
 * Lapis model bahasa untuk Gema.
 *
 * ATURAN YANG TIDAK BOLEH DILANGGAR: model TIDAK PERNAH menghasilkan data, dan
 * TIDAK PERNAH mengubahnya. Satu-satunya alat yang menyentuh perubahan —
 * siapkan_setel_ulang_sandi — hanya MENYIAPKAN konfirmasi; yang benar-benar
 * mengganti sandi adalah endpoint konfirmasi terpisah yang memeriksa izinnya
 * sendiri, setelah pengguna menekan tombol di layar.
 *
 * Model hanya mengerjakan dua hal — memilih alat mana yang dipanggil dengan
 * penyaring apa, dan merangkai satu kalimat yang enak diucapkan. Seluruh angka
 * dan baris tabel yang sampai ke pengguna diambil langsung dari hasil alat,
 * yaitu langsung dari basis data. Kalau model mengarang angka di kalimatnya,
 * tabel di bawahnya akan langsung membantah — dan itu memang disengaja.
 *
 * Alatnya bukan barang baru: persis penangan yang sudah dipakai mesin
 * deterministik di gemaMesin.service.js. Jadi tidak ada dua jalur yang bisa
 * menyimpang, dan mematikan lapis ini tidak menghilangkan kemampuan apa pun.
 *
 * KAPAN AKTIF. Hanya bila ANTHROPIC_API_KEY diisi. Tanpa kunci, berkas ini
 * diam sepenuhnya dan Gema memakai mesin deterministik — tidak ada satu byte
 * pun yang meninggalkan server. Itu bukan kebetulan: data desa, aparatur, dan
 * keuangan di sini bukan milik kami untuk dikirim ke layanan luar, jadi
 * pengirimannya harus berupa keputusan sadar yang ditulis di berkas .env.
 *
 * APA YANG DIKIRIM saat aktif: pertanyaan penggunanya, dan hasil alat yang
 * dipanggil (yang memang berisi data desa). Yang TIDAK dikirim: seluruh isi
 * basis data — model hanya melihat apa yang dikembalikan alat yang ia panggil.
 */

const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
const logger = require('../utils/logger');
const mesin = require('./gemaMesin.service');
const { muatKamus } = require('./gemaKamus.service');
const akun = require('./gemaAkunPegawai.service');
const percakapan = require('./gemaPercakapan.service');
const { susunSaran } = require('./gemaSaran.service');

const MODEL = 'claude-opus-5';

/** Klien dibuat sekali, dan hanya kalau kuncinya memang ada. */
let klien = null;

const tersedia = () => Boolean(process.env.ANTHROPIC_API_KEY);

const ambilKlien = () => {
	if (klien) return klien;
	if (!tersedia()) return null;
	const Anthropic = require('@anthropic-ai/sdk');
	const Kelas = Anthropic.default || Anthropic;
	klien = new Kelas();
	return klien;
};

/* ------------------------------------------------------------------- alat -- */

/**
 * Hasil alat terakhir ditangkap di sini, lalu dipakai membangun jawaban akhir.
 * Tabel yang dilihat pengguna berasal dari SINI, bukan dari karangan model.
 */
const buatAlat = (tangkap, pelaku) => {
	const catat = (hasil) => {
		tangkap.push(hasil);
		// Yang dikirim balik ke model diringkas: ia butuh tahu ADA APA dan
		// BERAPA, bukan tiga ratus baris. Selain menghemat token, ini menjaga
		// model tidak menyalin baris satu per satu ke dalam kalimatnya.
		return JSON.stringify({
			ringkasan: hasil.kalimat,
			total: hasil.total,
			jumlah_baris_tersedia: hasil.baris?.length || 0,
			contoh_baris: (hasil.baris || []).slice(0, 5),
			rincian: hasil.rincian || undefined,
			// Penanda bahwa yang terjadi barulah PENYIAPAN, belum ada yang berubah.
			menunggu_konfirmasi: hasil.konfirmasi ? true : undefined,
		});
	};

	return [
		betaTool({
			name: 'cari_desa',
			description:
				'Cari desa menurut status desa (Mandiri/Maju/Berkembang), klasifikasi '
				+ '(Swakarya/Swasembada/Swadaya), tipologi (Persawahan/Perkebunan/dll), '
				+ 'dan/atau kecamatan. Pakai untuk pertanyaan tentang daftar desa.',
			inputSchema: {
				type: 'object',
				properties: {
					status_desa: { type: 'string', description: 'mis. Mandiri, Maju, Berkembang' },
					klasifikasi: { type: 'string', description: 'mis. Swakarya, Swasembada, Swadaya' },
					tipologi: { type: 'string', description: 'mis. Persawahan, Perkebunan, Perikanan' },
					kecamatan: { type: 'string', description: 'nama kecamatan' },
				},
				additionalProperties: false,
			},
			run: async (input) => {
				const bagian = [
					input.status_desa ? `desa berstatus ${input.status_desa}` : '',
					input.klasifikasi ? `desa ${input.klasifikasi}` : '',
					input.tipologi ? `tipologi ${input.tipologi}` : '',
					input.kecamatan ? `di kecamatan ${input.kecamatan}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian || 'desa'));
			},
		}),

		betaTool({
			name: 'cari_bumdes',
			description:
				'Cari BUM Desa. Bisa disaring status aktif, sudah terbit badan hukum, '
				+ 'kecamatan, atau desa tertentu. Kalau hasilnya tinggal SATU, yang kembali '
				+ 'adalah profil lengkapnya: direktur, NIB, NPWP, aset, omset, dan PADes.',
			inputSchema: {
				type: 'object',
				properties: {
					kecamatan: { type: 'string' },
					desa: { type: 'string' },
					hanya_aktif: { type: 'boolean' },
					hanya_berbadan_hukum: { type: 'boolean' },
				},
				additionalProperties: false,
			},
			run: async (input) => {
				const bagian = [
					'bumdes',
					input.hanya_aktif ? 'aktif' : '',
					input.hanya_berbadan_hukum ? 'berbadan hukum' : '',
					input.kecamatan ? `di kecamatan ${input.kecamatan}` : '',
					input.desa ? `di desa ${input.desa}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		}),

		betaTool({
			name: 'cari_aparatur',
			description:
				'Cari aparatur desa. Bisa disaring jabatan (mis. KEPALA DESA, SEKRETARIS '
				+ 'DESA, Anggota BPD, KAUR KEUANGAN), kecamatan, atau desa. Kalau hasilnya '
				+ 'tinggal SATU orang, yang kembali adalah profil lengkapnya: NIPD, tempat '
				+ 'dan tanggal lahir, pendidikan, SK pengangkatan, BPJS, dan berkasnya.',
			inputSchema: {
				type: 'object',
				properties: {
					jabatan: { type: 'string' },
					kecamatan: { type: 'string' },
					desa: { type: 'string' },
				},
				additionalProperties: false,
			},
			run: async (input) => {
				const bagian = [
					input.jabatan || 'aparatur',
					input.kecamatan ? `di kecamatan ${input.kecamatan}` : '',
					input.desa ? `di desa ${input.desa}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		}),

		betaTool({
			name: 'rapor_wilayah',
			description:
				'Ambil rapor lengkap satu desa atau satu kecamatan: status, klasifikasi, '
				+ 'tipologi, penduduk, kepala desa, jumlah aparatur, BUM Desa, produk hukum. '
				+ 'Pakai kalau pertanyaannya tentang SATU wilayah tertentu.',
			inputSchema: {
				type: 'object',
				properties: {
					nama: { type: 'string', description: 'nama desa atau kecamatan' },
					jenis: { type: 'string', enum: ['desa', 'kecamatan'] },
				},
				required: ['nama'],
				additionalProperties: false,
			},
			run: async (input) => {
				const awalan = input.jenis === 'kecamatan' ? 'kecamatan ' : '';
				return catat(await mesin.jawab(`${awalan}${input.nama}`));
			},
		}),

		betaTool({
			name: 'cari_produk_hukum',
			description: 'Cari produk hukum desa (Perdes, Perkades, SK Kades), bisa disaring desa atau kecamatan.',
			inputSchema: {
				type: 'object',
				properties: { desa: { type: 'string' }, kecamatan: { type: 'string' } },
				additionalProperties: false,
			},
			run: async (input) => {
				const bagian = [
					'produk hukum',
					input.desa ? `desa ${input.desa}` : '',
					input.kecamatan ? `kecamatan ${input.kecamatan}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		}),

		betaTool({
			name: 'cari_bantuan_keuangan',
			description:
				'Cari usulan Bantuan Keuangan (Bankeu) desa: judul kegiatan, anggaran yang '
				+ 'diusulkan, dan tahap verifikasinya. Bisa disaring desa, kecamatan, dan '
				+ 'tahun anggaran.',
			inputSchema: {
				type: 'object',
				properties: {
					desa: { type: 'string' },
					kecamatan: { type: 'string' },
					tahun: { type: 'integer', description: 'tahun anggaran, mis. 2025' },
				},
				additionalProperties: false,
			},
			run: async (input) => {
				const bagian = [
					'bantuan keuangan',
					input.desa ? `desa ${input.desa}` : '',
					input.kecamatan ? `kecamatan ${input.kecamatan}` : '',
					input.tahun ? String(input.tahun) : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		}),

		betaTool({
			name: 'cari_kelembagaan',
			description:
				'Cari lembaga kemasyarakatan desa. Sebutkan salah satu: posyandu, rt, rw, '
				+ 'lpm, pkk, karang taruna, satlinmas. Bisa disaring desa atau kecamatan.',
			inputSchema: {
				type: 'object',
				properties: {
					lembaga: {
						type: 'string',
						enum: ['posyandu', 'rt', 'rw', 'lpm', 'pkk', 'karang taruna', 'satlinmas'],
					},
					desa: { type: 'string' },
					kecamatan: { type: 'string' },
				},
				required: ['lembaga'],
				additionalProperties: false,
			},
			run: async (input) => {
				const bagian = [
					input.lembaga,
					input.desa ? `di desa ${input.desa}` : '',
					input.kecamatan ? `di kecamatan ${input.kecamatan}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		}),

		betaTool({
			name: 'cari_penyaluran_dana',
			description:
				'Penyaluran dana desa dari SIPANDA: ADD, Dana Desa (DD), BHPRD, Bankeu '
				+ 'Akselerasi, dan Bantuan Provinsi (BP). Menjawab berapa totalnya, berapa '
				+ 'yang sudah cair, dan sebarannya. Bisa disaring desa atau kecamatan.',
			inputSchema: {
				type: 'object',
				properties: {
					sumber_dana: {
						type: 'string',
						enum: ['ADD', 'DD', 'BHPRD', 'BANKEU', 'BP'],
						description: 'kosongkan untuk melihat semua sumber sekaligus',
					},
					desa: { type: 'string' },
					kecamatan: { type: 'string' },
				},
				additionalProperties: false,
			},
			run: async (input) => {
				const sebutan = {
					ADD: 'add', DD: 'dana desa', BHPRD: 'bhprd',
					BANKEU: 'bankeu', BP: 'bantuan provinsi',
				};
				const bagian = [
					'penyaluran',
					sebutan[input.sumber_dana] || '',
					input.desa ? `desa ${input.desa}` : '',
					input.kecamatan ? `kecamatan ${input.kecamatan}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		}),

		betaTool({
			name: 'cari_akun_pegawai',
			description:
				'Cari profil AKUN PEGAWAI DPMD (bukan aparatur desa) menurut nama, email, '
				+ 'atau NIP. Kalau ketemu satu, yang kembali profil lengkapnya: peran, '
				+ 'bidang, jabatan, NIP, status akun, dan apakah sandinya masih sandi '
				+ 'default. Pakai untuk pertanyaan tentang akun aplikasi milik pegawai.',
			inputSchema: {
				type: 'object',
				properties: {
					kata: { type: 'string', description: 'nama, email, atau NIP pegawai' },
				},
				required: ['kata'],
				additionalProperties: false,
			},
			run: async (input) => catat(await akun.cariAkun(String(input.kata || ''))),
		}),

		betaTool({
			name: 'siapkan_setel_ulang_sandi',
			description:
				'SIAPKAN penyetelan ulang sandi akun pegawai ke sandi default. Alat ini '
				+ 'TIDAK mengubah apa pun — ia hanya mencari akunnya dan menyiapkan '
				+ 'konfirmasi yang harus ditekan pengguna di layar. Kalau yang cocok lebih '
				+ 'dari satu, yang kembali daftarnya supaya penanya mempersempit. Setelah '
				+ 'memanggil alat ini, katakan bahwa konfirmasinya menunggu ditekan; JANGAN '
				+ 'pernah mengatakan sandinya sudah diganti.',
			inputSchema: {
				type: 'object',
				properties: {
					kata: { type: 'string', description: 'nama atau email pegawai yang sandinya disetel ulang' },
				},
				required: ['kata'],
				additionalProperties: false,
			},
			run: async (input) => catat(await akun.siapkanSetelUlangSandi({
				kata: String(input.kata || ''),
				pelaku,
			})),
		}),

		betaTool({
			name: 'cari_apa_saja',
			description:
				'Cari satu kata ke seluruh nama di sistem sekaligus: nama desa, nama BUM '
				+ 'Desa, nama aparatur, judul peraturan. Pakai kalau alat lain tidak cocok, '
				+ 'atau kalau yang dicari sebuah nama orang.',
			inputSchema: {
				type: 'object',
				properties: { kata: { type: 'string' } },
				required: ['kata'],
				additionalProperties: false,
			},
			run: async (input) => catat(await mesin.pencarianMenyeluruh(String(input.kata || ''))),
		}),
	];
};

/* ---------------------------------------------------------------- perintah -- */

const susunSistem = (kamus, pelaku = null) => [
	'Kamu Gema, asisten suara untuk pegawai DPMD Kabupaten Bogor.',
	pelaku?.name ? `Yang sedang berbicara denganmu: ${pelaku.name}${pelaku.role ? ` (${pelaku.role})` : ''}.` : null,
	'',
	'ATURAN PALING PENTING: kamu TIDAK BOLEH menyebut angka atau nama yang tidak',
	'datang dari hasil alat. Kalau alat mengembalikan 66, katakan 66. Jangan',
	'pernah memperkirakan, membulatkan, atau mengarang. Kalau alat tidak',
	'menemukan apa-apa, katakan tidak ada — itu jawaban yang benar.',
	'',
	'INI PERCAKAPAN, BUKAN DERET PERTANYAAN LEPAS. Riwayat giliran sebelumnya',
	'ada di hadapanmu, termasuk hasil alat yang sudah kamu panggil. Pakai:',
	'- "yang", "-nya", "itu", "tadi" merujuk ke hal yang baru saja dibahas.',
	'  "Berapa yang mandiri?" sesudah bicara Kecamatan Jonggol berarti desa',
	'  mandiri DI JONGGOL — jangan tanya balik hal yang sudah jelas dari konteks',
	'- "bandingkan dengan Cibungbulang" berarti panggil alat lagi untuk',
	'  Cibungbulang, lalu sandingkan dengan angka yang sudah kamu dapat',
	'- kalau pertanyaan lanjutan bisa dijawab dari hasil alat yang SUDAH ada di',
	'  riwayat, jawab langsung tanpa memanggil alat lagi',
	'- kalau rujukannya benar-benar tidak jelas ("bagaimana dengan yang itu?"',
	'  tanpa apa pun sebelumnya), tanya balik SATU kalimat pendek, jangan menebak',
	'',
	'BOLEH MEMANGGIL BEBERAPA ALAT dalam satu giliran, dan itu memang',
	'diharapkan untuk pertanyaan yang butuh lebih dari satu potong data:',
	'perbandingan dua wilayah, atau "profil desa X sekalian aparaturnya".',
	'Panggil sebanyak yang perlu sampai kamu benar-benar bisa menjawab.',
	'',
	'Jawabanmu akan DIUCAPKAN dengan suara, jadi:',
	'- bicara santai seperti rekan kerja, bukan seperti mesin. Boleh mengawali',
	'  dengan "Oke", "Nah", atau "Siap", dan sesekali menawarkan bantuan lanjutan',
	'- sebutkan CONTOH isi datanya, bukan cuma jumlahnya. "Ada 66 desa" kurang',
	'  berguna; "ada 66, di antaranya Cijayanti dan Ragajaya" jauh lebih hidup',
	'- DUA SAMPAI EMPAT KALIMAT. Sebut angka intinya, lalu satu keterangan yang',
	'  membuatnya berarti: perbandingan, bagian terbesarnya, atau yang menonjol.',
	'  "Ada 66 desa mandiri dari 435, jadi sekitar seperenam" jauh lebih berguna',
	'  daripada "ada 66 desa mandiri". Angka pembandingnya pun harus dari alat',
	'- kalau alat mengembalikan profil satu orang atau satu objek, sebutkan tiga',
	'  sampai empat hal yang paling penting (nama, jabatan, desa, status), bukan',
	'  satu — sisa rinciannya memang sudah tampil lengkap di layar',
	'- kalau ada yang KOSONG atau BELUM TERDATA di hasil alat, sebutkan. Data',
	'  yang bolong itu justru yang paling perlu diketahui pegawai',
	'- jangan membacakan daftar panjang; tabelnya sudah tampil sendiri di layar',
	'- angka besar diucapkan wajar: "satu koma dua miliar", bukan "1200000000"',
	'- tanpa markdown, tanpa poin-poin, tanpa emoji, tanpa singkatan yang aneh',
	'  diucapkan (tulis "BUM Desa", bukan "BUMDes.")',
	'',
	'KALAU PERTANYAANNYA KABUR ("data desa dong"), jangan langsung menyemburkan',
	'seluruh daftar. Sebut apa yang kamu punya dan tawarkan dua atau tiga cara',
	'mempersempit dalam satu kalimat.',
	'',
	'Soal AKUN PEGAWAI: kamu bisa mencari profil akunnya, dan bisa MENYIAPKAN',
	'penyetelan ulang sandi ke sandi default. Menyiapkan bukan berarti sudah',
	'terjadi — sandinya baru berubah setelah pengguna menekan tombol konfirmasi',
	'di layar. Jadi jangan pernah bilang sandinya sudah diganti; bilang',
	'konfirmasinya menunggu ditekan. Kalau yang cocok lebih dari satu orang,',
	'minta penanya menyebut nama lengkap atau emailnya, jangan menebak.',
	'',
	'Kalau pertanyaannya di luar data DPMD (cuaca, berita, hal umum), jawab',
	'dengan ringan bahwa kamu belum bisa dan masih dikembangkan tim IT DPMD —',
	'jangan kaku, jangan minta maaf berlebihan.',
	'',
	'PENGENALAN SUARA SERING MELESET. Nama desa dan kecamatan kerap terdengar',
	'salah tipis: "Cijayanti" jadi "Ci Jayanti", "Bojong Koneng" jadi "Bojong',
	'Konen". Kalau sebuah kata terdengar seperti nama wilayah tapi tidak persis,',
	'coba alat pencarian dengan ejaan terdekat sebelum menyerah.',
	'',
	`Kabupaten Bogor punya ${kamus.kecamatan.length} kecamatan dan ${kamus.desa.length} desa/kelurahan terdata.`,
].filter((b) => b !== null).join('\n');

/**
 * Jawab lewat model bahasa. Melempar bila gagal — pemanggilnya yang memutuskan
 * untuk jatuh ke mesin deterministik, supaya kegagalan tidak pernah berarti
 * pengguna tidak dapat jawaban sama sekali.
 *
 * @param {string} teks   kalimat penanya
 * @param {object} pelaku identitas penanya, untuk pemeriksaan izin
 * @param {string} sesi   id percakapan dari peramban; tanpa ini tiap
 *                        pertanyaan berdiri sendiri dan Gema tidak bisa
 *                        menjawab "kalau yang maju berapa?"
 */
const jawabDenganModel = async (teks, pelaku = null, sesi = null) => {
	const c = ambilKlien();
	if (!c) throw new Error('ANTHROPIC_API_KEY belum diisi');

	const tangkap = [];
	const kamus = await muatKamus();

	// Riwayat giliran sebelumnya — lengkap dengan blok tool_use dan tool_result,
	// bukan cuma teksnya. Model jadi ingat alat mana yang sudah ia panggil dan
	// apa hasilnya, sehingga angka di giliran kedua tetap angka yang sama.
	const sebelumnya = percakapan.ambil(pelaku?.id, sesi);

	// Runner dipegang sebagai objek, bukan langsung di-await, karena setelah
	// selesai kita perlu membaca runner.params.messages — larik pesan yang sudah
	// bertambah sepanjang giliran ini — untuk disimpan sebagai riwayat.
	const runner = c.beta.messages.toolRunner({
		model: MODEL,
		max_tokens: 4000,
		// Adaptif dengan effort sedang. 'low' membuatnya sering puas dengan satu
		// panggilan alat dan satu kalimat pendek; 'medium' cukup untuk merangkai
		// dua-tiga alat pada pertanyaan perbandingan tanpa membuat jawaban suara
		// terasa lama menunggu.
		thinking: { type: 'adaptive' },
		output_config: { effort: 'medium' },
		betas: ['server-side-fallback-2026-07-01'],
		fallbacks: 'default',
		// Cukup untuk pertanyaan yang butuh beberapa alat, tapi tetap berbatas:
		// gelung alat yang tak pernah berhenti berarti pengguna menunggu di depan
		// mikrofon tanpa tahu sampai kapan.
		max_iterations: 10,
		system: susunSistem(kamus, pelaku),
		tools: buatAlat(tangkap, pelaku),
		messages: [...sebelumnya, { role: 'user', content: teks }],
	});

	const pesanAkhir = await runner;

	const kalimat = (pesanAkhir.content || [])
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join(' ')
		.trim();

	// Tabelnya dari hasil alat TERAKHIR, bukan dari model. Kalau model menjawab
	// tanpa memanggil alat sama sekali (mis. pertanyaan di luar cakupan), tidak
	// ada tabel — dan itu memang seharusnya.
	const terakhir = tangkap[tangkap.length - 1] || null;

	if (pesanAkhir.stop_reason === 'refusal') {
		throw new Error('Permintaan ditolak penyaring keamanan model');
	}

	// Riwayat disimpan HANYA setelah giliran ini benar-benar selesai. Menyimpan
	// di tengah jalan berisiko meninggalkan blok tool_use tanpa tool_result
	// pasangannya, dan permintaan berikutnya akan ditolak API mentah-mentah.
	//
	// params.messages DIAMBIL APA ADANYA, tanpa menambahkan pesanAkhir sendiri.
	// Runner sudah mendorong tiap balasan asisten ke sana sebelum berhenti, jadi
	// menambahkannya lagi berarti mencatatnya dua kali — dan salinan kedua itu
	// masih membawa blok tool_use yang tool_result-nya sudah lewat, yang akan
	// membuat permintaan berikutnya ditolak API.
	try {
		percakapan.simpan(pelaku?.id, sesi, [...runner.params.messages]);
	} catch (e) {
		// Gagal mengingat tidak boleh menggagalkan jawaban yang sudah jadi.
		logger.error('Gema: gagal menyimpan riwayat percakapan:', e.message);
	}

	return {
		maksud: terakhir ? `model:${terakhir.maksud}` : 'model:tanpa-data',
		kalimat: kalimat || terakhir?.kalimat || 'Maaf, saya tidak menemukan jawabannya.',
		judul: terakhir?.judul,
		rincian: terakhir?.rincian,
		kolom: terakhir?.kolom || [],
		baris: terakhir?.baris || [],
		total: terakhir?.total || 0,
		// Usulan lanjutan diturunkan dari hasil, bukan dikarang model: usulan
		// karangan bisa menunjuk kemampuan yang tidak ada.
		saran: terakhir?.saran?.length ? terakhir.saran : susunSaran(terakhir),
		// Tiket konfirmasi (mis. setel ulang sandi) harus sampai ke layar —
		// tanpa ini tombolnya tidak pernah muncul dan aksinya tidak bisa selesai.
		konfirmasi: terakhir?.konfirmasi,
		ditenagai: 'model',
		// Dipakai halaman depan untuk menunjukkan bahwa Gema masih ingat
		// konteksnya, dan kapan tombol "mulai percakapan baru" ada gunanya.
		giliran: percakapan.jumlahGiliran(pelaku?.id, sesi),
	};
};

/**
 * Jawaban jalur deterministik, dilengkapi usulan lanjutan supaya percakapannya
 * tetap terasa berlanjut walau model sedang tidak aktif.
 */
const lengkapiMesin = (hasil, ditenagai) => ({
	...hasil,
	saran: hasil.saran?.length ? hasil.saran : susunSaran(hasil),
	ditenagai,
});

/** Jawab lewat model bila tersedia; kalau gagal, kembali ke mesin deterministik. */
const jawab = async (teks, pelaku = null, sesi = null) => {
	if (!tersedia()) return lengkapiMesin(await mesin.jawab(teks, pelaku), 'mesin');

	try {
		return await jawabDenganModel(teks, pelaku, sesi);
	} catch (error) {
		// Gagal memanggil model TIDAK BOLEH berarti Gema bisu. Mesin
		// deterministik tetap menjawab, hanya dengan pemahaman yang lebih kaku.
		logger.error('Gema: model bahasa gagal, jatuh ke mesin deterministik:', error.message);
		return lengkapiMesin(await mesin.jawab(teks, pelaku), 'mesin-cadangan');
	}
};

module.exports = { jawab, jawabDenganModel, tersedia, MODEL };
