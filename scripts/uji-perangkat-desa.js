#!/usr/bin/env node
/**
 * Uji ujung-ke-ujung fitur Perangkat Desa di bidang Pemdes — lewat API sungguhan.
 *
 *   node scripts/uji-perangkat-desa.js            # desa pertama yang ditemukan
 *   node scripts/uji-perangkat-desa.js --desa=14  # desa tertentu
 *
 * Yang diuji:
 *   1. Login superadmin.
 *   2. Bidang menambah perangkat untuk desa terpilih (berkas SK terakhir + KTP),
 *      dan NIPD kiriman manual DIABAIKAN.
 *   3. Detail membawa item verifikasi, info NIPD, dan kode lokasi tugas.
 *   4. Verifikasi per item: sebagian → belum diputus; tidak sesuai tanpa
 *      alasan → ditolak 400; tidak sesuai beralasan → status ditolak.
 *   5. Semua sesuai → terverifikasi + NIPD 20 digit tepat sesuai rumus.
 *   6. Penyaring daftar (verifikasi, usia, jabatan baku) memuat orang itu.
 *   7. Bidang mengubah tanggal lahir → NIPD diterbitkan ulang.
 *   8. NIPD kembar ditolak 409.
 *   9. Kepala desa & staf: valid tanpa NIPD.
 *  10. Batalkan verifikasi → NIPD dicabut.
 * Semua data uji (baris, riwayat, berkas) dihapus di akhir, berhasil atau gagal.
 *
 * HANYA untuk backend lokal: skrip ini menulis data dan membersihkannya lewat
 * Prisma ke database yang sama, jadi alamat selain localhost ditolak.
 *
 * Variabel: UJI_API (bawaan http://127.0.0.1:3001/api), UJI_EMAIL, UJI_SANDI.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const API = process.env.UJI_API || 'http://127.0.0.1:3001/api';
const EMAIL = process.env.UJI_EMAIL || 'superadmin@dpmd.bogorkab.go.id';
const SANDI = process.env.UJI_SANDI || 'nobunaga1945';
const DIR_BERKAS = path.join(__dirname, '../storage/uploads/aparatur_desa_files');
const PENANDA = 'UJI OTOMATIS';

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(API)) {
	console.error(`✋ UJI_API harus backend lokal, bukan ${API}`);
	process.exit(2);
}

// ── Kerangka uji kecil ───────────────────────────────────────────────────────
let lulus = 0;
let gagal = 0;
const cek = (kondisi, pesan, detail) => {
	if (kondisi) {
		lulus++;
		console.log(`  ✓ ${pesan}`);
	} else {
		gagal++;
		console.log(`  ✗ ${pesan}${detail !== undefined ? `\n      → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
	}
	return kondisi;
};
const langkah = (judul) => console.log(`\n▸ ${judul}`);

let token = null;
const panggil = async (metode, jalur, { json, form } = {}) => {
	const res = await fetch(`${API}${jalur}`, {
		method: metode,
		headers: {
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(json ? { 'Content-Type': 'application/json' } : {}),
		},
		body: json ? JSON.stringify(json) : form,
	});
	let isi = null;
	try { isi = await res.json(); } catch { /* bukan JSON */ }
	return { status: res.status, isi };
};

// Berkas uji sekecil mungkin tapi sah: PNG 1×1 dan PDF satu halaman kosong.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const formAparatur = (isian, berkas = true) => {
	const fd = new FormData();
	for (const [k, v] of Object.entries(isian)) fd.append(k, v);
	if (berkas) {
		fd.append('file_sk_terakhir', new Blob([PDF], { type: 'application/pdf' }), 'sk-uji.pdf');
		fd.append('file_ktp', new Blob([PNG], { type: 'image/png' }), 'ktp-uji.png');
	}
	return fd;
};

const DASAR = {
	tempat_lahir: 'Bogor',
	jenis_kelamin: 'Perempuan',
	pendidikan_terakhir: 'S1',
	agama: 'Islam',
	status: 'Aktif',
	nomor_sk_pengangkatan: '141/UJI/2026',
	tanggal_pengangkatan: '2024-01-15',
};

