/**
 * NIK & nomor WhatsApp aparatur desa — wajib, tapi hanya bisa ditegakkan di
 * aplikasi: baris lama (termasuk impor Dapur Desa) belum punya keduanya, jadi
 * kolomnya tetap NULL di database sampai desa melengkapinya.
 */

const { nomorWhatsapp } = require('./nomorWhatsapp');

const bersihkanNik = (nilai) => String(nilai ?? '').replace(/\D/g, '');

// Deret satu angka (1111…) lolos hitungan digit, tapi hanya pengisi kolom wajib.
const nikSah = (nik) => /^\d{16}$/.test(nik) && !/^(\d)\1{15}$/.test(nik);

/**
 * Bersihkan dan periksa kiriman. Mengembalikan { nik, whatsapp } siap simpan,
 * atau { galat } berisi kalimat untuk pengguna. Dengan `wajib: false`, kolom
 * kosong diterima sebagai null, tetapi yang terisi tetap harus sah.
 */
const periksaIdentitas = ({ nik, whatsapp }, { wajib = true } = {}) => {
	const nikBersih = bersihkanNik(nik);
	if (!nikBersih && wajib) return { galat: 'NIK wajib diisi' };
	if (nikBersih && !nikSah(nikBersih)) return { galat: 'NIK harus 16 digit sesuai KTP' };

	const adaWhatsapp = String(whatsapp ?? '').trim() !== '';
	if (!adaWhatsapp && wajib) return { galat: 'Nomor WhatsApp wajib diisi' };
	const nomor = adaWhatsapp ? nomorWhatsapp(whatsapp) : null;
	if (adaWhatsapp && !nomor) return { galat: 'Nomor WhatsApp tidak valid. Contoh: 081234567890' };

	return { nik: nikBersih || null, whatsapp: nomor };
};

/** Label kolom identitas yang masih kosong pada satu baris. */
const identitasKurang = (aparatur) =>
	[['nik', 'NIK'], ['whatsapp', 'nomor WhatsApp']].filter(([kolom]) => !aparatur[kolom]).map(([, label]) => label);

// Isian yang menjadi dasar keputusan verifikasi. Berkas diperiksa terpisah.
const KOLOM_TERVERIFIKASI = [
	'nama_lengkap', 'jabatan', 'niap', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin',
	'pendidikan_terakhir', 'agama', 'pangkat_golongan', 'tanggal_pengangkatan',
	'nomor_sk_pengangkatan', 'tanggal_pemberhentian', 'nomor_sk_pemberhentian',
	'keterangan', 'status', 'produk_hukum_id', 'bpjs_kesehatan_nomor', 'bpjs_ketenagakerjaan_nomor',
];

const kanon = (nilai) => (nilai instanceof Date ? nilai.toISOString().slice(0, 10) : String(nilai ?? '').trim());

/**
 * Simpanan desa pada data terverifikasi yang tidak menyentuh isi terverifikasi:
 * NIK kosong dilengkapi, atau nomor WhatsApp diganti. Keputusan dan NIPD-nya
 * tidak perlu gugur — tanpa ini, mewajibkan NIK akan mencabut NIPD setiap
 * perangkat lama saat desa melengkapinya. NIK yang sudah ada lalu diganti
 * tetap dihitung perubahan data.
 */
const hanyaMelengkapiIdentitas = (lama, baru, adaBerkasBaru = false) => {
	if (lama.status_verifikasi !== 'terverifikasi' || adaBerkasBaru) return false;
	if (lama.nik && baru.nik !== undefined && baru.nik !== lama.nik) return false;
	return KOLOM_TERVERIFIKASI.every((kolom) => !(kolom in baru) || kanon(baru[kolom]) === kanon(lama[kolom]));
};

module.exports = { periksaIdentitas, identitasKurang, hanyaMelengkapiIdentitas };
