/**
 * Helpdesk DPMD — chatbot untuk masyarakat, operator desa, dan kecamatan, plus
 * tiket yang diteruskan ke penanggung jawab berjenjang:
 * KECAMATAN penanya -> BIDANG DPMD -> DPMD (sekretaris dinas & superadmin).
 *
 * Bot menjawab dari data akun penanya (tiket, proposal Bankeu, aparatur), data
 * resmi sistem (profil DPMD, wilayah), dan FAQ — disusun AI (Groq) bila
 * HELPDESK_AI_API_KEY diisi. Yang belum terjawab ditawarkan pertanyaan
 * terdekat, lalu kontak WhatsApp dan tiket ke pihak yang berwenang.
 */
const Helpdesk = require('../services/helpdesk.service');
const Bot = require('../services/helpdeskBot.service');
const { dataRelevan, lupakanSimpanan } = require('../services/helpdeskPengetahuan.service');
const Pribadi = require('../services/helpdeskPribadi.service');
const Jembatan = require('../services/helpdeskJembatan.service');
const PushNotificationService = require('../services/pushNotificationService');
const logger = require('../utils/logger');

const BATAS_PESAN = 1000;
const SAPAAN = /^(halo+|hai+|hi+|hallo+|pagi|siang|sore|malam|assalamu.?alaikum|permisi|p+|tes|test|terima ?kasih|makasih|thanks?|ok(e|ay)?|baik)[\s!.,]*$/i;
const LABEL_TINGKAT = { kecamatan: 'Kecamatan', bidang: 'Bidang DPMD', dpmd: 'DPMD' };
const PERAN_PIMPINAN = ['superadmin', 'kepala_dinas', 'sekretaris_dinas'];
const PERAN_STAF_BIDANG = ['kepala_bidang', 'ketua_tim', 'pegawai', 'bendahara'];

const teks = (v, batas = BATAS_PESAN) => String(v ?? '').trim().slice(0, batas);
const gagal = (res, label, err) => {
	logger.error(`Helpdesk ${label}: ${err.message}`);
	return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
};

/* Riwayat datang dari browser: hanya bentuk {peran, teks} yang diterima, dan
   dipotong supaya tidak bisa dipakai menyelundupkan prompt panjang. */
const riwayatBersih = (riwayat) => (Array.isArray(riwayat) ? riwayat : [])
	.slice(-10)
	.map((r) => ({ peran: r?.peran === 'bot' ? 'bot' : 'user', teks: teks(r?.teks, 800) }))
	.filter((r) => r.teks);

/* ── Notifikasi ──────────────────────────────────────────────────────────── */

/* Tautan notifikasi mengikuti layout penerimanya: petugas kecamatan membuka
   panel kecamatan, staf DPMD panel DPMD, pelapor membuka widget Tiket Saya. */
const tautanPanel = (tingkat, tiketId) => `${tingkat === 'kecamatan' ? '/kecamatan' : '/dpmd'}/helpdesk?tiket=${tiketId}`;
const tautanPelapor = (role) => (role === 'kecamatan' ? '/kecamatan/dashboard?bantuan=tiket' : '/desa/dashboard?bantuan=tiket');

async function notifikasi(userIds, judul, pesan, url) {
	const ids = [...new Set((userIds || []).map(Number))].filter(Boolean);
	if (!ids.length) return;
	const payload = {
		title: judul,
		body: pesan,
		icon: '/logo-192.png',
		badge: '/logo-96.png',
		tag: `helpdesk-${Date.now()}`,
		data: { type: 'helpdesk', url },
	};
	try {
		await PushNotificationService.storeNotifications(ids, payload);
		PushNotificationService.sendToMultipleUsers(ids, payload).catch(() => {});
	} catch (err) {
		logger.error(`Helpdesk notifikasi: ${err.message}`);
	}
}

/* ── Penanya, wilayah, tujuan ────────────────────────────────────────────── */

const akunPenanya = (req) => (req.user?.id ? Helpdesk.akun(req.user.id) : null);

/** Wilayah penanya: dari akun bila punya, dari pilihan tamu bila tidak. */
async function wilayahPenanya(akun, body) {
	if (akun?.kecamatan_id) {
		return {
			kecamatan_id: akun.kecamatan_id, desa_id: akun.desa_id || null,
			kecamatan_nama: akun.kecamatan_nama, desa_nama: akun.desa_nama || null,
		};
	}
	return Helpdesk.wilayahSah(body?.kecamatan_id, body?.desa_id);
}

const wilayahKurang = (tingkat, wilayah) => tingkat === 'kecamatan' && !wilayah.kecamatan_id;

/**
 * Tujuan tiket: tingkat pertama dalam rantai yang punya petugas aktif. Berbeda
 * dari kontak WhatsApp, petugas tanpa nomor HP tetap bisa membalas dari panel.
 */
async function tujuanTiket(tingkatAwal, wilayah, bidangKategori) {
	const bidangId = bidangKategori || Helpdesk.BIDANG_SEKRETARIAT;
	const urutan = Helpdesk.TINGKAT.slice(Math.max(0, Helpdesk.TINGKAT.indexOf(tingkatAwal)));
	for (const tingkat of urutan) {
		if (wilayahKurang(tingkat, wilayah)) continue;
		const penerima = await Helpdesk.penerimaTiket(tingkat, { kecamatanId: wilayah.kecamatan_id, bidangId });
		if (penerima.length || tingkat === 'dpmd') return { tingkat, bidangId, penerima };
	}
	return { tingkat: 'dpmd', bidangId, penerima: await Helpdesk.penerimaTiket('dpmd') };
}

function sajikanKontak(kontak, { kategori, pertanyaan, kode, nama }) {
	if (!kontak) return null;
	const sapa = kontak.pengelola ? `Halo ${kontak.pengelola} (${kontak.nama})` : `Halo ${kontak.nama}`;
	const pesan = [
		`${sapa}, saya${nama ? ` ${nama}` : ''} ingin bertanya seputar ${kategori || 'layanan DPMD'}.`,
		pertanyaan ? `\n${pertanyaan}` : '',
		kode ? `\n\nKode tiket Helpdesk: ${kode}` : '',
	].join('');
	return {
		tingkat: kontak.tingkat,
		nama: kontak.nama,
		pengelola: kontak.pengelola,
		dialihkan: kontak.dialihkan,
		whatsapp_url: kontak.whatsapp ? `https://wa.me/${kontak.whatsapp}?text=${encodeURIComponent(pesan)}` : null,
	};
}

/** Kontak sesuai kategori; butuh_wilayah bila tamu belum memilih kecamatan. */
async function kontakUntuk(kategori, wilayah, info) {
	const tingkat = kategori?.target_level || 'dpmd';
	if (wilayahKurang(tingkat, wilayah)) return { kontak: null, butuh_wilayah: tingkat };
	const kontak = await Helpdesk.cariKontak(tingkat, wilayah, kategori?.bidang_id);
	return { kontak: sajikanKontak(kontak, { kategori: kategori?.name, ...info }), butuh_wilayah: null };
}

