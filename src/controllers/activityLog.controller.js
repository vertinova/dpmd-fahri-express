/**
 * Activity Log Controller
 * Global activity logs untuk Superadmin
 */

const prisma = require('../config/prisma');

class ActivityLogController {
  /**
   * Get all activity logs (untuk Superadmin)
   * Mengambil SEMUA activity logs tanpa filter bidang_id
   */
  async getAllActivityLogs(req, res) {
    try {
      const { limit = 100, page = 1, module, action, search, bidang_id } = req.query;
      const take = Math.min(parseInt(limit), 1000); // cap at 1000
      const skip = (parseInt(page) - 1) * take;
      
      // Build where clause
      const where = {};
      
      if (module) {
        where.module = module;
      }
      
      if (action) {
        where.action = action;
      }
      
      if (bidang_id) {
        where.bidang_id = bidang_id === 'null' ? null : BigInt(bidang_id);
      }
      
      // Fetch logs
      let logs = await prisma.activity_logs.findMany({
        where,
        orderBy: {
          created_at: 'desc'
        },
        take,
        skip,
        select: {
          id: true,
          user_name: true,
          user_role: true,
          bidang_id: true,
          module: true,
          action: true,
          entity_type: true,
          entity_id: true,
          entity_name: true,
          description: true,
          created_at: true
        }
      });
      
      // Apply search filter if exists
      if (search) {
        const searchLower = search.toLowerCase();
        logs = logs.filter(log => 
          log.description?.toLowerCase().includes(searchLower) ||
          log.user_name?.toLowerCase().includes(searchLower) ||
          log.entity_name?.toLowerCase().includes(searchLower)
        );
      }
      
      // Format response
      const formattedLogs = logs.map(log => ({
        id: Number(log.id),
        userName: log.user_name,
        userRole: log.user_role,
        bidangId: log.bidang_id ? Number(log.bidang_id) : null,
        module: log.module,
        action: log.action,
        entityType: log.entity_type,
        entityId: log.entity_id ? log.entity_id.toString() : null,
        entityName: log.entity_name,
        description: log.description,
        createdAt: log.created_at
      }));
      
      res.json({
        success: true,
        message: 'Activity logs berhasil diambil',
        data: formattedLogs
      });
    } catch (error) {
      console.error('Error getting activity logs:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memuat activity logs',
        error: error.message
      });
    }
  }
  
  /**
   * Get activity log statistics
   */
  async getStats(req, res) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const [total, todayCount, weekCount, monthCount] = await Promise.all([
        prisma.activity_logs.count(),
        prisma.activity_logs.count({
          where: {
            created_at: { gte: today }
          }
        }),
        prisma.activity_logs.count({
          where: {
            created_at: { gte: weekAgo }
          }
        }),
        prisma.activity_logs.count({
          where: {
            created_at: { gte: monthStart }
          }
        })
      ]);
      
      res.json({
        success: true,
        data: {
          total: Number(total),
          today: Number(todayCount),
          thisWeek: Number(weekCount),
          thisMonth: Number(monthCount)
        }
      });
    } catch (error) {
      console.error('Error getting activity log stats:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memuat statistik',
        error: error.message
      });
    }
  }
}

module.exports = new ActivityLogController();
