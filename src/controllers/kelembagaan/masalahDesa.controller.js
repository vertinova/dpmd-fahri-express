/**
 * Daftar masalah kelembagaan satu desa, untuk dashboard kelembagaan desa.
 * GET /api/desa/kelembagaan/masalah
 *
 * Satu respons memuat:
 * - peta: status verifikasi tiap lembaga aktif (RT dikelompokkan per RW)
 * - ditolak: lembaga & pengurus yang verifikasinya ditolak, beserta catatannya
 * - nik: pengurus aktif dengan NIK cacat (aturan dari utils/nikAnomali)
 * - bpjs: Ketua RT/RW yang datanya tidak cocok dengan master BPJS
 *   (aturan dari rtrwComparison.controller → bpjsStatusPengurus)
 */

const { prisma, validateDesaAccess } = require('./base.controller');
const { nikErrorInfo } = require('../../utils/nikAnomali');
const { warmSourceCache, bpjs } = require('./rtrwComparison.controller');

// Nilai pengurusable_type yang tersimpan → jenis lembaga & segmen URL halaman desa.
const SINGLETON = [
  { type: 'karang_tarunas', model: 'karang_tarunas', jenis: 'Karang Taruna', route: 'karang-taruna' },
  { type: 'lpms', model: 'lpms', jenis: 'LPM', route: 'lpm' },
  { type: 'pkks', model: 'pkks', jenis: 'PKK', route: 'pkk' },
  { type: 'satlinmas', model: 'satlinmas', jenis: 'Satlinmas', route: 'satlinmas' },
];

const KOLOM_VERIF = { id: true, status_verifikasi: true, catatan_verifikasi: true, verifikator_nama: true, verified_at: true };

const nomorUrut = (a, b) => (parseInt(a.nomor, 10) || 0) - (parseInt(b.nomor, 10) || 0);
const pad = (n, len) => String(n ?? '').padStart(len, '0');

