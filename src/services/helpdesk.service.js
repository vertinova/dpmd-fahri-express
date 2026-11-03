/**
 * Data Helpdesk: kategori, FAQ, tiket & pesannya, log chat bot, pengaturan,
 * penerima tiket, dan kontak WhatsApp penanggung jawab.
 *
 * Rantai penanggung jawab: KECAMATAN penanya -> BIDANG DPMD -> DPMD
 * (sekretaris dinas & superadmin). Kategori menentukan titik awalnya; orangnya
 * dicari saat itu juga dari tabel users, jadi pergantian pegawai atau nomor HP
 * tidak perlu disalin ke tabel helpdesk.
 *
 * Skema: migrations/20261102_create_helpdesk.sql. Kueri memakai sequelize.query
 * mentah dengan placeholder `?` (array di-expand menjadi daftar untuk IN (?)).
 * Koneksi Sequelize ber-zona +00:00, jadi semua DATETIME helpdesk tersimpan UTC
 * dan sampai ke browser sebagai ISO yang benar.
 */
const crypto = require('crypto');
const sequelize = require('../config/database');

const TINGKAT = ['kecamatan', 'bidang', 'dpmd'];
const STATUS_TIKET = ['baru', 'diproses', 'dijawab', 'selesai'];
const PRIORITAS = ['normal', 'tinggi'];
/** Bidang cadangan bila kategori tidak menyebut bidang: Sekretariat. */
const BIDANG_SEKRETARIAT = 2;
const PERAN_STAF_BIDANG = ['kepala_bidang', 'ketua_tim', 'pegawai', 'bendahara'];
const PERAN_DPMD_PUSAT = ['superadmin', 'sekretaris_dinas'];

/**
 * Kueri mentah dengan hasil seragam ala mysql2: SELECT -> array baris; tulis ->
 * { insertId, affectedRows }. Sequelize sendiri mengembalikan bentuk berbeda
 * menurut awalan SQL (INSERT INTO -> [insertId, affectedRows], UPDATE ->
 * [undefined, affectedRows], lainnya -> [header, header]).
 */
async function q(sql, params = [], transaction) {
	const [hasil, meta] = await sequelize.query(sql, { replacements: params, transaction });
	if (Array.isArray(hasil) || (hasil && typeof hasil === 'object')) return hasil;
	return {
		insertId: typeof hasil === 'number' ? hasil : undefined,
		affectedRows: typeof meta === 'number' ? meta : meta?.affectedRows ?? 0,
	};
}
const satu = async (sql, params, t) => (await q(sql, params, t))[0] || null;

/** 08xx / +628xx / 628xx -> 628xx. Nomor yang tidak masuk akal -> null. */
function nomorWa(telepon) {
	let d = String(telepon || '').replace(/\D/g, '');
	if (d.startsWith('0')) d = `62${d.slice(1)}`;
	else if (d.startsWith('8')) d = `62${d}`;
	return /^62\d{8,13}$/.test(d) ? d : null;
}

const aktif = (x) => ({ ...x, is_active: Number(x.is_active) === 1 });

/* ── Kategori & FAQ ──────────────────────────────────────────────────────── */

async function semuaKategori({ hanyaAktif = false } = {}) {
	const rows = await q(
		`SELECT c.*, b.nama AS bidang_nama
		   FROM helpdesk_categories c LEFT JOIN bidangs b ON b.id = c.bidang_id
		  ${hanyaAktif ? 'WHERE c.is_active = 1' : ''}
		  ORDER BY c.sort_order, c.id`
	);
	return rows.map(aktif);
}

