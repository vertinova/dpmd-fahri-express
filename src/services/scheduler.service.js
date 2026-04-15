/**
 * Scheduler Service
 * Handles scheduled tasks using node-cron
 */

const cron = require('node-cron');
const pushNotificationService = require('./pushNotification.service');
const prisma = require('../config/prisma');
const PushNotificationServiceStatic = require('./pushNotificationService');

// Status kepegawaian yang wajib absen
const ABSENSI_REQUIRED_STATUS = [
  'PPPK_Paruh_Waktu',
  'Tenaga_Alih_Daya',
  'Tenaga_Keamanan',
  'Tenaga_Kebersihan',
];

class SchedulerService {
  constructor() {
    this.jobs = {};
  }

  /**
   * Initialize all scheduled jobs
   */
  init() {
    console.log('🕐 Initializing scheduler service...');

    // Morning reminder at 7:00 AM (Lihat jadwal kegiatan hari ini)
    this.jobs.morningReminder = cron.schedule('0 7 * * *', async () => {
      console.log('⏰ Running morning reminder job at 7:00 AM');
      try {
        const result = await pushNotificationService.sendTodayScheduleReminder();
        console.log(`✅ Morning reminder sent successfully: ${result.schedulesCount} schedules`);
      } catch (error) {
        console.error('❌ Error sending morning reminder:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Jakarta"
    });

    // Evening reminder at 9:00 PM (Lihat jadwal kegiatan besok)
    this.jobs.eveningReminder = cron.schedule('0 21 * * *', async () => {
      console.log('⏰ Running evening reminder job at 9:00 PM');
      try {
        const result = await pushNotificationService.sendTomorrowScheduleReminder();
        console.log(`✅ Evening reminder sent successfully: ${result.schedulesCount} schedules`);
      } catch (error) {
        console.error('❌ Error sending evening reminder:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Jakarta"
    });

    // Birthday notification at 7:15 AM every day
    this.jobs.birthdayReminder = cron.schedule('15 7 * * *', async () => {
      console.log('🎂 Running birthday check job at 7:15 AM');
      try {
        const result = await pushNotificationService.sendBirthdayNotifications();
        console.log(`🎂 Birthday check done: ${result.birthdayCount || 0} birthdays`);
      } catch (error) {
        console.error('❌ Error sending birthday notifications:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Jakarta"
    });

    // Absensi reminder - check every minute for dynamic jam_masuk/jam_pulang from settings
    this.jobs.absensiReminder = cron.schedule('* * * * *', async () => {
      try {
        await this.checkAbsensiReminder();
      } catch (error) {
        console.error('❌ Error checking absensi reminder:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Jakarta"
    });

    console.log('✅ Scheduler service initialized');
    console.log('📅 Morning reminder: Every day at 7:00 AM (WIB)');
    console.log('🌙 Evening reminder: Every day at 9:00 PM (WIB)');
    console.log('🎂 Birthday check: Every day at 7:15 AM (WIB)');
    console.log('⏰ Absensi reminder: Every minute (checks jam_masuk/jam_pulang from settings)');
  }

  /**
   * Check if it's time to send absensi reminder (at jam_masuk or jam_pulang from settings)
   */
  async checkAbsensiReminder() {
    const now = new Date();
    // WIB = UTC+7
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const currentHour = wib.getUTCHours();
    const currentMinute = wib.getUTCMinutes();
    const currentMinutes = currentHour * 60 + currentMinute;

    // Fetch absensi settings
    const settingsRows = await prisma.absensi_settings.findMany();
    const settings = {};
    settingsRows.forEach(s => { settings[s.key] = s.value; });
    const jamMasuk = settings.jam_masuk || '08:00';
    const jamPulang = settings.jam_pulang || '16:00';

    const [masukH, masukM] = jamMasuk.split(':').map(Number);
    const [pulangH, pulangM] = jamPulang.split(':').map(Number);
    const masukMinutes = masukH * 60 + masukM; // tepat pada jam masuk
    const pulangMinutes = pulangH * 60 + pulangM; // tepat pada jam pulang

    let reminderType = null;
    if (currentMinutes === masukMinutes) {
      reminderType = 'reminder_masuk';
    } else if (currentMinutes === pulangMinutes) {
      reminderType = 'reminder_pulang';
    }

    if (!reminderType) return;

    // Fetch the customizable template from DB
    const template = await prisma.absensi_reminder_templates.findUnique({
      where: { type: reminderType }
    });

    if (template && !template.is_active) return;

    const title = template?.title || (reminderType === 'reminder_masuk' ? '⏰ Waktunya Absen Masuk!' : '🏠 Waktunya Absen Pulang!');
    const body = template?.message || (reminderType === 'reminder_masuk'
      ? 'Jangan lupa absen masuk ya! Segera buka aplikasi dan lakukan absensi.'
      : 'Sudah waktunya pulang! Jangan lupa absen keluar sebelum meninggalkan kantor.');

    // Cek apakah hari ini weekend (Sabtu/Minggu)
    const dayOfWeek = wib.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Di weekend, hanya kirim ke Tenaga Keamanan & Tenaga Kebersihan
    // Di hari kerja, kirim ke semua pegawai yang wajib absen
    const statusFilter = isWeekend
      ? ['Tenaga_Keamanan', 'Tenaga_Kebersihan']
      : ABSENSI_REQUIRED_STATUS;

    // Get eligible user IDs
    const eligibleUsers = await prisma.users.findMany({
      where: {
        is_active: true,
        pegawai: { status_kepegawaian: { in: statusFilter } }
      },
      select: { id: true }
    });

    if (eligibleUsers.length === 0) return;

    const userIds = eligibleUsers.map(u => Number(u.id));

    const payload = {
      title,
      body,
      icon: '/logo-192.png',
      badge: '/logo-96.png',
      tag: reminderType,
      data: {
        type: reminderType,
        url: '/dpmd/absensi',
      },
      actions: [
        { action: 'open', title: 'Buka Absensi' },
        { action: 'close', title: 'Tutup' }
      ]
    };

    const result = await PushNotificationServiceStatic.sendToMultipleUsers(userIds, payload);
    await PushNotificationServiceStatic.storeNotifications(userIds, payload, null);

    console.log(`⏰ [Absensi Reminder] ${reminderType} sent to ${userIds.length} users: ${result.sent || 0} success, ${result.failed || 0} failed`);
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    console.log('🛑 Stopping all scheduled jobs...');
    Object.keys(this.jobs).forEach(jobName => {
      this.jobs[jobName].stop();
      console.log(`  - Stopped: ${jobName}`);
    });
    console.log('✅ All jobs stopped');
  }

  /**
   * Get status of all jobs
   */
  getStatus() {
    const status = {};
    Object.keys(this.jobs).forEach(jobName => {
      status[jobName] = this.jobs[jobName].getStatus ? this.jobs[jobName].getStatus() : 'running';
    });
    return status;
  }

  /**
   * Manual trigger for testing
   */
  async triggerMorningReminder() {
    console.log('🔧 Manual trigger: Morning reminder');
    return await pushNotificationService.sendTodayScheduleReminder();
  }

  /**
   * Manual trigger for testing
   */
  async triggerEveningReminder() {
    console.log('🔧 Manual trigger: Evening reminder');
    return await pushNotificationService.sendTomorrowScheduleReminder();
  }

  /**
   * Manual trigger for birthday notifications
   */
  async triggerBirthdayCheck() {
    console.log('🔧 Manual trigger: Birthday check');
    return await pushNotificationService.sendBirthdayNotifications();
  }

  /**
   * Manual trigger for absensi reminder
   */
  async triggerAbsensiReminder(type) {
    console.log(`🔧 Manual trigger: Absensi reminder (${type})`);
    // Override to force send regardless of time
    const template = await prisma.absensi_reminder_templates.findUnique({
      where: { type }
    });

    const title = template?.title || (type === 'reminder_masuk' ? '⏰ Waktunya Absen Masuk!' : '🏠 Waktunya Absen Pulang!');
    const body = template?.message || (type === 'reminder_masuk'
      ? 'Jangan lupa absen masuk ya!'
      : 'Jangan lupa absen keluar!');

    const eligibleUsers = await prisma.users.findMany({
      where: {
        is_active: true,
        pegawai: { status_kepegawaian: { in: ABSENSI_REQUIRED_STATUS } }
      },
      select: { id: true }
    });
    const userIds = eligibleUsers.map(u => Number(u.id));

    const payload = {
      title, body,
      icon: '/logo-192.png', badge: '/logo-96.png',
      tag: type,
      data: { type, url: '/dpmd/absensi' }
    };

    const result = await PushNotificationServiceStatic.sendToMultipleUsers(userIds, payload);
    return { sent: result.sent, failed: result.failed, total: userIds.length };
  }
}

module.exports = new SchedulerService();
