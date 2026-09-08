const prisma = require('../config/prisma');
const logger = require('../utils/logger');

class DeviceCheckerController {
  /**
   * Receive device scan data from Laptop-checker app.
   * POST /api/devices
   *
   * Endpoint ini tidak memerlukan autentikasi karena dipanggil
   * oleh aplikasi Desktop (C# WinForms) yang dijalankan petugas
   * di lapangan.
   *
   * Payload yang dikirim Laptop-checker:
   * {
   *   user_name, department, device_id, device_name,
   *   manufacturer, model, cpu, ram, gpu, storage, windows_version
   * }
   */
  async createDevice(req, res) {
    try {
      const {
        user_name,
        department,
        device_id,
        device_name,
        manufacturer,
        model,
        cpu,
        ram,
        gpu,
        storage,
        windows_version
      } = req.body;

      if (!device_id) {
        return res.status(400).json({
          success: false,
          message: 'device_id wajib diisi'
        });
      }

      const existing = await prisma.device_checkers.findFirst({
        where: { device_id: device_id }
      });

      let device;

      if (existing) {
        device = await prisma.device_checkers.update({
          where: { id: existing.id },
          data: {
            device_name: device_name || existing.device_name,
            manufacturer: manufacturer || existing.manufacturer,
            model: model || existing.model,
            cpu: cpu || existing.cpu,
            ram: ram || existing.ram,
            gpu: gpu || existing.gpu,
            storage: storage || existing.storage,
            windows_version: windows_version || existing.windows_version,
            user_name: user_name || existing.user_name,
            department: department || existing.department,
            ip_address: this.getClientIp(req),
            updated_at: new Date()
          }
        });
        logger.info('🔄 Device checker updated: %s (device_id: %s)', device.device_name, device_id);
      } else {
        device = await prisma.device_checkers.create({
          data: {
            device_id: device_id,
            device_name: device_name || null,
            manufacturer: manufacturer || null,
            model: model || null,
            cpu: cpu || null,
            ram: ram || null,
            gpu: gpu || null,
            storage: storage || null,
            windows_version: windows_version || null,
            user_name: user_name || null,
            department: department || null,
            ip_address: this.getClientIp(req)
          }
        });
        logger.info('📱 Device checker created: %s (device_id: %s)', device.device_name, device_id);
      }

      res.status(existing ? 200 : 201).json({
        success: true,
        message: existing
          ? 'Data device berhasil diperbarui'
          : 'Data device berhasil disimpan',
        data: this.formatDevice(device)
      });
    } catch (error) {
      logger.error('Error saving device checker:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menyimpan data device',
        error: error.message
      });
    }
  }

  /**
   * Get all registered devices.
   * GET /api/devices
   * Requires authentication.
   */
  async getAllDevices(req, res) {
    try {
      const { department, search, limit = 100, offset = 0 } = req.query;

      const where = {};

      if (department) {
        where.department = department;
      }

      if (search) {
        where.OR = [
          { device_name: { contains: search } },
          { user_name: { contains: search } },
          { manufacturer: { contains: search } },
          { model: { contains: search } },
          { cpu: { contains: search } }
        ];
      }

      const [devices, total] = await Promise.all([
        prisma.device_checkers.findMany({
          where,
          orderBy: { updated_at: 'desc' },
          take: parseInt(limit),
          skip: parseInt(offset)
        }),
        prisma.device_checkers.count({ where })
      ]);

      res.json({
        success: true,
        message: 'Daftar device berhasil diambil',
        data: devices.map(d => this.formatDevice(d)),
        pagination: {
          total: Number(total),
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
    } catch (error) {
      logger.error('Error fetching device checkers:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data device',
        error: error.message
      });
    }
  }

  /**
   * Get a specific device by device_id.
   * GET /api/devices/:deviceId
   * Requires authentication.
   */
  async getDeviceById(req, res) {
    try {
      const { deviceId } = req.params;

      const device = await prisma.device_checkers.findFirst({
        where: { device_id: deviceId }
      });

      if (!device) {
        return res.status(404).json({
          success: false,
          message: 'Device tidak ditemukan'
        });
      }

      res.json({
        success: true,
        message: 'Detail device berhasil diambil',
        data: this.formatDevice(device)
      });
    } catch (error) {
      logger.error('Error fetching device checker:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data device',
        error: error.message
      });
    }
  }

  /**
   * Get aggregated device statistics per department.
   * GET /api/devices/stats
   * Requires authentication.
   */
  async getDeviceStats(req, res) {
    try {
      const stats = await prisma.$queryRaw`
        SELECT 
          department,
          COUNT(*) as total_devices,
          COUNT(DISTINCT device_id) as unique_devices,
          COUNT(DISTINCT user_name) as unique_users,
          MAX(updated_at) as last_updated
        FROM device_checkers
        WHERE department IS NOT NULL
        GROUP BY department
        ORDER BY total_devices DESC
      `;

      const formatted = stats.map(row => ({
        department: row.department,
        total_devices: Number(row.total_devices),
        unique_devices: Number(row.unique_devices),
        unique_users: Number(row.unique_users),
        last_updated: row.last_updated
      }));

      res.json({
        success: true,
        message: 'Statistik device berhasil diambil',
        data: formatted
      });
    } catch (error) {
      logger.error('Error fetching device stats:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil statistik device',
        error: error.message
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Helper methods                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Extract client IP address from request, accounting for
   * reverse proxy (trust proxy = 2 in server.js).
   */
  getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           null;
  }

  /**
   * Format device record for JSON response, converting BigInt to Number.
   */
  formatDevice(device) {
    return {
      id: Number(device.id),
      device_id: device.device_id,
      device_name: device.device_name,
      manufacturer: device.manufacturer,
      model: device.model,
      cpu: device.cpu,
      ram: device.ram,
      gpu: device.gpu,
      storage: device.storage,
      windows_version: device.windows_version,
      user_name: device.user_name,
      department: device.department,
      ip_address: device.ip_address,
      created_at: device.created_at,
      updated_at: device.updated_at
    };
  }
}

module.exports = new DeviceCheckerController();
