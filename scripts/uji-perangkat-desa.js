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
 *  11. NIK & WhatsApp: wajib, format, kembar, tidak bocor di daftar.
 *  12. Data lama tanpa NIK: tak bisa dinyatakan valid, tapi bisa dinonaktifkan.
 *  13. Akun desa melengkapi NIK pada data terverifikasi → NIPD tetap;
 *      mengubah isian lain → verifikasi gugur seperti biasa.
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
const jwt = require('jsonwebtoken');
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
const panggil = async (metode, jalur, { json, form, sebagai } = {}) => {
	const res = await fetch(`${API}${jalur}`, {
		method: metode,
		headers: {
			...((sebagai || token) ? { Authorization: `Bearer ${sebagai || token}` } : {}),
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

// Tiap orang uji butuh NIK sendiri: NIK kembar di antara yang aktif ditolak.
let urutNik = 0;
const nikUji = () => `320101${String(Date.now()).slice(-6)}${String(++urutNik).padStart(4, '0')}`;

const tambah = async (desaId, isian, berkas = true) => {
	const r = await panggil('POST', `/pemdes/aparatur-desa?desa_id=${desaId}`, { form: formAparatur({ ...DASAR, nik: nikUji(), whatsapp: '081234567890', ...isian }, berkas) });
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

	// 9b ────────────────────────────────────────────────────────────────────
	langkah('Jabatan gabungan ditahan');
	const tg = await tambah(desaId, { nama_lengkap: `${PENANDA} Kaur Gabungan`, jabatan: 'Kaur Umum dan Perencanaan', tanggal_lahir: '1982-08-17' });
	if (cek(tg.status === 201, 'Kaur Umum dan Perencanaan tersimpan')) {
		const d = await detail(tg.isi.data.id);
		cek(d.nipd_info?.berhak === true && /gabungan/i.test(d.nipd_info?.kendala || ''), 'berhak, tapi ditahan sebagai jabatan gabungan', d.nipd_info);
		r = await verifikasi(tg.isi.data.id, semuaSesuai(d));
		cek(r.isi?.data?.status_verifikasi === 'terverifikasi' && r.isi?.data?.nipd === null, 'valid tapi NIPD tidak terbit', r.isi?.data?.nipd);
		cek(/gabungan/i.test(r.isi?.peringatan || ''), 'pemeriksa diberi tahu alasannya', r.isi?.peringatan);
	}

	// 9c ────────────────────────────────────────────────────────────────────
	langkah('Tanggal lahir taksiran Dapur Desa ditahan');
	const tt = await tambah(desaId, { nama_lengkap: `${PENANDA} Kadus Taksiran`, jabatan: 'Kadus IV', tanggal_lahir: '1979-01-01', jenis_kelamin: 'Laki-laki' });
	if (cek(tt.status === 201, 'Kadus IV tersimpan')) {
		const idT = tt.isi.data.id;
		// Meniru hasil impor arsip: tanggal 1 Januari yang ditaksir dari usia.
		await prisma.aparatur_desa.update({ where: { id: idT }, data: { tanggal_lahir_taksiran: true } });
		let d = await detail(idT);
		cek(/taksiran/i.test(d.nipd_info?.kendala || ''), 'kendala NIPD: tanggal lahir taksiran', d.nipd_info);
		r = await verifikasi(idT, semuaSesuai(d));
		cek(r.isi?.data?.status_verifikasi === 'terverifikasi' && r.isi?.data?.nipd === null, 'valid tapi NIPD ditahan', r.isi?.data?.nipd);

		r = await panggil('PUT', `/pemdes/aparatur-desa/${idT}`, { json: { konfirmasi_tanggal_lahir: true } });
		const harapT = '19790101' + '01' + kodeKec + kodeDesa + '1' + '011';
		cek(r.isi?.data?.tanggal_lahir_taksiran === false, 'konfirmasi "Sesuai KTP" memadamkan penanda');
		cek(r.isi?.data?.nipd === harapT, `NIPD langsung terbit: ${harapT}`, r.isi?.data?.nipd);

		// Jalur kedua: tanggal dikoreksi lewat sunting → penanda padam sendiri.
		await prisma.aparatur_desa.update({ where: { id: idT }, data: { tanggal_lahir_taksiran: true, nipd: null } });
		const fd = new FormData();
		fd.append('tanggal_lahir', '1979-06-21');
		r = await panggil('POST', `/pemdes/aparatur-desa/${idT}/lengkap`, { form: fd });
		cek(r.isi?.data?.tanggal_lahir_taksiran === false, 'tanggal dikoreksi → penanda padam');
		cek(String(r.isi?.data?.nipd || '').startsWith('19790621'), 'NIPD terbit dengan tanggal yang dikoreksi', r.isi?.data?.nipd);

		// Menyimpan ulang TANPA mengubah tanggal tidak boleh memadamkan penanda.
		await prisma.aparatur_desa.update({ where: { id: idT }, data: { tanggal_lahir_taksiran: true } });
		const fdSama = new FormData();
		fdSama.append('tanggal_lahir', '1979-06-21');
		fdSama.append('agama', 'Islam');
		r = await panggil('POST', `/pemdes/aparatur-desa/${idT}/lengkap`, { form: fdSama });
		cek(r.isi?.data?.tanggal_lahir_taksiran === true, 'simpan ulang dengan tanggal sama → penanda tetap menyala');
	}

	// 10 ────────────────────────────────────────────────────────────────────
	langkah('Batalkan verifikasi');
	r = await verifikasi(id1, { status: 'batal' });
	cek(r.isi?.data?.status_verifikasi === null && r.isi?.data?.nipd === null, 'status kosong & NIPD dicabut', r.isi?.data);
	d1 = await detail(id1);
	cek((d1.riwayat || []).some((x) => x.aksi === 'terverifikasi') && (d1.riwayat || []).some((x) => x.aksi === 'verifikasi_dibatalkan'), 'riwayat mencatat verifikasi & pembatalan');

	// 11 ────────────────────────────────────────────────────────────────────
	langkah('NIK & WhatsApp wajib');
	const jumlahBerkas = () => fs.readdirSync(DIR_BERKAS).length;
	const berkasAwal = jumlahBerkas();
	const orang = { nama_lengkap: `${PENANDA} Identitas`, jabatan: 'Staf Desa', tanggal_lahir: '1990-05-05' };
	r = await tambah(desaId, { ...orang, nik: '' });
	cek(r.status === 400 && /NIK wajib/.test(r.isi?.message), 'tanpa NIK ditolak', r.isi?.message);
	r = await tambah(desaId, { ...orang, whatsapp: '' });
	cek(r.status === 400 && /WhatsApp wajib/.test(r.isi?.message), 'tanpa WhatsApp ditolak', r.isi?.message);
	r = await tambah(desaId, { ...orang, nik: '320101' });
	cek(r.status === 400 && /16 digit/.test(r.isi?.message), 'NIK pendek ditolak', r.isi?.message);
	r = await tambah(desaId, { ...orang, nik: '1111111111111111' });
	cek(r.status === 400 && /16 digit/.test(r.isi?.message), 'NIK satu angka berulang ditolak', r.isi?.message);
	r = await tambah(desaId, { ...orang, whatsapp: '12345' });
	cek(r.status === 400 && /tidak valid/.test(r.isi?.message), 'WhatsApp salah ditolak', r.isi?.message);
	cek(jumlahBerkas() === berkasAwal, 'berkas kiriman yang ditolak tidak tertinggal', jumlahBerkas() - berkasAwal);

	const nikOrang = nikUji();
	r = await tambah(desaId, { ...orang, nik: nikOrang, whatsapp: '0812-3456-7890' });
	if (!cek(r.status === 201, 'isian lengkap tersimpan', r.isi?.message)) return;
	const idOrang = r.isi.data.id;
	cek(r.isi.data.nik === nikOrang && r.isi.data.whatsapp === '6281234567890', 'WhatsApp dinormalkan ke 62…', r.isi.data.whatsapp);
	r = await tambah(desaId, { ...orang, nama_lengkap: `${PENANDA} Kembar NIK`, nik: nikOrang });
	cek(r.status === 409, 'NIK kembar di antara yang aktif ditolak 409', r.isi?.message);
	r = await panggil('GET', `/pemdes/aparatur-desa?${new URLSearchParams({ search: PENANDA, limit: 100 })}`);
	const barisDaftar = (r.isi?.data || []).find((a) => a.id === idOrang);
	cek(barisDaftar && !('nik' in barisDaftar) && !('whatsapp' in barisDaftar), 'daftar bidang tidak memuat NIK & WhatsApp', barisDaftar && Object.keys(barisDaftar).length);
	const dOrang = await detail(idOrang);
	cek(dOrang.nik === nikOrang, 'detail memuat NIK');

	// 12 ────────────────────────────────────────────────────────────────────
	langkah('Data lama tanpa NIK');
	await prisma.aparatur_desa.update({ where: { id: idOrang }, data: { nik: null, whatsapp: null } });
	r = await verifikasi(idOrang, { items: { biodata: { status: 'sesuai' } } });
	cek(r.status === 400 && /NIK dan nomor WhatsApp/.test(r.isi?.message), 'biodata tak bisa dinyatakan sesuai', r.isi?.message);
	r = await verifikasi(idOrang, { status: 'terverifikasi' });
	cek(r.status === 400, 'jalur lama "terverifikasi" ikut tertahan', r.status);
	r = await verifikasi(idOrang, { items: { file_ktp: { status: 'sesuai' } } });
	cek(r.status === 200, 'item lain tetap bisa diperiksa', r.isi?.message);
	r = await verifikasi(idOrang, { items: { biodata: { status: 'tidak_sesuai', catatan: 'NIK belum diisi' } } });
	cek(r.status === 200 && r.isi?.data?.status_verifikasi === 'ditolak', 'bisa dikembalikan ke desa', r.isi?.message);

	const fdAktif = new FormData();
	fdAktif.append('status', 'Aktif');
	r = await panggil('POST', `/pemdes/aparatur-desa/${idOrang}/lengkap`, { form: fdAktif });
	cek(r.status === 400 && /NIK wajib/.test(r.isi?.message), 'tidak bisa disimpan sebagai aktif tanpa NIK', r.isi?.message);
	const fdNonaktif = new FormData();
	fdNonaktif.append('status', 'Tidak Aktif');
	r = await panggil('POST', `/pemdes/aparatur-desa/${idOrang}/lengkap`, { form: fdNonaktif });
	cek(r.status === 200 && r.isi?.data?.status === 'Tidak_Aktif', 'tetap bisa dinonaktifkan tanpa NIK', r.isi?.message);

	// 13 ────────────────────────────────────────────────────────────────────
	langkah('Akun desa melengkapi NIK pada data terverifikasi');
	const akunDesa = await prisma.users.findFirst({ where: { role: 'desa', is_active: true, desa_id: desa.id, desa_user_permissions: { some: { permission_key: 'aparatur-desa' } } } })
		|| await prisma.users.findFirst({ where: { role: 'desa', is_active: true, desa_id: desa.id } });
	if (!akunDesa) {
		console.log('  – tidak ada akun desa di desa uji; langkah ini dilewati (pakai --desa=<id>)');
		return;
	}
	const sebagai = jwt.sign({ id: String(akunDesa.id), name: akunDesa.name, email: akunDesa.email, role: 'desa', desa_id: String(akunDesa.desa_id) }, process.env.JWT_SECRET, { expiresIn: '10m' });
	const tv = await tambah(desaId, { nama_lengkap: `${PENANDA} Kadus Lama`, jabatan: 'Kadus V', tanggal_lahir: '1981-09-09' });
	const idV = tv.isi.data.id;
	r = await verifikasi(idV, semuaSesuai(await detail(idV)));
	const nipdV = r.isi?.data?.nipd;
	cek(r.isi?.data?.status_verifikasi === 'terverifikasi' && Boolean(nipdV), 'terverifikasi & NIPD terbit', r.isi?.message);
	await prisma.aparatur_desa.update({ where: { id: idV }, data: { nik: null, whatsapp: null } });

	// Kiriman sama dengan form: seluruh isian dikirim ulang, tanggal sebagai yyyy-mm-dd.
	const kirimanDesa = (ubahan = {}) => {
		const fd = new FormData();
		const isian = { ...DASAR, nama_lengkap: `${PENANDA} Kadus Lama`, jabatan: 'Kadus V', tanggal_lahir: '1981-09-09', produk_hukum_id: '', ...ubahan };
		for (const [k, v] of Object.entries(isian)) fd.append(k, v);
		return fd;
	};
	const nikV = nikUji();
	r = await panggil('POST', `/desa/aparatur-desa/${idV}`, { form: kirimanDesa({ nik: nikV, whatsapp: '081298765432' }), sebagai });
	cek(r.status === 200, 'akun desa bisa menyimpan', r.isi?.message || r.status);
	cek(r.isi?.data?.status_verifikasi === 'terverifikasi' && r.isi?.data?.nipd === nipdV, 'melengkapi NIK & WhatsApp → verifikasi & NIPD tetap', r.isi?.data?.nipd);
	cek(r.isi?.data?.nik === nikV, 'NIK tersimpan');

	r = await panggil('POST', `/desa/aparatur-desa/${idV}`, { form: kirimanDesa({ nik: nikV, whatsapp: '081298765432', agama: 'Katolik' }), sebagai });
	cek(r.status === 200 && r.isi?.data?.status_verifikasi === null && r.isi?.data?.nipd === null, 'mengubah isian lain → verifikasi & NIPD gugur', r.isi?.data?.status_verifikasi);
	r = await panggil('POST', `/desa/aparatur-desa/${idV}`, { form: kirimanDesa({ nik: '', whatsapp: '081298765432' }), sebagai });
	cek(r.status === 400, 'akun desa tidak bisa mengosongkan NIK', r.isi?.message);
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
