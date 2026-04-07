const express = require('express');
const router = express.Router();
const { vapidKeys } = require('../config/push-notification');
const PushSubscription = require('../models/pushSubscription');
const PushNotificationService = require('../services/pushNotification.service');
const { auth, checkRole } = require('../middlewares/auth');
const prisma = require('../config/prisma');

/**
 * GET /api/push-notification/vapid-public-key
 * Get VAPID public key untuk client subscription
 */
router.get('/vapid-public-key', (req, res) => {
  res.json({
    success: true,
    publicKey: vapidKeys.publicKey
  });
});

/**
 * POST /api/push-notification/subscribe
 * Subscribe user ke push notifications
 */
router.post('/subscribe', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription data'
      });
    }

    await PushSubscription.saveSubscription(userId, subscription);

    res.json({
      success: true,
      message: 'Successfully subscribed to push notifications'
    });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe',
      error: error.message
    });
  }
});

/**
 * POST /api/push-notification/unsubscribe
 * Unsubscribe user dari push notifications
 */
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint is required'
      });
    }

    await PushSubscription.removeSubscription(userId, endpoint);

    res.json({
      success: true,
      message: 'Successfully unsubscribed from push notifications'
    });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe',
      error: error.message
    });
  }
});

/**
 * GET /api/push-notification/subscriptions
 * Get user's active subscriptions
 */
router.get('/subscriptions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const subscriptions = await PushSubscription.getSubscriptionsByUser(userId);

    res.json({
      success: true,
      data: subscriptions
    });
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscriptions',
      error: error.message
    });
  }
});

/**
 * GET /api/push-notification/check
 * Check if user has active subscription
 */
router.get('/check', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const subscriptions = await PushSubscription.getSubscriptionsByUser(userId);

    res.json({
      success: true,
      subscribed: subscriptions.length > 0,
      count: subscriptions.length
    });
  } catch (error) {
    console.error('Error checking subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check subscription',
      error: error.message
    });
  }
});

/**
 * GET /api/push-notification/statistics
 * Get notification statistics
 */
router.get('/statistics', auth, async (req, res) => {
  try {
    // Count total subscriptions
    const totalSubscribers = await prisma.push_subscriptions.count();

    // Count today's schedules
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaySchedules = await prisma.jadwal_kegiatan.count({
      where: {
        tanggal_mulai: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    // Count tomorrow's schedules
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    const tomorrowSchedules = await prisma.jadwal_kegiatan.count({
      where: {
        tanggal_mulai: {
          gte: tomorrow,
          lt: dayAfterTomorrow
        }
      }
    });

    // Count unique subscribed users
    const subscribedUsers = await prisma.push_subscriptions.groupBy({
      by: ['user_id'],
    });

    res.json({
      success: true,
      data: {
        totalSent: 0,
        totalSubscribers,
        uniqueSubscribedUsers: subscribedUsers.length,
        todaySchedules,
        tomorrowSchedules
      }
    });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: error.message
    });
  }
});

/**
 * GET /api/push-notification/history
 * Notification history (disabled - no notification_logs table)
 */
router.get('/history', auth, async (req, res) => {
  res.json({
    success: true,
    data: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
  });
});

/**
 * GET /api/push-notification/users-list
 * Get list of users with subscription status for employee picker
 */
router.get('/users-list', auth, async (req, res) => {
  try {
    const { search = '', role = '' } = req.query;

    const where = {
      is_active: true,
      role: { notIn: ['desa', 'kecamatan', 'dinas_terkait'] }
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } }
      ];
    }

    if (role) {
      where.role = role;
    }

    const users = await prisma.users.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        bidang_id: true,
        _count: {
          select: { push_subscriptions: true }
        }
      },
      orderBy: [
        { role: 'asc' },
        { name: 'asc' }
      ]
    });

    // Also get bidang names
    const bidangs = await prisma.bidangs.findMany({
      select: { id: true, nama: true }
    });
    const bidangMap = Object.fromEntries(bidangs.map(b => [b.id, b.nama]));

    const data = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      bidang: bidangMap[u.bidang_id] || null,
      subscribed: u._count.push_subscriptions > 0
    }));

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error getting users list:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users list',
      error: error.message
    });
  }
});

