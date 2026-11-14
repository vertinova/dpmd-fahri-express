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
 * penyaring apa, dan merangkai kalimat yang enak diucapkan. Seluruh angka dan
 * baris tabel yang sampai ke pengguna diambil langsung dari hasil alat, yaitu
 * langsung dari basis data. Kalau model mengarang angka di kalimatnya, tabel di
 * bawahnya akan langsung membantah — dan itu memang disengaja.
 *
 * Alat domain adalah penangan yang sama dengan mesin deterministik di
 * gemaMesin.service.js. Dua alat tambahan (cari_tabel, kueri_data) memberi akses
 * baca SQL terkurasi lewat gemaData.service.js untuk pertanyaan di luar alat domain.
 *
 * KAPAN AKTIF. Hanya bila GEMA_LLM_URL diisi — server llama-server milik sendiri
 * (OpenAI-compatible), jadi data tidak keluar dari jaringan DPMD. Tanpa itu Gema
 * memakai mesin deterministik.
 */

const logger = require('../utils/logger');
const mesin = require('./gemaMesin.service');
const { muatKamus } = require('./gemaKamus.service');
const belajar = require('./gemaBelajar.service');
const akun = require('./gemaAkunPegawai.service');
const data = require('./gemaData.service');
const percakapan = require('./gemaPercakapan.service');
const { susunSaran } = require('./gemaSaran.service');
const { ringkasKatalog } = require('../config/gemaKatalog');

const MODEL = process.env.GEMA_LLM_MODEL || 'gemma-4-26b-a4b';
const MAKS_PUTARAN = 6;
const TIMEOUT_PUTARAN_MS = 60 * 1000;

const tersedia = () => Boolean(process.env.GEMA_LLM_URL);

/* ------------------------------------------------------------------- alat -- */

const alat = (name, description, properties, required, run) => ({
	definisi: {
		type: 'function',
		function: {
			name,
			description,
			parameters: { type: 'object', properties, required, additionalProperties: false },
		},
	},
	run,
});

/**
 * Hasil alat ditangkap di `tangkap`, lalu dipakai membangun jawaban akhir.
 * Tabel yang dilihat pengguna berasal dari SINI, bukan dari karangan model.
 * @returns {{ definisi: object[], peta: Object<string, Function> }}
 */
