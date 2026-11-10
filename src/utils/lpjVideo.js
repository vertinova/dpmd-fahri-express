// Validasi link video LPJ Bantuan Keuangan (TA 2026+).
const KATEGORI_VIDEO = ['dayeuh_pajajaran', 'infrastruktur'];
const MIN_VIDEO = 3;
const MAX_VIDEO = 10;

function normalisasiDaftarVideo(nilai) {
  if (!Array.isArray(nilai)) return { ok: false, pesan: 'daftar link harus berupa array' };

  const daftar = [];
  for (const item of nilai) {
    const teks = typeof item === 'string' ? item.trim() : '';
    if (!teks) continue;
    if (teks.length > 500) return { ok: false, pesan: 'link maksimal 500 karakter' };
    let url;
    try { url = new URL(teks); } catch (e) { return { ok: false, pesan: `link tidak valid: ${teks}` }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, pesan: `link harus diawali http:// atau https://: ${teks}` };
    }
    if (!daftar.includes(teks)) daftar.push(teks);
  }

  if (daftar.length < MIN_VIDEO) return { ok: false, pesan: `minimal ${MIN_VIDEO} link berbeda` };
  if (daftar.length > MAX_VIDEO) return { ok: false, pesan: `maksimal ${MAX_VIDEO} link` };
  return { ok: true, daftar };
}

// Json dari MariaDB bisa berupa string; parse bila perlu.
function keArray(nilai) {
  if (typeof nilai === 'string') {
    try { nilai = JSON.parse(nilai); } catch (e) { return []; }
  }
  return Array.isArray(nilai) ? nilai : [];
}

function videoLengkap(baris) {
  if (!baris) return false;
  return KATEGORI_VIDEO.every((k) => keArray(baris[k]).length >= MIN_VIDEO);
}

module.exports = { KATEGORI_VIDEO, MIN_VIDEO, MAX_VIDEO, normalisasiDaftarVideo, videoLengkap, keArray };
