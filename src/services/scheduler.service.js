/**
 * Scheduler Service
 * Handles scheduled tasks using node-cron
 */

const cron = require('node-cron');
const pushNotificationService = require('./pushNotification.service');

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

    console.log('✅ Scheduler service initialized');
    console.log('📅 Morning reminder: Every day at 7:00 AM (WIB)');
    console.log('🌙 Evening reminder: Every day at 9:00 PM (WIB)');
    console.log('🎂 Birthday check: Every day at 7:15 AM (WIB)');
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
}

module.exports = new SchedulerService();