const buatAlat = (tangkap, pelaku, jejak = { alat: [], sql: [], panggilan: [] }) => {
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

	const daftar = [
		alat(
			'cari_desa',
			'Cari desa menurut status desa (Mandiri/Maju/Berkembang), klasifikasi '
			+ '(Swakarya/Swasembada/Swadaya), tipologi (Persawahan/Perkebunan/dll), '
			+ 'dan/atau kecamatan. Pakai untuk pertanyaan tentang daftar desa.',
			{
				status_desa: { type: 'string', description: 'mis. Mandiri, Maju, Berkembang' },
				klasifikasi: { type: 'string', description: 'mis. Swakarya, Swasembada, Swadaya' },
				tipologi: { type: 'string', description: 'mis. Persawahan, Perkebunan, Perikanan' },
				kecamatan: { type: 'string', description: 'nama kecamatan' },
			},
			[],
			async (input) => {
				const bagian = [
					input.status_desa ? `desa berstatus ${input.status_desa}` : '',
					input.klasifikasi ? `desa ${input.klasifikasi}` : '',
					input.tipologi ? `tipologi ${input.tipologi}` : '',
					input.kecamatan ? `desa di kecamatan ${input.kecamatan}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian || 'desa'));
			},
		),

		alat(
			'cari_bumdes',
			'Cari BUM Desa. Bisa disaring status aktif, sudah terbit badan hukum, '
			+ 'kecamatan, atau desa tertentu. Kalau hasilnya tinggal SATU, yang kembali '
			+ 'adalah profil lengkapnya: direktur, NIB, NPWP, aset, omset, dan PADes.',
			{
				kecamatan: { type: 'string' },
				desa: { type: 'string' },
				hanya_aktif: { type: 'boolean' },
				hanya_berbadan_hukum: { type: 'boolean' },
			},
			[],
			async (input) => {
				const bagian = [
					'bumdes',
					input.hanya_aktif ? 'aktif' : '',
					input.hanya_berbadan_hukum ? 'berbadan hukum' : '',
					input.kecamatan ? `di kecamatan ${input.kecamatan}` : '',
					input.desa ? `di desa ${input.desa}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		),

		alat(
			'cari_aparatur',
			'Cari aparatur desa. Bisa disaring jabatan (mis. KEPALA DESA, SEKRETARIS '
			+ 'DESA, Anggota BPD, KAUR KEUANGAN), kecamatan, atau desa. Kalau hasilnya '
			+ 'tinggal SATU orang, yang kembali adalah profil lengkapnya: NIPD, tempat '
			+ 'dan tanggal lahir, pendidikan, SK pengangkatan, BPJS, dan berkasnya.',
			{
				jabatan: { type: 'string' },
				kecamatan: { type: 'string' },
				desa: { type: 'string' },
			},
			[],
			async (input) => {
				const bagian = [
					input.jabatan || 'aparatur',
					input.kecamatan ? `di kecamatan ${input.kecamatan}` : '',
					input.desa ? `di desa ${input.desa}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		),

		alat(
			'rapor_wilayah',
			'Ambil rapor lengkap satu desa atau satu kecamatan: status, klasifikasi, '
			+ 'tipologi, penduduk, kepala desa, jumlah aparatur, BUM Desa, produk hukum. '
			+ 'Pakai kalau pertanyaannya tentang SATU wilayah tertentu.',
			{
				nama: { type: 'string', description: 'nama desa atau kecamatan' },
				jenis: { type: 'string', enum: ['desa', 'kecamatan'] },
			},
			['nama'],
			async (input) => {
				const awalan = input.jenis === 'kecamatan' ? 'kecamatan ' : '';
				return catat(await mesin.jawab(`${awalan}${input.nama}`));
			},
		),

		alat(
			'cari_produk_hukum',
			'Cari produk hukum desa (Perdes, Perkades, SK Kades), bisa disaring desa atau kecamatan.',
			{ desa: { type: 'string' }, kecamatan: { type: 'string' } },
			[],
			async (input) => {
				const bagian = [
					'produk hukum',
					input.desa ? `desa ${input.desa}` : '',
					input.kecamatan ? `kecamatan ${input.kecamatan}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		),

		alat(
			'cari_bantuan_keuangan',
			'Cari usulan Bantuan Keuangan (Bankeu) desa: judul kegiatan, anggaran yang '
			+ 'diusulkan, dan tahap verifikasinya. Bisa disaring desa, kecamatan, dan '
			+ 'tahun anggaran.',
			{
				desa: { type: 'string' },
				kecamatan: { type: 'string' },
				tahun: { type: 'integer', description: 'tahun anggaran, mis. 2025' },
			},
			[],
			async (input) => {
				const bagian = [
					'bantuan keuangan',
					input.desa ? `desa ${input.desa}` : '',
					input.kecamatan ? `kecamatan ${input.kecamatan}` : '',
					input.tahun ? String(input.tahun) : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		),

		alat(
			'cari_kelembagaan',
			'Cari lembaga kemasyarakatan desa. Sebutkan salah satu: posyandu, rt, rw, '
			+ 'lpm, pkk, karang taruna, satlinmas. Bisa disaring desa atau kecamatan.',
			{
				lembaga: {
					type: 'string',
					enum: ['posyandu', 'rt', 'rw', 'lpm', 'pkk', 'karang taruna', 'satlinmas'],
				},
				desa: { type: 'string' },
				kecamatan: { type: 'string' },
			},
			['lembaga'],
			async (input) => {
				const bagian = [
					input.lembaga,
					input.desa ? `di desa ${input.desa}` : '',
					input.kecamatan ? `di kecamatan ${input.kecamatan}` : '',
				].filter(Boolean).join(' ');
				return catat(await mesin.jawab(bagian));
			},
		),

		alat(
			'cari_penyaluran_dana',
			'Penyaluran dana desa dari SIPANDA: ADD, Dana Desa (DD), BHPRD, Bankeu '
			+ 'Akselerasi, dan Bantuan Provinsi (BP). Menjawab berapa totalnya, berapa '
			+ 'yang sudah cair, dan sebarannya. Bisa disaring desa atau kecamatan.',
			{
				sumber_dana: {
					type: 'string',
					enum: ['ADD', 'DD', 'BHPRD', 'BANKEU', 'BP'],
					description: 'kosongkan untuk melihat semua sumber sekaligus',
				},
				desa: { type: 'string' },
				kecamatan: { type: 'string' },
			},
			[],
			async (input) => {
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
		),

		alat(
			'cari_akun_pegawai',
			'Cari profil AKUN PEGAWAI DPMD (bukan aparatur desa) menurut nama, email, '
			+ 'atau NIP. Kalau ketemu satu, yang kembali profil lengkapnya: peran, '
			+ 'bidang, jabatan, NIP, status akun, dan apakah sandinya masih sandi '
			+ 'default. Pakai untuk pertanyaan tentang akun aplikasi milik pegawai.',
			{ kata: { type: 'string', description: 'nama, email, atau NIP pegawai' } },
			['kata'],
			async (input) => catat(await akun.cariAkun(String(input.kata || ''), pelaku)),
		),

		alat(
			'siapkan_setel_ulang_sandi',
			'SIAPKAN penyetelan ulang sandi akun pegawai ke sandi default. Alat ini '
			+ 'TIDAK mengubah apa pun — ia hanya mencari akunnya dan menyiapkan '
			+ 'konfirmasi yang harus ditekan pengguna di layar. Kalau yang cocok lebih '
			+ 'dari satu, yang kembali daftarnya supaya penanya mempersempit. Setelah '
			+ 'memanggil alat ini, katakan bahwa konfirmasinya menunggu ditekan; JANGAN '
			+ 'pernah mengatakan sandinya sudah diganti.',
			{ kata: { type: 'string', description: 'nama atau email pegawai yang sandinya disetel ulang' } },
			['kata'],
			async (input) => catat(await akun.siapkanSetelUlangSandi({
				kata: String(input.kata || ''),
				pelaku,
			})),
		),

		alat(
			'cari_apa_saja',
			'Cari satu kata ke seluruh nama di sistem sekaligus: nama desa, nama BUM '
			+ 'Desa, nama aparatur, judul peraturan. Pakai kalau alat lain tidak cocok, '
			+ 'atau kalau yang dicari sebuah nama orang.',
			{ kata: { type: 'string' } },
			['kata'],
			async (input) => catat(await mesin.pencarianMenyeluruh(String(input.kata || ''))),
		),

		alat(
			'cari_tabel',
			'Cari tabel basis data yang relevan dengan kata kunci (nama tabel, kolom, '
			+ 'atau istilah). Dipakai HANYA bila alat domain tidak cocok, sebelum kueri_data. '
			+ 'Hasilnya nama tabel beserta kolomnya.',
			{ kata_kunci: { type: 'string' } },
			['kata_kunci'],
			async (input) => {
				try {
					return JSON.stringify(await data.cariTabel(String(input.kata_kunci || '')));
				} catch (e) {
					return JSON.stringify({ galat: e.message });
				}
			},
		),

		alat(
			'kueri_data',
			'Jalankan SATU kueri SQL baca-saja (SELECT/WITH) ke basis data DPMD. Dipakai '
			+ 'HANYA bila alat domain tidak cocok, dan setelah cari_tabel memastikan nama '
			+ 'tabel dan kolomnya. Bila galat, perbaiki SQL-nya.',
			{
				sql: { type: 'string', description: 'satu pernyataan SELECT/WITH MySQL 8, dengan LIMIT' },
				tujuan: { type: 'string', description: 'judul singkat apa yang dicari, untuk judul tabel' },
			},
			['sql', 'tujuan'],
			async (input) => {
				const sql = String(input.sql || '');
				jejak.sql.push(sql.slice(0, 500));
				let hasil;
				try {
					hasil = await data.jalankanKueri(sql);
				} catch (e) {
					// Galat SQL dikembalikan ke model supaya ia bisa memperbaiki kuerinya.
					return JSON.stringify({ galat: e.message });
				}
				if (hasil.galat) return JSON.stringify({ galat: hasil.galat });

				const tujuan = String(input.tujuan || 'Hasil kueri');
				tangkap.push({
					maksud: 'kueri-data',
					kalimat: tujuan,
					judul: tujuan,
					kolom: hasil.kolom,
					baris: hasil.baris.slice(0, 200),
					total: hasil.total,
				});
				return JSON.stringify({ kolom: hasil.kolom, baris: hasil.baris.slice(0, 50), total: hasil.total }).slice(0, 6000);
			},
		),
	];

	return {
		definisi: daftar.map((a) => a.definisi),
		peta: Object.fromEntries(daftar.map((a) => [a.definisi.function.name, a.run])),
	};
};

/* ---------------------------------------------------------------- perintah -- */

const tanggalIndonesia = () => new Date().toLocaleDateString('id-ID', {
	timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

/**
 * SELURUHNYA STATIS (sama untuk semua penanya) supaya cache prefix llama-server
 * dipakai lintas pertanyaan dan lintas pengguna. Tanggal & penanya ada di
 * pesan pengguna (lihat pesanPengguna). Di CPU, ±2.500 token prompt dingin = ±30 dtk.
 */
const susunSistem = (kamus) => [
	'Kamu Gema, asisten suara untuk pegawai DPMD Kabupaten Bogor. Santai seperti rekan kerja.',
	'',
	'Jawabanmu akan DIUCAPKAN: satu sampai tiga kalimat, tanpa markdown, tanpa poin-poin, tanpa emoji.',
	'Sebut angka inti dan satu-dua contoh atau keterangan yang membuatnya berarti. Tabel sudah',
	'tampil sendiri di layar, jangan dibacakan. DILARANG menutup dengan basa-basi seperti',
	'"Ada lagi yang bisa Gema bantu?".',
	'',
	'ATURAN PALING PENTING: angka dan nama HANYA boleh datang dari hasil alat. Jangan memperkirakan,',
	'membulatkan, atau mengarang. Kalau alat tidak menemukan apa-apa atau ada yang kosong, katakan',
	'jujur bahwa datanya tidak ada.',
	'',
	'Ini percakapan: "yang", "-nya", "itu", "tadi" merujuk ke hal yang baru dibahas. Kalau jawabannya',
	'ADA di hasil alat sebelumnya, jawab langsung; kalau tidak, WAJIB panggil alat lagi dengan',
	'penyaring dari konteks. Kalau rujukannya tidak jelas, tanya balik satu kalimat.',
	'Tiap pesan pengguna diawali [tanggal hari ini · nama penanya]; itu keterangan, bukan pertanyaan.',
	'Boleh memanggil beberapa alat dalam satu giliran (mis. membandingkan dua wilayah).',
	'Pesan pengguna kadang membawa "Panduan dari pertanyaan serupa": itu cara memanggil alat yang terbukti tepat. Ikuti bila cocok, abaikan bila tidak. Angkanya tidak pernah dari panduan.',
	'',
	'Pakai alat domain (cari_desa, cari_bumdes, dst.) lebih dulu. Hanya bila tidak ada yang cocok,',
	'pakai cari_tabel lalu kueri_data. Aturan SQL: MySQL 8, ONLY_FULL_GROUP_BY aktif, sebut kolom',
	'secara eksplisit, jangan SELECT *, hanya SELECT/WITH satu pernyataan, selalu pakai LIMIT.',
	'',
	'Soal AKUN PEGAWAI: kamu bisa mencari profil akunnya dan MENYIAPKAN penyetelan ulang sandi ke',
	'sandi default. Menyiapkan bukan berarti sudah terjadi: sandinya baru berubah setelah pengguna',
	'menekan tombol konfirmasi di layar. Jangan pernah bilang sandinya sudah diganti; bilang',
	'konfirmasinya menunggu ditekan. Kalau yang cocok lebih dari satu, minta nama lengkap atau email.',
	'',
	'Di luar data DPMD (cuaca, berita, hal umum), jawab ringan bahwa kamu belum bisa dan masih',
	'dikembangkan tim IT DPMD.',
	'',
	'PENGENALAN SUARA SERING MELESET: "Cijayanti" jadi "Ci Jayanti", "Bojong Koneng" jadi "Bojong',
	'Konen". Kalau sebuah kata terdengar seperti nama wilayah tapi tidak persis, coba alat pencarian',
	'dengan ejaan terdekat sebelum menyerah.',
	'',
	'Tabel tersedia dan istilah:',
	ringkasKatalog(),
	'',
	`Kabupaten Bogor punya ${kamus.kecamatan.length} kecamatan dan ${kamus.desa.length} desa/kelurahan terdata.`,
].join('\n');

/** Pesan pengguna dengan keterangan dinamis di depannya; disimpan apa adanya agar riwayat tetap jadi prefix. */
const pesanPengguna = (teks, pelaku, contoh = '') => {
	const siapa = pelaku?.name ? ` · ${pelaku.name}${pelaku.role ? ` (${pelaku.role})` : ''}` : '';
	const kepala = `[${tanggalIndonesia()}${siapa}]`;
	return { role: 'user', content: contoh ? `${kepala}\n${contoh}\nPertanyaan: ${teks}` : `${kepala}\n${teks}` };
};

/* ------------------------------------------------------------------- aliran -- */

/**
 * Parser SSE gaya OpenAI. Murni terhadap `response.body` (aliran web).
 * @returns {Promise<{ teks: string, toolCalls: {id, name, arguments}[] }>}
 */
const bacaAliran = async (response, { onToken } = {}) => {
	const dekoder = new TextDecoder();
	const calls = [];
	let teks = '';
	let sisa = '';

	const proses = (baris) => {
		const b = baris.trim();
		if (!b.startsWith('data:')) return;
		const isi = b.slice(5).trim();
		if (!isi || isi === '[DONE]') return;
		let delta;
		try { delta = JSON.parse(isi).choices?.[0]?.delta; } catch { return; }
		if (!delta) return;
		// delta.reasoning_content sengaja diabaikan.
		if (delta.content) {
			teks += delta.content;
			onToken?.(delta.content);
		}
		for (const tc of delta.tool_calls || []) {
			const c = (calls[tc.index ?? 0] ||= { id: '', name: '', arguments: '' });
			if (tc.id) c.id = tc.id;
			if (tc.function?.name) c.name += tc.function.name;
			if (tc.function?.arguments) c.arguments += tc.function.arguments;
		}
	};

	for await (const potong of response.body) {
		sisa += typeof potong === 'string' ? potong : dekoder.decode(potong, { stream: true });
		const baris = sisa.split('\n');
		sisa = baris.pop();
		baris.forEach(proses);
	}
	proses(sisa);

	return { teks, toolCalls: calls.filter(Boolean) };
};

/** Satu putaran: POST ke llama-server, baca alirannya. Timeout digabung dengan signal pemanggil. */
const satuPutaran = async (messages, tools, { onToken, signal }) => {
	const kontrol = new AbortController();
	const batal = () => kontrol.abort();
	const timer = setTimeout(batal, TIMEOUT_PUTARAN_MS);
	if (signal?.aborted) batal();
	else signal?.addEventListener('abort', batal, { once: true });

	try {
		const headers = { 'Content-Type': 'application/json' };
		if (process.env.GEMA_LLM_KEY) headers.Authorization = `Bearer ${process.env.GEMA_LLM_KEY}`;
		const response = await fetch(`${process.env.GEMA_LLM_URL.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			headers,
			// Penalaran Gemma dimatikan: di CPU ia menambah ±150 token (±15 dtk) per putaran.
			body: JSON.stringify({
				model: MODEL, messages, tools, temperature: 0.2, max_tokens: 600, stream: true,
				chat_template_kwargs: { enable_thinking: false },
			}),
			signal: kontrol.signal,
		});
		if (!response.ok) throw new Error(`Server model membalas ${response.status}`);
		return await bacaAliran(response, { onToken });
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', batal);
	}
};

/**
 * Jawab lewat model bahasa. Melempar bila gagal — pemanggilnya yang memutuskan
 * untuk jatuh ke mesin deterministik, supaya kegagalan tidak pernah berarti
 * pengguna tidak dapat jawaban sama sekali.
 *
 * @param {string} teks   kalimat penanya
 * @param {object} pelaku identitas penanya, untuk pemeriksaan izin
 * @param {string} sesi   id percakapan dari peramban; tanpa ini tiap pertanyaan berdiri sendiri
 * @param {object} opsi   { onToken(potongan), onReset(), signal, jejak:{alat:[],sql:[],panggilan:[]} }
 */
const jawabDenganModel = async (teks, pelaku = null, sesi = null, opsi = {}) => {
	if (!tersedia()) throw new Error('GEMA_LLM_URL belum diisi');
	const { onToken, onReset, signal } = opsi;
	const jejak = opsi.jejak || { alat: [], sql: [], panggilan: [] };

	const tangkap = [];
	const kamus = await muatKamus();
	const { definisi, peta } = buatAlat(tangkap, pelaku, jejak);

	const sebelumnya = percakapan.ambil(pelaku?.id, sesi);
	const contoh = await belajar.contohUntuk(teks, kamus);
	const tanya = pesanPengguna(teks, pelaku, contoh);
	const riwayat = [...sebelumnya, tanya];
	const sistem = { role: 'system', content: susunSistem(kamus) };

	let kalimat = null;
	for (let putaran = 0; putaran < MAKS_PUTARAN; putaran += 1) {
		let adaToken = false;
		const hasil = await satuPutaran([sistem, ...riwayat], definisi, {
			signal,
			onToken: (t) => { adaToken = true; onToken?.(t); },
		});

		if (!hasil.toolCalls.length) {
			kalimat = hasil.teks.trim();
			riwayat.push({ role: 'assistant', content: hasil.teks });
			break;
		}

		// Teks yang sempat tampil di putaran ini hanyalah pembuka sebelum alat; tarik kembali.
		if (adaToken) onReset?.();
		riwayat.push({
			role: 'assistant',
			content: hasil.teks || null,
			tool_calls: hasil.toolCalls.map((c, i) => ({
				id: c.id || `call_${putaran}_${i}`,
				type: 'function',
				function: { name: c.name, arguments: c.arguments },
			})),
		});

		for (const [i, c] of hasil.toolCalls.entries()) {
			jejak.alat.push(c.name);
			let isi;
			const jalankan = peta[c.name];
			if (!jalankan) {
				isi = JSON.stringify({ galat: 'alat tidak ada' });
			} else {
				let args = null;
				try { args = JSON.parse(c.arguments || '{}'); } catch { /* argumen rusak */ }
					if (args && typeof args === 'object') jejak.panggilan?.push({ nama: c.name, argumen: args });
				if (!args || typeof args !== 'object') {
					isi = JSON.stringify({ galat: 'argumen tidak valid' });
				} else {
					try {
						isi = await jalankan(args);
					} catch (e) {
						logger.error(`Gema: alat ${c.name} gagal:`, e.message);
						isi = JSON.stringify({ galat: e.message });
					}
				}
			}
			riwayat.push({ role: 'tool', tool_call_id: c.id || `call_${putaran}_${i}`, content: isi });
		}
	}

	if (kalimat === null) throw new Error(`Model belum menjawab setelah ${MAKS_PUTARAN} putaran`);

	// Tabelnya dari hasil alat TERAKHIR, bukan dari model.
	const terakhir = tangkap[tangkap.length - 1] || null;

	// Disimpan utuh persis seperti dikirim (hanya-bertambah): riwayat yang disunting belakangan
	// mengubah prefix dan memaksa CPU memproses ulang ratusan token.
	try {
		percakapan.simpan(pelaku?.id, sesi, riwayat);
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
		// Usulan lanjutan diturunkan dari hasil, bukan dikarang model.
		saran: terakhir?.saran?.length ? terakhir.saran : susunSaran(terakhir),
		// Tiket konfirmasi (mis. setel ulang sandi) harus sampai ke layar.
		konfirmasi: terakhir?.konfirmasi,
		ditenagai: 'model',
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
const jawab = async (teks, pelaku = null, sesi = null, opsi = {}) => {
	if (!tersedia()) return lengkapiMesin(await mesin.jawab(teks, pelaku), 'mesin');

	try {
		return await jawabDenganModel(teks, pelaku, sesi, opsi);
	} catch (error) {
		// Pemanggil sudah pergi: tidak ada gunanya menjawab lagi.
		if (opsi.signal?.aborted) throw error;
		// Gagal memanggil model TIDAK BOLEH berarti Gema bisu.
		logger.error('Gema: model bahasa gagal, jatuh ke mesin deterministik:', error.message);
		return lengkapiMesin(await mesin.jawab(teks, pelaku), 'mesin-cadangan');
	}
};

/**
 * Panaskan cache prompt (sistem + alat) llama-server, supaya
 * penanya pertama setelah server dinyalakan ulang tidak menunggu ±30 dtk.
 * Saat sudah hangat biayanya ±1 dtk CPU, jadi aman diulang berkala.
 */
const panaskan = async () => {
	if (!tersedia()) return;
	try {
		const kamus = await muatKamus();
		const { definisi } = buatAlat([], null);
		const headers = { 'Content-Type': 'application/json' };
		if (process.env.GEMA_LLM_KEY) headers.Authorization = `Bearer ${process.env.GEMA_LLM_KEY}`;
		const body = JSON.stringify({
			model: MODEL,
			messages: [{ role: 'system', content: susunSistem(kamus) }, { role: 'user', content: 'halo' }],
			tools: definisi, max_tokens: 1, chat_template_kwargs: { enable_thinking: false },
		});
		const url = `${process.env.GEMA_LLM_URL.replace(/\/$/, '')}/chat/completions`;
		// Satu permintaan cukup: cache prompt llama-server dibagi antar slot. Berurutan, bukan
		// paralel, supaya tidak berebut CPU dengan penanya sungguhan.
		await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(120000) }).then((r) => r.text());
	} catch (e) {
		logger.warn(`Gema: pemanasan model gagal: ${e.message}`);
	}
};

if (tersedia() && !process.env.JEST_WORKER_ID) {
	setTimeout(panaskan, 15000).unref?.();
	setInterval(panaskan, 10 * 60 * 1000).unref?.();
}

module.exports = { jawab, jawabDenganModel, tersedia, bacaAliran, panaskan, MODEL };
