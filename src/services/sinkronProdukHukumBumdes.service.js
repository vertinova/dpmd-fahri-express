/**
 * Menyambungkan dokumen pendirian BUM Desa yang diunggah Bidang SPKED ke modul
 * Produk Hukum Desa.
 *
 * MASALAHNYA. Ada dua jalan masuk untuk dokumen yang sama:
 *
 *   • Desa  memilih Perdes/SK yang sudah ada di modul Produk Hukum. Yang
 *     tersimpan hanya id-nya, di `bumdes.produk_hukum_perdes_id` /
 *     `produk_hukum_sk_bumdes_id`.
 *   • SPKED mengunggah berkasnya langsung dari halaman BUM Desa. Yang tersimpan
 *     nama berkas, di kolom `bumdes.Perdes` / `bumdes.SK_BUM_Desa`.
 *
 * Dua kolom berbeda yang tidak pernah bertemu: Perdes yang diunggah SPKED tidak
 * muncul di menu Produk Hukum Desa, dan desa yang membukanya mengira dokumennya
 * belum ada. Berkas ini menutup jarak itu — begitu SPKED mengunggah Perdes atau
 * SK BUM Desa, dokumennya sekalian terdaftar sebagai produk hukum milik desa
 * yang bersangkutan.
 *
 * KENAPA BERKASNYA DISALIN, BUKAN DITUNJUK BERSAMA. Modul Produk Hukum membaca
 * berkasnya dari `storage/produk_hukum/` (lihat produkHukum.controller.download),
 * sedangkan dokumen BUM Desa tinggal di `storage/uploads/bumdes_dokumen_badanhukum/`.
 * Menunjuk satu berkas dari dua modul berarti menghapusnya di satu tempat
 * mematikan tautan di tempat lain. Satu salinan per modul jauh lebih murah
 * daripada dokumen yang hilang diam-diam.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const FOLDER_BUMDES = path.join(__dirname, '../../storage/uploads/bumdes_dokumen_badanhukum');
const FOLDER_PRODUK_HUKUM = path.join(__dirname, '../../storage/produk_hukum');

/**
 * Kolom dokumen BUM Desa yang punya padanan di modul Produk Hukum.
 * Nilai `jenis` dan `singkatan_jenis` memakai nama enum Prisma (bergaris bawah),
 * bukan teks yang tersimpan di basis data.
 */
const PADANAN = {
	Perdes: {
		jenis: 'Peraturan_Desa',
		singkatan_jenis: 'PERDES',
		kolomRelasi: 'produk_hukum_perdes_id',
		judul: (namaBumdes) => `Peraturan Desa tentang Pendirian ${namaBumdes || 'BUM Desa'}`,
	},
	SK_BUM_Desa: {
		jenis: 'Keputusan_Kepala_Desa',
		singkatan_jenis: 'SK_KADES',
		kolomRelasi: 'produk_hukum_sk_bumdes_id',
		judul: (namaBumdes) => `Keputusan Kepala Desa tentang ${namaBumdes || 'BUM Desa'}`,
	},
};

/** Kolom mana saja yang ikut tersinkron — dipakai pemanggil untuk memutuskan. */
const KOLOM_TERSINKRON = Object.keys(PADANAN);

/**
 * "05 Tahun 2024" → { nomor: '05', tahun: 2024 }.
 * Nomor Perdes diisi bebas oleh petugas, jadi pembacaannya harus memaafkan:
 * apa pun yang tidak terbaca dikembalikan sebagai null agar pemanggil memakai
 * cadangannya, bukan menyimpan tebakan.
 */
const bacaNomorPerdes = (teks) => {
	if (!teks || typeof teks !== 'string') return { nomor: null, tahun: null };

	const bersih = teks.trim();
	const cocokTahun = bersih.match(/(?:19|20)\d{2}/);
	const tahun = cocokTahun ? parseInt(cocokTahun[0], 10) : null;

	// Tahunnya dibuang lebih dulu, lalu diambil potongan PERTAMA yang memuat
	// angka. Dengan begitu kata pengantar seperti "Nomor", "No.", atau "Perdes"
	// terlewat sendiri, dan bentuk majemuk seperti "141.3/46/KPTS/2021" tetap
	// utuh sebagai satu nomor.
	const tanpaTahun = cocokTahun ? bersih.replace(cocokTahun[0], ' ') : bersih;
	const bernomor = tanpaTahun.split(/\s+/).filter(Boolean).find((k) => /\d/.test(k));
	const nomor = bernomor
		? bernomor.replace(/^[^\w]+/, '').replace(/[^\w]+$/, '')
		: null;

	return { nomor: nomor || null, tahun };
};