const dibuat = []; // id aparatur uji, untuk dibersihkan

const tambah = async (desaId, isian, berkas = true) => {
	const r = await panggil('POST', `/pemdes/aparatur-desa?desa_id=${desaId}`, { form: formAparatur({ ...DASAR, ...isian }, berkas) });
	if (r.isi?.data?.id) dibuat.push(r.isi.data.id);
	return r;
};
const detail = async (id) => (await panggil('GET', `/pemdes/aparatur-desa/${id}`)).isi?.data;
const verifikasi = (id, body) => panggil('POST', `/pemdes/aparatur-desa/${id}/verifikasi`, { json: body });
const semuaSesuai = (d) => ({
	items: Object.fromEntries((d.item_verifikasi || []).filter((i) => i.ada).map((i) => [i.key, { status: 'sesuai' }])),
});
const adaDiDaftar = async (query, id) => {
	const r = await panggil('GET', `/pemdes/aparatur-desa?${new URLSearchParams({ ...query, limit: 100 })}`);
	return (r.isi?.data || []).some((a) => a.id === id);
};

// ── Jalannya uji ─────────────────────────────────────────────────────────────
const jalankan = async () => {
	langkah('Login superadmin');
	const login = await panggil('POST', '/auth/login', { json: { email: EMAIL, password: SANDI } });
	token = login.isi?.data?.token || null;
	if (!cek(login.status === 200 && token, `login ${EMAIL}`, login.isi?.message)) return;

	langkah('Pilih desa uji');
	const argDesa = process.argv.find((a) => a.startsWith('--desa='));
	const desa = argDesa
		? await prisma.desas.findUnique({ where: { id: BigInt(argDesa.split('=')[1]) }, include: { kecamatans: true } })
		: await prisma.desas.findFirst({ where: { status_pemerintahan: 'desa', kode: { contains: '.' } }, include: { kecamatans: true }, orderBy: { id: 'asc' } });
	if (!cek(desa && desa.status_pemerintahan === 'desa', `desa ${desa?.nama} (${desa?.kode})`)) return;
	const [, , kodeKec, kodeDesa] = desa.kode.split('.');
	const desaId = String(desa.id);

	// 2 ─────────────────────────────────────────────────────────────────────
	langkah('Bidang menambah Kadus II untuk desa terpilih');
	const t1 = await tambah(desaId, { nama_lengkap: `${PENANDA} Kadus Dua`, jabatan: 'Kadus II', tanggal_lahir: '1985-03-07', nipd: '99999999999999999999' });
	if (!cek(t1.status === 201, 'tersimpan (201)', t1.isi?.message || t1.status)) return;
	const id1 = t1.isi.data.id;
	cek(String(t1.isi.data.desa_id) === desaId, 'tercatat di desa yang dipilih bidang');
	cek(t1.isi.data.nipd === null, 'NIPD kiriman manual diabaikan', t1.isi.data.nipd);
	cek(Boolean(t1.isi.data.file_sk_terakhir) && Boolean(t1.isi.data.file_ktp), 'berkas SK terakhir & KTP terunggah');

	const tanpaDesa = await panggil('POST', '/pemdes/aparatur-desa', { form: formAparatur({ ...DASAR, nama_lengkap: `${PENANDA} X`, jabatan: 'Kadus I', tanggal_lahir: '1990-01-01' }, false) });
	cek(tanpaDesa.status === 400, 'tanpa desa_id ditolak (400)', tanpaDesa.status);

	// 3 ─────────────────────────────────────────────────────────────────────
	langkah('Detail: item verifikasi, info NIPD, kode lokasi');
	let d1 = await detail(id1);
	const kunci = (d1.item_verifikasi || []).map((i) => i.key);
	cek(['biodata', 'jabatan_sk', 'file_sk_terakhir', 'file_ktp'].every((k) => kunci.includes(k)), 'item wajib tersedia', kunci);
	cek(!kunci.includes('bpjs'), 'item BPJS tidak muncul bila nomornya kosong', kunci);
	cek(d1.nipd_info?.berhak === true && d1.nipd_info?.kode_jabatan === '009', 'Kadus II berhak NIPD, kode jabatan 009', d1.nipd_info);
	cek(d1.kode_lokasi?.kab === '01' && d1.kode_lokasi?.kec === kodeKec && d1.kode_lokasi?.desa === kodeDesa, `kode lokasi 01 · ${kodeKec} · ${kodeDesa}`, d1.kode_lokasi);
	cek(d1.status_verifikasi === null, 'belum diverifikasi');

	// 4 ─────────────────────────────────────────────────────────────────────
	langkah('Verifikasi per item');
	let r = await verifikasi(id1, { items: { biodata: { status: 'sesuai' } } });
	cek(r.status === 200 && r.isi.data.status_verifikasi === null, 'satu item sesuai → masih belum diputus', r.isi?.data?.status_verifikasi);

	r = await verifikasi(id1, { items: { file_ktp: { status: 'tidak_sesuai' } } });
	cek(r.status === 400, 'tidak sesuai tanpa alasan → 400', r.status);

	r = await verifikasi(id1, { items: { file_ktp: { status: 'tidak_sesuai', catatan: 'KTP buram' } } });
	cek(r.isi?.data?.status_verifikasi === 'ditolak', 'tidak sesuai beralasan → status ditolak', r.isi?.data?.status_verifikasi);
	cek(String(r.isi?.data?.catatan_verifikasi || '').includes('KTP buram'), 'alasan sampai ke catatan untuk desa', r.isi?.data?.catatan_verifikasi);
	cek(r.isi?.data?.nipd === null, 'data ditolak → tidak ada NIPD');

	// 5 ─────────────────────────────────────────────────────────────────────
	langkah('Semua item sesuai → terverifikasi & NIPD terbit');
	d1 = await detail(id1);
	r = await verifikasi(id1, semuaSesuai(d1));
	const harap = `19850307` + `01` + kodeKec + kodeDesa + `2` + `009`;
	cek(r.isi?.data?.status_verifikasi === 'terverifikasi', 'status terverifikasi', r.isi?.message);
	cek(r.isi?.data?.nipd === harap, `NIPD = ${harap}`, r.isi?.data?.nipd);
	cek(/^\d{20}$/.test(r.isi?.data?.nipd || ''), 'NIPD tepat 20 digit');

	// 6 ─────────────────────────────────────────────────────────────────────
	langkah('Penyaring daftar untuk pop-up grafik');
	cek(await adaDiDaftar({ desa_id: desaId, verifikasi: 'terverifikasi' }, id1), 'verifikasi=terverifikasi memuatnya');
	cek(!(await adaDiDaftar({ desa_id: desaId, verifikasi: 'belum' }, id1)), 'verifikasi=belum tidak memuatnya');
	cek(await adaDiDaftar({ desa_id: desaId, usia: '35-44' }, id1), 'usia=35-44 memuatnya (lahir 1985)');
	cek(!(await adaDiDaftar({ desa_id: desaId, usia: '25-34' }, id1)), 'usia=25-34 tidak memuatnya');
	cek(await adaDiDaftar({ desa_id: desaId, jabatan_baku: 'KEPALA DUSUN II' }, id1), 'jabatan_baku=KEPALA DUSUN II memuat "Kadus II"');

	// 7 ─────────────────────────────────────────────────────────────────────
	langkah('Bidang mengubah tanggal lahir → NIPD diterbitkan ulang');
	const fdUbah = new FormData();
	fdUbah.append('tanggal_lahir', '1986-04-08');
	r = await panggil('POST', `/pemdes/aparatur-desa/${id1}/lengkap`, { form: fdUbah });
	cek(r.status === 200, 'tersimpan', r.isi?.message);
	cek(r.isi?.data?.status_verifikasi === 'terverifikasi', 'suntingan bidang tidak menggugurkan verifikasi');
	cek(String(r.isi?.data?.nipd || '').startsWith('19860408'), 'NIPD mengikuti tanggal lahir baru', r.isi?.data?.nipd);

	// 8 ─────────────────────────────────────────────────────────────────────
	langkah('NIPD kembar ditolak');
	const t2 = await tambah(desaId, { nama_lengkap: `${PENANDA} Kadus Kembar`, jabatan: 'Kadus II', tanggal_lahir: '1986-04-08' });
	if (cek(t2.status === 201, 'orang kedua dengan data identik tersimpan')) {
		const d2 = await detail(t2.isi.data.id);
		r = await verifikasi(t2.isi.data.id, semuaSesuai(d2));
		cek(r.status === 409, 'verifikasi ditolak 409 karena NIPD sudah dipakai', `${r.status} ${r.isi?.message}`);
	}

	// 9 ─────────────────────────────────────────────────────────────────────
	langkah('Kepala desa & staf: valid tanpa NIPD');
	for (const jabatan of ['Kepala Desa', 'Staf Sekretariat']) {
		const t = await tambah(desaId, { nama_lengkap: `${PENANDA} ${jabatan}`, jabatan, tanggal_lahir: '1975-06-01', jenis_kelamin: 'Laki-laki' });
		if (!cek(t.status === 201, `${jabatan} tersimpan`)) continue;
		const d = await detail(t.isi.data.id);
		cek(d.nipd_info?.berhak === false, `${jabatan} tidak berhak NIPD`, d.nipd_info);
		r = await verifikasi(t.isi.data.id, semuaSesuai(d));
		cek(r.isi?.data?.status_verifikasi === 'terverifikasi' && r.isi?.data?.nipd === null, `${jabatan} terverifikasi tanpa NIPD`, r.isi?.data);
	}

	// 10 ────────────────────────────────────────────────────────────────────
	langkah('Batalkan verifikasi');
	r = await verifikasi(id1, { status: 'batal' });
	cek(r.isi?.data?.status_verifikasi === null && r.isi?.data?.nipd === null, 'status kosong & NIPD dicabut', r.isi?.data);
	d1 = await detail(id1);
	cek((d1.riwayat || []).some((x) => x.aksi === 'terverifikasi') && (d1.riwayat || []).some((x) => x.aksi === 'verifikasi_dibatalkan'), 'riwayat mencatat verifikasi & pembatalan');
};

