/**
 * Activity Logger Utility
 * Centralized logging for all user activities
 */

const prisma = require('../config/prisma');

class ActivityLogger {
  /**
   * Log an activity
   * @param {Object} params - Activity parameters
   * @param {number} params.userId - User ID
   * @param {string} params.userName - User name
   * @param {string} params.userRole - User role
   * @param {number|null} params.bidangId - Bidang ID (optional)
   * @param {string} params.module - Module name (bumdes, musdesus, kelembagaan, etc)
   * @param {string} params.action - Action type (create, update, delete, approve, reject, upload, download)
   * @param {string} params.entityType - Entity/table name
   * @param {number|null} params.entityId - Entity ID
   * @param {string|null} params.entityName - Entity name for easy reference
   * @param {string} params.description - Human-readable description
   * @param {Object|null} params.oldValue - Old data (for updates)
   * @param {Object|null} params.newValue - New data
   * @param {string|null} params.ipAddress - IP address
   * @param {string|null} params.userAgent - User agent
   */
  static async log({
    userId,
    userName,
    userRole,
    bidangId = null,
    module,
    action,
    entityType,
    entityId = null,
    entityName = null,
    description,
    oldValue = null,
    newValue = null,
    ipAddress = null,
    userAgent = null
  }) {
    try {
      await prisma.activity_logs.create({
        data: {
          user_id: userId,
          user_name: userName,
          user_role: userRole,
          bidang_id: bidangId,
          module,
          action,
          entity_type: entityType,
          entity_id: entityId ? BigInt(entityId) : null,
          entity_name: entityName ? String(entityName).substring(0, 255) : null,
          description,
          old_value: oldValue ? JSON.stringify(oldValue) : null,
          new_value: newValue ? JSON.stringify(newValue) : null,
          ip_address: ipAddress,
          user_agent: userAgent
        }
      });

      console.log(`[ActivityLog] ${userName} (${userRole}) - ${description}`);
    } catch (error) {
      console.error('[ActivityLog] Error logging activity:', error);
      // Don't throw error - logging should not break the main flow
    }
  }

  /**
   * Get activities by bidang
   * @param {number} bidangId - Bidang ID
   * @param {number} limit - Limit results (default: 50)
   */
  static async getByBidang(bidangId, limit = 50) {
    try {
      const activities = await prisma.activity_logs.findMany({
        where: {
          bidang_id: bidangId
        },
        orderBy: {
          created_at: 'desc'
        },
        take: limit
      });

      return activities.map(activity => ({
        ...activity,
        entity_id: activity.entity_id ? activity.entity_id.toString() : null,
        old_value: activity.old_value ? JSON.parse(activity.old_value) : null,
        new_value: activity.new_value ? JSON.parse(activity.new_value) : null
      }));
    } catch (error) {
      console.error('[ActivityLog] Error fetching activities:', error);
      return [];
    }
  }

  /**
   * Get activities by user
   * @param {number} userId - User ID
   * @param {number} limit - Limit results (default: 50)
   */
  static async getByUser(userId, limit = 50) {
    try {
      const activities = await prisma.activity_logs.findMany({
        where: {
          user_id: userId
        },
        orderBy: {
          created_at: 'desc'
        },
        take: limit
      });

      return activities.map(activity => ({
        ...activity,
        entity_id: activity.entity_id ? activity.entity_id.toString() : null,
        old_value: activity.old_value ? JSON.parse(activity.old_value) : null,
        new_value: activity.new_value ? JSON.parse(activity.new_value) : null
      }));
    } catch (error) {
      console.error('[ActivityLog] Error fetching activities:', error);
      return [];
    }
  }

  /**
   * Get activities by module
   * @param {string} module - Module name
   * @param {number} limit - Limit results (default: 50)
   */
  static async getByModule(module, limit = 50) {
    try {
      const activities = await prisma.activity_logs.findMany({
        where: {
          module
        },
        orderBy: {
          created_at: 'desc'
        },
        take: limit
      });

      return activities.map(activity => ({
        ...activity,
        entity_id: activity.entity_id ? activity.entity_id.toString() : null,
        old_value: activity.old_value ? JSON.parse(activity.old_value) : null,
        new_value: activity.new_value ? JSON.parse(activity.new_value) : null
      }));
    } catch (error) {
      console.error('[ActivityLog] Error fetching activities:', error);
      return [];
    }
  }

  /**
   * Get all recent activities
   * @param {number} limit - Limit results (default: 100)
   * @param {Object} filters - Optional filters
   */
  static async getRecent(limit = 100, filters = {}) {
    try {
      const where = {};
      
      if (filters.bidangId) where.bidang_id = filters.bidangId;
      if (filters.userId) where.user_id = filters.userId;
      if (filters.module) where.module = filters.module;
      if (filters.action) where.action = filters.action;

      const activities = await prisma.activity_logs.findMany({
        where,
        orderBy: {
          created_at: 'desc'
        },
        take: limit
      });

      return activities.map(activity => ({
        ...activity,
        entity_id: activity.entity_id ? activity.entity_id.toString() : null,
        old_value: activity.old_value ? JSON.parse(activity.old_value) : null,
        new_value: activity.new_value ? JSON.parse(activity.new_value) : null
      }));
    } catch (error) {
      console.error('[ActivityLog] Error fetching recent activities:', error);
      return [];
    }
  }

  /**
   * Helper: Extract IP address from request
   */
  static getIpFromRequest(req) {
    return req.ip || 
           req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection?.remoteAddress || 
           null;
  }

  /**
   * Helper: Extract user agent from request
   */
  static getUserAgentFromRequest(req) {
    return req.headers['user-agent'] || null;
  }

  /**
   * Helper: Create description for CRUD operations
   */
  static createDescription(action, userName, entityType, entityName, oldValue = null, newValue = null) {
    switch (action) {
      case 'create':
        return `${userName} membuat ${entityType} baru: ${entityName}`;
      
      case 'update':
        if (oldValue && newValue && oldValue.name && newValue.name && oldValue.name !== newValue.name) {
          return `${userName} mengubah nama ${entityType} dari "${oldValue.name}" menjadi "${newValue.name}"`;
        }
        return `${userName} mengubah data ${entityType}: ${entityName}`;
      
      case 'delete':
        return `${userName} menghapus ${entityType}: ${entityName}`;
      
      case 'approve':
        return `${userName} menyetujui ${entityType}: ${entityName}`;
      
      case 'reject':
        return `${userName} menolak ${entityType}: ${entityName}`;
      
      case 'upload':
        return `${userName} mengunggah file untuk ${entityType}: ${entityName}`;
      
      case 'download':
        return `${userName} mengunduh file dari ${entityType}: ${entityName}`;
      
      default:
        return `${userName} melakukan aksi ${action} pada ${entityType}: ${entityName}`;
    }
  }
}

module.exports = ActivityLogger;
