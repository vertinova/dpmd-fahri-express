// Validasi & bentuk respons STS pengembalian dana Bankeu (diuji terpisah).
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const hariIniWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const bacaTahun = (v) => { const t = Number(v); return Number.isInteger(t) && t >= 2025 && t <= 2100 ? t : null; };

/** Body multipart STS (semua string). */
function bacaSts(body, hari = hariIniWib()) {
  const b = body || {};
  const tahun = bacaTahun(b.tahun_anggaran);
  if (!tahun) return { galat: 'Tahun anggaran tidak valid' };
  const angka = String(b.nominal ?? '').replace(/[.\s]/g, '');
  if (!/^\d{1,13}$/.test(angka) || Number(angka) <= 0) return { galat: 'Nominal setor wajib diisi (angka rupiah lebih dari 0)' };
  const t = String(b.tanggal_setor ?? '');
  const tgl = POLA_TANGGAL.test(t) ? new Date(`${t}T00:00:00Z`) : null;
  if (!tgl || Number.isNaN(tgl.getTime()) || tgl.toISOString().slice(0, 10) !== t) return { galat: 'Tanggal setor tidak valid' };
  if (t > hari) return { galat: 'Tanggal setor tidak boleh di masa depan' };
  return { data: { tahun_anggaran: tahun, nominal: BigInt(angka), tanggal_setor: tgl } };
}


const bentukSts = (s) => ({
  id: s.id, tahun_anggaran: s.tahun_anggaran, nominal: Number(s.nominal),
  tanggal_setor: s.tanggal_setor.toISOString().slice(0, 10),
  nama_file: s.nama_file, file_path: s.file_path, file_size: s.file_size, created_at: s.created_at,
});

module.exports = { bacaTahun, bacaSts, bentukSts, hariIniWib };
