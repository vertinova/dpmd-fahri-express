const prisma = require('../config/prisma');
const PushNotificationService = require('./pushNotificationService');

const ELIGIBLE_STATUSES = [
  'PPPK_Paruh_Waktu',
  'Tenaga_Alih_Daya',
  'Tenaga_Keamanan',
  'Tenaga_Kebersihan',
];
const PRESENT_STATUSES = ['hadir', 'dinas_luar', 'wfh', 'wfa'];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function getWIBParts(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return {
    year: wib.getUTCFullYear(),
    month: wib.getUTCMonth() + 1,
    day: wib.getUTCDate(),
    dayOfWeek: wib.getUTCDay(),
  };
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function timeToWIBMinutes(value) {
  if (!value) return null;
  const date = new Date(value);
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

function getAwardPeriod(now = new Date()) {
  const wib = getWIBParts(now);
  const todayUTC = new Date(Date.UTC(wib.year, wib.month - 1, wib.day));
  const daysSinceSunday = wib.dayOfWeek === 0 ? 7 : wib.dayOfWeek;
  const periodEnd = new Date(todayUTC);
  periodEnd.setUTCDate(periodEnd.getUTCDate() - daysSinceSunday);
  const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));

  return {
    periodStart,
    periodEnd,
    weekKey: `${dateKey(periodEnd)}-weekly`,
    monthLabel: `${MONTH_NAMES[periodEnd.getUTCMonth()]} ${periodEnd.getUTCFullYear()}`,
  };
}

// Skor absensi gabungan: menggabungkan kelengkapan absen, ketepatan waktu,
// total kehadiran, dan bonus datang lebih awal (dikurangi penalti keterlambatan).
// Semakin tinggi = absensi semakin baik. Dipakai untuk peringkat tunggal Juara 1/2/3.
function scoreCandidate(candidate, lateThreshold) {
  // Rata-rata berapa menit sebelum batas jam masuk pegawai tiba (makin awal makin tinggi).
  const earliness = candidate.averageArrival !== null
    ? Math.max(0, lateThreshold - candidate.averageArrival)
    : 0;
  return (
    candidate.completeDays * 10  // absen lengkap (masuk + pulang) — paling utama
    + candidate.onTimeDays * 6   // hari tepat waktu
    + candidate.presentDays * 4  // total kehadiran
    + earliness * 0.6            // bonus datang lebih awal
    - candidate.lateDays * 5     // penalti terlambat
  );
}

// Kategori penghargaan (urutan kartu di popup).
const CATEGORY_META = [
  { key: 'pppk_alihdaya', label: 'PPPK PW & Tenaga Alih Daya' },
  { key: 'kebersihan', label: 'Petugas Kebersihan' },
  { key: 'keamanan', label: 'Petugas Keamanan' },
];

// Peran kebersihan/keamanan dikenali dari status_kepegawaian ATAU kata kunci jabatan
// (di banyak data, petugas kebersihan/keamanan berstatus Tenaga Alih Daya/PPPK PW
// sehingga perannya hanya tampak di jabatan).
const SECURITY_JABATAN_KEYWORDS = ['keamanan', 'security', 'satpam'];
const CLEANING_JABATAN_KEYWORDS = ['kebersih', 'cleaning', 'cleaning service'];

function categorizeEmployee(pegawai) {
  const status = pegawai?.status_kepegawaian;
  const jabatan = (pegawai?.jabatan || '').toLowerCase();
  if (status === 'Tenaga_Keamanan' || SECURITY_JABATAN_KEYWORDS.some(k => jabatan.includes(k))) return 'keamanan';
  if (status === 'Tenaga_Kebersihan' || CLEANING_JABATAN_KEYWORDS.some(k => jabatan.includes(k))) return 'kebersihan';
  return 'pppk_alihdaya';
}

function compareCandidates(a, b, lateThreshold) {
  return (
    scoreCandidate(b, lateThreshold) - scoreCandidate(a, lateThreshold)
    || b.completeDays - a.completeDays
    || (a.averageArrival ?? Infinity) - (b.averageArrival ?? Infinity)
    || b.onTimeDays - a.onTimeDays
    || b.presentDays - a.presentDays
  );
}