class MasalahDesaController {
  async getMasalahDesa(req, res) {
    try {
      const rawDesaId = validateDesaAccess(req, res);
      if (!rawDesaId) return;
      const desaId = BigInt(rawDesaId);
      const aktif = { desa_id: desaId, status_kelembagaan: 'aktif' };

      const [desa, rws, rts, posyandus, lainnya, singletons, pengurus] = await Promise.all([
        prisma.desas.findUnique({ where: { id: desaId }, select: { kode: true } }),
        prisma.rws.findMany({ where: aktif, select: { ...KOLOM_VERIF, nomor: true } }),
        prisma.rts.findMany({ where: aktif, select: { ...KOLOM_VERIF, nomor: true, rw_id: true } }),
        prisma.posyandus.findMany({ where: aktif, select: { ...KOLOM_VERIF, nama: true }, orderBy: { nama: 'asc' } }),
        prisma.lembaga_lainnyas.findMany({ where: aktif, select: { ...KOLOM_VERIF, nama: true }, orderBy: { nama: 'asc' } }),
        // Singleton tanpa filter status: yang nonaktif tetap tampil di peta sebagai nonaktif.
        Promise.all(SINGLETON.map((s) => prisma[s.model].findFirst({
          where: { desa_id: desaId },
          select: { ...KOLOM_VERIF, status_kelembagaan: true },
        }))),
        prisma.pengurus.findMany({
          where: { desa_id: desaId, status_jabatan: 'aktif' },
          select: {
            ...KOLOM_VERIF, nama_lengkap: true, nik: true, tanggal_lahir: true, jabatan: true,
            pengurusable_type: true, pengurusable_id: true,
          },
          orderBy: { nama_lengkap: 'asc' },
        }),
      ]);

      // id lembaga aktif → { label, link }. Pengurus di lembaga nonaktif diabaikan.
      const lembaga = new Map();
      const rwNomor = new Map(rws.map((r) => [r.id, r.nomor]));
      for (const r of rws) lembaga.set(r.id, { label: `RW ${pad(r.nomor, 2)}`, link: `/desa/kelembagaan/rw/${r.id}` });
      for (const r of rts) {
        const rw = rwNomor.get(r.rw_id);
        lembaga.set(r.id, { label: `RT ${pad(r.nomor, 3)}${rw ? ` / RW ${pad(rw, 2)}` : ''}`, link: `/desa/kelembagaan/rt/${r.id}` });
      }
      for (const p of posyandus) lembaga.set(p.id, { label: p.nama, link: `/desa/kelembagaan/posyandu/${p.id}` });
      for (const l of lainnya) lembaga.set(l.id, { label: l.nama, link: `/desa/kelembagaan/lembaga-lainnya/${l.id}` });
      SINGLETON.forEach((s, i) => {
        const rec = singletons[i];
        if (rec?.status_kelembagaan === 'aktif') lembaga.set(rec.id, { label: s.jenis, link: `/desa/kelembagaan/${s.route}/detail` });
      });

      // ── Peta ──
      const rtPerRw = new Map();
      for (const rt of [...rts].sort(nomorUrut)) {
        const key = rwNomor.has(rt.rw_id) ? rt.rw_id : null;
        if (!rtPerRw.has(key)) rtPerRw.set(key, []);
        rtPerRw.get(key).push({ id: rt.id, nomor: rt.nomor, status: rt.status_verifikasi || 'unverified' });
      }
      const petaRw = [...rws].sort(nomorUrut).map((r) => ({
        id: r.id, nomor: r.nomor, status: r.status_verifikasi || 'unverified', rts: rtPerRw.get(r.id) || [],
      }));
      if (rtPerRw.has(null)) petaRw.push({ id: null, nomor: null, status: null, rts: rtPerRw.get(null) });

      const peta = {
        rw: petaRw,
        posyandu: posyandus.map((p) => ({ id: p.id, nama: p.nama, status: p.status_verifikasi || 'unverified' })),
        tunggal: SINGLETON.map((s, i) => {
          const rec = singletons[i];
          let status = null; // null = belum dibentuk
          if (rec) status = rec.status_kelembagaan === 'aktif' ? (rec.status_verifikasi || 'unverified') : 'nonaktif';
          return { jenis: s.jenis, route: s.route, status };
        }),
        lainnya: lainnya.map((l) => ({ id: l.id, nama: l.nama, status: l.status_verifikasi || 'unverified' })),
      };

      // ── Ditolak ──
      const ditolak = [];
      const tolakLembaga = (rows) => rows
        .filter((r) => r.status_verifikasi === 'ditolak' && lembaga.has(r.id))
        .forEach((r) => ditolak.push({ jenis: 'lembaga', id: r.id, nama: lembaga.get(r.id).label, konteks: 'Lembaga', link: lembaga.get(r.id).link, ...catatan(r) }));
      tolakLembaga(rws);
      tolakLembaga(rts);
      tolakLembaga(posyandus);
      tolakLembaga(lainnya);
      tolakLembaga(singletons.filter(Boolean));

      const pengurusAktif = pengurus.filter((p) => lembaga.has(p.pengurusable_id));
      for (const p of pengurusAktif) {
        if (p.status_verifikasi !== 'ditolak') continue;
        ditolak.push({
          jenis: 'pengurus', id: p.id, nama: p.nama_lengkap,
          konteks: konteksPengurus(p, lembaga),
          link: `/desa/pengurus/${p.id}`, ...catatan(p),
        });
      }
      ditolak.sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || '')));

      // ── NIK ──
      const nik = [];
      for (const p of pengurusAktif) {
        const err = nikErrorInfo(p.nik, p.tanggal_lahir);
        if (!err) continue;
        nik.push({
          id: p.id, nama: p.nama_lengkap, konteks: konteksPengurus(p, lembaga),
          nik: p.nik || '', tanggal_lahir: p.tanggal_lahir, sebab: err.sebab, label: err.label,
          link: `/desa/pengurus/${p.id}`,
        });
      }

      // ── BPJS (Ketua RT/RW) ──
      // Data master BPJS bisa gagal dimuat; masalah lain tetap dikirim.
      // Hanya Ketua RT/RW yang ditanggung BPJS. Jumlahnya dikirim terpisah agar
      // dashboard tetap bisa menyebut cakupannya walau master BPJS gagal dimuat.
      const semuaKetua = pengurusAktif.filter((p) => ['rts', 'rws', 'rt', 'rw'].includes(p.pengurusable_type)
        && bpjs.isKetuaRtRw(p.jabatan));
      const ketua = semuaKetua.filter((p) => bpjs.normalizeNik(p.nik));
      const jumlah = { jumlah_ketua: semuaKetua.length, ketua_tanpa_nik: semuaKetua.length - ketua.length };
      let bpjsHasil = { tersedia: false, periode: null, items: [], ...jumlah };
      try {
        const index = bpjs.getBpjsNikIndex(await warmSourceCache());
        // Cakupan dinilai terhadap periode terbaru yang ada di master, bukan bulan
        // kalender: kalau master belum memuat bulan ini, semua ketua akan tampak
        // tidak tercover.
        const periode = index.periodeTerbaru || bpjs.bulanBerjalanWib();
        const getItems = bpjs.desaComparisonItems(desa?.kode);
        const items = [];
        for (const p of ketua) {
          const s = await bpjs.bpjsStatusPengurus(p, index, periode, getItems);
          const temuan = temuanBpjs(s);
          if (temuan) {
            items.push({
              id: p.id, nama: p.nama_lengkap, nik: p.nik, konteks: konteksPengurus(p, lembaga),
              link: `/desa/pengurus/${p.id}`, ...temuan,
            });
          }
        }
        bpjsHasil = { tersedia: true, periode, items, ...jumlah };
      } catch (error) {
        console.error('getMasalahDesa: data BPJS tidak dapat dimuat:', error.message);
      }

      res.json({ success: true, data: { peta, ditolak, nik, bpjs: bpjsHasil } });
    } catch (error) {
      console.error('Error in getMasalahDesa:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil daftar masalah kelembagaan', error: error.message });
    }
  }
}

function catatan(r) {
  return { catatan: r.catatan_verifikasi || null, verifikator: r.verifikator_nama || null, tanggal: r.verified_at || null };
}

/** "SEKRETARIS, RT 003 / RW 02"; nama lembaga tak diulang bila sudah ada di jabatan ("SEKRETARIS PKK"). */
function konteksPengurus(p, lembaga) {
  const label = lembaga.get(p.pengurusable_id).label;
  const jabatan = String(p.jabatan || '').trim();
  return jabatan.toUpperCase().includes(label.toUpperCase()) ? jabatan : `${jabatan}, ${label}`;
}

/** Status BPJS → temuan yang perlu ditindak, atau null bila sesuai. Urut dari yang terberat. */
function temuanBpjs(s) {
  if (s.nik_dipakai_lain) return { temuan: 'nik_dipakai_lain', berat: true, nama_bpjs: s.nik_dipakai_lain.nama };
  if (s.nik_berbeda) return { temuan: 'nik_berbeda', berat: true, nik_bpjs: s.nik_berbeda.nik_bpjs, nama_bpjs: s.nik_berbeda.nama_bpjs };
  if (!s.terdaftar) return { temuan: 'belum_terdaftar', berat: false };
  if (!s.tercover) return { temuan: 'tidak_tercover', berat: false, blth_terakhir: s.peserta?.blth_terakhir || null };
  return null;
}

module.exports = new MasalahDesaController();
module.exports._internals = { temuanBpjs };
