/**
 * Notifikasi Manajemen Server lewat web push (pushNotification.service):
 * laporan harian dan uji kirim. Peringatan & pemulihan dikirim oleh
 * serverAlerts.service dengan penerima yang sama.
 */

const logger = require('../utils/logger');
const prisma = require('../config/prisma');
const store = require('./serverStore.service');
const metrics = require('./serverMetrics.service');
const alerts = require('./serverAlerts.service');
const journal = require('./serverJournal.service');

const KUNCI_LAPORAN = 'server_daily_report_last';

/** Akun tambahan di luar superadmin (superadmin selalu ikut). */
const penerima = () => ({ userIds: store.getConfigSync().notifications?.push_users || [] });

/** Kirim push; mengembalikan jumlah penerima yang punya langganan push. */
const kirimPush = async ({ title, body }) => {
  const push = require('./pushNotification.service');
  const hasil = await push.sendToRoles(['superadmin'], { title, body, data: { type: 'server_report', url: '/superadmin/server' } }, penerima());
  return hasil?.sentTo || 0;
};

const tanggalWib = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d); // YYYY-MM-DD
const jamWib = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(d));

const lalu = (iso) => {
  if (!iso) return 'belum ada';
  const jam = Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3);
  return jam < 1 ? 'kurang dari 1 jam lalu' : jam < 48 ? `${jam} jam lalu` : `${Math.floor(jam / 24)} hari lalu`;
};

/** Laporan ringkas berupa teks polos (push dipotong peramban). */
const susunLaporan = async () => {
  const baris = [];
  const coba = async (fn) => { try { const t = await fn(); if (t) baris.push(t); } catch { /* lewati bagian yang gagal */ } };
  const tgl = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' });
  const aktifList = alerts.getActive();

  await coba(() => {
    const status = aktifList.length ? `⚠️ ${aktifList.length} peringatan aktif` : '✅ Normal';
    const l = metrics.getLatest();
    return l ? `${status} · CPU ${l.cpu}% · RAM ${l.memory.percent}%${l.disk ? ` · Disk ${l.disk.percent}%` : ''}` : status;
  });

  let postur = null;
  await coba(async () => { postur = await journal.getPosture(); return null; });
  await coba(() => postur && `Serangan 24j: ${postur.serangan_24j.total} (${postur.serangan_24j.ditolak} ditolak) · ${postur.ip_diblokir} IP diblokir`);
  await coba(() => postur && `Tindakan: ${postur.tindakan_24j.otomatis} otomatis, ${postur.tindakan_24j.manual} manual`);
  await coba(() => postur && postur.deploy.length && `Deploy: ${postur.deploy.map((d) => `${d.key === 'dpmd-frontend' ? 'FE' : d.key === 'dpmd-fahri-express' ? 'BE' : d.label} ${d.short || '-'}${d.pinned ? ' (di-rollback)' : ''}${d.behind ? ` (tertinggal ${d.behind})` : ''}`).join(' · ')}`);
  await coba(() => postur && `Backup DB: ${lalu(postur.backup.mysql_terakhir)}`);

  return { title: `📊 Laporan server ${tgl}`, body: baris.join('\n') };
};

/* ─────────────────────────── Jadwal harian ─────────────────────────── */

let tanggalTerakhir = null;
let jalan = false;

const periksaLaporan = async () => {
  if (jalan) return;
  const n = store.getConfigSync().notifications || {};
  if (!n.daily_report || jamWib() !== Number(n.daily_report_hour)) return;
  const hariIni = tanggalWib();
  if (tanggalTerakhir === hariIni) return;
  jalan = true;
  try {
    tanggalTerakhir = hariIni; // tandai dulu supaya tidak terkirim ganda bila gagal berulang
    await kirimPush(await susunLaporan());
    await prisma.app_settings.upsert({
      where: { setting_key: KUNCI_LAPORAN },
      update: { setting_value: hariIni, updated_at: new Date() },
      create: { setting_key: KUNCI_LAPORAN, setting_value: hariIni, description: 'Tanggal laporan harian server terakhir terkirim', updated_at: new Date() },
    });
  } catch (e) {
    logger.warn(`[ServerNotify] Laporan harian gagal: ${e.message}`);
  } finally {
    jalan = false;
  }
};

let mulai = false;
const start = () => {
  if (mulai) return;
  mulai = true;
  prisma.app_settings.findUnique({ where: { setting_key: KUNCI_LAPORAN } })
    .then((b) => { if (b && !tanggalTerakhir) tanggalTerakhir = b.setting_value; })
    .catch(() => {});
  setInterval(() => periksaLaporan(), 60000).unref();
};

module.exports = { penerima, kirimPush, susunLaporan, start };
