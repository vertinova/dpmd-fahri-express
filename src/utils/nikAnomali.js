/**
 * Deteksi cacat bentuk NIK pengurus. Satu sumber aturan untuk dua pemakai:
 * tab "NIK Error Database" di persandingan RT/RW (rtrwComparison.controller.js)
 * dan peringatan di detail pengurus (pengurus.controller.js showPengurus).
 *
 * Format NIK: 6 digit kode wilayah + DDMMYY (perempuan: DD+40) + 4 digit urut.
 */

const NIK_ERROR_LABEL = {
  kosong: 'NIK Kosong',
  digit_kurang: 'Digit NIK Kurang dari 16',
  digit_lebih: 'Digit NIK Lebih dari 16',
  nol_belakang: 'Enam Angka Nol di Belakang',
  tgl_lahir: 'Tanggal Lahir pada NIK Tidak Sesuai',
};

/** Tanggal (Date dari Prisma @db.Date, atau string) menjadi 'YYYY-MM-DD'. */
function toIsoDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

/**
 * Sebab cacat NIK, atau '' bila wajar. Dinilai dari NIK mentah (bukan hasil
 * normalizeNik(), yang sudah membuang NIK di bawah 10 digit).
 */
function nikErrorSebab(rawNik, tglLahir) {
  const digits = String(rawNik ?? '').replace(/\D/g, '');
  if (!digits) return 'kosong';
  if (digits.length !== 16) return digits.length < 16 ? 'digit_kurang' : 'digit_lebih';
  if (/0{6}$/.test(digits)) return 'nol_belakang';
  const iso = toIsoDate(tglLahir);
  if (iso) {
    const [yyyy, mm, dd] = iso.split('-');
    const nikHari = Number(digits.slice(6, 8)) % 40; // perempuan: tanggal + 40
    if (nikHari !== Number(dd)
      || Number(digits.slice(8, 10)) !== Number(mm)
      || digits.slice(10, 12) !== String(yyyy).slice(2)) return 'tgl_lahir';
  }
  return '';
}

/** Sebab + labelnya, siap dikirim ke UI. null bila NIK wajar. */
function nikErrorInfo(rawNik, tglLahir) {
  const sebab = nikErrorSebab(rawNik, tglLahir);
  return sebab ? { sebab, label: NIK_ERROR_LABEL[sebab] || sebab } : null;
}

module.exports = { nikErrorSebab, nikErrorInfo, NIK_ERROR_LABEL };