async function simpanKategori(id, d) {
	const nilai = [d.name, d.slug, d.description || null, d.icon || 'tanya', d.target_level, d.bidang_id || null,
		d.keywords || null, Number(d.sort_order) || 0, d.is_active ? 1 : 0];
	if (id) {
		await q(
			`UPDATE helpdesk_categories SET name = ?, slug = ?, description = ?, icon = ?, target_level = ?, bidang_id = ?,
			   keywords = ?, sort_order = ?, is_active = ? WHERE id = ?`,
			[...nilai, id]
		);
		return id;
	}
	const r = await q(
		`INSERT INTO helpdesk_categories (name, slug, description, icon, target_level, bidang_id, keywords, sort_order, is_active)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		nilai
	);
	return r.insertId;
}

/* Kategori yang sudah dipakai tiket/FAQ tidak dihapus — cukup dinonaktifkan,
   supaya riwayat tiket tetap punya label. */
async function hapusKategori(id) {
	const r = await satu(
		`SELECT (SELECT COUNT(*) FROM helpdesk_tickets WHERE category_id = ?)
		      + (SELECT COUNT(*) FROM helpdesk_faqs WHERE category_id = ?) AS dipakai`,
		[id, id]
	);
	if (Number(r.dipakai) > 0) {
		await q('UPDATE helpdesk_categories SET is_active = 0 WHERE id = ?', [id]);
		return 'dinonaktifkan';
	}
	await q('DELETE FROM helpdesk_categories WHERE id = ?', [id]);
	return 'dihapus';
}

async function semuaFaq() {
	const rows = await q(
		`SELECT f.*, c.name AS category_name, c.bidang_id AS category_bidang_id
		   FROM helpdesk_faqs f LEFT JOIN helpdesk_categories c ON c.id = f.category_id
		  ORDER BY c.sort_order, f.id`
	);
	return rows.map(aktif);
}

const faqById = (id) => satu(
	'SELECT f.*, c.bidang_id AS category_bidang_id FROM helpdesk_faqs f LEFT JOIN helpdesk_categories c ON c.id = f.category_id WHERE f.id = ?',
	[id]
);

/** FAQ yang boleh dipakai bot untuk penanya ini (tamu atau akun login). */
function faqUntuk(login) {
	return q(
		`SELECT f.id, f.category_id, f.question, f.answer, f.keywords, f.action_label, f.action_url, f.hits
		   FROM helpdesk_faqs f JOIN helpdesk_categories c ON c.id = f.category_id
		  WHERE f.is_active = 1 AND c.is_active = 1 AND f.audience IN ('semua', ?)`,
		[login ? 'akun' : 'publik']
	);
}

/** Tombol aksi FAQ dalam bentuk yang dikirim ke widget, atau null. */
const aksiFaq = (f) => (f?.action_label && f?.action_url ? { label: f.action_label, url: f.action_url } : null);

async function faqPopuler(login, batas = 5) {
	const faqs = await faqUntuk(login);
	return faqs.sort((a, b) => (b.hits - a.hits) || (a.id - b.id)).slice(0, batas).map((f) => f.question);
}

async function simpanFaq(id, d, userId) {
	const nilai = [d.category_id, d.question, d.answer, d.keywords || null, d.audience,
		d.action_label || null, d.action_url || null, d.is_active ? 1 : 0, userId || null];
	if (id) {
		await q(
			`UPDATE helpdesk_faqs SET category_id = ?, question = ?, answer = ?, keywords = ?, audience = ?,
			   action_label = ?, action_url = ?, is_active = ?, updated_by = ? WHERE id = ?`,
			[...nilai, id]
		);
		return id;
	}
	const r = await q(
		`INSERT INTO helpdesk_faqs (category_id, question, answer, keywords, audience, action_label, action_url, is_active, updated_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		nilai
	);
	return r.insertId;
}

const hapusFaq = (id) => q('DELETE FROM helpdesk_faqs WHERE id = ?', [id]);

async function tambahHitFaq(ids) {
	if (!ids.length) return;
	await q('UPDATE helpdesk_faqs SET hits = hits + 1 WHERE id IN (?)', [ids]);
}

/* ── Log chat ────────────────────────────────────────────────────────────── */

async function catatChat({ userId, kategoriId, pertanyaan, terjawab, sumber, faqId }) {
	const r = await q(
		`INSERT INTO helpdesk_chat_logs (user_id, category_id, question, answered, source, faq_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[userId || null, kategoriId || null, String(pertanyaan).slice(0, 1000), terjawab ? 1 : 0, sumber, faqId || null]
	);
	return r.insertId;
}

/* Satu log hanya bisa dinilai sekali, dan hanya selama sehari. */
async function nilaiJawaban(logId, membantu) {
	const r = await q(
		`UPDATE helpdesk_chat_logs SET helpful = ?
		  WHERE id = ? AND helpful IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
		[membantu ? 1 : 0, logId]
	);
	return r.affectedRows > 0;
}

/* Bahan perbaikan FAQ: yang tidak terjawab, ditambah yang terjawab tetapi
   dinilai tidak membantu. `bidangId` membatasi ke kategori milik bidang itu. */
function pertanyaanTakTerjawab({ bidangId = null, batas = 150 } = {}) {
	return q(
		`SELECT l.id, l.question, l.created_at, l.category_id, l.answered, l.helpful, l.source,
		        c.name AS category_name, f.question AS faq_question
		   FROM helpdesk_chat_logs l
		   LEFT JOIN helpdesk_categories c ON c.id = l.category_id
		   LEFT JOIN helpdesk_faqs f ON f.id = l.faq_id
		  WHERE (l.answered = 0 OR l.helpful = 0) AND l.reviewed = 0
		    ${bidangId ? 'AND c.bidang_id = ?' : ''}
		  ORDER BY l.id DESC LIMIT ?`,
		[...(bidangId ? [bidangId] : []), batas]
	);
}

const tandaiLogDitinjau = (ids) => q('UPDATE helpdesk_chat_logs SET reviewed = 1 WHERE id IN (?)', [ids]);

async function ringkasanChat(hari = 30) {
	const r = await satu(
		`SELECT COUNT(*) AS total, COALESCE(SUM(answered), 0) AS terjawab,
		        COALESCE(SUM(source = 'ai'), 0) AS lewat_ai, COALESCE(SUM(source = 'faq'), 0) AS lewat_faq,
		        COALESCE(SUM(source = 'akun'), 0) AS lewat_akun, COALESCE(SUM(source = 'data'), 0) AS lewat_data,
		        COALESCE(SUM(helpful = 1), 0) AS membantu, COALESCE(SUM(helpful = 0), 0) AS tidak_membantu
		   FROM helpdesk_chat_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
		[hari]
	);
	return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

/* ── Pengaturan ──────────────────────────────────────────────────────────── */

async function pengaturan() {
	const rows = await q('SELECT setting_key, setting_value FROM helpdesk_settings');
	return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value || '']));
}

async function simpanPengaturan(data) {
	for (const [k, v] of Object.entries(data)) {
		await q(
			`INSERT INTO helpdesk_settings (setting_key, setting_value) VALUES (?, ?)
			 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
			[k, v == null ? '' : String(v)]
		);
	}
}

