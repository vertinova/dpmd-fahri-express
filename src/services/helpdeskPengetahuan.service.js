/**
 * Pengetahuan Helpdesk dari data resmi sistem — di luar FAQ yang ditulis DPMD.
 *
 * FAQ menjawab "bagaimana caranya"; data di sini menjawab "siapa / di mana /
 * berapa": profil & pejabat DPMD, tugas tiap bidang, camat & alamat kantor
 * kecamatan beserta daftar desanya, dan angka umum (jumlah kecamatan, desa,
 * kelurahan, BUMDes). Semuanya dibaca dari tabel yang sama dengan yang dipakai
 * halaman lain, jadi bot tidak pernah tertinggal dari data terbaru.
 *
 * Hanya potongan yang relevan dengan pertanyaan yang dikirim ke Claude. Isinya
 * ditulis sebagai kalimat jadi supaya bisa langsung ditampilkan bila Claude
 * sedang tidak tersedia.
 */
const Helpdesk = require('./helpdesk.service');

const SIMPAN_MS = 5 * 60 * 1000;
const simpanan = new Map();

async function tersimpan(kunci, ambil) {
	const ada = simpanan.get(kunci);
	if (ada && ada.sampai > Date.now()) return ada.nilai;
	const nilai = await ambil();
	simpanan.set(kunci, { nilai, sampai: Date.now() + SIMPAN_MS });
	return nilai;
}

/** Dipanggil setelah pengaturan disimpan supaya profil DPMD terbaru langsung dipakai. */
const lupakanSimpanan = () => simpanan.clear();

const normal = (t) => ` ${String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const ada = (teks, pola) => pola.test(teks);

/* Tugas bidang mengikuti siapa yang benar-benar memverifikasi di aplikasi
   (lihat config/bidangDesaPermissions.js), bukan sekadar nama bidang. */
const TUGAS_BIDANG = {
	2: 'persuratan, kepegawaian, dan urusan umum dinas',
	3: 'Bantuan Keuangan (Bankeu & Bankeu Perubahan), BUMDes, LPJ Bantuan Keuangan Provinsi, dan Kerja Sama Desa',
	4: 'penyaluran ADD, Dana Desa, BHPRD, serta penyaluran Bankeu dan Bantuan Provinsi',
	5: 'kelembagaan desa (RT, RW, LPM, Posyandu, PKK, Karang Taruna, dan lembaga lain) beserta pengurusnya',
	6: 'profil desa, aparatur desa (termasuk verifikasi & NIPD), dan produk hukum desa',
};

async function profilDpmd() {
	return tersimpan('profil', async () => {
		const [set, bidang, pejabat] = await Promise.all([
			Helpdesk.pengaturan(),
			Helpdesk.daftarBidang(),
			Helpdesk.q(
				`SELECT u.name, u.role, b.nama AS bidang FROM users u LEFT JOIN bidangs b ON b.id = u.bidang_id
				  WHERE u.is_active = 1 AND u.role IN ('kepala_dinas', 'sekretaris_dinas', 'kepala_bidang')
				  ORDER BY FIELD(u.role, 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang'), u.bidang_id`
			),
		]);
		const baris = [`${set.dpmd_nama || 'DPMD Kabupaten Bogor'} — Dinas Pemberdayaan Masyarakat dan Desa Kabupaten Bogor.`];
		if (set.dpmd_profil) baris.push(set.dpmd_profil.trim());
		/* Akun jabatan sering bernama jabatannya sendiri ("Kepala Dinas DPMD"),
		   bukan nama orang — yang seperti itu tidak disebut sebagai nama pejabat. */
		const orang = (p) => (p && !/kepala|sekretaris|kabid|kadis|admin|dinas|bidang|dpmd|operator/i.test(p.name) ? p : null);
		const kadis = orang(pejabat.find((p) => p.role === 'kepala_dinas'));
		const sekdis = orang(pejabat.find((p) => p.role === 'sekretaris_dinas'));
		if (kadis) baris.push(`Kepala Dinas: ${kadis.name}.`);
		if (sekdis) baris.push(`Sekretaris Dinas: ${sekdis.name}.`);
		baris.push('Bidang dan urusannya:');
		bidang.forEach((b) => {
			const kabid = orang(pejabat.find((p) => p.role === 'kepala_bidang' && p.bidang === b.nama));
			baris.push(`- ${b.nama}: ${TUGAS_BIDANG[b.id] || 'urusan sesuai tugas bidang'}${kabid ? ` (Kepala Bidang: ${kabid.name})` : ''}.`);
		});
		return { id: 'DATA-DPMD', isi: baris.join('\n') };
	});
}

