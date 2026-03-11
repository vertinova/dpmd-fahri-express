/**
 * Cron Scheduler Service
 * Handles scheduled tasks for the application
 */

const cron = require('node-cron');
const pushNotificationService = require('./pushNotification.service');

class CronSchedulerService {
	constructor() {
		this.jobs = {};
	}

	/**
	 * Initialize all cron jobs
	 */
	init() {
		console.log('🕐 Initializing cron scheduler...');
		// Auto cron dinonaktifkan - notifikasi jadwal dikirim manual oleh Sekretariat
		// dari halaman Kelola Notifikasi setelah selesai input semua kegiatan
		console.log('ℹ️  Cron jadwal dinonaktifkan. Notifikasi dikirim manual dari halaman Kelola Notifikasi.');
	}

	/**
	 * Stop all cron jobs
	 */
	stopAll() {
		Object.keys(this.jobs).forEach(jobName => {
			if (this.jobs[jobName]) {
				this.jobs[jobName].stop();
				console.log(`⏸️  Stopped cron job: ${jobName}`);
			}
		});
	}

	/**
	 * Start all cron jobs
	 */
	startAll() {
		Object.keys(this.jobs).forEach(jobName => {
			if (this.jobs[jobName]) {
				this.jobs[jobName].start();
				console.log(`▶️  Started cron job: ${jobName}`);
			}
		});
	}

	/**
	 * Get status of all cron jobs
	 */
	getStatus() {
		const status = {};
		Object.keys(this.jobs).forEach(jobName => {
			status[jobName] = {
				running: this.jobs[jobName] ? true : false
			};
		});
		return status;
	}

	/**
	 * Test notification manually
	 */
	async testMorningReminder() {
		console.log('🧪 Testing morning reminder manually...');
		try {
			const result = await pushNotificationService.sendTodayScheduleReminder();
			console.log('✅ Test completed:', result);
			return result;
		} catch (error) {
			console.error('❌ Test failed:', error);
			throw error;
		}
	}

	/**
	 * Test evening notification manually
	 */
	async testEveningReminder() {
		console.log('🧪 Testing evening reminder manually...');
		try {
			const result = await pushNotificationService.sendTomorrowScheduleReminder();
			console.log('✅ Test completed:', result);
			return result;
		} catch (error) {
			console.error('❌ Test failed:', error);
			throw error;
		}
	}
}

module.exports = new CronSchedulerService();