/* ── Akun, wilayah & bidang ──────────────────────────────────────────────── */

/** Akun penanya beserta wilayahnya. Akun desa mengambil kecamatan dari desanya. */
function akun(userId) {
	return satu(
		`SELECT u.id, u.name, u.role, u.no_hp, u.desa_id, u.bidang_id, u.operator_kecamatan,
		        COALESCE(u.kecamatan_id, d.kecamatan_id) AS kecamatan_id,
		        d.nama AS desa_nama, d.status_pemerintahan, k.nama AS kecamatan_nama, b.nama AS bidang_nama
		   FROM users u
		   LEFT JOIN desas d ON d.id = u.desa_id
		   LEFT JOIN kecamatans k ON k.id = COALESCE(u.kecamatan_id, d.kecamatan_id)
		   LEFT JOIN bidangs b ON b.id = u.bidang_id
		  WHERE u.id = ?`,
		[userId]
	);
}

const KOSONG = { kecamatan_id: null, desa_id: null, kecamatan_nama: null, desa_nama: null };

/** Desa yang dipilih tamu harus benar-benar milik kecamatan yang dipilih. */
async function wilayahSah(kecamatanId, desaId) {
	const kid = Number(kecamatanId) || null;
	if (!kid) return { ...KOSONG };
	const kec = await satu('SELECT id, nama FROM kecamatans WHERE id = ?', [kid]);
	if (!kec) return { ...KOSONG };
	const desa = Number(desaId)
		? await satu('SELECT id, nama FROM desas WHERE id = ? AND kecamatan_id = ?', [Number(desaId), kid])
		: null;
	return { kecamatan_id: kec.id, desa_id: desa?.id || null, kecamatan_nama: kec.nama, desa_nama: desa?.nama || null };
}

