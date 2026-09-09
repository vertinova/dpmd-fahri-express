/**
 * Usulan pertanyaan lanjutan.
 *
 * Percakapan mati bukan karena jawabannya salah, melainkan karena penanya tidak
 * tahu apa lagi yang boleh ditanyakan. Sesudah "Desa Cijayanti berstatus Maju",
 * pertanyaan berikutnya yang wajar adalah aparaturnya, BUM Desanya, atau produk
 * hukumnya — tapi tidak ada yang memberi tahu bahwa ketiganya bisa ditanyakan.
 *
 * Usulan di sini DITURUNKAN DARI HASIL, bukan diminta ke model. Dua alasannya:
 * usulan yang dikarang model bisa menunjuk ke kemampuan yang tidak ada, dan
 * usulan yang diturunkan dari maksud + judul dijamin sesuai dengan apa yang
 * benar-benar bisa dijawab. Ini juga gratis: tidak ada satu token pun tambahan.
 *
 * Semuanya ditulis sebagai kalimat yang WAJAR DIUCAPKAN, karena selain jadi
 * tombol di layar, ia juga contoh cara bertanya berikutnya.
 */

/** Ambil "Cijayanti" dari judul "Desa Cijayanti". */
const namaDari = (judul, awalan) => {
	const t = String(judul || '').trim();
	const pola = new RegExp(`^${awalan}\\s+`, 'i');
	return pola.test(t) ? t.replace(pola, '').trim() : '';
};

/** Nama kecamatan dari rincian rapor desa. */
const kecamatanDari = (rincian) =>
	(rincian || []).find((r) => r.label === 'Kecamatan')?.nilai?.replace(/^—$/, '') || '';

/**
 * Susun sampai empat usulan lanjutan untuk sebuah hasil.
 *
 * @param {object} hasil bentuk jawaban Gema (maksud, judul, rincian, ...)
 * @returns {string[]} kalimat siap diklik; boleh kosong
 */
const susunSaran = (hasil) => {
	if (!hasil) return [];
	const maksud = String(hasil.maksud || '').replace(/^model:/, '');
	const judul = hasil.judul || '';

	if (maksud === 'rapor-desa') {
		const desa = namaDari(judul, 'Desa');
		if (!desa) return [];
		const kec = kecamatanDari(hasil.rincian);
		return [
			`aparatur desa ${desa}`,
			`bumdes desa ${desa}`,
			`produk hukum desa ${desa}`,
			kec ? `kecamatan ${kec}` : `penyaluran dana desa ${desa}`,
		];
	}

	if (maksud === 'rapor-kecamatan') {
		const kec = namaDari(judul, 'Kecamatan');
		if (!kec) return [];
		return [
			`desa berstatus mandiri di kecamatan ${kec}`,
			`kepala desa di kecamatan ${kec}`,
			`bumdes aktif di kecamatan ${kec}`,
			`penyaluran dana desa di kecamatan ${kec}`,
		];
	}

	if (maksud === 'daftar-desa') {
		return [
			'berapa yang berstatus mandiri',
			'yang berstatus maju berapa',
			'sebarannya per kecamatan',
		];
	}

	if (maksud === 'daftar-bumdes') {
		return [
			'yang sudah berbadan hukum berapa',
			'yang statusnya aktif saja',
			'berapa total asetnya',
		];
	}

	if (maksud === 'daftar-aparatur') {
		return [
			'yang jabatannya kepala desa saja',
			'berapa jumlahnya',
			'ada sekretaris desanya tidak',
		];
	}

	if (maksud === 'daftar-produk-hukum' || maksud === 'produk-hukum-ringkas') {
		return ['yang jenisnya perdes saja', 'berapa jumlahnya', 'yang paling baru apa'];
	}

	if (maksud === 'daftar-bankeu') {
		return ['berapa total anggarannya', 'yang sudah terverifikasi berapa', 'tahun sebelumnya bagaimana'];
	}

	if (maksud === 'daftar-kelembagaan') {
		return ['berapa totalnya', 'bandingkan dengan kecamatan lain', 'yang paling banyak di mana'];
	}

	if (maksud.startsWith('keuangan') || maksud.startsWith('penyaluran')) {
		return ['berapa yang sudah cair', 'rinciannya per kecamatan', 'bandingkan dengan sumber dana lain'];
	}

	if (maksud === 'profil-akun-pegawai' || maksud.startsWith('akun')) {
		return ['sandinya masih default tidak', 'perannya apa', 'akunnya aktif tidak'];
	}

	return [];
};

module.exports = { susunSaran };