const labelPenanya = (akun) => {
	if (!akun) return 'masyarakat umum (tamu, belum login)';
	if (akun.role === 'desa') return `operator ${akun.status_pemerintahan === 'kelurahan' ? 'kelurahan' : 'desa'} ${akun.desa_nama || ''}`.trim();
	if (akun.role === 'kecamatan') return `petugas Kecamatan ${akun.kecamatan_nama || ''}`.trim();
	return 'pengguna terdaftar aplikasi DPMD';
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ PUBLIK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const faqPerKategori = (faqs, kategoriId, batas = 6) => faqs
	.filter((f) => f.category_id === kategoriId)
	.sort((a, b) => (b.hits - a.hits) || (a.id - b.id))
	.slice(0, batas)
	.map((f) => f.question);

function pintasanAkun(akun) {
	if (akun?.role === 'desa' && akun.desa_id) {
		return ['Status proposal Bankeu desa saya', 'Status verifikasi aparatur desa saya', 'Status tiket saya'];
	}
	if (akun?.role === 'kecamatan') return ['Proposal Bankeu yang menunggu verifikasi kecamatan saya', 'Status tiket saya'];
	if (akun) return ['Status tiket saya'];
	return [];
}

exports.awal = async (req, res) => {
	try {
		const akun = await akunPenanya(req);
		const login = Boolean(akun);
		const [set, kategori, faqs, populer] = await Promise.all([
			Helpdesk.pengaturan(),
			Helpdesk.semuaKategori({ hanyaAktif: true }),
			Helpdesk.faqUntuk(login),
			Helpdesk.faqPopuler(login),
		]);
		return res.json({
			success: true,
			data: {
				salam: set.salam,
				kategori: kategori.map(({ id, name, slug, description, icon, target_level }) => ({
					id, name, slug, description, icon, target_level, pertanyaan: faqPerKategori(faqs, id),
				})),
				populer,
				pintasan_akun: pintasanAkun(akun),
				login,
				nama: akun?.name || null,
				wilayah: akun ? { kecamatan_nama: akun.kecamatan_nama, desa_nama: akun.desa_nama, punya: Boolean(akun.kecamatan_id) } : null,
				ai: Bot.aiAktif(),
			},
		});
	} catch (err) {
		return gagal(res, 'awal', err);
	}
};

exports.kecamatan = async (req, res) => {
	try {
		return res.json({ success: true, data: await Helpdesk.daftarKecamatan() });
	} catch (err) {
		return gagal(res, 'kecamatan', err);
	}
};

exports.desa = async (req, res) => {
	try {
		return res.json({ success: true, data: await Helpdesk.daftarDesa(Number(req.params.id) || 0) });
	} catch (err) {
		return gagal(res, 'desa', err);
	}
};

exports.chat = async (req, res) => {
	try {
		const pesan = teks(req.body.pesan);
		if (!pesan) return res.status(400).json({ success: false, message: 'Pertanyaan tidak boleh kosong' });
		const akun = await akunPenanya(req);
		const data = await jawabBot({
			pesan,
			riwayat: riwayatBersih(req.body.riwayat),
			akun,
			wilayah: await wilayahPenanya(akun, req.body),
			kategoriId: req.body.kategori_id,
		});
		return res.json({ success: true, data });
	} catch (err) {
		return gagal(res, 'chat', err);
	}
};

async function jawabBot({ pesan, riwayat, akun, wilayah, kategoriId }) {
	const login = Boolean(akun);
	const [kategori, faqs] = await Promise.all([
		Helpdesk.semuaKategori({ hanyaAktif: true }),
		Helpdesk.faqUntuk(login),
	]);
	const kategoriPilihan = kategori.find((k) => k.id === Number(kategoriId)) || null;

	let jawaban;
	let terjawab = false;
	let luarTopik = false;
	let sumber = 'none';
	let faqIds = [];
	let dataIds = [];
	let kategoriAi = null;
	let aksi = [];
	let pribadi = null;

	const sapaan = SAPAAN.test(pesan);
	const niat = sapaan ? null : Pribadi.niatPribadi(pesan, akun);
	if (sapaan) {
		jawaban = 'Halo! 👋 Silakan tuliskan pertanyaan Anda, misalnya "Bagaimana alur pengajuan proposal Bankeu?"';
	} else if (niat === 'tiket') {
		pribadi = akun ? Pribadi.jawabTiket(await Helpdesk.tiketMilik(akun.id)) : Pribadi.jawabTiketTamu();
	} else if (niat === 'bankeu') {
		pribadi = await Pribadi.jawabBankeu(akun);
	} else if (niat === 'aparatur') {
		pribadi = await Pribadi.jawabAparatur(akun);
	}

	/* Pertanyaan samar ("gimana caranya") dicari bersama pertanyaan
	   sebelumnya, dan FAQ topik yang dipilih ikut menjadi referensi. */
	const samar = Bot.tokenisasi(pesan).length < 2;
	const sebelumnya = riwayat.filter((r) => r.peran === 'user').slice(-1)[0]?.teks || '';
	const kueri = samar && sebelumnya ? `${sebelumnya} ${pesan}` : pesan;
	let hasil = Bot.cariFaq(kueri, faqs, { kategoriId: kategoriPilihan?.id });
	if (kategoriPilihan && (samar || hasil.length < 2)) {
		const ada = new Set(hasil.map((h) => h.faq.id));
		const sekategori = faqs
			.filter((f) => f.category_id === kategoriPilihan.id && !ada.has(f.id))
			.sort((a, b) => (b.hits - a.hits) || (a.id - b.id))
			.map((faq) => ({ faq, skor: 0, cakupan: 0 }));
		hasil = [...hasil, ...sekategori].slice(0, 5);
	}

	/* Urusan akun tidak dijawab bot: penanya memilih program yang memakai akun
	   itu lalu disambungkan langsung ke PIC-nya di kolom chat (Jembatan). */
	if (!pribadi && !sapaan && Jembatan.niatAkun(kueri)) {
		const katAkun = kategori.find((k) => k.slug === 'akun') || null;
		const logIdAkun = await Helpdesk.catatChat({ userId: akun?.id, kategoriId: katAkun?.id, pertanyaan: pesan, terjawab: true, sumber: 'akun', faqId: null }).catch(() => null);
		return {
			jawaban: 'Urusan akun ditangani langsung oleh **PIC program** yang memakai akun tersebut. Akun Anda untuk program apa?',
			terjawab: true,
			sumber: 'akun',
			log_id: logIdAkun,
			aksi: [],
			kategori: katAkun ? { id: katAkun.id, name: katAkun.name, slug: katAkun.slug, target_level: katAkun.target_level } : null,
			saran: [],
			kontak: null,
			butuh_wilayah: null,
			sapaan: false,
			luar_topik: false,
			program_akun: Jembatan.PROGRAM_AKUN.map(({ key, label, ket }) => ({ key, label, ket })),
			pertanyaan_akun: pesan,
		};
	}

	let data = [];
	if (pribadi) {
		({ jawaban, aksi } = pribadi);
		terjawab = true;
		sumber = 'akun';
		kategoriAi = kategori.find((k) => k.slug === pribadi.kategoriSlug) || null;
	} else if (!sapaan) {
		data = await dataRelevan(kueri, { wilayah });
		const ai = await Bot.tanyaAi({
			pertanyaan: pesan,
			riwayat,
			referensi: hasil,
			semuaFaq: faqs,
			data,
			kategori,
			konteks: {
				penanya: labelPenanya(akun),
				wilayah: [wilayah.desa_nama, wilayah.kecamatan_nama && `Kecamatan ${wilayah.kecamatan_nama}`].filter(Boolean).join(', '),
				topik: kategoriPilihan?.name,
			},
		});
		if (ai) {
			({ jawaban, terjawab, faqIds, dataIds, luarTopik } = ai);
			sumber = terjawab ? (faqIds.length ? 'ai' : 'data') : 'none';
			kategoriAi = kategori.find((k) => k.slug === ai.kategoriSlug) || null;
		} else if (Bot.cukupYakin(hasil[0])) {
			jawaban = hasil[0].faq.answer;
			terjawab = true;
			sumber = 'faq';
			faqIds = [hasil[0].faq.id];
		} else if (data.length) {
			/* Tanpa AI, data resmi yang relevan ditampilkan apa adanya. */
			jawaban = data.map((d) => d.isi).join('\n\n');
			terjawab = true;
			sumber = 'data';
			dataIds = data.map((d) => d.id);
		}
	}

	/* Topik pilihan penanya tidak ditimpa tebakan AI, kecuali AI benar-benar
	   menemukan jawabannya di kategori lain. */
	const kat = (terjawab && kategoriAi) || kategoriPilihan || kategoriAi || Bot.tebakKategori(kueri, kategori, hasil);

	/* Jawaban personal diarahkan ke pihak yang sedang memegang urusannya
	   (mis. kecamatan saat proposal di tahap verifikasi kecamatan). */
	let kontakJawaban;
	if (sapaan || luarTopik) kontakJawaban = { kontak: null, butuh_wilayah: null };
	else if (pribadi) {
		const k = pribadi.pemegang ? await Helpdesk.cariKontak(pribadi.pemegang, wilayah, kat?.bidang_id) : null;
		kontakJawaban = { kontak: sajikanKontak(k, { kategori: kat?.name, pertanyaan: pesan }), butuh_wilayah: null };
	} else kontakJawaban = await kontakUntuk(kat, wilayah, { pertanyaan: pesan });

	/* Belum terjawab: tawarkan pertanyaan terdekat yang bisa diklik dulu, baru
	   petugas — "tidak tahu" adalah jalan terakhir. */
	let saran = [];
	if (!terjawab && !sapaan && luarTopik) {
		saran = await Helpdesk.faqPopuler(login, 3);
		jawaban = 'Saya asisten khusus layanan **DPMD Kabupaten Bogor** dan urusan pemerintahan desa, jadi belum bisa menjawab pertanyaan itu 🙏 Coba tanyakan, misalnya:';
	} else if (!terjawab && !sapaan) {
		const calon = [
			...hasil.filter((h) => h.skor >= 2).map((h) => h.faq.question),
			...(kategoriPilihan ? faqPerKategori(faqs, kategoriPilihan.id, 4) : []),
		];
		saran = [...new Set(calon)].slice(0, 4);
		const pembuka = samar
			? 'Saya belum yakin maksud pertanyaannya 🤔 Mungkin salah satu ini'
			: 'Jawaban pastinya belum ada di data Helpdesk 🙏 Mungkin yang Anda cari salah satu ini';
		jawaban = saran.length
			? `${pembuka}${kat ? ` seputar **${kat.name}**` : ''}? Klik untuk melihat jawabannya, atau tanyakan langsung ke petugas lewat tombol di bawah.`
			: `Pertanyaan ini belum ada di basis pengetahuan Helpdesk, jadi sebaiknya dijawab langsung oleh **${kontakJawaban.kontak?.nama || 'petugas DPMD'}** — lewat WhatsApp atau tiket di bawah — supaya ditangani pihak yang berwenang.`;
	}

	/* Tombol aksi dari FAQ yang dipakai menjawab. */
	if (!pribadi && terjawab) {
		const a = Helpdesk.aksiFaq(faqs.find((f) => f.id === faqIds[0]));
		if (a) aksi = [a];
	}

	let logId = null;
	if (!sapaan) {
		logId = await Helpdesk.catatChat({ userId: akun?.id, kategoriId: kat?.id, pertanyaan: pesan, terjawab, sumber, faqId: faqIds[0] })
			.catch((err) => { logger.error(`Helpdesk log: ${err.message}`); return null; });
		if (terjawab) Helpdesk.tambahHitFaq(faqIds).catch(() => {});
	}

	return {
		jawaban,
		terjawab,
		sumber,
		log_id: logId,
		aksi,
		kategori: kat ? { id: kat.id, name: kat.name, slug: kat.slug, target_level: kat.target_level } : null,
		saran,
		kontak: kontakJawaban.kontak,
		butuh_wilayah: kontakJawaban.butuh_wilayah,
		sapaan,
		luar_topik: luarTopik,
	};
}

/* Penilaian 👍/👎 dari widget untuk satu jawaban bot. */
exports.umpanBalik = async (req, res) => {
	try {
		const logId = Number(req.body.log_id);
		if (!logId || typeof req.body.membantu !== 'boolean') {
			return res.status(400).json({ success: false, message: 'Data penilaian tidak valid' });
		}
		await Helpdesk.nilaiJawaban(logId, req.body.membantu);
		return res.json({ success: true, message: 'Terima kasih atas penilaiannya' });
	} catch (err) {
		return gagal(res, 'umpan balik', err);
	}
};

/* Dipanggil setelah tamu memilih kecamatan untuk mendapatkan kontak. */
exports.kontak = async (req, res) => {
	try {
		const akun = await akunPenanya(req);
		const [kategori, wilayah] = await Promise.all([
			Helpdesk.semuaKategori({ hanyaAktif: true }),
			wilayahPenanya(akun, req.body),
		]);
		const kat = kategori.find((k) => k.id === Number(req.body.kategori_id)) || null;
		return res.json({ success: true, data: await kontakUntuk(kat, wilayah, { pertanyaan: teks(req.body.pertanyaan, 500) }) });
	} catch (err) {
		return gagal(res, 'kontak', err);
	}
};

exports.buatTiket = async (req, res) => {
	try {
		// Kolom umpan: manusia tidak melihatnya, bot pengisi formulir mengisinya.
		if (req.body.website) return res.json({ success: true, data: {} });

		const pesan = teks(req.body.pesan, 2000);
		if (!pesan) return res.status(400).json({ success: false, message: 'Isi pertanyaan wajib diisi' });

		const akun = await akunPenanya(req);
		const nama = teks(req.body.nama, 150) || akun?.name || '';
		const whatsapp = Helpdesk.nomorWa(req.body.whatsapp || akun?.no_hp);
		if (!nama) return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
		if (!akun && !whatsapp) {
			return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak valid. Contoh: 081234567890' });
		}

		const [kategori, wilayah] = await Promise.all([
			Helpdesk.semuaKategori({ hanyaAktif: true }),
			wilayahPenanya(akun, req.body),
		]);
		const kat = kategori.find((k) => k.id === Number(req.body.kategori_id)) || null;
		const tingkatAwal = kat?.target_level || 'dpmd';
		if (wilayahKurang(tingkatAwal, wilayah)) {
			return res.status(400).json({ success: false, message: 'Pilih kecamatan Anda terlebih dahulu' });
		}

		const tujuan = await tujuanTiket(tingkatAwal, wilayah, kat?.bidang_id);
		const riwayat = riwayatBersih(req.body.riwayat);
		const pesanAwal = [];
		if (riwayat.length) {
			pesanAwal.push({
				sender_type: 'sistem',
				body: `Riwayat percakapan dengan bot:\n${riwayat.map((r) => `${r.peran === 'bot' ? '🤖' : '👤'} ${r.teks}`).join('\n')}`,
			});
		}
		pesanAwal.push({ sender_type: 'pelapor', sender_id: akun?.id, sender_name: nama, body: pesan });

		const { id, code } = await Helpdesk.buatTiket({
			category_id: kat?.id || null,
			target_level: tujuan.tingkat,
			bidang_id: tujuan.tingkat === 'kecamatan' ? kat?.bidang_id || null : tujuan.bidangId,
			kecamatan_id: wilayah.kecamatan_id,
			desa_id: wilayah.desa_id,
			user_id: akun?.id || null,
			reporter_name: nama,
			reporter_whatsapp: whatsapp,
			subject: pesan.split('\n')[0].slice(0, 200),
			priority: req.body.mendesak === true ? 'tinggi' : 'normal',
		}, pesanAwal);

		await notifikasi(
			tujuan.penerima,
			`🛟 Tiket Helpdesk baru ${code}`,
			`${nama}${wilayah.desa_nama ? ` (${wilayah.desa_nama})` : ''}${kat ? ` · ${kat.name}` : ''}: ${pesan.slice(0, 150)}`,
			tautanPanel(tujuan.tingkat, id)
		);

		const kontak = await Helpdesk.cariKontak(tujuan.tingkat, wilayah, tujuan.bidangId);
		const namaTujuan = tujuan.tingkat === 'kecamatan' ? `Kecamatan ${wilayah.kecamatan_nama}`
			: tujuan.tingkat === 'bidang' ? (await Helpdesk.bidangById(tujuan.bidangId))?.nama || 'Bidang DPMD' : 'DPMD';
		return res.status(201).json({
			success: true,
			message: 'Tiket berhasil dibuat',
			data: {
				id,
				code,
				tujuan: namaTujuan,
				kontak: sajikanKontak(kontak, { kategori: kat?.name, pertanyaan: pesan.slice(0, 500), kode: code, nama }),
			},
		});
	} catch (err) {
		return gagal(res, 'buat tiket', err);
	}
};

/* ── Tiket milik akun ────────────────────────────────────────────────────── */

async function tiketPemilik(req, res) {
	const tiket = await Helpdesk.tiketById(Number(req.params.id));
	if (!tiket || String(tiket.user_id) !== String(req.user.id)) {
		res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
		return null;
	}
	return tiket;
}

/* Hanya kolom yang perlu dilihat pelapor — t.* memuat id petugas & data internal. */
const ringkasUntukPelapor = (t) => ({
	id: t.id,
	code: t.code,
	subject: t.subject,
	status: t.status,
	target_level: t.target_level,
	tujuan_nama: t.target_level === 'kecamatan' ? `Kecamatan ${t.kecamatan_nama || ''}`.trim() : t.target_level === 'bidang' ? t.bidang_nama : 'DPMD',
	category_name: t.category_name,
	rating: t.rating,
	last_message_at: t.last_message_at,
	created_at: t.created_at,
});
const pesanUntukPelapor = (pesan) => pesan.map(({ id, sender_type, sender_name, body, created_at }) => ({ id, sender_type, sender_name, body, created_at }));

exports.tiketSaya = async (req, res) => {
	try {
		return res.json({ success: true, data: (await Helpdesk.tiketMilik(req.user.id)).map(ringkasUntukPelapor) });
	} catch (err) {
		return gagal(res, 'tiket saya', err);
	}
};

exports.detailTiketSaya = async (req, res) => {
	try {
		const tiket = await tiketPemilik(req, res);
		if (!tiket) return undefined;
		return res.json({ success: true, data: { ...ringkasUntukPelapor(tiket), pesan: pesanUntukPelapor(await Helpdesk.pesanTiket(tiket.id)) } });
	} catch (err) {
		return gagal(res, 'detail tiket saya', err);
	}
};

const penerimaBalasan = async (t) => (t.handled_by
	? [t.handled_by]
	: Helpdesk.penerimaTiket(t.target_level, { kecamatanId: t.kecamatan_id, bidangId: t.bidang_id }));

/* Balasan pelapor — akun maupun tamu — membuka kembali tiket dan memberi tahu
   petugas yang menanganinya. */
async function balasanPelapor(res, tiket, isi, senderId) {
	const pesan = teks(isi, 2000);
	if (!pesan) return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong' });
	if (tiket.status === 'selesai') {
		return res.status(400).json({ success: false, message: 'Tiket sudah selesai. Buat tiket baru bila masih ada pertanyaan.' });
	}
	await Helpdesk.tambahPesan(tiket.id, { sender_type: 'pelapor', sender_id: senderId, sender_name: tiket.reporter_name, body: pesan }, { status: 'baru' });
	await notifikasi(await penerimaBalasan(tiket), `💬 Balasan pada tiket ${tiket.code}`, `${tiket.reporter_name}: ${pesan.slice(0, 150)}`, tautanPanel(tiket.target_level, tiket.id));
	return res.json({ success: true, message: 'Pesan terkirim' });
}

async function nilaiOlehPelapor(res, tiket, body) {
	const rating = Number(body.rating);
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		return res.status(400).json({ success: false, message: 'Penilaian harus 1 sampai 5 bintang' });
	}
	const ok = await Helpdesk.nilaiTiket(tiket.id, rating, teks(body.catatan, 500));
	if (!ok) return res.status(400).json({ success: false, message: 'Tiket ini belum bisa atau sudah dinilai' });
	if (tiket.handled_by) {
		await notifikasi([tiket.handled_by], `⭐ Tiket ${tiket.code} dinilai ${rating}/5`, teks(body.catatan, 150) || tiket.subject, tautanPanel(tiket.target_level, tiket.id));
	}
	return res.json({ success: true, message: 'Terima kasih atas penilaian Anda' });
}

