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
  tgl_lahir_tertukar: 'Tanggal & Bulan Lahir Tertukar',
};

// Dua sebab di bawah ini soal kecocokan NIK dengan tanggal lahir, bukan bentuk
// NIK-nya — dipisah ke tab sendiri karena bobot masalahnya jauh lebih ringan
// (penomoran Dukcapil pun tidak selalu mengikuti tanggal lahir).
const NIK_ERROR_TGL = ['tgl_lahir', 'tgl_lahir_tertukar'];

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
    const nikBulan = Number(digits.slice(8, 10));
    const tahunSama = digits.slice(10, 12) === String(yyyy).slice(2);
    if (nikHari === Number(dd) && nikBulan === Number(mm) && tahunSama) return '';
    // Tanggal & bulan tertukar: NIK-nya justru benar, yang keliru biasanya
    // tanggal lahir di database (terinput/terimpor dengan urutan terbalik).
    // Bulan pada NIK harus bulan yang benar-benar ada — kalau 17, itu NIK-nya
    // yang salah ketik, bukan tanggal lahirnya yang terbalik.
    if (tahunSama && nikBulan >= 1 && nikBulan <= 12
      && nikHari === Number(mm) && nikBulan === Number(dd)) return 'tgl_lahir_tertukar';
    return 'tgl_lahir';
  }
  return '';
}

/** Sebab + labelnya, siap dikirim ke UI. null bila NIK wajar. */
function nikErrorInfo(rawNik, tglLahir) {
  const sebab = nikErrorSebab(rawNik, tglLahir);
  return sebab ? { sebab, label: NIK_ERROR_LABEL[sebab] || sebab } : null;
}

module.exports = { nikErrorSebab, nikErrorInfo, NIK_ERROR_LABEL, NIK_ERROR_TGL };
