/**
 * Pengelolaan hak akses Smart CCTV oleh superadmin.
 *
 *   GET  /api/smart-cctv/akses/saya      izin pengguna yang sedang masuk (semua staf)
 *   GET  /api/smart-cctv/akses           daftar staf DPMD beserta izinnya (superadmin)
 *   PUT  /api/smart-cctv/akses/:userId   atur izin satu staf (superadmin)
 *   PUT  /api/smart-cctv/akses           atur izin banyak staf sekaligus (superadmin)
 *   GET  /api/smart-cctv/akses/riwayat   jejak perubahan akses (superadmin)
 *
 * Setiap perubahan dicatat di activity_logs (module "smart_cctv_akses"), cache izin
 * pengguna dibuang, dan room socket peringatan disesuaikan saat itu juga.
 */

const prisma = require('../config/prisma');
const ActivityLogger = require('../utils/activityLogger');
const { IZIN_CCTV, izinCctv, lupakanIzinCctv, isSuperadmin } = require('../middlewares/cctvAccess');
const { segarkanRoomCctv } = require('../socket/cctv.socket');

const MODUL = 'smart_cctv_akses';
const STAF = ['superadmin', 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'bendahara', 'pegawai'];
const NAMA_IZIN = { lihat: 'Lihat', peringatan: 'Peringatan', kamera: 'Kamera', wajah: 'Wajah' };

const angka = (v) => (typeof v === 'bigint' ? Number(v) : v);