exports.balasTiketSaya = async (req, res) => {
	try {
		const tiket = await tiketPemilik(req, res);
		if (!tiket) return undefined;
		return await balasanPelapor(res, tiket, req.body.pesan, req.user.id);
	} catch (err) {
		return gagal(res, 'balas tiket saya', err);
	}
};

exports.nilaiTiketSaya = async (req, res) => {
	try {
		const tiket = await tiketPemilik(req, res);
		if (!tiket) return undefined;
		return await nilaiOlehPelapor(res, tiket, req.body);
	} catch (err) {
		return gagal(res, 'nilai tiket saya', err);
	}
};

/* ── Tiket tamu: dibuka dengan kode tiket + nomor WhatsApp ──────────────── */

const POLA_KODE = /^HD-\d{6}-[0-9A-F]{6}$/;
const TIDAK_KETEMU = 'Tiket tidak ditemukan. Periksa kode tiket dan nomor WhatsApp yang Anda isi saat membuat tiket.';

async function tiketTamu(kode, whatsapp) {
	const code = String(kode || '').trim().toUpperCase();
	const nomor = Helpdesk.nomorWa(whatsapp);
	if (!POLA_KODE.test(code) || !nomor) return null;
	const tiket = await Helpdesk.tiketByKode(code);
	return tiket && !tiket.user_id && tiket.reporter_whatsapp === nomor ? tiket : null;
}