const daftarKecamatan = () => q('SELECT id, nama FROM kecamatans ORDER BY nama');
const daftarDesa = (kecamatanId) => q(
	'SELECT id, nama, status_pemerintahan FROM desas WHERE kecamatan_id = ? ORDER BY nama',
	[kecamatanId]
);
const daftarBidang = () => q('SELECT id, nama FROM bidangs ORDER BY id');
const bidangById = (id) => satu('SELECT id, nama FROM bidangs WHERE id = ?', [id]);

/* Penerima tiket di satu tingkat. Akun utama kecamatan didahulukan dari akun
   operatornya, dan akun bernomor HP didahulukan untuk kontak WhatsApp. */
function petugas(tingkat, { kecamatanId, bidangId } = {}) {
	if (tingkat === 'kecamatan') {
		if (!kecamatanId) return Promise.resolve([]);
		return q(
			`SELECT id, name, no_hp FROM users
			  WHERE role = 'kecamatan' AND kecamatan_id = ? AND is_active = 1
			  ORDER BY operator_kecamatan, (TRIM(COALESCE(no_hp, '')) <> '') DESC, id`,
			[kecamatanId]
		);
	}
	if (tingkat === 'bidang') {
		if (!bidangId) return Promise.resolve([]);
		return q(
			`SELECT id, name, no_hp FROM users
			  WHERE bidang_id = ? AND role IN (?) AND is_active = 1
			  ORDER BY FIELD(role, 'kepala_bidang', 'ketua_tim', 'pegawai', 'bendahara'), id`,
			[bidangId, PERAN_STAF_BIDANG]
		);
	}
	return q(
		`SELECT id, name, no_hp FROM users WHERE role IN (?) AND is_active = 1
		  ORDER BY FIELD(role, 'sekretaris_dinas', 'superadmin'), id`,
		[PERAN_DPMD_PUSAT]
	);
}

async function penerimaTiket(tingkat, tujuan) {
	return (await petugas(tingkat, tujuan)).map((u) => u.id);
}

/**
 * Kontak WhatsApp penanggung jawab mulai dari `tingkatAwal`. Bila tingkat itu
 * belum punya nomor, naik ke tingkat berikutnya — penanya selalu mendapat
 * seseorang untuk dihubungi.
 *
 * @param {'kecamatan'|'bidang'|'dpmd'} tingkatAwal
 * @param {{kecamatan_id, kecamatan_nama}} wilayah
 * @param {number|null} bidangId  bidang kategori (cadangan: Sekretariat)
 */
async function cariKontak(tingkatAwal, wilayah, bidangId) {
	const set = await pengaturan();
	const urutan = TINGKAT.slice(Math.max(0, TINGKAT.indexOf(tingkatAwal)));
	const idBidang = bidangId || BIDANG_SEKRETARIAT;

	for (const tingkat of urutan) {
		if (tingkat === 'kecamatan') {
			if (!wilayah.kecamatan_id) continue;
			const orang = (await petugas('kecamatan', { kecamatanId: wilayah.kecamatan_id })).find((u) => nomorWa(u.no_hp));
			if (orang) {
				return {
					tingkat, nama: `Kecamatan ${wilayah.kecamatan_nama || ''}`.trim(), pengelola: orang.name,
					whatsapp: nomorWa(orang.no_hp), dialihkan: tingkat !== tingkatAwal,
				};
			}
		} else if (tingkat === 'bidang') {
			const bidang = await bidangById(idBidang);
			const waSetel = nomorWa(set[`wa_bidang_${idBidang}`]);
			const orang = waSetel ? null : (await petugas('bidang', { bidangId: idBidang })).find((u) => nomorWa(u.no_hp));
			if (waSetel || orang) {
				return {
					tingkat, nama: bidang?.nama || 'Bidang DPMD', pengelola: orang?.name || null,
					whatsapp: waSetel || nomorWa(orang.no_hp), dialihkan: tingkat !== tingkatAwal,
				};
			}
		} else {
			return {
				tingkat, nama: set.dpmd_nama || 'DPMD Kabupaten Bogor', pengelola: null,
				whatsapp: nomorWa(set.dpmd_whatsapp), dialihkan: tingkat !== tingkatAwal,
			};
		}
	}
	return null;
}

