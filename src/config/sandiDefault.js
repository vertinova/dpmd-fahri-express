/**
 * Sandi bawaan aplikasi.
 *
 * Dipakai dua arah: auth.controller memeriksa apakah sebuah akun masih memakai
 * sandi ini (lalu memaksa penggantian saat login), dan Gema memakainya saat
 * menyetel ulang sandi akun pegawai. Nilainya harus satu supaya "disetel ulang
 * ke sandi default" benar-benar memicu layar ganti sandi.
 */
const SANDI_DEFAULT = 'password';

module.exports = { SANDI_DEFAULT };