exports.cekTiketTamu = async (req, res) => {
	try {
		const daftar = (Array.isArray(req.body.tiket) ? req.body.tiket : []).slice(0, 10);
		const hasil = await Promise.all(daftar.map((x) => tiketTamu(x?.kode, x?.whatsapp)));
		return res.json({ success: true, data: hasil.filter(Boolean).map(ringkasUntukPelapor) });
	} catch (err) {
		return gagal(res, 'cek tiket tamu', err);
	}
};

exports.detailTiketTamu = async (req, res) => {
	try {
		const tiket = await tiketTamu(req.body.kode, req.body.whatsapp);
		if (!tiket) return res.status(404).json({ success: false, message: TIDAK_KETEMU });
		return res.json({ success: true, data: { ...ringkasUntukPelapor(tiket), pesan: pesanUntukPelapor(await Helpdesk.pesanTiket(tiket.id)) } });
	} catch (err) {
		return gagal(res, 'detail tiket tamu', err);
	}
};

exports.balasTiketTamu = async (req, res) => {
	try {
		const tiket = await tiketTamu(req.body.kode, req.body.whatsapp);
		if (!tiket) return res.status(404).json({ success: false, message: TIDAK_KETEMU });
		return await balasanPelapor(res, tiket, req.body.pesan, null);
	} catch (err) {
		return gagal(res, 'balas tiket tamu', err);
	}
};

