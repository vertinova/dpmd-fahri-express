/**
 * Jawaban Helpdesk dari data akun penanya: tiket Helpdesk miliknya, tahapan
 * proposal Bantuan Keuangan Perubahan desanya (atau antrean verifikasi untuk
 * akun kecamatan), dan hasil verifikasi aparatur desanya.
 *
 * Sengaja tanpa AI. "Proposal saya sampai mana?" hanya bisa dijawab benar dari
 * basis data, dan model bahasa tidak menambah apa-apa selain risiko salah
 * menyebut tahap.
 */
const Helpdesk = require('./helpdesk.service');

/* Pertanyaan baru dianggap personal bila menyebut diri sendiri DAN menanyakan
   keadaan, supaya "bagaimana alur bankeu?" tetap dijawab FAQ umum. */
const DIRI = /\b(saya|sy|aku|kami|kita|desaku|desa ?(saya|kami|kita)|kecamatan ?(saya|kami)|punya ?(saya|kami)|ku)\b/;
const BANKEU = /bankeu|bantuan keuangan|proposal/;
const APARATUR = /aparatur|perangkat desa|nipd|kepala desa|kades|sekdes/;
const TIKET = /\btiket\b|\blaporan (saya|kami)\b|pengaduan (saya|kami)/;
const KEADAAN = /status|sampai mana|sdh sampai|udah sampai|progres|proses|kapan|udah|sudah|sdh|belum|blm|ditolak|tolak|revisi|lama|cek|gimana|gmn|bagaimana|masih|verifikasi|disetujui|diterima|dijawab|dibalas|balasan|antre|antri|menunggu/;

const normal = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ');

/**
 * @param {string} pesan
 * @param {object|null} akun  Helpdesk.akun() penanya (null = tamu)
 * @returns {'tiket'|'bankeu'|'aparatur'|null}
 */
function niatPribadi(pesan, akun) {
	const t = normal(pesan);
	const soalTiket = TIKET.test(t) && (DIRI.test(t) || KEADAAN.test(t));
	if (!akun) return soalTiket ? 'tiket' : null;
	if (soalTiket) return 'tiket';
	const desa = akun.role === 'desa' && akun.desa_id;
	const kec = akun.role === 'kecamatan' && akun.kecamatan_id;
	if ((desa || kec) && BANKEU.test(t) && (DIRI.test(t) || KEADAAN.test(t))) return 'bankeu';
	if (desa && APARATUR.test(t) && DIRI.test(t) && KEADAAN.test(t)) return 'aparatur';
	return null;
}

const STATUS_TIKET = { baru: 'menunggu jawaban', diproses: 'sedang diproses', dijawab: 'sudah dijawab', selesai: 'selesai' };

function jawabTiket(tiket) {
	if (!tiket.length) {
		return { jawaban: 'Anda belum pernah membuat tiket Helpdesk. Bila pertanyaan belum terjawab di sini, buat tiket dan petugas yang berwenang akan menjawabnya.', kategoriSlug: null, pemegang: null, aksi: [] };
	}
	const terbuka = tiket.filter((x) => x.status !== 'selesai');
	const daftar = (terbuka.length ? terbuka : tiket).slice(0, 5)
		.map((x) => `- **${x.code}** — ${x.subject}: ${STATUS_TIKET[x.status]}${x.status !== 'selesai' ? ` (di ${x.target_level === 'kecamatan' ? `Kecamatan ${x.kecamatan_nama || ''}` : x.target_level === 'bidang' ? x.bidang_nama || 'bidang DPMD' : 'DPMD'})` : ''}`);
	return {
		jawaban: `${terbuka.length ? `Anda punya **${terbuka.length} tiket** yang masih berjalan:` : 'Semua tiket Anda sudah selesai. Tiket terakhir:'}\n${daftar.join('\n')}`,
		kategoriSlug: null,
		pemegang: null,
		aksi: [{ label: 'Buka Tiket Saya', url: '#tiket-saya' }],
	};
}

function jawabTiketTamu() {
	return {
		jawaban: 'Tiket yang Anda buat bisa dicek di menu **Tiket Saya** (ikon tiket di atas). Dari perangkat lain, masukkan kode tiket dan nomor WhatsApp yang Anda isi saat membuat tiket.',
		kategoriSlug: null,
		pemegang: null,
		aksi: [{ label: 'Buka Tiket Saya', url: '#tiket-saya' }],
	};
}

/* Tahap satu proposal Bankeu Perubahan, dari kolom status berjenjang. */
function tahapProposal(p) {
	if (p.dpmd_status === 'approved') return 'disetujui';
	if (['revision', 'rejected'].includes(p.dpmd_status)) return 'revisi_dpmd';
	if (p.submitted_to_dpmd) return 'di_dpmd';
	if (['revision', 'rejected'].includes(p.kecamatan_status) || p.status === 'revision' || p.status === 'rejected') return 'revisi_kecamatan';
	if (p.submitted_to_kecamatan) return 'di_kecamatan';
	return 'draf';
}
const LABEL_TAHAP = {
	draf: 'masih draf (belum dikirim ke kecamatan)',
	di_kecamatan: 'sedang diverifikasi kecamatan',
	revisi_kecamatan: 'perlu perbaikan dari catatan kecamatan',
	di_dpmd: 'sedang diverifikasi DPMD',
	revisi_dpmd: 'perlu perbaikan dari catatan DPMD',
	disetujui: 'disetujui DPMD',
};