function serializeWinner(candidate, rank, lateThreshold, category) {
  return {
    rank,
    category_key: category.key,
    category: category.label,
    subtitle: 'Paling lengkap & paling awal datang',
    metric: `${candidate.completeDays} hari lengkap`,
    score: Math.round(scoreCandidate(candidate, lateThreshold)),
    user_id: Number(candidate.user.id),
    name: candidate.user.pegawai?.nama_pegawai || candidate.user.name,
    avatar: candidate.user.avatar || null,
    jabatan: candidate.user.pegawai?.jabatan || '-',
    bidang: candidate.user.pegawai?.bidangs?.nama || '-',
    attendance_days: candidate.presentDays,
    complete_days: candidate.completeDays,
    on_time_days: candidate.onTimeDays,
    late_days: candidate.lateDays,
    average_arrival: formatMinutes(candidate.averageArrival),
  };
}

// Bangun pemenang Juara 1/2/3 untuk SETIAP kategori secara terpisah.
function buildCategoryWinners(candidates, lateThreshold) {
  return CATEGORY_META.map(category => {
    const inCategory = candidates.filter(
      c => categorizeEmployee(c.user.pegawai) === category.key
    );
    const highest = Math.max(0, ...inCategory.map(c => c.presentDays));
    // Syarat kehadiran minimal dihitung per kategori agar adil antar kategori.
    const minimumAttendance = Math.max(1, Math.ceil(highest * 0.6));
    const winners = inCategory
      .filter(c => c.presentDays >= minimumAttendance)
      .sort((a, b) => compareCandidates(a, b, lateThreshold))
      .slice(0, 3)
      .map((c, i) => serializeWinner(c, i + 1, lateThreshold, category));
    return { key: category.key, label: category.label, winners };
  }).filter(category => category.winners.length > 0);
}

// Normalisasi data tersimpan ke bentuk { categories: [...] } (kompatibel data lama).
function normalizeCategories(stored) {
  if (!stored) return [];
  if (Array.isArray(stored)) {
    return stored.length ? [{ key: 'overall', label: 'Absensi Terbaik', winners: stored }] : [];
  }
  return Array.isArray(stored.categories) ? stored.categories : [];
}

// Kumpulkan kandidat (statistik kehadiran per pegawai) untuk satu rentang periode.
// Dipakai bersama oleh award mingguan dan leaderboard per periode (pegawai).
async function gatherCandidates(periodStart, periodEnd) {
  const users = await prisma.users.findMany({
    where: {
      is_active: true,
      pegawai: { status_kepegawaian: { in: ELIGIBLE_STATUSES } },
    },
    select: {
      id: true,
      name: true,
      avatar: true,
      pegawai: {
        select: {
          nama_pegawai: true,
          jabatan: true,
          status_kepegawaian: true,
          bidangs: { select: { nama: true } },
        },
      },
    },
  });

  const [records, attendanceSetting] = await Promise.all([
    prisma.absensi_pegawai.findMany({
      where: {
        tanggal: { gte: periodStart, lte: periodEnd },
        user_id: { in: users.map(user => user.id) },
      },
      select: { user_id: true, status: true, jam_masuk: true, jam_keluar: true },
    }),
    prisma.absensi_settings.findUnique({
      where: { key: 'jam_masuk' },
      select: { value: true },
    }),
  ]);
  const [startHour, startMinute] = (attendanceSetting?.value || '08:00').split(':').map(Number);
  const lateThreshold = startHour * 60 + startMinute;

  const recordsByUser = new Map();
  records.forEach(record => {
    const key = record.user_id.toString();
    if (!recordsByUser.has(key)) recordsByUser.set(key, []);
    recordsByUser.get(key).push(record);
  });

  const candidates = users.map(user => {
    const userRecords = recordsByUser.get(user.id.toString()) || [];
    const present = userRecords.filter(record => PRESENT_STATUSES.includes(record.status) && record.jam_masuk);
    const arrivals = present.map(record => timeToWIBMinutes(record.jam_masuk)).filter(Number.isFinite);
    const completeDays = present.filter(record => record.jam_keluar).length;
    const lateDays = arrivals.filter(minutes => minutes > lateThreshold).length;
    const onTimeDays = arrivals.length - lateDays;
    return {
      user,
      presentDays: present.length,
      completeDays,
      lateDays,
      onTimeDays,
      averageArrival: arrivals.length
        ? arrivals.reduce((sum, value) => sum + value, 0) / arrivals.length
        : null,
    };
  }).filter(candidate => candidate.presentDays > 0);

  return { candidates, lateThreshold };
}

