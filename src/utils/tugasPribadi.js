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
 * Isi push pengingat dari tugas belum selesai yang tanggal pengingatnya <= hari ini atau kosong.
 * @param {Array<{judul: string, tanggal_pengingat: Date|null}>} daftar  yang bertanggal (lewat) dulu
 * @param {string} hari  'YYYY-MM-DD' (WIB)
 */
function susunPengingat(daftar, hari) {
  // tugas tanpa tanggal pengingat = diingatkan sejak dibuat, tidak pernah "lewat"
  const lewat = daftar.filter((t) => t.tanggal_pengingat && t.tanggal_pengingat.toISOString().slice(0, 10) < hari).length;
  if (daftar.length === 1) {
    return { title: lewat ? '📝 Tugas lewat tanggal' : '📝 Tugas belum selesai', body: daftar[0].judul };
  }
  const judul = `${daftar.length} tugas belum selesai${lewat ? ` · ${lewat} lewat tanggal` : ''}`;
  const sisa = daftar.length > 3 ? `\n+${daftar.length - 3} lainnya` : '';
  return { title: `📝 ${judul}`, body: daftar.slice(0, 3).map((t) => `• ${t.judul}`).join('\n') + sisa };
}

const MAKS_JUDUL_CATATAN = 120;
const MAKS_ISI_CATATAN = 20000;

/**
 * @param {object} body
 * @param {boolean} ubah  true untuk PATCH: semua field opsional kecuali `versi`, minimal satu perubahan
 * @returns {{ data: object, versi?: number } | { galat: string }}
 */
function bacaCatatan(body, ubah = false) {
  const b = body && typeof body === 'object' ? body : {};
  const data = {};
  if (b.judul !== undefined) {
    if (typeof b.judul !== 'string' || b.judul.trim().length > MAKS_JUDUL_CATATAN) return { galat: `Judul maksimal ${MAKS_JUDUL_CATATAN} karakter` };
    data.judul = b.judul.trim();
  }
  if (b.isi !== undefined) {
    if (typeof b.isi !== 'string' || b.isi.length > MAKS_ISI_CATATAN) return { galat: `Isi catatan maksimal ${MAKS_ISI_CATATAN.toLocaleString('id-ID')} karakter` };
    data.isi = b.isi;
  }
  if (b.disematkan !== undefined) {
    if (typeof b.disematkan !== 'boolean') return { galat: 'Status sematan harus true/false' };
    data.disematkan = b.disematkan;
  }
  if (!ubah) return { data: { judul: '', isi: '', disematkan: false, ...data } };
  if (!Number.isInteger(b.versi) || b.versi < 0) return { galat: 'Versi catatan wajib dikirim' };
  if (Object.keys(data).length === 0) return { galat: 'Tidak ada perubahan' };
  return { data, versi: b.versi };
}

const bentukCatatan = (c) => ({ id: c.id, judul: c.judul, isi: c.isi, disematkan: c.disematkan, versi: c.versi, created_at: c.created_at, updated_at: c.updated_at });

module.exports = { bacaMasukan, bentukTugas, susunPengingat, MAKS_JUDUL, bacaCatatan, bentukCatatan };