/* ── Tiket ───────────────────────────────────────────────────────────────── */

const kodeTiket = () => {
	const t = new Date();
	const tgl = `${String(t.getFullYear()).slice(2)}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
	return `HD-${tgl}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

async function buatTiket(d, pesanAwal) {
	return sequelize.transaction(async (t) => {
		let id;
		let code;
		/* Kode acak 6 heksa per hari; tabrakan sangat jarang tapi tetap ditangani. */
		for (let coba = 0; coba < 5 && !id; coba += 1) {
			code = kodeTiket();
			const ada = await satu('SELECT id FROM helpdesk_tickets WHERE code = ?', [code], t);
			if (ada) continue;
			const r = await q(
				`INSERT INTO helpdesk_tickets (code, category_id, target_level, bidang_id, kecamatan_id, desa_id, user_id,
				   reporter_name, reporter_whatsapp, subject, priority)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[code, d.category_id, d.target_level, d.bidang_id, d.kecamatan_id, d.desa_id, d.user_id,
					d.reporter_name, d.reporter_whatsapp, d.subject, d.priority || 'normal'],
				t
			);
			id = r.insertId;
		}
		if (!id) throw new Error('Gagal membuat kode tiket unik');
		for (const p of pesanAwal) {
			await q(
				'INSERT INTO helpdesk_messages (ticket_id, sender_type, sender_id, sender_name, body) VALUES (?, ?, ?, ?, ?)',
				[id, p.sender_type, p.sender_id || null, p.sender_name || null, p.body],
				t
			);
		}
		return { id, code };
	});
}

const KOLOM_TIKET = `
  t.*, c.name AS category_name, c.icon AS category_icon,
  b.nama AS bidang_nama, k.nama AS kecamatan_nama, d.nama AS desa_nama, h.name AS handled_by_name,
  (SELECT COUNT(*) FROM helpdesk_messages m WHERE m.ticket_id = t.id) AS jumlah_pesan,
  (SELECT m.sender_type FROM helpdesk_messages m WHERE m.ticket_id = t.id AND m.sender_type <> 'sistem' ORDER BY m.id DESC LIMIT 1) AS pengirim_terakhir`;

const JOIN_TIKET = `
  FROM helpdesk_tickets t
  LEFT JOIN helpdesk_categories c ON c.id = t.category_id
  LEFT JOIN bidangs b ON b.id = t.bidang_id
  LEFT JOIN kecamatans k ON k.id = t.kecamatan_id
  LEFT JOIN desas d ON d.id = t.desa_id
  LEFT JOIN users h ON h.id = t.handled_by`;

const tiketById = (id) => satu(`SELECT ${KOLOM_TIKET} ${JOIN_TIKET} WHERE t.id = ?`, [id]);
const tiketByKode = (code) => satu(`SELECT ${KOLOM_TIKET} ${JOIN_TIKET} WHERE t.code = ?`, [code]);
const tiketMilik = (userId) => q(
	`SELECT ${KOLOM_TIKET} ${JOIN_TIKET} WHERE t.user_id = ? ORDER BY t.last_message_at DESC LIMIT 50`,
	[userId]
);

/** Kondisi WHERE untuk cakupan petugas — dibaca dari akun, bukan query string. */
function kondisiCakupan(cakupan) {
	if (cakupan.tingkat === 'kecamatan') return { sql: "t.target_level = 'kecamatan' AND t.kecamatan_id = ?", param: [cakupan.kecamatanId] };
	if (cakupan.tingkat === 'bidang') return { sql: "t.target_level = 'bidang' AND t.bidang_id = ?", param: [cakupan.bidangId] };
	return { sql: '1 = 1', param: [] };
}

async function daftarTiket(cakupan, { status, tingkat, bidang, prioritas, cari } = {}) {
	const { sql, param } = kondisiCakupan(cakupan);
	const where = [sql];
	const p = [...param];
	if (cakupan.tingkat === 'dpmd' && TINGKAT.includes(tingkat)) { where.push('t.target_level = ?'); p.push(tingkat); }
	if (cakupan.tingkat === 'dpmd' && Number(bidang)) { where.push('t.bidang_id = ?'); p.push(Number(bidang)); }
	if (STATUS_TIKET.includes(status)) { where.push('t.status = ?'); p.push(status); }
	if (status === 'terbuka') where.push("t.status <> 'selesai'");
	if (PRIORITAS.includes(prioritas)) { where.push('t.priority = ?'); p.push(prioritas); }
	if (cari) {
		where.push('(t.code LIKE ? OR t.subject LIKE ? OR t.reporter_name LIKE ? OR d.nama LIKE ?)');
		const pola = `%${cari}%`;
		p.push(pola, pola, pola, pola);
	}
	return q(
		`SELECT ${KOLOM_TIKET} ${JOIN_TIKET}
		  WHERE ${where.join(' AND ')}
		  ORDER BY FIELD(t.status, 'baru', 'diproses', 'dijawab', 'selesai'), t.priority = 'tinggi' DESC, t.last_message_at DESC
		  LIMIT 300`,
		p
	);
}

async function hitungTiketBaru(cakupan) {
	const { sql, param } = kondisiCakupan(cakupan);
	const r = await satu(`SELECT COUNT(*) AS n FROM helpdesk_tickets t WHERE ${sql} AND t.status = 'baru'`, param);
	return Number(r.n);
}

/**
 * Statistik panel untuk cakupan petugas: jumlah per status, waktu tanggap
 * pertama, kepuasan pelapor, kategori teramai, dan tren 14 hari.
 */
async function statistik(cakupan, hari = 30) {
	const { sql, param } = kondisiCakupan(cakupan);
	const dasar = `FROM helpdesk_tickets t WHERE ${sql}`;
	const [ringkas, kategori, tren, tertunda] = await Promise.all([
		satu(
			`SELECT COUNT(*) AS total,
			        COALESCE(SUM(t.status = 'baru'), 0) AS baru, COALESCE(SUM(t.status = 'diproses'), 0) AS diproses,
			        COALESCE(SUM(t.status = 'dijawab'), 0) AS dijawab, COALESCE(SUM(t.status = 'selesai'), 0) AS selesai,
			        COALESCE(SUM(t.priority = 'tinggi' AND t.status <> 'selesai'), 0) AS mendesak,
			        AVG(TIMESTAMPDIFF(MINUTE, t.created_at, t.first_response_at)) AS menit_tanggap,
			        AVG(t.rating) AS rating, COALESCE(SUM(t.rating IS NOT NULL), 0) AS jumlah_rating
			   ${dasar} AND t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
			[...param, hari]
		),
		q(
			`SELECT COALESCE(c.name, 'Tanpa kategori') AS nama, COUNT(*) AS jumlah
			   FROM helpdesk_tickets t LEFT JOIN helpdesk_categories c ON c.id = t.category_id
			  WHERE ${sql} AND t.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
			  GROUP BY c.name ORDER BY jumlah DESC LIMIT 6`,
			[...param, hari]
		),
		q(
			`SELECT DATE(t.created_at) AS tanggal, COUNT(*) AS jumlah
			   ${dasar} AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
			  GROUP BY DATE(t.created_at) ORDER BY tanggal`,
			param
		),
		satu(`SELECT COUNT(*) AS n ${dasar} AND t.status = 'baru' AND t.last_message_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)`, param),
	]);
	const angka = Object.fromEntries(Object.entries(ringkas).map(([k, v]) => [k, v == null ? null : Number(v)]));
	return {
		...angka,
		terlambat: Number(tertunda.n),
		kategori: kategori.map((k) => ({ nama: k.nama, jumlah: Number(k.jumlah) })),
		tren: tren.map((x) => ({ tanggal: x.tanggal, jumlah: Number(x.jumlah) })),
	};
}

function pesanTiket(ticketId) {
	return q(
		'SELECT id, sender_type, sender_id, sender_name, body, created_at FROM helpdesk_messages WHERE ticket_id = ? ORDER BY id',
		[ticketId]
	);
}

async function tambahPesan(ticketId, { sender_type, sender_id, sender_name, body }, { status, penanganId } = {}) {
	await q(
		'INSERT INTO helpdesk_messages (ticket_id, sender_type, sender_id, sender_name, body) VALUES (?, ?, ?, ?, ?)',
		[ticketId, sender_type, sender_id || null, sender_name || null, body]
	);
	const set = ['last_message_at = NOW()'];
	const p = [];
	if (status) { set.push('status = ?'); p.push(status); }
	if (penanganId) { set.push('handled_by = COALESCE(handled_by, ?)'); p.push(penanganId); }
	if (sender_type === 'petugas') set.push('first_response_at = COALESCE(first_response_at, NOW())');
	await q(`UPDATE helpdesk_tickets SET ${set.join(', ')} WHERE id = ?`, [...p, ticketId]);
}

const ubahStatus = (id, status) => q('UPDATE helpdesk_tickets SET status = ? WHERE id = ?', [status, id]);
const ubahPrioritas = (id, prioritas) => q('UPDATE helpdesk_tickets SET priority = ? WHERE id = ?', [prioritas, id]);

async function pindahTujuan(id, { tingkat, bidangId }) {
	await q(
		`UPDATE helpdesk_tickets SET target_level = ?, bidang_id = COALESCE(?, bidang_id), status = 'baru',
		   handled_by = NULL, last_message_at = NOW(), reminded_at = NULL WHERE id = ?`,
		[tingkat, bidangId || null, id]
	);
}

/* Penilaian hanya sekali, dan hanya untuk tiket yang sudah ditanggapi. */
async function nilaiTiket(id, rating, catatan) {
	const r = await q(
		`UPDATE helpdesk_tickets SET rating = ?, rating_note = ?
		  WHERE id = ? AND rating IS NULL AND status IN ('dijawab', 'selesai')`,
		[rating, catatan || null, id]
	);
	return r.affectedRows > 0;
}

/* Tiket yang menunggu balasan petugas lebih dari sehari dan belum diingatkan
   dalam sehari terakhir. Patokannya pesan terakhir, karena balasan pelapor
   mengembalikan status ke 'baru'. */
function tiketPerluPengingat() {
	return q(
		`SELECT t.id, t.code, t.subject, t.reporter_name, t.target_level, t.bidang_id, t.kecamatan_id, t.handled_by,
		        TIMESTAMPDIFF(HOUR, t.last_message_at, NOW()) AS jam_menunggu, k.nama AS kecamatan_nama, b.nama AS bidang_nama
		   FROM helpdesk_tickets t
		   LEFT JOIN kecamatans k ON k.id = t.kecamatan_id
		   LEFT JOIN bidangs b ON b.id = t.bidang_id
		  WHERE t.status = 'baru'
		    AND t.last_message_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
		    AND (t.reminded_at IS NULL OR t.reminded_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR))
		  ORDER BY t.last_message_at
		  LIMIT 200`
	);
}

const tandaiDiingatkan = (ids) => q('UPDATE helpdesk_tickets SET reminded_at = NOW() WHERE id IN (?)', [ids]);

module.exports = {
	TINGKAT,
	STATUS_TIKET,
	PRIORITAS,
	BIDANG_SEKRETARIAT,
	q,
	satu,
	nomorWa,
	semuaKategori,
	simpanKategori,
	hapusKategori,
	semuaFaq,
	faqById,
	faqUntuk,
	aksiFaq,
	faqPopuler,
	simpanFaq,
	hapusFaq,
	tambahHitFaq,
	catatChat,
	nilaiJawaban,
	pertanyaanTakTerjawab,
	tandaiLogDitinjau,
	ringkasanChat,
	pengaturan,
	simpanPengaturan,
	akun,
	wilayahSah,
	daftarKecamatan,
	daftarDesa,
	daftarBidang,
	bidangById,
	petugas,
	penerimaTiket,
	cariKontak,
	buatTiket,
	tiketById,
	tiketByKode,
	tiketMilik,
	daftarTiket,
	hitungTiketBaru,
	statistik,
	pesanTiket,
	tambahPesan,
	ubahStatus,
	ubahPrioritas,
	pindahTujuan,
	nilaiTiket,
	tiketPerluPengingat,
	tandaiDiingatkan,
};
