/**
 * Fitur kecamatan yang boleh diberikan staf bidang saat membuatkan operator
 * kecamatan. Salah petakan di sini = staf PMD bisa memberi akses verifikasi
 * Bankeu ke operator kecamatan.
 */

const {
  KECAMATAN_PERMISSION_KEYS,
  kecamatanKeysUntukModul,
  sanitizeKecamatanPermissionKeys,
} = require('../kecamatanPermissions');

describe('kecamatanKeysUntukModul', () => {
  it('memetakan modul bidang ke fiturnya sendiri saja', () => {
    expect(kecamatanKeysUntukModul('kelembagaan')).toEqual(['kelembagaan']);
    expect(kecamatanKeysUntukModul('bumdes')).toEqual(['bumdes']);
    expect(kecamatanKeysUntukModul('aparatur-desa')).toEqual(['aparatur-desa']);
    expect(kecamatanKeysUntukModul('bankeu').sort()).toEqual(['bankeu', 'bankeu-perubahan']);
  });

  it('modul tanpa fitur kecamatan dan tanpa modul tidak memberi apa pun', () => {
    expect(kecamatanKeysUntukModul('kerjasama-desa')).toEqual([]);
    expect(kecamatanKeysUntukModul(null)).toEqual([]);
    expect(kecamatanKeysUntukModul('tidak-ada')).toEqual([]);
  });

  it('semua fitur hasil pemetaan ada di katalog kecamatan', () => {
    ['bankeu', 'bumdes', 'kelembagaan', 'aparatur-desa'].forEach((m) => {
      kecamatanKeysUntukModul(m).forEach((k) => expect(KECAMATAN_PERMISSION_KEYS).toContain(k));
    });
  });
});

describe('sanitizeKecamatanPermissionKeys', () => {
  it('membuang key asing dan duplikat', () => {
    expect(sanitizeKecamatanPermissionKeys(['bankeu', 'bankeu', 'profil-desa', ' pesan '])).toEqual(['bankeu', 'pesan']);
    expect(sanitizeKecamatanPermissionKeys('bankeu')).toEqual([]);
  });
});
