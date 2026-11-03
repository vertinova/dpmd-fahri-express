/**
 * Jembatan Helpdesk ↔ Pesan untuk urusan AKUN.
 *
 * Pertanyaan akun (lupa sandi, tidak bisa masuk, menu tidak muncul, minta akun)
 * tidak dijawab bot: penanya memilih PROGRAM yang memakai akun itu, lalu
 * disambungkan langsung ke PIC program tersebut — semuanya di dalam kolom chat
 * Helpdesk, tanpa tautan keluar.
 *
 *   penanya (widget) ──► tiket Helpdesk ──► Pesan PIC (dari akun sistem "Helpdesk DPMD")
 *   PIC balas di Pesan ──► pesan petugas di tiket ──► tampil di chat penanya
 *
 * Program = fitur akun desa (config/desaPermissions.js) beserta bidang
 * pemiliknya (config/bidangDesaPermissions.js), ditambah akun kecamatan.
 * PIC tiap program diatur di panel Helpdesk (pengaturan "pic_akun"); bila belum,
 * dipakai staf bidang pemilik program (kepala bidang → ketua tim → pegawai).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const Helpdesk = require('./helpdesk.service');
const { DESA_PERMISSIONS } = require('../config/desaPermissions');
const { PERMISSION_PER_BIDANG } = require('../config/bidangDesaPermissions');
const { getIO } = require('../socket/meeting.socket');
const logger = require('../utils/logger');

const EMAIL_SISTEM = 'helpdesk@sistem.dpmd.local';
const REF = 'helpdesk';

const bidangPemilik = (key) => Number(Object.entries(PERMISSION_PER_BIDANG).find(([, keys]) => keys.includes(key))?.[0]) || null;

/** Program yang memakai akun, urut sesuai menu akun desa. */
const PROGRAM_AKUN = [
	...DESA_PERMISSIONS.filter((p) => p.key !== 'pesan').map((p) => ({ key: p.key, label: p.label, ket: p.description, bidang_id: bidangPemilik(p.key) })),
	{ key: 'akun-kecamatan', label: 'Akun Kecamatan', ket: 'Akun utama & operator kecamatan (verifikasi).', bidang_id: null },
];
const programByKey = (key) => PROGRAM_AKUN.find((p) => p.key === key) || null;

/* Pertanyaan seputar akun: lupa/ganti sandi, tidak bisa masuk, minta/buat akun,
   menu/hak akses tidak muncul. */
const POLA_AKUN = [
	/\b(lupa|reset|ganti|ubah|atur ulang|setel ulang)\b.{0,30}\b(sandi|password|pasword|passwd|pin|akun)\b/i,
	/\b(tidak|tdk|gak|ga|nggak|enggak|belum) ?(bisa|dapat|bs)\b.{0,20}\b(masuk|login|log in|akses)\b/i,
	/\b(minta|buat|bikin|daftar|tambah|aktifkan)\b.{0,20}\b(akun|user|username)\b/i,
	/\b(akun|username)\b.{0,25}\b(terkunci|diblokir|nonaktif|tidak aktif|hilang|salah)\b/i,
	/\b(hak akses|menu)\b.{0,25}\b(tidak muncul|hilang|tidak ada|belum ada)\b/i,
];
const niatAkun = (pesan) => POLA_AKUN.some((p) => p.test(pesan));

/* ── PIC ─────────────────────────────────────────────────────────────────── */

const bacaPeta = async () => {
	try {
		const peta = JSON.parse((await Helpdesk.pengaturan()).pic_akun || '{}');
		return peta && typeof peta === 'object' ? peta : {};
	} catch {
		return {};
	}
};

async function picUntuk(program) {
	const peta = await bacaPeta();
	const pilihan = Number(peta[program.key]) || null;
	if (pilihan) {
		const u = await prisma.users.findFirst({ where: { id: BigInt(pilihan), is_active: true }, select: { id: true, name: true, bidang_id: true } });
		if (u) return { id: Number(u.id), name: u.name, diatur: true };
	}
	// staf bidang pemilik program; bidang tanpa staf aktif → pimpinan DPMD
	let calon = program.bidang_id ? await Helpdesk.petugas('bidang', { bidangId: program.bidang_id }) : [];
	if (!calon.length) calon = await Helpdesk.petugas('dpmd');
	return calon[0] ? { id: Number(calon[0].id), name: calon[0].name, diatur: false } : null;
}

