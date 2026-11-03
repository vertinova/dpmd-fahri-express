#!/usr/bin/env node
/**
 * Isi bumdes.diisi_desa_at / diisi_desa_oleh untuk riwayat SEBELUM kolomnya ada.
 *
 * Sampai 2026-11, simpan formulir BUM Desa oleh akun desa tidak meninggalkan
 * jejak di basis data (updated_at pun tidak berubah — seluruh 415 baris
 * bertanggal impor CSV 2026-08-27). Jejak yang tersisa:
 *   1. log aplikasi pm2: "BUMDES updated: <id> by desa" dan
 *      "BUMDES created for desa_id: <d>, id: <id> by user <uid> (desa)" (UTC);
 *   2. activity_logs: simpan BUM Desa oleh peran desa (entity_type bumdes) dan
 *      produk hukum yang dibuat desa dari formulir BUM Desa (dipetakan lewat
 *      kolom tautan produk_hukum_perdes_id / produk_hukum_sk_bumdes_id).
 *
 * Hanya MENGISI: baris yang sudah punya diisi_desa_at lebih baru (dari simpan
 * sesudah fitur ini terpasang) tidak disentuh. updated_at tidak diubah.
 *
 *   node scripts/bumdes-import/tandai-isian-desa.js              # simulasi
 *   node scripts/bumdes-import/tandai-isian-desa.js --tulis      # tulis
 *   node scripts/bumdes-import/tandai-isian-desa.js --log=/jalur/a.log,/jalur/b.log
 */
require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const prisma = require('../../src/config/prisma');

const TULIS = process.argv.includes('--tulis');
const argLog = process.argv.find((a) => a.startsWith('--log='));
const BERKAS_LOG = argLog
	? argLog.slice('--log='.length).split(',').filter(Boolean)
	: ['/root/.pm2/logs/dpmd-backend-out.log'];

const POLA_UBAH = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*BUMDES updated: (\d+) by desa\b/;
const POLA_BUAT = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*BUMDES created for desa_id: \d+, id: (\d+) by user (\d+) \(desa\)/;
const utc = (teks) => new Date(`${teks.replace(' ', 'T')}Z`);

/** id bumdes → { at: Date terbaru, oleh: users.id | null, sumber: Set } */
const temuan = new Map();
const catat = (id, at, oleh, sumber) => {
	if (!id || Number.isNaN(at.getTime())) return;
	const lama = temuan.get(id);
	if (!lama) {
		temuan.set(id, { at, oleh: oleh || null, sumber: new Set([sumber]) });
		return;
	}
	lama.sumber.add(sumber);
	if (at > lama.at) {
		lama.at = at;
		if (oleh) lama.oleh = oleh;
	} else if (!lama.oleh && oleh) {
		lama.oleh = oleh;
	}
};

const bacaLog = async (jalur) => {
	if (!fs.existsSync(jalur)) {
		console.log(`  (lewati: ${jalur} tidak ada)`);
		return 0;
	}
	let n = 0;
	const rl = readline.createInterface({ input: fs.createReadStream(jalur, { encoding: 'latin1' }), crlfDelay: Infinity });
	for await (const baris of rl) {
		if (!baris.includes('BUMDES ')) continue;
		let m = baris.match(POLA_UBAH);
		if (m) {
			catat(Number(m[2]), utc(m[1]), null, 'log-ubah');
			n += 1;
			continue;
		}
		m = baris.match(POLA_BUAT);
		if (m) {
			catat(Number(m[2]), utc(m[1]), BigInt(m[3]), 'log-buat');
			n += 1;
		}
	}
	return n;
};

(async () => {
	console.log(TULIS ? '▶ MODE TULIS' : '▶ SIMULASI (tidak menulis apa pun — tambahkan --tulis untuk menyimpan)');

	console.log('\n1. Log aplikasi');
	for (const jalur of BERKAS_LOG) {
		const n = await bacaLog(jalur);
		console.log(`  ${jalur}: ${n} baris cocok`);
	}

	console.log('\n2. activity_logs');
	const simpan = await prisma.$queryRawUnsafe(
		"SELECT entity_id, user_id, created_at FROM activity_logs WHERE module = 'bumdes' AND entity_type = 'bumdes' AND user_role = 'desa' AND entity_id IS NOT NULL"
	);
	simpan.forEach((r) => catat(Number(r.entity_id), new Date(r.created_at), r.user_id ? BigInt(r.user_id) : null, 'aktivitas-simpan'));
	console.log(`  simpan BUM Desa oleh desa: ${simpan.length}`);

	const dokumen = await prisma.$queryRawUnsafe(
		`SELECT b.id AS bumdes_id, a.user_id, a.created_at
		   FROM activity_logs a
		   JOIN bumdes b ON b.produk_hukum_perdes_id = JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.id'))
		                 OR b.produk_hukum_sk_bumdes_id = JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.id'))
		  WHERE a.module = 'bumdes' AND a.entity_type = 'produk_hukum' AND a.user_role = 'desa'`
	);
	dokumen.forEach((r) => catat(Number(r.bumdes_id), new Date(r.created_at), r.user_id ? BigInt(r.user_id) : null, 'aktivitas-dokumen'));
	console.log(`  dokumen dari formulir BUM Desa yang tertaut: ${dokumen.length}`);

	// Hanya id yang memang ada, dan hanya yang belum punya jejak lebih baru.
	const ada = await prisma.bumdes.findMany({
		where: { id: { in: [...temuan.keys()] } },
		select: { id: true, diisi_desa_at: true },
	});
	const rencana = ada
		.map((b) => ({ id: b.id, ...temuan.get(b.id), sekarang: b.diisi_desa_at }))
		.filter((r) => !r.sekarang || r.sekarang < r.at);
	const total = await prisma.bumdes.count();

	console.log('\n3. Ringkasan');
	console.log(`  BUM Desa ditemukan pernah diisi desa : ${ada.length} dari ${total}`);
	console.log(`  akan ditandai / diperbarui          : ${rencana.length}`);
	console.log(`  tetap "data lama"                    : ${total - ada.length}`);
	const perBulan = {};
	rencana.forEach((r) => {
		const k = r.at.toISOString().slice(0, 7);
		perBulan[k] = (perBulan[k] || 0) + 1;
	});
	console.log('  menurut bulan isian terakhir        :', JSON.stringify(perBulan));
	rencana.slice(0, 5).forEach((r) => console.log(`    contoh id ${r.id}: ${r.at.toISOString()} oleh ${r.oleh ?? '-'} [${[...r.sumber].join(', ')}]`));

	if (!TULIS) {
		console.log('\nSimulasi selesai. Jalankan ulang dengan --tulis untuk menyimpan.');
		process.exit(0);
	}

	let ditulis = 0;
	for (const r of rencana) {
		await prisma.bumdes.update({
			where: { id: r.id },
			data: { diisi_desa_at: r.at, ...(r.oleh ? { diisi_desa_oleh: r.oleh } : {}) },
		});
		ditulis += 1;
	}
	console.log(`\n✅ ${ditulis} BUM Desa ditandai.`);
	process.exit(0);
})().catch((e) => {
	console.error('GAGAL:', e);
	process.exit(1);
});
