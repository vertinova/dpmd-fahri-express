/**
 * Lapis model bahasa untuk Gema.
 *
 * ATURAN YANG TIDAK BOLEH DILANGGAR: model TIDAK PERNAH menghasilkan data.
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
const buatAlat = (tangkap) => {
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
				+ 'kecamatan, atau desa tertentu.',
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
				+ 'DESA, Anggota BPD, KAUR KEUANGAN), kecamatan, atau desa.',
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

const susunSistem = (kamus) => [
	'Kamu Gema, asisten suara untuk pegawai DPMD Kabupaten Bogor.',
	'',
	'ATURAN PALING PENTING: kamu TIDAK BOLEH menyebut angka atau nama yang tidak',
	'datang dari hasil alat. Kalau alat mengembalikan 66, katakan 66. Jangan',
	'pernah memperkirakan, membulatkan, atau mengarang. Kalau alat tidak',
	'menemukan apa-apa, katakan tidak ada — itu jawaban yang benar.',
	'',
	'Jawabanmu akan DIUCAPKAN dengan suara, jadi:',
	'- bicara santai seperti rekan kerja, bukan seperti mesin. Boleh mengawali',
	'  dengan "Oke", "Nah", atau "Siap", dan sesekali menawarkan bantuan lanjutan',
	'- sebutkan CONTOH isi datanya, bukan cuma jumlahnya. "Ada 66 desa" kurang',
	'  berguna; "ada 66, di antaranya Cijayanti dan Ragajaya" jauh lebih hidup',
	'- satu sampai dua kalimat saja, bahasa Indonesia yang wajar diucapkan',
	'- sebut angka pentingnya, jangan membacakan daftar panjang',
	'  (tabelnya sudah tampil sendiri di layar pengguna)',
	'- tanpa markdown, tanpa poin-poin, tanpa emoji',
	'',
	'Kalau pertanyaannya di luar data DPMD (cuaca, berita, hal umum), jawab',
	'dengan ringan bahwa kamu belum bisa dan masih dikembangkan tim IT DPMD —',
	'jangan kaku, jangan minta maaf berlebihan.',
	'',
	`Kabupaten Bogor punya ${kamus.kecamatan.length} kecamatan dan ${kamus.desa.length} desa/kelurahan terdata.`,
].join('\n');

/**
 * Jawab lewat model bahasa. Melempar bila gagal — pemanggilnya yang memutuskan
 * untuk jatuh ke mesin deterministik, supaya kegagalan tidak pernah berarti
 * pengguna tidak dapat jawaban sama sekali.
 */
const jawabDenganModel = async (teks) => {
	const c = ambilKlien();
	if (!c) throw new Error('ANTHROPIC_API_KEY belum diisi');

	const tangkap = [];
	const kamus = await muatKamus();

	const pesanAkhir = await c.beta.messages.toolRunner({
		model: MODEL,
		max_tokens: 4000,
		// Adaptif: memilih alat dan penyaring yang tepat butuh sedikit
		// penalaran, tapi effort rendah supaya jawab suaranya tidak lama.
		thinking: { type: 'adaptive' },
		output_config: { effort: 'low' },
		betas: ['server-side-fallback-2026-07-01'],
		fallbacks: 'default',
		system: susunSistem(kamus),
		tools: buatAlat(tangkap),
		messages: [{ role: 'user', content: teks }],
	});

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

	return {
		maksud: terakhir ? `model:${terakhir.maksud}` : 'model:tanpa-data',
		kalimat: kalimat || terakhir?.kalimat || 'Maaf, saya tidak menemukan jawabannya.',
		judul: terakhir?.judul,
		rincian: terakhir?.rincian,
		kolom: terakhir?.kolom || [],
		baris: terakhir?.baris || [],
		total: terakhir?.total || 0,
		ditenagai: 'model',
	};
};

/** Jawab lewat model bila tersedia; kalau gagal, kembali ke mesin deterministik. */
const jawab = async (teks) => {
	if (!tersedia()) return { ...(await mesin.jawab(teks)), ditenagai: 'mesin' };

	try {
		return await jawabDenganModel(teks);
	} catch (error) {
		// Gagal memanggil model TIDAK BOLEH berarti Gema bisu. Mesin
		// deterministik tetap menjawab, hanya dengan pemahaman yang lebih kaku.
		logger.error('Gema: model bahasa gagal, jatuh ke mesin deterministik:', error.message);
		return { ...(await mesin.jawab(teks)), ditenagai: 'mesin-cadangan' };
	}
};

module.exports = { jawab, jawabDenganModel, tersedia, MODEL };
