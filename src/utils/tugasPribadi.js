// Validasi masukan tugas pribadi (dipakai controller dan diuji terpisah).
const MAKS_JUDUL = 160;
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {object} body  req.body
 * @param {boolean} sebagian  true untuk PATCH (semua field opsional, minimal satu)
 * @returns {{ data: object } | { galat: string }}
 */
function bacaMasukan(body, sebagian = false) {
  const b = body && typeof body === 'object' ? body : {};
  const data = {};
  if (!sebagian || b.judul !== undefined) {
    const judul = typeof b.judul === 'string' ? b.judul.trim() : '';
    if (!judul || judul.length > MAKS_JUDUL) return { galat: `Judul wajib diisi (maks. ${MAKS_JUDUL} karakter)` };
    data.judul = judul;
  }
  if (b.tanggal_pengingat !== undefined) {
    const t = b.tanggal_pengingat;
    if (t === null || t === '') data.tanggal_pengingat = null;
    else {
      const tgl = typeof t === 'string' && POLA_TANGGAL.test(t) ? new Date(`${t}T00:00:00Z`) : null;
      // tolak tanggal mustahil seperti 2026-02-31 yang digeser Date ke Maret
      if (!tgl || Number.isNaN(tgl.getTime()) || tgl.toISOString().slice(0, 10) !== t) return { galat: 'Tanggal pengingat tidak valid' };
      data.tanggal_pengingat = tgl;
    }
  }
  if (sebagian && b.selesai !== undefined) {
    if (typeof b.selesai !== 'boolean') return { galat: 'Status selesai harus true/false' };
    data.selesai = b.selesai;
  }
  if (sebagian && Object.keys(data).length === 0) return { galat: 'Tidak ada perubahan' };
  return { data };
}

/** Bentuk respons: tanggal pengingat sebagai 'YYYY-MM-DD' (kolom DATE dibaca Prisma sebagai tengah malam UTC). */
const bentukTugas = (t) => ({
  id: t.id,
  judul: t.judul,
  selesai: t.selesai,
  tanggal_pengingat: t.tanggal_pengingat ? t.tanggal_pengingat.toISOString().slice(0, 10) : null,
  created_at: t.created_at,
  updated_at: t.updated_at,
});

/**
 * Isi push pengingat pagi dari tugas belum selesai yang tanggal pengingatnya <= hari ini.
 * @param {Array<{judul: string, tanggal_pengingat: Date}>} daftar  urut tanggal naik (yang lewat dulu)
 * @param {string} hari  'YYYY-MM-DD' (WIB)
 */
function susunPengingat(daftar, hari) {
  const lewat = daftar.filter((t) => t.tanggal_pengingat.toISOString().slice(0, 10) < hari).length;
  const kini = daftar.length - lewat;
  if (daftar.length === 1) {
    return { title: lewat ? '📝 Tugas lewat tanggal' : '📝 Pengingat tugas hari ini', body: daftar[0].judul };
  }
  const judul = [kini && `${kini} tugas hari ini`, lewat && `${lewat} lewat tanggal`].filter(Boolean).join(' · ');
  const sisa = daftar.length > 3 ? `\n+${daftar.length - 3} lainnya` : '';
  return { title: `📝 ${judul}`, body: daftar.slice(0, 3).map((t) => `• ${t.judul}`).join('\n') + sisa };
}

module.exports = { bacaMasukan, bentukTugas, susunPengingat, MAKS_JUDUL };