exports.nilaiTiketTamu = async (req, res) => {
	try {
		const tiket = await tiketTamu(req.body.kode, req.body.whatsapp);
		if (!tiket) return res.status(404).json({ success: false, message: TIDAK_KETEMU });
		return await nilaiOlehPelapor(res, tiket, req.body);
	} catch (err) {
		return gagal(res, 'nilai tiket tamu', err);
	}
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ PENGINGAT TIKET ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const HARI_LAPOR_DPMD = 3;

/**
 * Dijalankan berkala. Tiket yang belum dibalas lebih dari sehari diingatkan ke
 * petugas tujuannya sekali per hari; tiket kecamatan/bidang yang menunggu
 * HARI_LAPOR_DPMD hari atau lebih juga dilaporkan ke DPMD, yang bisa membalas
 * atau mengalihkannya dari panel.
 */
async function ingatkanTiketTertunda() {
	try {
		const tiket = await Helpdesk.tiketPerluPengingat();
		if (!tiket.length) return;
		const penerimaDpmd = await Helpdesk.penerimaTiket('dpmd');
		for (const t of tiket) {
			const hari = Math.max(1, Math.floor(Number(t.jam_menunggu) / 24));
			const ringkas = `${t.reporter_name}: ${String(t.subject).slice(0, 120)}`;
			await notifikasi(await penerimaBalasan(t), `⏰ Tiket ${t.code} belum dibalas ${hari} hari`, ringkas, tautanPanel(t.target_level, t.id));
			if (t.target_level !== 'dpmd' && hari >= HARI_LAPOR_DPMD) {
				const di = t.target_level === 'kecamatan' ? `Kecamatan ${t.kecamatan_nama || ''}` : t.bidang_nama || 'bidang';
				await notifikasi(penerimaDpmd, `⚠️ Tiket ${t.code} di ${di} belum dibalas ${hari} hari`, ringkas, tautanPanel('dpmd', t.id));
			}
		}
		await Helpdesk.tandaiDiingatkan(tiket.map((t) => t.id));
		logger.info(`🛟 Helpdesk: pengingat ${tiket.length} tiket tertunda`);
	} catch (err) {
		logger.error(`Helpdesk pengingat: ${err.message}`);
	}
}
exports.ingatkanTiketTertunda = ingatkanTiketTertunda;

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ PANEL PETUGAS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* Cakupan dibaca dari akun, bukan query string — petugas tidak bisa membuka
   tiket wilayah/bidang lain dengan mengganti parameter. */
async function cakupanPetugas(req) {
	const role = String(req.user.role || '').toLowerCase();
	if (PERAN_PIMPINAN.includes(role)) return { tingkat: 'dpmd', nama: 'Seluruh tiket DPMD', pimpinan: true };
	if (role === 'kecamatan' && req.user.kecamatan_id) {
		const kec = await Helpdesk.satu('SELECT nama FROM kecamatans WHERE id = ?', [req.user.kecamatan_id]);
		return { tingkat: 'kecamatan', kecamatanId: req.user.kecamatan_id, nama: `Kecamatan ${kec?.nama || ''}`.trim() };
	}
	if (PERAN_STAF_BIDANG.includes(role) && req.user.bidang_id) {
		const b = await Helpdesk.bidangById(req.user.bidang_id);
		return { tingkat: 'bidang', bidangId: req.user.bidang_id, nama: b?.nama || 'Bidang', kepalaBidang: role === 'kepala_bidang' };
	}
	return null;
}

const bolehLihat = (c, t) => c.tingkat === 'dpmd'
	|| (c.tingkat === 'kecamatan' && t.target_level === 'kecamatan' && Number(t.kecamatan_id) === Number(c.kecamatanId))
	|| (c.tingkat === 'bidang' && t.target_level === 'bidang' && Number(t.bidang_id) === Number(c.bidangId));

const TANPA_CAKUPAN = 'Akun ini belum terhubung ke kecamatan atau bidang, jadi belum punya tiket Helpdesk.';

async function tiketPetugas(req, res) {
	const cakupan = await cakupanPetugas(req);
	if (!cakupan) {
		res.status(403).json({ success: false, message: TANPA_CAKUPAN });
		return {};
	}
	const tiket = await Helpdesk.tiketById(Number(req.params.id));
	if (!tiket || !bolehLihat(cakupan, tiket)) {
		res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });
		return {};
	}
	return { cakupan, tiket };
}

const namaPetugas = (req, cakupan) => `${req.user.name || 'Petugas'} · ${cakupan.tingkat === 'dpmd' ? 'DPMD' : cakupan.nama}`;

exports.daftarTiketPetugas = async (req, res) => {
	try {
		const cakupan = await cakupanPetugas(req);
		if (!cakupan) return res.status(403).json({ success: false, message: TANPA_CAKUPAN });
		const items = await Helpdesk.daftarTiket(cakupan, {
			status: req.query.status,
			tingkat: req.query.tingkat,
			bidang: req.query.bidang,
			prioritas: req.query.prioritas,
			cari: teks(req.query.cari, 100),
		});
		return res.json({
			success: true,
			data: {
				cakupan: { tingkat: cakupan.tingkat, nama: cakupan.nama, kelola: cakupan.tingkat === 'dpmd' || Boolean(cakupan.kepalaBidang) },
				bidang: cakupan.tingkat === 'dpmd' ? await Helpdesk.daftarBidang() : [],
				items: items.map(({ reporter_whatsapp, ...t }) => ({ ...t, punya_whatsapp: Boolean(reporter_whatsapp) })),
			},
		});
	} catch (err) {
		return gagal(res, 'daftar tiket petugas', err);
	}
};

