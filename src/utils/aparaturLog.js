/**
 * Riwayat perubahan satu aparatur desa.
 *
 * Dipakai bersama controller sisi desa dan sisi bidang supaya urutan
 * kejadiannya utuh: siapa pun yang menyentuh baris itu, jejaknya masuk ke
 * tempat yang sama.
 */
const prisma = require('../config/prisma');

const AKSI = {
	dibuat: 'dibuat',
	diubah: 'diubah',
	terverifikasi: 'terverifikasi',
	ditolak: 'ditolak',
	verifikasi_dibatalkan: 'verifikasi_dibatalkan',
};

/**
 * Catat satu kejadian. Sengaja tidak pernah melempar: gagal mencatat riwayat
 * tidak boleh menggagalkan penyimpanan data yang sudah berhasil.
 */
const catatLogAparatur = async ({ aparaturId, aksi, keterangan = null, user = null }) => {
	try {
		if (!aparaturId || !aksi) return null;
		return await prisma.aparatur_desa_logs.create({
			data: {
				aparatur_id: String(aparaturId),
				aksi,
				keterangan,
				oleh_id: user?.id ? BigInt(user.id) : null,
				oleh_nama: user?.name || null,
				oleh_peran: user?.role || null,
				created_at: new Date(),
			},
		});
	} catch (error) {
		console.error('[aparaturLog] gagal mencatat riwayat:', error.message);
		return null;
	}
};

/** Riwayat satu aparatur, terbaru lebih dulu. */
const ambilLogAparatur = (aparaturId, batas = 50) =>
	prisma.aparatur_desa_logs.findMany({
		where: { aparatur_id: String(aparaturId) },
		orderBy: { created_at: 'desc' },
		take: batas,
	});

module.exports = { AKSI, catatLogAparatur, ambilLogAparatur };
