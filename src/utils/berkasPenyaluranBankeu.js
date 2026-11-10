// Berkas data penyaluran Bankeu per tahap & tahun anggaran. TA 2025 memakai nama
// lama (bankeu-tahap1.json) karena landing page & dasbor lain sudah merujuknya.
const TAHUN_LAMA = 2025;

/** Tahun dari query/body; selain bilangan bulat 2026..2100 → 2025 (perilaku lama). */
const tahunPenyaluran = (nilai) => {
  const t = Number(nilai);
  return Number.isInteger(t) && t >= 2026 && t <= 2100 ? t : TAHUN_LAMA;
};

/** Nama berkas di public/ untuk tahap (1|2) & tahun hasil tahunPenyaluran. */
const namaBerkasPenyaluran = (tahap, tahun) =>
  tahun === TAHUN_LAMA ? `bankeu-tahap${tahap}.json` : `bankeu-tahap${tahap}-${tahun}.json`;

module.exports = { TAHUN_LAMA, tahunPenyaluran, namaBerkasPenyaluran };