exports.jumlahTiketBaru = async (req, res) => {
	try {
		const cakupan = await cakupanPetugas(req);
		return res.json({ success: true, data: { jumlah: cakupan ? await Helpdesk.hitungTiketBaru(cakupan) : 0 } });
	} catch (err) {
		return gagal(res, 'jumlah tiket', err);
	}
};

exports.statistik = async (req, res) => {
	try {
		const cakupan = await cakupanPetugas(req);
		if (!cakupan) return res.status(403).json({ success: false, message: TANPA_CAKUPAN });
		const hari = [7, 30, 90, 365].includes(Number(req.query.hari)) ? Number(req.query.hari) : 30;
		return res.json({ success: true, data: { hari, ...(await Helpdesk.statistik(cakupan, hari)) } });
	} catch (err) {
		return gagal(res, 'statistik', err);
	}
};

exports.detailTiketPetugas = async (req, res) => {
	try {
		const { cakupan, tiket } = await tiketPetugas(req, res);
		if (!tiket) return undefined;
		const pesan = await Helpdesk.pesanTiket(tiket.id);
		const sapa = `Halo ${tiket.reporter_name}, kami dari ${cakupan.tingkat === 'dpmd' ? 'DPMD Kabupaten Bogor' : cakupan.nama} menanggapi tiket Helpdesk ${tiket.code} — "${tiket.subject}".`;
		const kategori = tiket.category_id ? (await Helpdesk.semuaKategori()).find((k) => k.id === tiket.category_id) : null;
		return res.json({
			success: true,
			data: {
				...tiket,
				pesan,
				reporter_whatsapp_url: tiket.reporter_whatsapp ? `https://wa.me/${tiket.reporter_whatsapp}?text=${encodeURIComponent(sapa)}` : null,
				/* Rantai teruskan: kecamatan -> bidang kategori; bidang -> DPMD. DPMD bisa mengalihkan ke bidang mana pun. */
				teruskan_ke: tiket.target_level === 'kecamatan'
					? { tingkat: 'bidang', nama: kategori?.bidang_nama || (await Helpdesk.bidangById(tiket.bidang_id || Helpdesk.BIDANG_SEKRETARIAT))?.nama }
					: tiket.target_level === 'bidang' ? { tingkat: 'dpmd', nama: 'DPMD (Sekretaris Dinas)' } : null,
				bisa_alihkan_bidang: cakupan.tingkat !== 'kecamatan',
				bidang: cakupan.tingkat !== 'kecamatan' ? await Helpdesk.daftarBidang() : [],
			},
		});
	} catch (err) {
		return gagal(res, 'detail tiket petugas', err);
	}
};

exports.balasTiketPetugas = async (req, res) => {
	try {
		const { cakupan, tiket } = await tiketPetugas(req, res);
		if (!tiket) return undefined;
		const pesan = teks(req.body.pesan, 4000);
		if (!pesan) return res.status(400).json({ success: false, message: 'Balasan tidak boleh kosong' });
		const status = Helpdesk.STATUS_TIKET.includes(req.body.status) ? req.body.status : 'dijawab';
		await Helpdesk.tambahPesan(tiket.id, {
			sender_type: 'petugas', sender_id: req.user.id, sender_name: namaPetugas(req, cakupan), body: pesan,
		}, { status, penanganId: req.user.id });
		Jembatan.dariPanel(tiket.id, { id: req.user.id, name: namaPetugas(req, cakupan) }, pesan).catch((err) => logger.warn(`Helpdesk jembatan panel: ${err.message}`));
		if (tiket.user_id) {
			const pelapor = await Helpdesk.akun(tiket.user_id);
			await notifikasi([tiket.user_id], `🛟 Tiket ${tiket.code} dibalas`, pesan.slice(0, 150), tautanPelapor(pelapor?.role));
		}
		return res.json({ success: true, message: 'Balasan terkirim' });
	} catch (err) {
		return gagal(res, 'balas tiket petugas', err);
	}
};

exports.ubahStatusTiket = async (req, res) => {
	try {
		const { tiket } = await tiketPetugas(req, res);
		if (!tiket) return undefined;
		if (!Helpdesk.STATUS_TIKET.includes(req.body.status)) return res.status(400).json({ success: false, message: 'Status tidak dikenal' });
		await Helpdesk.ubahStatus(tiket.id, req.body.status);
		return res.json({ success: true, message: 'Status diperbarui' });
	} catch (err) {
		return gagal(res, 'ubah status', err);
	}
};

exports.ubahPrioritasTiket = async (req, res) => {
	try {
		const { tiket } = await tiketPetugas(req, res);
		if (!tiket) return undefined;
		if (!Helpdesk.PRIORITAS.includes(req.body.prioritas)) return res.status(400).json({ success: false, message: 'Prioritas tidak dikenal' });
		await Helpdesk.ubahPrioritas(tiket.id, req.body.prioritas);
		return res.json({ success: true, message: req.body.prioritas === 'tinggi' ? 'Ditandai mendesak' : 'Prioritas normal' });
	} catch (err) {
		return gagal(res, 'ubah prioritas', err);
	}
};

/* Draf balasan dari FAQ; selalu disunting petugas sebelum dikirim. */
exports.drafBalasanTiket = async (req, res) => {
	try {
		const { cakupan, tiket } = await tiketPetugas(req, res);
		if (!tiket) return undefined;
		if (!Bot.aiAktif()) {
			return res.status(503).json({ success: false, message: 'Asisten AI belum diaktifkan di server (HELPDESK_AI_API_KEY kosong).' });
		}
		const [pesan, faqs] = await Promise.all([Helpdesk.pesanTiket(tiket.id), Helpdesk.faqUntuk(Boolean(tiket.user_id))]);
		const teksPelapor = pesan.filter((m) => m.sender_type === 'pelapor').map((m) => m.body).join(' ');
		const referensi = Bot.cariFaq(`${tiket.subject} ${teksPelapor}`, faqs, { kategoriId: tiket.category_id, batas: 5 });
		const draf = await Bot.drafBalasan({ tiket, pesan, referensi, penulis: cakupan.tingkat === 'dpmd' ? 'petugas DPMD' : cakupan.nama });
		if (!draf) return res.status(503).json({ success: false, message: 'Asisten AI sedang tidak tersedia. Coba lagi beberapa menit lagi.' });
		return res.json({ success: true, data: { draf, rujukan: referensi.map(({ faq }) => faq.question) } });
	} catch (err) {
		return gagal(res, 'draf balasan', err);
	}
};

/**
 * Teruskan ke tingkat berikutnya (kecamatan -> bidang kategori -> DPMD), atau
 * — bagi bidang dan DPMD — alihkan langsung ke bidang tertentu
 * (body.bidang_id) bila tiket salah alamat.
 */