class AttendanceAwardService {
  async calculateAndStore(now = new Date()) {
    const period = getAwardPeriod(now);
    if (period.periodEnd < period.periodStart) {
      return { success: true, categories: [], reason: 'Periode belum tersedia' };
    }

    const existing = await prisma.absensi_weekly_awards.findUnique({
      where: { week_key: period.weekKey },
    });
    if (existing) return { success: true, award: existing, categories: normalizeCategories(existing.winners), reused: true };

    const { candidates, lateThreshold } = await gatherCandidates(period.periodStart, period.periodEnd);

    // Pemenang Juara 1/2/3 dihitung terpisah per kategori (status kepegawaian).
    const categories = buildCategoryWinners(candidates, lateThreshold);

    const award = await prisma.absensi_weekly_awards.upsert({
      where: { week_key: period.weekKey },
      update: { month_label: period.monthLabel },
      create: {
        week_key: period.weekKey,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        month_label: period.monthLabel,
        winners: { categories },
      },
    });

    return { success: true, award, categories: normalizeCategories(award.winners), reused: false };
  }

  // Leaderboard per kategori untuk rentang periode apa pun (dipakai halaman pegawai).
  // Mengembalikan setiap kategori dengan podium (top 3) + ranking lengkap.
  async buildLeaderboardForPeriod(periodStart, periodEnd) {
    const { candidates, lateThreshold } = await gatherCandidates(periodStart, periodEnd);
    const categories = CATEGORY_META.map(category => {
      const ranking = candidates
        .filter(c => categorizeEmployee(c.user.pegawai) === category.key)
        .sort((a, b) => compareCandidates(a, b, lateThreshold))
        .map((c, i) => serializeWinner(c, i + 1, lateThreshold, category));
      return {
        key: category.key,
        label: category.label,
        winners: ranking.slice(0, 3),
        ranking,
        total: ranking.length,
      };
    });
    return { categories };
  }

  async announceWeeklyAwards(now = new Date()) {
    const result = await this.calculateAndStore(now);
    const categories = result.categories || [];
    const allWinners = categories.flatMap(category => category.winners);
    if (!allWinners.length) return result;
    if (result.award.notified_at) {
      return { ...result, skipped: true, reason: 'Penghargaan minggu ini sudah dikirim' };
    }

    const eligibleUsers = await prisma.users.findMany({
      where: {
        is_active: true,
        pegawai: { status_kepegawaian: { in: ELIGIBLE_STATUSES } },
      },
      select: { id: true },
    });
    const userIds = eligibleUsers.map(user => Number(user.id));
    const topNames = categories
      .map(category => category.winners[0]?.name)
      .filter(Boolean)
      .join(', ');
    const payload = {
      title: '🏆 Juara Absensi Mingguan!',
      body: `Juara 1 tiap kategori: ${topNames}. Lihat podium semua kategori!`,
      icon: '/logo-192.png',
      badge: '/logo-96.png',
      tag: `weekly-attendance-award-${result.award.week_key}`,
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 300],
      data: {
        type: 'weekly_attendance_award',
        week_key: result.award.week_key,
        month_label: result.award.month_label,
        period_start: dateKey(result.award.period_start),
        period_end: dateKey(result.award.period_end),
        categories,
        url: '/dpmd/dashboard',
      },
      actions: [
        { action: 'open', title: '🏆 Lihat Pemenang' },
        { action: 'close', title: 'Nanti' },
      ],
    };

    await PushNotificationService.storeNotifications(userIds, payload);
    const pushResult = await PushNotificationService.sendToMultipleUsers(userIds, payload);
    await prisma.absensi_weekly_awards.update({
      where: { id: result.award.id },
      data: { notified_at: new Date() },
    });

    return { ...result, push: pushResult, recipients: userIds.length };
  }

  async getLatest() {
    const current = await this.calculateAndStore();
    const award = current.award || await prisma.absensi_weekly_awards.findFirst({
      orderBy: { period_end: 'desc' },
    });
    if (!award) return null;

    const now = getWIBParts();
    const today = new Date(Date.UTC(now.year, now.month - 1, now.day));
    const ageDays = Math.floor((today - award.period_end) / (24 * 60 * 60 * 1000));
    if (ageDays > 7) return null;

    return {
      id: Number(award.id),
      week_key: award.week_key,
      period_start: dateKey(award.period_start),
      period_end: dateKey(award.period_end),
      month_label: award.month_label,
      categories: normalizeCategories(award.winners),
      generated_at: award.generated_at,
    };
  }
}

module.exports = new AttendanceAwardService();
