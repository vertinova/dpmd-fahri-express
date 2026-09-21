/**
 * Dua aturan yang menopang fitur Akun Operator per fitur, dan keduanya jenis
 * aturan yang rusak tanpa suara:
 *
 *   1. Modul hanya boleh MEMPERSEMPIT wewenang bidang, tidak pernah menambah.
 *      Kalau suatu saat irisannya berubah jadi penggantian, staf PMD bisa
 *      membuat akun bankeu dan tidak ada yang tahu sampai akunnya dipakai.
 *   2. Template email wajib menghasilkan alamat berbeda untuk tiap desa.
 *      Template yang salah baru ketahuan setelah ratusan akun gagal dibuat.
 */

const {
  getAllowedPermissionKeys,
  getCorePermissionKeys,
  canManageDesaAccounts,
  mergePermissions,
  sanitizeForActor,
} = require('../bidangDesaPermissions');

const { periksaTemplate, susunEmail, TEMPLATE_BAWAAN } = require('../templateAkunDesa');

const spked = { role: 'pegawai', bidang_id: 3 };
const pmd = { role: 'pegawai', bidang_id: 5 };
const sekretariat = { role: 'pegawai', bidang_id: 2 };
const superadmin = { role: 'superadmin' };

describe('penyempitan wewenang per modul', () => {
  it('SPKED tanpa modul memegang seluruh fitur bidangnya', () => {
    expect(getAllowedPermissionKeys(spked)).toEqual(
      expect.arrayContaining(['bankeu', 'bankeu-perubahan', 'bumdes', 'bantuan-provinsi-lpj']),
    );
  });

  it('modul bankeu menyisakan bankeu saja, bukan seluruh fitur SPKED', () => {
    expect(getAllowedPermissionKeys(spked, 'bankeu').sort()).toEqual(['bankeu', 'pesan']);
    expect(getCorePermissionKeys(spked, 'bankeu')).toEqual(['bankeu']);
  });

  it('modul bumdes menyisakan bumdes saja', () => {
    expect(getAllowedPermissionKeys(spked, 'bumdes').sort()).toEqual(['bumdes', 'pesan']);
    expect(getCorePermissionKeys(spked, 'bumdes')).toEqual(['bumdes']);
  });

  it('modul tidak pernah memberi fitur yang bukan milik bidang', () => {
    // PMD hanya memegang kelembagaan; membuka modul bankeu tidak boleh
    // memberinya bankeu, dan gerbang rute harus menolaknya.
    expect(getAllowedPermissionKeys(pmd, 'bankeu')).toEqual([]);
    expect(canManageDesaAccounts(pmd, 'bankeu')).toBe(false);
    expect(canManageDesaAccounts(pmd)).toBe(true);
  });

  it('bidang tanpa fitur desa tetap ditolak, dengan atau tanpa modul', () => {
    expect(canManageDesaAccounts(sekretariat)).toBe(false);
    expect(canManageDesaAccounts(sekretariat, 'bumdes')).toBe(false);
  });

  it('peran lintas bidang ikut menyempit saat modul dibuka', () => {
    expect(getAllowedPermissionKeys(superadmin, 'bumdes').sort()).toEqual(['bumdes', 'pesan']);
    expect(getAllowedPermissionKeys(superadmin)).toEqual(expect.arrayContaining(['kelembagaan']));
  });
});

describe('penyimpanan hak akses saat modul dibuka', () => {
  it('fitur di luar modul dipertahankan, tidak ikut terhapus', () => {
    // Akun desa yang sudah memegang bumdes (dari tab BUMDes) dan kelembagaan
    // (dari PMD) tidak boleh kehilangan keduanya karena disimpan dari tab Bankeu.
    const sesudah = mergePermissions(['bumdes', 'kelembagaan'], ['bankeu'], spked, 'bankeu');
    expect(sesudah.sort()).toEqual(['bankeu', 'bumdes', 'kelembagaan']);
  });

  it('kiriman fitur di luar modul diabaikan', () => {
    expect(sanitizeForActor(['bankeu', 'bumdes'], spked, 'bankeu')).toEqual(['bankeu']);
  });
});

describe('template username massal', () => {
  it('template bawaan menghasilkan bentuk yang dipakai bidang', () => {
    const email = susunEmail(TEMPLATE_BAWAAN.replace('{fitur}', 'bumdes'), {
      fitur: 'bumdes',
      kecamatan: 'Caringin',
      desa: 'Caringin',
      kode: '3201052001',
    });
    expect(email).toBe('bumdes.caringin.caringin@dpmd.bogorkab.go.id');
  });

  it('nama berspasi dan beraksen dirapatkan', () => {
    const email = susunEmail('{fitur}.{kecamatan}.{desa}@dpmd.bogorkab.go.id', {
      fitur: 'bankeu',
      kecamatan: 'Cibinong Raya',
      desa: 'Suka Maju',
      kode: '0',
    });
    expect(email).toBe('bankeu.cibinongraya.sukamaju@dpmd.bogorkab.go.id');
  });

  it('menolak template tanpa pembeda antar desa', () => {
    expect(periksaTemplate('bankeu.{kecamatan}@dpmd.bogorkab.go.id').valid).toBe(false);
  });

  it('menolak template yang bukan alamat email', () => {
    expect(periksaTemplate('bankeu.{desa}').valid).toBe(false);
  });

  it('menolak token yang tidak dikenali', () => {
    expect(periksaTemplate('{fitur}.{desa}.{provinsi}@dpmd.bogorkab.go.id').valid).toBe(false);
  });

  it('menerima template yang memakai kode wilayah', () => {
    expect(periksaTemplate('operator{kode}@dpmd.bogorkab.go.id').valid).toBe(true);
  });
});