exports.teruskanTiket = async (req, res) => {
	try {
		const { cakupan, tiket } = await tiketPetugas(req, res);
		if (!tiket) return undefined;
		const alasan = teks(req.body.alasan, 500);
		let tingkat;
		let bidangId = null;
		const bidangPilihan = Number(req.body.bidang_id);
		if (bidangPilihan && cakupan.tingkat !== 'kecamatan') {
			const b = await Helpdesk.bidangById(bidangPilihan);
			if (!b) return res.status(400).json({ success: false, message: 'Bidang tidak dikenal' });
			tingkat = 'bidang';
			bidangId = b.id;
		} else if (tiket.target_level === 'kecamatan') {
			tingkat = 'bidang';
			bidangId = tiket.bidang_id || Helpdesk.BIDANG_SEKRETARIAT;
		} else if (tiket.target_level === 'bidang') {
			tingkat = 'dpmd';
		} else {
			return res.status(400).json({ success: false, message: 'Tiket sudah di tingkat DPMD. Pilih bidang untuk mengalihkannya.' });
		}

		const penerima = await Helpdesk.penerimaTiket(tingkat, { bidangId });
		await Helpdesk.pindahTujuan(tiket.id, { tingkat, bidangId });
		const namaTujuan = tingkat === 'dpmd' ? 'DPMD' : (await Helpdesk.bidangById(bidangId))?.nama || 'bidang';
		await Helpdesk.tambahPesan(tiket.id, {
			sender_type: 'sistem',
			body: `Tiket diteruskan oleh ${namaPetugas(req, cakupan)} ke ${namaTujuan}.${alasan ? ` Catatan: ${alasan}` : ''}`,
		});
		await notifikasi(penerima, `🛟 Tiket diteruskan ke ${namaTujuan}: ${tiket.code}`, `${tiket.reporter_name}: ${tiket.subject}`, tautanPanel(tingkat, tiket.id));
		return res.json({ success: true, message: `Tiket diteruskan ke ${namaTujuan}` });
	} catch (err) {
		return gagal(res, 'teruskan tiket', err);
	}
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ BASIS PENGETAHUAN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* Pimpinan DPMD mengelola semuanya; Kepala Bidang mengelola FAQ dan
   pertanyaan tak terjawab untuk kategori bidangnya sendiri. */
async function pengelola(req, res, { hanyaPimpinan = false } = {}) {
	const c = await cakupanPetugas(req);
	const ok = c && (c.tingkat === 'dpmd' || (!hanyaPimpinan && c.kepalaBidang));
	if (!ok) {
		res.status(403).json({ success: false, message: 'Hanya pimpinan DPMD atau Kepala Bidang yang dapat mengelola basis pengetahuan Helpdesk' });
		return null;
	}
	return c;
}

const slugDari = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const IKON = ['tanya', 'info', 'uang', 'dompet', 'toko', 'dokumen', 'jabat', 'orang', 'lencana', 'buku', 'kunci', 'gedung', 'peta', 'kalender', 'telepon', 'bintang'];

exports.kelolaData = async (req, res) => {
	try {
		const c = await pengelola(req, res);
		if (!c) return undefined;
		const [kategori, faq, pengaturan, ringkasan, bidang] = await Promise.all([
			Helpdesk.semuaKategori(),
			Helpdesk.semuaFaq(),
			Helpdesk.pengaturan(),
			Helpdesk.ringkasanChat(30),
			Helpdesk.daftarBidang(),
		]);
		const milikBidang = (bidangId) => c.tingkat === 'dpmd' || Number(bidangId) === Number(c.bidangId);
		return res.json({
			success: true,
			data: {
				pimpinan: c.tingkat === 'dpmd',
				bidang_saya: c.bidangId || null,
				kategori: kategori.map((k) => ({ ...k, boleh_ubah: milikBidang(k.bidang_id) })),
				faq: faq.filter((f) => milikBidang(f.category_bidang_id)),
				pengaturan: c.tingkat === 'dpmd' ? pengaturan : {},
				ringkasan,
				bidang,
				ikon: IKON,
				ai: { aktif: Bot.aiAktif(), model: Bot.MODEL },
				program_akun: c.tingkat === 'dpmd' ? await Jembatan.daftarProgramPic() : [],
				calon_pic: c.tingkat === 'dpmd' ? await Helpdesk.q(
					`SELECT u.id, u.name, u.role, u.bidang_id, b.nama AS bidang FROM users u LEFT JOIN bidangs b ON b.id = u.bidang_id
					  WHERE u.is_active = 1 AND u.role IN ('superadmin','kepala_dinas','sekretaris_dinas','kepala_bidang','ketua_tim','pegawai','bendahara')
					  ORDER BY u.bidang_id, FIELD(u.role, 'kepala_bidang', 'ketua_tim', 'pegawai', 'bendahara'), u.name`,
				) : [],
			},
		});
	} catch (err) {
		return gagal(res, 'kelola data', err);
	}
};

exports.simpanKategori = async (req, res) => {
	try {
		if (!(await pengelola(req, res, { hanyaPimpinan: true }))) return undefined;
		const name = teks(req.body.name, 100);
		if (!name) return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });
		if (!Helpdesk.TINGKAT.includes(req.body.target_level)) return res.status(400).json({ success: false, message: 'Penanggung jawab tidak dikenal' });
		const bidangId = Number(req.body.bidang_id) || null;
		if (bidangId && !(await Helpdesk.bidangById(bidangId))) return res.status(400).json({ success: false, message: 'Bidang tidak dikenal' });
		const id = await Helpdesk.simpanKategori(Number(req.params.id) || null, {
			name,
			slug: slugDari(req.body.slug || name),
			description: teks(req.body.description, 255),
			icon: IKON.includes(req.body.icon) ? req.body.icon : 'tanya',
			target_level: req.body.target_level,
			bidang_id: bidangId,
			keywords: teks(req.body.keywords, 500),
			sort_order: req.body.sort_order,
			is_active: req.body.is_active !== false,
		});
		return res.json({ success: true, message: 'Kategori disimpan', data: { id } });
	} catch (err) {
		if (err?.original?.code === 'ER_DUP_ENTRY' || err?.parent?.code === 'ER_DUP_ENTRY') {
			return res.status(400).json({ success: false, message: 'Slug kategori sudah dipakai' });
		}
		return gagal(res, 'simpan kategori', err);
	}
};

exports.hapusKategori = async (req, res) => {
	try {
		if (!(await pengelola(req, res, { hanyaPimpinan: true }))) return undefined;
		const hasil = await Helpdesk.hapusKategori(Number(req.params.id));
		return res.json({ success: true, message: hasil === 'dihapus' ? 'Kategori dihapus' : 'Kategori sudah dipakai, jadi dinonaktifkan' });
	} catch (err) {
		return gagal(res, 'hapus kategori', err);
	}
};

/* Kepala Bidang hanya boleh menyentuh FAQ di kategori bidangnya. */
async function kategoriMilik(c, categoryId) {
	const kat = (await Helpdesk.semuaKategori()).find((k) => k.id === Number(categoryId));
	if (!kat) return null;
	return c.tingkat === 'dpmd' || Number(kat.bidang_id) === Number(c.bidangId) ? kat : null;
}