/** Salin berkas ke folder modul Produk Hukum; nama dipertahankan. */
const salinBerkas = async (namaBerkas) => {
	const asal = path.join(FOLDER_BUMDES, namaBerkas);
	const tujuan = path.join(FOLDER_PRODUK_HUKUM, namaBerkas);

	await fs.promises.mkdir(FOLDER_PRODUK_HUKUM, { recursive: true });
	await fs.promises.copyFile(asal, tujuan);
	return namaBerkas;
};

/**
 * Daftarkan (atau perbarui) dokumen BUM Desa sebagai produk hukum desa.
 *
 * @param {object} bumdes     baris bumdes lengkap (butuh desa_id, desa, namabumdesa, NomorPerdes)
 * @param {string} fieldName  'Perdes' | 'SK_BUM_Desa'
 * @param {string} namaBerkas nama berkas di folder dokumen badan hukum
 * @returns {Promise<{id: string, dibuat: boolean} | null>} null bila tidak berlaku
 */
const sinkronkanKeProdukHukum = async (bumdes, fieldName, namaBerkas) => {
	const padanan = PADANAN[fieldName];
	if (!padanan) return null;

	// Produk hukum selalu milik satu desa. BUM Desa tanpa desa_id tidak bisa
	// dititipkan ke mana pun — dilewati diam-diam, bukan digagalkan, supaya
	// unggahan berkasnya sendiri tetap berhasil.
	if (!bumdes?.desa_id) {
		logger.warn('Sinkron produk hukum dilewati: bumdes tanpa desa_id', { bumdes_id: bumdes?.id });
		return null;
	}

	await salinBerkas(namaBerkas);

	const { nomor, tahun } = bacaNomorPerdes(bumdes.NomorPerdes);
	const tahunPakai = tahun
		|| (bumdes.TahunPendirian ? parseInt(bumdes.TahunPendirian, 10) : null)
		|| new Date().getFullYear();

	const idLama = bumdes[padanan.kolomRelasi];

	// Sudah pernah tersinkron: perbarui barisnya, jangan bikin kembar. Unggah
	// ulang adalah penggantian dokumen, bukan dokumen baru.
	if (idLama) {
		const adaLama = await prisma.produk_hukums.findUnique({ where: { id: idLama } });
		if (adaLama) {
			await prisma.produk_hukums.update({
				where: { id: idLama },
				data: { file: namaBerkas, updated_at: new Date() },
			});
			logger.info('Produk hukum BUM Desa diperbarui', { id: idLama, fieldName });
			return { id: idLama, dibuat: false };
		}
	}

	const id = uuidv4();
	const sekarang = new Date();

	await prisma.produk_hukums.create({
		data: {
			id,
			uuid: id,
			desa_id: BigInt(bumdes.desa_id),
			judul: padanan.judul(bumdes.namabumdesa),
			nomor: nomor || '-',
			tahun: tahunPakai,
			jenis: padanan.jenis,
			singkatan_jenis: padanan.singkatan_jenis,
			// Tanggal penetapan sebenarnya tidak diketahui dari unggahan ini;
			// kolomnya NOT NULL, jadi diisi tanggal pendaftaran dan ditandai di
			// `keterangan_status` supaya tidak dikira tanggal resmi.
			tempat_penetapan: bumdes.desa || 'Kabupaten Bogor',
			tanggal_penetapan: sekarang,
			sumber: 'Unggahan Bidang SPKED lewat modul BUM Desa',
			subjek: 'BUM Desa',
			keterangan_status: 'Tanggal penetapan belum diverifikasi — diisi otomatis saat berkas diunggah',
			file: namaBerkas,
			created_at: sekarang,
			updated_at: sekarang,
		},
	});

	await prisma.bumdes.update({
		where: { id: bumdes.id },
		data: { [padanan.kolomRelasi]: id },
	});

	logger.info('Produk hukum BUM Desa dibuat & ditautkan', {
		id, bumdes_id: bumdes.id, desa_id: String(bumdes.desa_id), fieldName,
	});
	return { id, dibuat: true };
};

module.exports = { sinkronkanKeProdukHukum, KOLOM_TERSINKRON, bacaNomorPerdes };