async function angkaUmum() {
	return tersimpan('angka', async () => {
		const r = await Helpdesk.satu(
			`SELECT (SELECT COUNT(*) FROM kecamatans) AS kecamatan,
			        (SELECT COUNT(*) FROM desas WHERE status_pemerintahan = 'desa') AS desa,
			        (SELECT COUNT(*) FROM desas WHERE status_pemerintahan = 'kelurahan') AS kelurahan,
			        (SELECT COUNT(*) FROM bumdes) AS bumdes`
		);
		return {
			id: 'DATA-ANGKA',
			isi: `Data wilayah Kabupaten Bogor di sistem DPMD: ${r.kecamatan} kecamatan, ${r.desa} desa, dan ${r.kelurahan} kelurahan. BUMDes yang terdata di sistem: ${r.bumdes}.`,
		};
	});
}

const semuaKecamatan = () => tersimpan('kecamatan', () => Helpdesk.daftarKecamatan());

async function kecamatan(id) {
	return tersimpan(`kec-${id}`, async () => {
		const [kec, desa] = await Promise.all([
			Helpdesk.satu('SELECT id, nama, alamat, nama_camat FROM kecamatans WHERE id = ?', [id]),
			Helpdesk.daftarDesa(id),
		]);
		if (!kec) return null;
		const desaSaja = desa.filter((d) => d.status_pemerintahan !== 'kelurahan');
		const kelurahan = desa.filter((d) => d.status_pemerintahan === 'kelurahan');
		const baris = [`Kecamatan ${kec.nama}${kec.nama_camat ? ` — Camat: ${kec.nama_camat}` : ' — nama camat belum tercatat di sistem'}.`];
		baris.push(kec.alamat ? `Alamat kantor kecamatan: ${kec.alamat}.` : 'Alamat kantor kecamatan belum tercatat di sistem.');
		baris.push(`Terdiri dari ${desaSaja.length} desa${kelurahan.length ? ` dan ${kelurahan.length} kelurahan` : ''}: ${desa.map((d) => d.nama).join(', ')}.`);
		return { id: `DATA-KEC-${kec.id}`, isi: baris.join('\n') };
	});
}

const SOAL_DPMD = /\s(dpmd|dinas|kadis|kepala dinas|sekretaris dinas|sekdis|kabid|kepala bidang|bidang|struktur|pejabat)\s/;
/* Kata umum ini baru berarti "tentang DPMD" bila tidak sedang menanyakan kecamatan. */
const SOAL_UMUM = /\s(alamat|kantor|lokasi|kontak|telepon|telp|email|jam (layanan|kerja|buka)|profil)\s/;
const SOAL_ANGKA = /\s(berapa|jumlah|total|banyak)\s.*\s(kecamatan|desa|kelurahan|bumdes)\s|\s(jumlah|total)\s(kecamatan|desa|kelurahan|bumdes)\s/;
const SOAL_WILAYAH = /\s(camat|kecamatan|desa|kelurahan|alamat|wilayah)\s/;

/**
 * Potongan data resmi yang relevan dengan pertanyaan.
 * @param {string} pesan
 * @param {{wilayah}} ctx  wilayah penanya (kecamatan dari akun atau pilihan tamu)
 */
async function dataRelevan(pesan, { wilayah } = {}) {
	const t = normal(pesan);
	const hasil = [];
	const soalKecamatan = /\s(camat|kecamatan)\s/.test(t);
	if (ada(t, SOAL_DPMD) || (!soalKecamatan && ada(t, SOAL_UMUM))) hasil.push(await profilDpmd());
	if (ada(t, SOAL_ANGKA)) hasil.push(await angkaUmum());

	/* Kecamatan yang disebut namanya; bila tidak ada, kecamatan penanya saat ia
	   menanyakan camat/kantor kecamatannya sendiri. */
	if (ada(t, SOAL_WILAYAH)) {
		const daftar = await semuaKecamatan();
		const disebut = daftar.filter((k) => t.includes(` ${normal(k.nama).trim()} `)).slice(0, 2);
		const ids = disebut.length ? disebut.map((k) => k.id) : (wilayah?.kecamatan_id && /\s(camat|kecamatan)\s/.test(t) ? [wilayah.kecamatan_id] : []);
		for (const id of ids) {
			const d = await kecamatan(id);
			if (d) hasil.push(d);
		}
	}
	return hasil.filter(Boolean);
}

module.exports = { dataRelevan, lupakanSimpanan };
