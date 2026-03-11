/**
 * Push Notification Service
 * Handles sending push notifications to users
 */

const webpush = require('web-push');
const prisma = require('../config/prisma');

// VAPID keys - Should be in .env for production
// Generate using: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:dpmd@bogor.go.id';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
	webpush.setVapidDetails(
		VAPID_SUBJECT,
		VAPID_PUBLIC_KEY,
		VAPID_PRIVATE_KEY
	);
}

class PushNotificationService {
	/**
	 * Get role-specific URL path
	 * @param {string} role - User role
	 * @param {string} path - Relative path (e.g., 'jadwal-kegiatan')
	 */
	getRoleBasedUrl(role, path) {
		// Semua DPMD staff menggunakan prefix /dpmd
		const dpmfStaffRoles = ['superadmin', 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai'];
		if (dpmfStaffRoles.includes(role)) {
			return `/dpmd/${path}`;
		}
		const roleRouteMap = {
			'kecamatan': '/kecamatan',
			'desa': '/desa',
			'bankeu': '/bankeu'
		};
		const rolePrefix = roleRouteMap[role] || '/dpmd';
		return `${rolePrefix}/${path}`;
	}

	/**
	 * Send notification to specific users by roles
	 * @param {Array} roles - Array of role names
	 * @param {Object} notification - Notification payload (can include {path} for dynamic URL)
	 */
	async sendToRoles(roles, notification) {
		try {
			// Get users with specified roles who have push subscriptions
			const users = await prisma.users.findMany({
				where: {
					role: { in: roles },
					is_active: true,
					push_subscriptions: {
						some: {}
					}
				},
				include: {
					push_subscriptions: {
						orderBy: { created_at: 'desc' },
						take: 1 // Only get the latest subscription per user
					}
				}
			});

			console.log(`📨 Sending notification to ${users.length} users with roles: ${roles.join(', ')}`);

			const sendPromises = [];

			for (const user of users) {
				// Only use the first (latest) subscription per user to avoid duplicates
				const subscription = user.push_subscriptions[0];
				if (!subscription) continue;

				try {
					// subscription.subscription could be string (JSON) or object (from Prisma)
					const pushSubscription = typeof subscription.subscription === 'string' 
						? JSON.parse(subscription.subscription)
						: subscription.subscription;
					
					// Generate role-specific URL if path is provided
					const notificationData = { ...notification.data };
					if (notification.path) {
						notificationData.url = this.getRoleBasedUrl(user.role, notification.path);
					}
					
					const payload = JSON.stringify({
						title: notification.title,
						body: notification.body,
						icon: notification.icon || '/logo-192.png',
						badge: notification.badge || '/logo-96.png',
						data: notificationData,
						actions: notification.actions || []
					});

					const promise = webpush.sendNotification(pushSubscription, payload)
						.then(() => {
							console.log(`✅ Notification sent to user ${user.name} (${user.email})`);
						})
						.catch((error) => {
							console.error(`❌ Failed to send to user ${user.name}:`, error.message);
							
							// If subscription is invalid, remove it
							if (error.statusCode === 410 || error.statusCode === 404) {
								return prisma.push_subscriptions.delete({
									where: { id: subscription.id }
								});
							}
						});

					sendPromises.push(promise);
				} catch (error) {
					console.error(`Error processing subscription for user ${user.name}:`, error.message);
				}
			}

			await Promise.all(sendPromises);
			return { success: true, sentTo: users.length };
		} catch (error) {
			console.error('Error sending push notifications:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Send notification about today's schedule
	 */
	async sendTodayScheduleReminder() {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			// Get today's schedules
			const todaySchedules = await prisma.jadwal_kegiatan.findMany({
				where: {
					tanggal_mulai: {
						gte: today,
						lt: tomorrow
					},
					status: { in: ['approved', 'pending', 'draft'] }
				},
				select: {
					id: true,
					judul: true,
					tanggal_mulai: true,
					lokasi: true,
					prioritas: true
				},
				orderBy: {
					tanggal_mulai: 'asc'
				}
			});

			if (todaySchedules.length === 0) {
				console.log('📅 No schedules for today');
				return { success: true, schedulesCount: 0 };
			}

			const todayStr = today.toISOString().split('T')[0];
			const notification = {
				title: '📅 Jadwal Kegiatan Hari Ini',
				body: `Ada ${todaySchedules.length} kegiatan hari ini. Tap untuk melihat detail.`,
				icon: '/logo-192.png',
				badge: '/logo-96.png',
				path: 'jadwal-kegiatan',
				data: {
					type: 'today_schedule',
					targetDate: todayStr,
					schedules: todaySchedules
				},
				actions: [
					{ action: 'view', title: 'Lihat Jadwal' },
					{ action: 'close', title: 'Tutup' }
				]
			};

			const roles = ['kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai'];
			const result = await this.sendToRoles(roles, notification);

			console.log(`✅ Today's schedule reminder sent. Schedules: ${todaySchedules.length}`);
			return { ...result, schedulesCount: todaySchedules.length };
		} catch (error) {
			console.error('Error sending today schedule reminder:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Send notification about tomorrow's schedule
	 */
	async sendTomorrowScheduleReminder() {
		try {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			tomorrow.setHours(0, 0, 0, 0);
			
			const dayAfterTomorrow = new Date(tomorrow);
			dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

			// Get tomorrow's schedules
			const tomorrowSchedules = await prisma.jadwal_kegiatan.findMany({
				where: {
					tanggal_mulai: {
						gte: tomorrow,
						lt: dayAfterTomorrow
					},
					status: { in: ['approved', 'pending', 'draft'] }
				},
				select: {
					id: true,
					judul: true,
					tanggal_mulai: true,
					lokasi: true,
					prioritas: true
				},
				orderBy: {
					tanggal_mulai: 'asc'
				}
			});

			if (tomorrowSchedules.length === 0) {
				console.log('📅 No schedules for tomorrow');
				return { success: true, schedulesCount: 0 };
			}

			const tomorrowStr = tomorrow.toISOString().split('T')[0];
			const notification = {
				title: '📅 Jadwal Kegiatan Besok',
				body: `Ada ${tomorrowSchedules.length} kegiatan besok. Tap untuk melihat detail.`,
				icon: '/logo-192.png',
				badge: '/logo-96.png',
				path: 'jadwal-kegiatan',
				data: {
					type: 'tomorrow_schedule',
					targetDate: tomorrowStr,
					schedules: tomorrowSchedules
				},
				actions: [
					{ action: 'view', title: 'Lihat Jadwal' },
					{ action: 'close', title: 'Tutup' }
				]
			};

			const roles = ['kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai'];
			const result = await this.sendToRoles(roles, notification);

			console.log(`✅ Tomorrow's schedule reminder sent. Schedules: ${tomorrowSchedules.length}`);
			return { ...result, schedulesCount: tomorrowSchedules.length };
		} catch (error) {
			console.error('Error sending tomorrow schedule reminder:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Send notification when new jadwal kegiatan is created
	 */
	async notifyNewJadwalKegiatan(jadwal) {
		try {
			const formattedDate = new Date(jadwal.tanggal_mulai).toLocaleDateString('id-ID', {
				weekday: 'long',
				day: 'numeric',
				month: 'long',
				year: 'numeric'
			});

			// Get bidang info if exists
			let bidangInfo = '';
			if (jadwal.bidang_id) {
				try {
					const bidang = await prisma.bidang.findUnique({
						where: { id: jadwal.bidang_id }
					});
					if (bidang) {
						bidangInfo = ` (${bidang.nama})`;
					}
				} catch (e) {
					console.log('Could not fetch bidang info');
				}
			}

			const notification = {
				title: '📅 Jadwal Kegiatan Baru',
				body: `${jadwal.judul}${bidangInfo} - ${formattedDate}`,
				icon: '/logo-192.png',
				badge: '/logo-96.png',
				path: 'jadwal-kegiatan', // Dynamic path that will be prefixed with role
				data: {
					type: 'new_jadwal',
					jadwal_id: jadwal.id,
					prioritas: jadwal.prioritas
				},
				actions: [
					{ action: 'view', title: 'Lihat Detail' },
					{ action: 'close', title: 'Tutup' }
				]
			};

			// Send to all roles
			const roles = ['kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai'];
			const result = await this.sendToRoles(roles, notification);

			console.log(`✅ New jadwal kegiatan notification sent: ${jadwal.judul}`);
			return result;
		} catch (error) {
			console.error('Error notifying new jadwal kegiatan:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Send notification when jadwal kegiatan is updated
	 */
	async notifyJadwalKegiatanUpdate(jadwal, changes) {
		try {
			const changesList = Object.keys(changes).join(', ');
			
			const notification = {
				title: '📝 Jadwal Kegiatan Diperbarui',
				body: `${jadwal.judul} - Perubahan: ${changesList}`,
				icon: '/logo-192.png',
				badge: '/logo-96.png',
				path: 'jadwal-kegiatan', // Dynamic path that will be prefixed with role
				data: {
					type: 'update_jadwal',
					jadwal_id: jadwal.id,
					changes: changesList
				},
				actions: [
					{ action: 'view', title: 'Lihat Perubahan' },
					{ action: 'close', title: 'Tutup' }
				]
			};

			// Send to all roles
			const roles = ['kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai'];
			const result = await this.sendToRoles(roles, notification);

			console.log(`✅ Jadwal kegiatan update notification sent: ${jadwal.judul}`);
			return result;
		} catch (error) {
			console.error('Error notifying jadwal update:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Send notification when jadwal kegiatan is about to start (1 hour before)
	 */
	async notifyUpcomingJadwal(jadwal) {
		try {
			const notification = {
				title: '⏰ Kegiatan Akan Segera Dimulai',
				body: `${jadwal.judul} akan dimulai dalam 1 jam di ${jadwal.lokasi || 'lokasi belum ditentukan'}`,
				icon: '/logo-192.png',
				badge: '/logo-96.png',
				path: 'jadwal-kegiatan',
				data: {
					type: 'upcoming_jadwal',
					jadwal_id: jadwal.id,
					prioritas: jadwal.prioritas
				},
				actions: [
					{ action: 'view', title: 'Lihat Detail' },
					{ action: 'close', title: 'Tutup' }
				],
				requireInteraction: true // Keep notification visible
			};

			// Send to all roles
			const roles = ['kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai'];
			const result = await this.sendToRoles(roles, notification);

			console.log(`✅ Upcoming jadwal notification sent: ${jadwal.judul}`);
			return result;
		} catch (error) {
			console.error('Error notifying upcoming jadwal:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Test push notification
	 */
	async sendTestNotification(userId) {
		try {
			const user = await prisma.users.findUnique({
				where: { id: userId },
				include: {
					push_subscriptions: true
				}
			});

			if (!user || user.push_subscriptions.length === 0) {
				return { success: false, message: 'User not found or has no subscriptions' };
			}

			const notification = {
				title: '🔔 Test Notification',
				body: 'This is a test push notification from DPMD system',
				icon: '/logo-192.png',
				badge: '/logo-96.png',
				data: {
					url: '/dashboard',
					type: 'test'
				}
			};

			for (const subscription of user.push_subscriptions) {
				// subscription.subscription could be string (JSON) or object (from Prisma)
				const pushSubscription = typeof subscription.subscription === 'string' 
					? JSON.parse(subscription.subscription)
					: subscription.subscription;
				const payload = JSON.stringify(notification);
				await webpush.sendNotification(pushSubscription, payload);
			}

			return { success: true, message: 'Test notification sent' };
		} catch (error) {
			console.error('Error sending test notification:', error);
			return { success: false, error: error.message };
		}
	}
}

module.exports = new PushNotificationService();