exports.simpanFaq = async (req, res) => {
	try {
		const c = await pengelola(req, res);
		if (!c) return undefined;
		const question = teks(req.body.question, 500);
		const answer = teks(req.body.answer, 5000);
		if (!question || !answer || !req.body.category_id) {
			return res.status(400).json({ success: false, message: 'Kategori, pertanyaan, dan jawaban wajib diisi' });
		}
		if (!(await kategoriMilik(c, req.body.category_id))) {
			return res.status(403).json({ success: false, message: 'Kategori ini bukan milik bidang Anda' });
		}
		if (req.params.id) {
			const lama = await Helpdesk.faqById(Number(req.params.id));
			if (!lama || !(await kategoriMilik(c, lama.category_id))) return res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
		}
		/* Tombol aksi opsional: jalur internal ("/desa/...") atau https://.
		   Skema lain (javascript:, data:) ditolak karena dirender sebagai tautan. */
		const actionLabel = teks(req.body.action_label, 60);
		const actionUrl = teks(req.body.action_url, 255);
		if (actionUrl && !/^(\/(?!\/)|https:\/\/)/.test(actionUrl)) {
			return res.status(400).json({ success: false, message: 'Tautan tombol harus diawali "/" (halaman aplikasi DPMD) atau "https://"' });
		}
		if (Boolean(actionLabel) !== Boolean(actionUrl)) {
			return res.status(400).json({ success: false, message: 'Teks tombol dan tautannya harus diisi keduanya, atau dikosongkan keduanya' });
		}
		const id = await Helpdesk.simpanFaq(Number(req.params.id) || null, {
			category_id: Number(req.body.category_id),
			question,
			answer,
			keywords: teks(req.body.keywords, 500),
			audience: ['semua', 'publik', 'akun'].includes(req.body.audience) ? req.body.audience : 'semua',
			action_label: actionLabel,
			action_url: actionUrl,
			is_active: req.body.is_active !== false,
		}, req.user.id);
		const logIds = (Array.isArray(req.body.dari_log) ? req.body.dari_log : []).map(Number).filter(Boolean);
		if (logIds.length) await Helpdesk.tandaiLogDitinjau(logIds);
		return res.json({ success: true, message: 'FAQ disimpan', data: { id } });
	} catch (err) {
		return gagal(res, 'simpan FAQ', err);
	}
};

exports.hapusFaq = async (req, res) => {
	try {
		const c = await pengelola(req, res);
		if (!c) return undefined;
		const faq = await Helpdesk.faqById(Number(req.params.id));
		if (!faq || !(await kategoriMilik(c, faq.category_id))) return res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
		await Helpdesk.hapusFaq(faq.id);
		return res.json({ success: true, message: 'FAQ dihapus' });
	} catch (err) {
		return gagal(res, 'hapus FAQ', err);
	}
};

exports.takTerjawab = async (req, res) => {
	try {
		const c = await pengelola(req, res);
		if (!c) return undefined;
		return res.json({ success: true, data: await Helpdesk.pertanyaanTakTerjawab({ bidangId: c.tingkat === 'dpmd' ? null : c.bidangId }) });
	} catch (err) {
		return gagal(res, 'tak terjawab', err);
	}
};

exports.tandaiDitinjau = async (req, res) => {
	try {
		if (!(await pengelola(req, res))) return undefined;
		const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
		if (ids.length) await Helpdesk.tandaiLogDitinjau(ids);
		return res.json({ success: true, message: 'Ditandai sudah ditinjau' });
	} catch (err) {
		return gagal(res, 'tandai ditinjau', err);
	}
};

exports.simpanPengaturan = async (req, res) => {
	try {
		if (!(await pengelola(req, res, { hanyaPimpinan: true }))) return undefined;
		const data = {
			salam: teks(req.body.salam, 500),
			dpmd_nama: teks(req.body.dpmd_nama, 100) || 'DPMD Kabupaten Bogor',
			dpmd_whatsapp: teks(req.body.dpmd_whatsapp, 20),
			dpmd_profil: teks(req.body.dpmd_profil, 3000),
		};
		const bidang = await Helpdesk.daftarBidang();
		for (const b of bidang) data[`wa_bidang_${b.id}`] = teks(req.body[`wa_bidang_${b.id}`], 20);
		if (req.body.pic_akun && typeof req.body.pic_akun === 'object') {
			const peta = {};
			for (const p of Jembatan.PROGRAM_AKUN) {
				const id = Number(req.body.pic_akun[p.key]);
				if (id > 0) peta[p.key] = id;
			}
			data.pic_akun = JSON.stringify(peta);
		}
		const salah = Object.entries(data).find(([k, v]) => (k === 'dpmd_whatsapp' || k.startsWith('wa_bidang_')) && v && !Helpdesk.nomorWa(v));
		if (salah) return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak valid. Contoh: 081234567890' });
		await Helpdesk.simpanPengaturan(data);
		lupakanSimpanan();
		return res.json({ success: true, message: 'Pengaturan disimpan' });
	} catch (err) {
		return gagal(res, 'simpan pengaturan', err);
	}
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ SAMBUNG KE PIC AKUN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/* Penanya urusan akun disambungkan ke PIC program di kolom chat; percakapannya
   diteruskan ke fitur Pesan PIC (lihat helpdeskJembatan.service.js). */

exports.programAkun = (req, res) => res.json({ success: true, data: Jembatan.PROGRAM_AKUN.map(({ key, label, ket }) => ({ key, label, ket })) });

exports.sambungPic = async (req, res) => {
	try {
		if (req.body.website) return res.json({ success: true, data: {} });
		const pesan = teks(req.body.pesan, 2000);
		if (!pesan) return res.status(400).json({ success: false, message: 'Tuliskan keperluan Anda' });
		const akun = await akunPenanya(req);
		const nama = teks(req.body.nama, 150) || akun?.name || '';
		if (!nama) return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
		const wilayah = await wilayahPenanya(akun, req.body);
		const hasil = await Jembatan.sambung({
			programKey: teks(req.body.program, 60),
			pesan,
			nama,
			akun,
			wilayah,
			whatsapp: Helpdesk.nomorWa(req.body.whatsapp || akun?.no_hp),
		});
		await notifikasi([hasil.pic.id], `🛟 Pesan Helpdesk · ${hasil.program.label}`, `${nama}: ${pesan.slice(0, 140)}`, '/dpmd/pesan');
		return res.status(201).json({
			success: true,
			data: { id: hasil.id, code: hasil.code, k: hasil.k, program: hasil.program.label, pic: hasil.pic.name },
		});
	} catch (err) {
		if (err.status) return res.status(err.status).json({ success: false, message: err.message });
		return gagal(res, 'sambung pic', err);
	}
};

exports.benangPic = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Jembatan.tokenSah(id, req.query.k)) return res.status(403).json({ success: false, message: 'Akses percakapan tidak sah' });
		const data = await Jembatan.benang(id);
		if (!data) return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
		return res.json({ success: true, data });
	} catch (err) {
		return gagal(res, 'benang pic', err);
	}
};

exports.balasPic = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Jembatan.tokenSah(id, req.body.k)) return res.status(403).json({ success: false, message: 'Akses percakapan tidak sah' });
		const isi = teks(req.body.pesan, 2000);
		if (!isi) return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong' });
		const akun = await akunPenanya(req);
		if (!(await Jembatan.balasPenanya(id, { isi, nama: teks(req.body.nama, 150) || akun?.name, akunId: akun?.id }))) {
			return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
		}
		return res.json({ success: true, data: await Jembatan.benang(id) });
	} catch (err) {
		return gagal(res, 'balas pic', err);
	}
};
