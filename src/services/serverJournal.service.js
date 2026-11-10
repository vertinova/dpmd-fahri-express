/**
 * Jurnal tindakan mitigasi & postur server.
 *
 * Jurnal = tindakan manual superadmin (activity_logs modul manajemen_server)
 * digabung tindakan otomatis sistem (IP diblokir otomatis, honeypot).
 * Postur = ringkasan satu layar untuk tab Ringkasan.
 */

const prisma = require('../config/prisma');
const store = require('./serverStore.service');
const security = require('./serverSecurity.service');
const audit_ = require('./serverAudit.service');
const deploy = require('./serverDeploy.service');
const backup = require('./serverBackup.service');
const proxmox = require('./serverProxmox.service');
const { EVENT_TYPES, kategoriTindakan } = require('../config/serverManagement');

const MAKS = 300;
const OTOMATIS_SQL = "event_type IN ('auto_blocked','honeypot')";

const getJournal = async ({ hours } = {}) => {
  const jam = Math.min(720, Math.max(1, Number(hours) || 168));
  const gte = new Date(Date.now() - jam * 3600e3);
  await store.ensureTables();

  const whereManual = { module: 'manajemen_server', created_at: { gte } };
  const [manual, jumlahManual, otomatis, [jmlOto], [ditolak], blokirAktif] = await Promise.all([
    prisma.activity_logs.findMany({
      where: whereManual,
      orderBy: { created_at: 'desc' },
      take: MAKS,
      select: { id: true, user_name: true, description: true, entity_name: true, ip_address: true, created_at: true },
    }),
    prisma.activity_logs.count({ where: whereManual }),
    store.query(`SELECT id, ip_address, event_type, detail, created_at FROM server_security_events WHERE ${OTOMATIS_SQL} AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY created_at DESC LIMIT ${MAKS}`, jam),
    store.query(`SELECT COUNT(*) AS n FROM server_security_events WHERE ${OTOMATIS_SQL} AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`, jam),
    store.query('SELECT COUNT(*) AS n FROM server_security_events WHERE blocked = 1 AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)', jam),
    security.listBlocklist().then((l) => l.length).catch(() => 0),
  ]);

  const items = [
    ...manual.map((m) => ({
      id: `m${String(m.id)}`,
      at: m.created_at,
      jenis: 'manual',
      kategori: kategoriTindakan(m.description),
      judul: m.description,
      rincian: null,
      oleh: m.user_name,
      ip: null,
    })),
    ...otomatis.map((o) => ({
      id: `o${o.id}`,
      at: o.created_at,
      jenis: 'otomatis',
      kategori: 'blokir',
      judul: `${EVENT_TYPES[o.event_type]?.label || o.event_type} · ${o.ip_address}`,
      rincian: o.detail,
      oleh: 'sistem',
      ip: o.ip_address,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, MAKS);

  return {
    ringkasan: { manual: jumlahManual, otomatis: jmlOto?.n || 0, permintaan_ditolak: ditolak?.n || 0, ip_diblokir_aktif: blokirAktif },
    items,
  };
};

let cachePostur = null;

const terbaru = (daftar) => daftar.filter(Boolean).sort().pop() || null;

const getPosture = async () => {
  if (cachePostur && Date.now() - cachePostur.at < 60000) return cachePostur.data;
  const aman = async (fn, cadangan) => { try { return await fn(); } catch { return cadangan; } };

  const [audit, serangan, jurnal24, ipDiblokir, status, vm] = await Promise.all([
    aman(() => {
      const a = audit_.getCachedAudit();
      return a ? { grade: a.grade, score: a.score, at: a.at } : null;
    }, null),
    aman(async () => {
      await store.ensureTables();
      const [r] = await store.query('SELECT COUNT(*) AS total, SUM(blocked = 1) AS ditolak FROM server_security_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)');
      return { total: Number(r?.total) || 0, ditolak: Number(r?.ditolak) || 0 };
    }, { total: 0, ditolak: 0 }),
    aman(async () => (await getJournal({ hours: 24 })).ringkasan, null),
    aman(async () => (await security.listBlocklist()).length, 0),
    aman(() => deploy.getStatus(), null),
    aman(async () => (proxmox.isConfigured() ? await proxmox.listBackups() : null), null),
  ]);

  const tambahan = (store.getConfigSync().notifications?.push_users || []).map((i) => BigInt(i));
  // Penerima = superadmin aktif + akun tambahan, yang punya langganan push.
  const penerima = await aman(() => prisma.users.count({
    where: { is_active: true, push_subscriptions: { some: {} }, OR: [{ role: 'superadmin' }, ...(tambahan.length ? [{ id: { in: tambahan } }] : [])] },
  }), 0);
  const data = {
    audit,
    serangan_24j: serangan,
    tindakan_24j: { manual: jurnal24?.manual || 0, otomatis: jurnal24?.otomatis || 0 },
    ip_diblokir: ipDiblokir,
    deploy: (status?.repos || []).map((r) => ({
      key: r.key,
      label: r.label,
      short: r.head?.short || null,
      subject: r.head?.subject || null,
      date: r.head?.date || null,
      pinned: !!r.pinned,
      behind: r.behind,
    })),
    backup: {
      mysql_terakhir: await aman(() => backup.terakhir(), null),
      vzdump_terakhir: vm ? terbaru(vm.guests.flatMap((g) => g.backups.map((b) => b.ctime))) : null,
      snapshot_terakhir: vm ? terbaru(vm.guests.flatMap((g) => g.snapshots.map((s) => s.snaptime))) : null,
    },
    notifikasi: { penerima },
  };
  cachePostur = { at: Date.now(), data };
  return data;
};

module.exports = { getJournal, getPosture };