/**
 * POST /api/push-notification/send
 * Send push notification
 * Accessible by: superadmin and pegawai with Sekretariat bidang
 */
router.post('/send', auth, async (req, res) => {
  try {
    console.log('\n📨 [Push] Send notification request');
    console.log('   User:', req.user.name, '- Role:', req.user.role, '- Bidang:', req.user.bidang_id);
    
    // Check if user has permission
    const SEKRETARIAT_BIDANG_ID = 2;
    const isSuperadmin = req.user.role === 'superadmin';
    const isSekretariatPegawai = req.user.bidang_id === SEKRETARIAT_BIDANG_ID;
    
    if (!isSuperadmin && !isSekretariatPegawai) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Hanya Superadmin dan Pegawai Sekretariat yang dapat mengirim notifikasi'
      });
    }

    const { userId, userIds, broadcast, roles, title, body, data, payload } = req.body;

    let result;
    let logTargetType = 'broadcast';
    let logTargetValue = null;
    
    if (roles && Array.isArray(roles) && roles.length > 0) {
      // Send to specific roles
      logTargetType = 'roles';
      logTargetValue = JSON.stringify(roles);

      const notification = {
        title: title || payload?.title,
        body: body || payload?.body,
        icon: payload?.icon || '/logo-192.png',
        badge: payload?.badge || '/logo-96.png',
        data: data || payload?.data || {},
        actions: payload?.actions || []
      };
      
      // Extract path from URL if present for role-aware routing
      if (notification.data && notification.data.url && !notification.path) {
        const urlPath = notification.data.url.replace(/^\/[^/]+\//, '');
        if (urlPath !== notification.data.url) {
          notification.path = urlPath;
          delete notification.data.url;
        } else if (notification.data.url.startsWith('/') && !notification.data.url.includes('//')) {
          notification.path = notification.data.url.replace(/^\//, '');
          delete notification.data.url;
        }
      }
      
      result = await PushNotificationService.sendToRoles(roles, notification);

    } else if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      // Send to specific users by ID
      logTargetType = 'users';
      logTargetValue = JSON.stringify(userIds);

      const notifPayload = payload || {
        title: title,
        body: body,
        icon: '/logo-192.png',
        badge: '/logo-96.png',
        tag: `manual-${Date.now()}`,
        data: data || { type: 'manual', timestamp: Date.now() },
        vibrate: [200, 100, 200]
      };

      const StaticPushService = require('../services/pushNotificationService');
      const sendResult = await StaticPushService.sendToMultipleUsers(
        userIds.map(id => parseInt(id)),
        notifPayload
      );
      result = {
        success: true,
        sentTo: sendResult.sent || sendResult.sentTo || 0,
        failed: sendResult.failed || 0
      };

    } else if (userId) {
      // Send to single user
      logTargetType = 'users';
      logTargetValue = JSON.stringify([userId]);

      const StaticPushService = require('../services/pushNotificationService');
      const sendResult = await StaticPushService.sendToUser(
        parseInt(userId),
        payload || { title, body, icon: '/logo-192.png', badge: '/logo-96.png', data: data || {} }
      );
      result = {
        success: true,
        sentTo: sendResult.sent || 1,
        failed: sendResult.failed || 0
      };

    } else if (broadcast) {
      // Broadcast to all users
      logTargetType = 'broadcast';

      const StaticPushService = require('../services/pushNotificationService');
      const sendResult = await StaticPushService.sendToAll(
        payload || { title, body, icon: '/logo-192.png', badge: '/logo-96.png', data: data || {} }
      );
      result = {
        success: true,
        sentTo: sendResult.sent || sendResult.sentTo || 0,
        failed: sendResult.failed || 0
      };

    } else {
      return res.status(400).json({
        success: false,
        message: 'roles, userId, userIds, or broadcast flag is required'
      });
    }

    console.log('   ✅ Notification sent to', result.sentTo || 0, 'users');

    // Store notification records in DB for target users
    try {
      const notifPayload = {
        title: title || payload?.title || 'Notifikasi',
        body: body || payload?.body || '',
        data: data || payload?.data || {}
      };

      let targetIds = [];
      if (userId) {
        targetIds = [parseInt(userId)];
      } else if (userIds && Array.isArray(userIds)) {
        targetIds = userIds.map(id => parseInt(id));
      } else if (roles && Array.isArray(roles)) {
        // Get user IDs by roles
        const roleUsers = await prisma.users.findMany({
          where: { role: { in: roles }, is_active: true },
          select: { id: true }
        });
        targetIds = roleUsers.map(u => Number(u.id));
      } else if (broadcast) {
        // Get all active user IDs
        const allUsers = await prisma.users.findMany({
          where: { is_active: true },
          select: { id: true }
        });
        targetIds = allUsers.map(u => Number(u.id));
      }

      if (targetIds.length > 0) {
        const StaticPushService = require('../services/pushNotificationService');
        await StaticPushService.storeNotifications(targetIds, notifPayload, req.user.id);
      }
    } catch (storeErr) {
      console.error('   ⚠️ Failed to store notification records:', storeErr.message);
    }

    res.json({
      success: true,
      message: 'Push notification sent',
      sentTo: result.sentTo || 0,
      data: result
    });
  } catch (error) {
    console.error('Error sending push notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send push notification',
      error: error.message
    });
  }
});