/** Daftar program beserta PIC efektifnya — untuk panel pengaturan. */
async function daftarProgramPic() {
	const peta = await bacaPeta();
	const hasil = [];
	for (const p of PROGRAM_AKUN) {
		const pic = await picUntuk(p);
		hasil.push({ ...p, pic_id: Number(peta[p.key]) || null, pic_efektif: pic });
	}
	return hasil;
}

/* ── Akun sistem "Helpdesk DPMD" (pengirim di Pesan; tidak bisa login) ─────── */

let idSistem = null;
async function akunSistem() {
	if (idSistem) return idSistem;
	let u = await prisma.users.findUnique({ where: { email: EMAIL_SISTEM }, select: { id: true } });
	if (!u) {
		const kini = new Date();
		u = await prisma.users.create({
			data: {
				name: 'Helpdesk DPMD',
				email: EMAIL_SISTEM,
				password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
				role: 'helpdesk',
				is_active: false,
				created_at: kini,
				updated_at: kini,
			},
			select: { id: true },
		});
	}
	idSistem = u.id;
	return idSistem;
}

/* ── Token akses widget (tamu tidak punya sesi) ───────────────────────────── */

const kunciAkses = () => crypto.createHash('sha256').update(`${process.env.JWT_SECRET || ''}:helpdesk-sambung`).digest();
const tokenAkses = (tiketId) => crypto.createHmac('sha256', kunciAkses()).update(String(tiketId)).digest('base64url').slice(0, 32);
const tokenSah = (tiketId, token) => {
	const a = Buffer.from(tokenAkses(tiketId));
	const b = Buffer.from(String(token || ''));
	return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* ── Percakapan Pesan untuk satu tiket ───────────────────────────────────── */

const percakapanTiket = (tiketId) => prisma.conversations.findFirst({ where: { reference_type: REF, reference_id: BigInt(tiketId) } });

async function kirimKePesan(conv, senderId, isi) {
	const kini = new Date();
	const pesan = await prisma.messages.create({
		data: { conversation_id: conv.id, sender_id: BigInt(senderId), content: isi, message_type: 'text', created_at: kini, updated_at: kini },
		include: { sender: { select: { id: true, name: true, role: true, avatar: true } } },
	});
	await prisma.conversations.update({ where: { id: conv.id }, data: { last_message_at: kini, updated_at: kini } });
	try {
		const { serializeMessage } = require('../controllers/messaging.controller');
		const io = getIO();
		if (io) for (const uid of [conv.participant_one_id, conv.participant_two_id]) if (uid) io.to(`user_${Number(uid)}`).emit('new_message', serializeMessage(pesan));
	} catch (err) {
		logger.warn(`Helpdesk jembatan: gagal menyiarkan pesan: ${err.message}`);
	}
	return pesan;
}

const wilayahTeks = (w) => [w.desa_nama, w.kecamatan_nama && `Kec. ${w.kecamatan_nama}`].filter(Boolean).join(', ');

/**
 * Sambungkan penanya ke PIC program. Membuat tiket (kategori Akun) yang
 * dipegang PIC dan percakapan Pesan PIC ↔ Helpdesk DPMD berisi pesan pertama.
 */
async function sambung({ programKey, pesan, nama, akun, wilayah, whatsapp }) {
	const program = programByKey(programKey);
	if (!program) throw Object.assign(new Error('Program tidak dikenal'), { status: 400 });
	const pic = await picUntuk(program);
	if (!pic) throw Object.assign(new Error('PIC program ini belum tersedia'), { status: 503 });
	const kategori = (await Helpdesk.semuaKategori({ hanyaAktif: true })).find((k) => k.slug === 'akun') || null;
	const wil = wilayahTeks(wilayah);

	const { id, code } = await Helpdesk.buatTiket(
		{
			category_id: kategori?.id || null,
			target_level: program.bidang_id ? 'bidang' : 'dpmd',
			bidang_id: program.bidang_id || Helpdesk.BIDANG_SEKRETARIAT,
			kecamatan_id: wilayah.kecamatan_id,
			desa_id: wilayah.desa_id,
			user_id: akun?.id || null,
			reporter_name: nama,
			reporter_whatsapp: whatsapp || null,
			subject: `[${program.label}] ${pesan.split('\n')[0]}`.slice(0, 200),
			priority: 'normal',
		},
		[
			{ sender_type: 'sistem', body: `Disambungkan langsung ke PIC ${program.label}: ${pic.name}. Percakapan juga masuk ke Pesan PIC.` },
			{ sender_type: 'pelapor', sender_id: akun?.id, sender_name: nama, body: pesan },
		],
	);
	await Helpdesk.tambahPesan(id, { sender_type: 'sistem', body: `Ditangani ${pic.name}` }, { penanganId: pic.id, status: 'diproses' });

	const sistem = await akunSistem();
	const kini = new Date();
	const conv = await prisma.conversations.create({
		data: {
			type: 'dpmd_internal',
			reference_type: REF,
			reference_id: BigInt(id),
			participant_one_id: BigInt(pic.id),
			participant_two_id: sistem,
			created_by: sistem,
			created_at: kini,
			updated_at: kini,
		},
	});
	await kirimKePesan(
		conv,
		sistem,
		`🛟 Helpdesk ${code} · ${program.label}\nDari: ${nama}${wil ? ` (${wil})` : ''}${akun ? ' · akun terdaftar' : ' · tamu'}\n\n${pesan}\n\nBalas di sini — balasan Anda langsung tampil di chat penanya.`,
	);
	return { id, code, program, pic, k: tokenAkses(id) };
}

/** Isi percakapan untuk widget penanya (tanpa riwayat internal). */
async function benang(tiketId) {
	const tiket = await Helpdesk.tiketById(tiketId);
	if (!tiket) return null;
	const pesan = await Helpdesk.pesanTiket(tiketId);
	return {
		id: tiket.id,
		code: tiket.code,
		status: tiket.status,
		pesan: pesan
			.filter((m) => m.sender_type !== 'bot' && !(m.sender_type === 'sistem' && /^Ditangani /.test(m.body)))
			.map((m) => ({ id: m.id, dari: m.sender_type, nama: m.sender_name, isi: m.body, pada: m.created_at })),
	};
}

/** Balasan penanya dari widget → tiket + Pesan PIC. */
async function balasPenanya(tiketId, { isi, nama, akunId }) {
	const tiket = await Helpdesk.tiketById(tiketId);
	if (!tiket) return false;
	await Helpdesk.tambahPesan(tiketId, { sender_type: 'pelapor', sender_id: akunId, sender_name: nama || tiket.reporter_name, body: isi }, { status: tiket.status === 'selesai' ? 'diproses' : undefined });
	const conv = await percakapanTiket(tiketId);
	if (conv) await kirimKePesan(conv, await akunSistem(), `${nama || tiket.reporter_name}: ${isi}`);
	return true;
}

/**
 * Dipanggil dari fitur Pesan setiap ada pesan baru: balasan PIC di percakapan
 * Helpdesk diteruskan ke tiket sebagai balasan petugas.
 */
async function dariPesan(conv, pesan, pengirim) {
	if (conv?.reference_type !== REF || !conv.reference_id) return;
	if (Number(pengirim.id) === Number(await akunSistem())) return;
	await Helpdesk.tambahPesan(
		Number(conv.reference_id),
		{ sender_type: 'petugas', sender_id: Number(pengirim.id), sender_name: pengirim.name, body: pesan },
		{ status: 'dijawab', penanganId: Number(pengirim.id) },
	);
}

/** Balasan petugas dari panel Helpdesk ikut masuk ke percakapan Pesan tiketnya. */
async function dariPanel(tiketId, petugas, isi) {
	const conv = await percakapanTiket(tiketId);
	if (!conv) return;
	const peserta = [Number(conv.participant_one_id), Number(conv.participant_two_id)].includes(Number(petugas.id));
	await kirimKePesan(conv, peserta ? petugas.id : await akunSistem(), peserta ? isi : `${petugas.name} (panel Helpdesk): ${isi}`);
}

module.exports = { PROGRAM_AKUN, programByKey, niatAkun, picUntuk, daftarProgramPic, sambung, benang, balasPenanya, dariPesan, dariPanel, tokenSah, akunSistem };
