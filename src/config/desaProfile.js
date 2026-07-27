/**
 * Kelengkapan identitas Admin Desa.
 *
 * DPMD perlu tahu SIAPA orang di balik akun Admin Desa dan bagaimana
 * menghubunginya, bukan sekadar nama bawaan sistem "Admin Desa <nama desa>"
 * hasil seeding. Selama tiga data ini belum lengkap, akun diblokir dari aktivitas.
 */

// Nama hasil seeding, mis. "Admin Desa Mekarsari" — bukan identitas orang.
const PLACEHOLDER_NAME_PATTERN = /^admin\s+desa\b/i;

const MIN_NAME_LENGTH = 3;
const MIN_PHONE_DIGITS = 9;
const MAX_PHONE_DIGITS = 15;

const text = (value) => String(value ?? '').trim();

/**
 * Rapikan nomor HP ke bentuk 08xxxxxxxxxx.
 * Menerima 62..., +62..., 8..., dan variasi berspasi/berstrip.
 * Mengembalikan null bila tidak masuk akal sebagai nomor HP Indonesia.
 */
const normalizePhone = (value) => {
  const digits = text(value).replace(/[^0-9+]/g, '');
  if (!digits) return null;

  let local = digits.replace(/^\+/, '');
  if (local.startsWith('62')) local = '0' + local.slice(2);
  else if (local.startsWith('8')) local = '0' + local;

  if (!/^0[0-9]+$/.test(local)) return null;
  if (local.length < MIN_PHONE_DIGITS || local.length > MAX_PHONE_DIGITS) return null;
  return local;
};

const isPlaceholderName = (name) => PLACEHOLDER_NAME_PATTERN.test(text(name));

/**
 * Validasi isian identitas. Mengembalikan { valid, errors, value }.
 */
const validateDesaProfile = ({ name, jabatan_desa, no_hp }) => {
  const errors = {};

  const cleanName = text(name);
  if (cleanName.length < MIN_NAME_LENGTH) {
    errors.name = `Nama minimal ${MIN_NAME_LENGTH} karakter`;
  } else if (isPlaceholderName(cleanName)) {
    errors.name = 'Isi dengan nama asli petugas, bukan nama bawaan sistem seperti "Admin Desa ..."';
  }

  const cleanJabatan = text(jabatan_desa);
  if (!cleanJabatan) {
    errors.jabatan_desa = 'Jabatan wajib diisi';
  } else if (cleanJabatan.length > 100) {
    errors.jabatan_desa = 'Jabatan maksimal 100 karakter';
  }

  const cleanPhone = normalizePhone(no_hp);
  if (!cleanPhone) {
    errors.no_hp = 'Nomor HP tidak valid. Contoh: 081234567890';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { name: cleanName, jabatan_desa: cleanJabatan, no_hp: cleanPhone },
  };
};

/**
 * Apakah akun ini wajib melengkapi identitas dulu sebelum boleh beraktivitas?
 * Hanya berlaku untuk Admin Desa; role lain tidak pernah diblokir.
 */
const mustCompleteDesaProfile = (user) => {
  if (!user) return false;
  if (String(user.role || '').trim().toLowerCase() !== 'admin_desa') return false;

  const name = text(user.name);
  if (name.length < MIN_NAME_LENGTH || isPlaceholderName(name)) return true;
  if (!text(user.jabatan_desa)) return true;
  if (!normalizePhone(user.no_hp)) return true;
  return false;
};

module.exports = {
  normalizePhone,
  isPlaceholderName,
  validateDesaProfile,
  mustCompleteDesaProfile,
};