async function jawabBankeu(akun) {
	if (akun.role === 'kecamatan') {
		const r = await Helpdesk.satu(
			`SELECT COUNT(*) AS n, MAX(tahun_anggaran) AS tahun FROM bankeu_perubahan_proposals
			  WHERE kecamatan_id = ? AND submitted_to_kecamatan = 1 AND COALESCE(kecamatan_status, 'pending') IN ('pending', 'in_review')`,
			[akun.kecamatan_id]
		);
		return {
			jawaban: Number(r.n)
				? `Ada **${r.n} proposal Bankeu Perubahan** dari desa di Kecamatan ${akun.kecamatan_nama} yang menunggu verifikasi kecamatan.`
				: `Tidak ada proposal Bankeu Perubahan yang menunggu verifikasi Kecamatan ${akun.kecamatan_nama} saat ini.`,
			kategoriSlug: 'bankeu',
			pemegang: null,
			aksi: [{ label: 'Buka verifikasi Bankeu Perubahan', url: '/kecamatan/bankeu-perubahan' }],
		};
	}

	const proposal = await Helpdesk.q(
		`SELECT judul_proposal, status, kecamatan_status, kecamatan_catatan, dpmd_status, dpmd_catatan,
		        submitted_to_kecamatan, submitted_to_dpmd, tahun_anggaran
		   FROM bankeu_perubahan_proposals
		  WHERE desa_id = ? AND tahun_anggaran = (SELECT MAX(tahun_anggaran) FROM bankeu_perubahan_proposals WHERE desa_id = ?)
		  ORDER BY id`,
		[akun.desa_id, akun.desa_id]
	);
	if (!proposal.length) {
		return {
			jawaban: `Belum ada proposal Bantuan Keuangan Perubahan dari Desa ${akun.desa_nama} yang tercatat di sistem.`,
			kategoriSlug: 'bankeu',
			pemegang: null,
			aksi: [{ label: 'Buka Bankeu Perubahan', url: '/desa/bankeu-perubahan' }],
		};
	}
	const hitung = {};
	proposal.forEach((p) => { const k = tahapProposal(p); hitung[k] = (hitung[k] || 0) + 1; });
	const ringkas = Object.entries(LABEL_TAHAP).filter(([k]) => hitung[k]).map(([k, l]) => `- ${hitung[k]} proposal ${l}`);
	const revisi = proposal.filter((p) => ['revisi_kecamatan', 'revisi_dpmd'].includes(tahapProposal(p))).slice(0, 3)
		.map((p) => {
			const catatan = tahapProposal(p) === 'revisi_dpmd' ? p.dpmd_catatan : p.kecamatan_catatan;
			return `- **${p.judul_proposal}**${catatan ? `: "${String(catatan).trim().slice(0, 180)}"` : ''}`;
		});
	/* Urusan diarahkan ke pihak yang sedang memegang proposal. */
	const pemegang = hitung.revisi_kecamatan || hitung.di_kecamatan ? 'kecamatan' : hitung.revisi_dpmd || hitung.di_dpmd ? 'bidang' : null;
	return {
		jawaban: [
			`Proposal Bankeu Perubahan Desa ${akun.desa_nama} (TA ${proposal[0].tahun_anggaran}), total **${proposal.length}**:`,
			...ringkas,
			...(revisi.length ? ['', 'Yang perlu diperbaiki:', ...revisi] : []),
		].join('\n'),
		kategoriSlug: 'bankeu',
		pemegang,
		aksi: [{ label: 'Buka Bankeu Perubahan', url: '/desa/bankeu-perubahan' }],
	};
}

async function jawabAparatur(akun) {
	const r = await Helpdesk.satu(
		`SELECT COUNT(*) AS total,
		        COALESCE(SUM(status_verifikasi = 'terverifikasi'), 0) AS terverifikasi,
		        COALESCE(SUM(status_verifikasi = 'ditolak'), 0) AS ditolak,
		        COALESCE(SUM(status_verifikasi IS NULL OR status_verifikasi = ''), 0) AS belum
		   FROM aparatur_desa WHERE desa_id = ? AND status = 'Aktif'`,
		[akun.desa_id]
	);
	const total = Number(r.total);
	if (!total) {
		return {
			jawaban: `Belum ada aparatur aktif Desa ${akun.desa_nama} yang tercatat di sistem.`,
			kategoriSlug: 'aparatur', pemegang: null, aksi: [{ label: 'Buka Aparatur Desa', url: '/desa/aparatur-desa' }],
		};
	}
	return {
		jawaban: [
			`Aparatur aktif Desa ${akun.desa_nama}: **${total} orang**.`,
			`- ${Number(r.terverifikasi)} terverifikasi`,
			`- ${Number(r.ditolak)} perlu perbaikan (lihat catatan verifikasi pada datanya)`,
			`- ${Number(r.belum)} belum diverifikasi`,
		].join('\n'),
		kategoriSlug: 'aparatur',
		pemegang: Number(r.ditolak) ? 'bidang' : null,
		aksi: [{ label: 'Buka Aparatur Desa', url: '/desa/aparatur-desa' }],
	};
}

module.exports = { niatPribadi, jawabTiket, jawabTiketTamu, jawabBankeu, jawabAparatur };