const saya = async (req, res) => {
  try {
    const izin = await izinCctv(req.user);
    return res.json({ success: true, data: { izin, superadmin: isSuperadmin(req.user) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal memuat akses Smart CCTV' });
  }
};

const daftar = async (req, res) => {
  try {
    const [users, bidang, akses] = await Promise.all([
      prisma.users.findMany({
        where: { role: { in: STAF }, is_active: true },
        select: { id: true, name: true, email: true, role: true, bidang_id: true, avatar: true, last_active_at: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      }),
      prisma.bidangs.findMany({ select: { id: true, nama: true } }),
      prisma.cctv_akses.findMany(),
    ]);
    const namaBidang = new Map(bidang.map((b) => [Number(b.id), b.nama]));
    const pemberi = new Map(
      (await prisma.users.findMany({ where: { id: { in: [...new Set(akses.map((a) => a.diberi_oleh).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [
        String(u.id),
        u.name,
      ]),
    );
    const kini = Date.now();
    const perUser = new Map();
    for (const a of akses) {
      const k = String(a.user_id);
      if (!perUser.has(k)) perUser.set(k, []);
      perUser.get(k).push(a);
    }
    const data = users.map((u) => {
      const baris = perUser.get(String(u.id)) || [];
      const aktif = baris.filter((b) => !b.berlaku_sampai || b.berlaku_sampai.getTime() > kini);
      const terakhir = baris.reduce((m, b) => (!m || (b.created_at && b.created_at > m.created_at) ? b : m), null);
      return {
        id: angka(u.id),
        nama: u.name,
        email: u.email,
        role: u.role,
        bidang: u.bidang_id ? namaBidang.get(Number(u.bidang_id)) || null : null,
        avatar: u.avatar,
        terakhir_aktif: u.last_active_at,
        superadmin: u.role === 'superadmin',
        izin: u.role === 'superadmin' ? [...IZIN_CCTV] : aktif.map((b) => b.izin),
        kedaluwarsa: baris.filter((b) => b.berlaku_sampai && b.berlaku_sampai.getTime() <= kini).map((b) => b.izin),
        berlaku_sampai: aktif.find((b) => b.berlaku_sampai)?.berlaku_sampai || null,
        diberi_oleh: terakhir?.diberi_oleh ? pemberi.get(String(terakhir.diberi_oleh)) || null : null,
        diberi_pada: terakhir?.created_at || null,
      };
    });
    const ringkasan = Object.fromEntries(IZIN_CCTV.map((i) => [i, data.filter((d) => !d.superadmin && d.izin.includes(i)).length]));
    ringkasan.berakses = data.filter((d) => !d.superadmin && d.izin.length).length;
    ringkasan.total = data.filter((d) => !d.superadmin).length;
    return res.json({ success: true, data, ringkasan, izin: IZIN_CCTV });
  } catch (err) {
    console.error('[cctvAkses] daftar:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat daftar akses' });
  }
};

// Validasi masukan: izin dari daftar baku, tanggal berlaku (opsional) harus di masa depan.
function bacaMasukan(body) {
  const izin = Array.isArray(body?.izin) ? [...new Set(body.izin.filter((i) => IZIN_CCTV.includes(i)))] : null;
  if (!izin) return { galat: 'Daftar izin tidak valid' };
  let sampai = null;
  if (body.berlaku_sampai) {
    sampai = new Date(body.berlaku_sampai);
    if (Number.isNaN(sampai.getTime())) return { galat: 'Tanggal berlaku tidak valid' };
    if (sampai.getTime() <= Date.now()) return { galat: 'Tanggal berlaku harus di masa depan' };
  }
  return { izin, sampai };
}

async function terapkan(req, target, izin, sampai) {
  const lama = (await prisma.cctv_akses.findMany({ where: { user_id: target.id }, select: { izin: true } })).map((b) => b.izin);
  await prisma.$transaction([
    prisma.cctv_akses.deleteMany({ where: { user_id: target.id } }),
    ...(izin.length
      ? [prisma.cctv_akses.createMany({ data: izin.map((i) => ({ user_id: target.id, izin: i, berlaku_sampai: sampai, diberi_oleh: BigInt(req.user.id) })) })]
      : []),
  ]);
  lupakanIzinCctv(target.id);
  segarkanRoomCctv(target.id, izin.includes('peringatan'));
  const teks = izin.length ? izin.map((i) => NAMA_IZIN[i]).join(', ') : 'tanpa akses';
  ActivityLogger.log({
    userId: req.user.id,
    userName: req.user.name || `User ${req.user.id}`,
    userRole: req.user.role,
    module: MODUL,
    action: izin.length ? 'update' : 'delete',
    entityType: 'user',
    entityId: target.id,
    entityName: target.name,
    description: `${req.user.name || 'Superadmin'} mengatur akses Smart CCTV ${target.name}: ${teks}${sampai ? ` (berlaku sampai ${sampai.toLocaleDateString('id-ID')})` : ''}`,
    oldValue: { izin: lama },
    newValue: { izin, berlaku_sampai: sampai },
    ipAddress: ActivityLogger.getIpFromRequest(req),
    userAgent: ActivityLogger.getUserAgentFromRequest(req),
  });
}

const atur = async (req, res) => {
  try {
    const { izin, sampai, galat } = bacaMasukan(req.body);
    if (galat) return res.status(400).json({ success: false, message: galat });
    const id = /^\d+$/.test(req.params.userId) ? BigInt(req.params.userId) : null;
    const target = id && (await prisma.users.findUnique({ where: { id }, select: { id: true, name: true, role: true } }));
    if (!target || !STAF.includes(target.role)) return res.status(404).json({ success: false, message: 'Staf tidak ditemukan' });
    if (target.role === 'superadmin') return res.status(400).json({ success: false, message: 'Superadmin selalu berakses penuh' });
    await terapkan(req, target, izin, sampai);
    return res.json({ success: true, message: `Akses ${target.name} diperbarui`, data: { id: angka(target.id), izin, berlaku_sampai: sampai } });
  } catch (err) {
    console.error('[cctvAkses] atur:', err);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan akses' });
  }
};

const aturMassal = async (req, res) => {
  try {
    const { izin, sampai, galat } = bacaMasukan(req.body);
    if (galat) return res.status(400).json({ success: false, message: galat });
    const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids.filter((v) => /^\d+$/.test(String(v))).slice(0, 300).map((v) => BigInt(v)) : [];
    if (!ids.length) return res.status(400).json({ success: false, message: 'Pilih minimal satu staf' });
    const target = await prisma.users.findMany({ where: { id: { in: ids }, role: { in: STAF.filter((r) => r !== 'superadmin') } }, select: { id: true, name: true, role: true } });
    for (const t of target) await terapkan(req, t, izin, sampai);
    return res.json({ success: true, message: `Akses ${target.length} staf diperbarui`, data: { jumlah: target.length } });
  } catch (err) {
    console.error('[cctvAkses] massal:', err);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan akses' });
  }
};

const riwayat = async (req, res) => {
  try {
    const log = await prisma.activity_logs.findMany({
      where: { module: MODUL },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: { id: true, user_name: true, entity_name: true, description: true, new_value: true, created_at: true },
    });
    return res.json({ success: true, data: log.map((l) => ({ ...l, id: angka(l.id) })) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal memuat riwayat' });
  }
};

module.exports = { saya, daftar, atur, aturMassal, riwayat };
