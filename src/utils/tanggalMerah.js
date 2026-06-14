/**
 * Util pengecekan "tanggal merah" untuk generate Berita Acara & Surat Pengantar.
 * Tanggal merah = Sabtu/Minggu (weekend) ATAU terdaftar di tabel hari_libur (libur nasional).
 */

const { sequelize } = require('../models');

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Normalisasi input tanggal menjadi string 'YYYY-MM-DD' (tanpa pengaruh timezone).
 * Menerima 'YYYY-MM-DD', ISO string, atau Date.
 * @returns {string|null}
 */
function toYmd(tanggal) {
  if (!tanggal) return null;
  if (typeof tanggal === 'string') {
    const m = tanggal.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = new Date(tanggal);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Apakah tanggal jatuh di akhir pekan (Sabtu/Minggu).
 * Memakai UTC agar string 'YYYY-MM-DD' tidak bergeser oleh timezone server.
 */
function isWeekend(ymd) {
  if (!ymd) return false;
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Minggu, 6 = Sabtu
  return day === 0 || day === 6;
}

/**
 * Cek apakah sebuah tanggal merupakan tanggal merah.
 * @param {string|Date} tanggal
 * @returns {Promise<{merah: boolean, alasan: string|null, tanggal: string|null}>}
 */
async function checkTanggalMerah(tanggal) {
  const ymd = toYmd(tanggal);
  if (!ymd) {
    return { merah: false, alasan: null, tanggal: null };
  }

  if (isWeekend(ymd)) {
    const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    return { merah: true, alasan: `Hari ${HARI[day]} (akhir pekan)`, tanggal: ymd };
  }

  const [libur] = await sequelize.query(
    `SELECT keterangan FROM hari_libur WHERE tanggal = :ymd AND is_active = 1 LIMIT 1`,
    { replacements: { ymd }, type: sequelize.QueryTypes.SELECT }
  );

  if (libur) {
    return { merah: true, alasan: `Hari libur: ${libur.keterangan}`, tanggal: ymd };
  }

  return { merah: false, alasan: null, tanggal: ymd };
}

/**
 * Ambil daftar hari libur aktif (opsional difilter per tahun).
 * Dipakai frontend untuk menonaktifkan tanggal di date picker.
 * @param {number|string} [tahun]
 */
async function getHariLibur(tahun) {
  let where = 'is_active = 1';
  const replacements = {};
  if (tahun) {
    where += ' AND YEAR(tanggal) = :tahun';
    replacements.tahun = tahun;
  }
  return sequelize.query(
    `SELECT id, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, keterangan, is_active
     FROM hari_libur WHERE ${where} ORDER BY tanggal ASC`,
    { replacements, type: sequelize.QueryTypes.SELECT }
  );
}

module.exports = { checkTanggalMerah, getHariLibur, isWeekend, toYmd };
