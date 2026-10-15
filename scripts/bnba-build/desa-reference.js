/**
 * desa-reference.js — pencarian kode_desa dari nama desa + kecamatan.
 *
 * Referensi disimpan offline di desa-reference.json supaya builder bisa dijalankan
 * di PC operator tanpa akses database. Segarkan dengan:
 *   node scripts/bnba-build/refresh-desa-reference.js
 */

const fs = require('fs');
const path = require('path');

const REFERENCE_PATH = path.join(__dirname, 'desa-reference.json');

function normalizeName(v) {
  return String(v == null ? '' : v)
    .toUpperCase()
    .replace(/^(DESA|KELURAHAN|KEC\.?|KECAMATAN)\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function loadReference(refPath = REFERENCE_PATH) {
  if (!fs.existsSync(refPath)) {
    throw new Error(`Referensi desa tidak ditemukan: ${refPath}. Jalankan refresh-desa-reference.js lebih dulu.`);
  }
  const raw = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  const desas = (raw.desas || []).map((d) => ({
    ...d,
    _desa: normalizeName(d.nama),
    _kecamatan: normalizeName(d.kecamatan),
  }));
  return { kecamatans: raw.kecamatans || [], desas, generated_at: raw.generated_at || null };
}

/**
 * @returns {{ok:true, desa:object} | {ok:false, reason:string, candidates:Array}}
 */
function resolveDesa(reference, { kodeDesa, namaDesa, namaKecamatan }) {
  if (kodeDesa) {
    const found = reference.desas.find((d) => d.kode === String(kodeDesa).trim());
    if (found) return { ok: true, desa: found };
    return { ok: false, reason: `kode_desa '${kodeDesa}' tidak ada di referensi`, candidates: [] };
  }

  const nd = normalizeName(namaDesa);
  const nk = normalizeName(namaKecamatan);
  if (!nd) return { ok: false, reason: 'nama desa tidak terbaca dari workbook', candidates: [] };

  let matches = reference.desas.filter((d) => d._desa === nd);
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `desa '${namaDesa}' tidak ada di referensi`,
      candidates: reference.desas.filter((d) => d._desa.startsWith(nd.slice(0, 5))).slice(0, 8),
    };
  }

  if (matches.length > 1) {
    if (!nk) {
      return {
        ok: false,
        reason: `desa '${namaDesa}' ada di ${matches.length} kecamatan dan nama kecamatan tidak terbaca`,
        candidates: matches,
      };
    }
    const byKec = matches.filter((d) => d._kecamatan === nk);
    if (byKec.length === 1) return { ok: true, desa: byKec[0] };
    return {
      ok: false,
      reason: `desa '${namaDesa}' kecamatan '${namaKecamatan}' tidak unik / tidak cocok`,
      candidates: matches,
    };
  }

  const only = matches[0];
  if (nk && only._kecamatan !== nk) {
    return {
      ok: false,
      reason: `desa '${namaDesa}' ada di kecamatan '${only.kecamatan}', bukan '${namaKecamatan}'`,
      candidates: [only],
    };
  }
  return { ok: true, desa: only };
}

module.exports = { REFERENCE_PATH, loadReference, resolveDesa, normalizeName };