/**
 * POST /api/push-notification/test
 * Send test notification to current user
 */
router.post('/test', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const testPayload = {
      title: '🎉 Test Notification',
      body: 'Push notification berhasil! Sistem bekerja dengan baik.',
      icon: '/logo-192.png',
      badge: '/logo-96.png',
      tag: 'test-notification',
      data: {
        type: 'test',
        timestamp: Date.now(),
        url: '/'
      },
      vibrate: [200, 100, 200],
      requireInteraction: false
    };

    const StaticPushService = require('../services/pushNotificationService');
    const result = await StaticPushService.sendToUser(parseInt(userId), testPayload);

    res.json({
      success: true,
      message: 'Test notification sent',
      data: result
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
});

/**
 * GET /api/push-notification/notifications
 * Get notifications for current user from notifications table
 */
router.get('/notifications', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notifications.findMany({
        where: { user_id: BigInt(userId) },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: {
          sender: { select: { name: true } }
        }
      }),
      prisma.notifications.count({
        where: { user_id: BigInt(userId), is_read: false }
      })
    ]);

    const formattedNotifications = notifications.map(n => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      read: n.is_read,
      data: n.data,
      sent_by_name: n.sender?.name || null,
      time: formatTimeAgo(n.created_at),
      timestamp: n.created_at
    }));

    res.json({
      success: true,
      data: formattedNotifications,
      unreadCount
    });
  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications',
      error: error.message
    });
  }
});

/**
 * POST /api/push-notification/notifications/mark-read
 * Mark specific notifications as read
 * Body: { ids: [1, 2, 3] } or { all: true }
 */
router.post('/notifications/mark-read', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { ids, all } = req.body;

    if (all) {
      await prisma.notifications.updateMany({
        where: { user_id: BigInt(userId), is_read: false },
        data: { is_read: true, read_at: new Date() }
      });
    } else if (ids && Array.isArray(ids) && ids.length > 0) {
      await prisma.notifications.updateMany({
        where: {
          id: { in: ids.map(id => BigInt(id)) },
          user_id: BigInt(userId)
        },
        data: { is_read: true, read_at: new Date() }
      });
    } else {
      return res.status(400).json({ success: false, message: 'ids array or all:true required' });
    }

    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
  }
});

/**
 * POST /api/push-notification/trigger-birthday
 * Manual trigger for birthday notification (superadmin only)
 */
router.post('/trigger-birthday', auth, checkRole('superadmin'), async (req, res) => {
  try {
    const schedulerService = require('../services/scheduler.service');
    const result = await schedulerService.triggerBirthdayCheck();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error triggering birthday:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper function to format time ago
function formatTimeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} hari lalu`;
  if (hours > 0) return `${hours} jam lalu`;
  if (minutes > 0) return `${minutes} menit lalu`;
  return 'Baru saja';
}

module.exports = router;