// ── Pembersihan ──────────────────────────────────────────────────────────────
const bersihkan = async () => {
	// Termasuk sisa uji sebelumnya yang gagal dibersihkan.
	const baris = await prisma.aparatur_desa.findMany({
		where: { OR: [{ id: { in: dibuat } }, { nama_lengkap: { startsWith: PENANDA } }] },
	});
	const berkas = baris.flatMap((b) => Object.entries(b).filter(([k, v]) => k.startsWith('file_') && v).map(([, v]) => v));
	const ids = baris.map((b) => b.id);
	if (ids.length) {
		await prisma.aparatur_desa_logs.deleteMany({ where: { aparatur_id: { in: ids } } });
		await prisma.aparatur_desa.deleteMany({ where: { id: { in: ids } } });
	}
	for (const nama of berkas) {
		try { fs.unlinkSync(path.join(DIR_BERKAS, nama)); } catch { /* sudah tidak ada */ }
	}
	console.log(`\n🧹 Dibersihkan: ${ids.length} baris uji, ${berkas.length} berkas.`);
};

(async () => {
	console.log(`Uji Perangkat Desa → ${API}`);
	try {
		await jalankan();
	} catch (error) {
		gagal++;
		console.error('\n💥 Uji berhenti karena galat:', error.message);
	} finally {
		try { await bersihkan(); } catch (error) { console.error('Pembersihan gagal:', error.message); }
		await prisma.$disconnect();
		console.log(`\n${gagal ? '❌' : '✅'} ${lulus} lulus, ${gagal} gagal`);
		process.exit(gagal ? 1 : 0);
	}
})();
