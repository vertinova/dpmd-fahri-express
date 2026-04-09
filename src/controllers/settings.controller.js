const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Change password for the authenticated user
 */
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const userId = req.user.id;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Semua field harus diisi'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password baru minimal 6 karakter'
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Konfirmasi password tidak cocok'
      });
    }

    const user = await prisma.users.findUnique({
      where: { id: BigInt(userId) },
      select: { id: true, password: true, role: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Password lama tidak sesuai'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // Never store plain password for superadmin
    await prisma.users.update({
      where: { id: BigInt(userId) },
      data: {
        password: hashedPassword,
        plain_password: user.role === 'superadmin' ? null : new_password,
        updated_at: new Date()
      }
    });

    logger.info(`User ${userId} changed password successfully`);

    return res.json({
      success: true,
      message: 'Password berhasil diubah'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengubah password'
    });
  }
};

/**
 * Backup database - generates SQL dump (superadmin only)
 */
const backupDatabase = async (req, res) => {
  try {
    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const dbPort = process.env.DB_PORT || '3306';
    const dbName = process.env.DB_NAME || 'dpmd';
    const dbUser = process.env.DB_USER || 'root';
    const dbPassword = process.env.DB_PASSWORD || '';

    const backupDir = path.join(__dirname, '../../storage/backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup_${dbName}_${timestamp}.sql`;
    const filePath = path.join(backupDir, filename);

    // Build mysqldump command
    let cmd = `mysqldump -h ${dbHost} -P ${dbPort} -u ${dbUser}`;
    if (dbPassword) {
      cmd += ` -p${dbPassword}`;
    }
    cmd += ` --single-transaction --routines --triggers --add-drop-table ${dbName}`;

    await new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 1024 * 1024 * 512 }, (error, stdout, stderr) => {
        if (error) {
          logger.error('mysqldump error:', error.message);
          return reject(error);
        }
        // Write the dump to file
        fs.writeFileSync(filePath, stdout, 'utf8');
        resolve();
      });
    });

    const stats = fs.statSync(filePath);
    logger.info(`Database backup created: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    // Stream the file to client then delete it
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      // Clean up the file after sending
      fs.unlink(filePath, (err) => {
        if (err) logger.error('Failed to delete backup file:', err);
      });
    });
  } catch (error) {
    logger.error('Database backup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal membuat backup database: ' + error.message
    });
  }
};

/**
 * Get database info (superadmin only)
 */
const getDatabaseInfo = async (req, res) => {
  try {
    // Get table count and sizes
    const dbName = process.env.DB_NAME || 'dpmd';

    const tables = await prisma.$queryRawUnsafe(`
      SELECT 
        table_name AS table_name,
        table_rows AS row_count,
        ROUND(data_length / 1024 / 1024, 2) AS data_size_mb,
        ROUND(index_length / 1024 / 1024, 2) AS index_size_mb
      FROM information_schema.tables 
      WHERE table_schema = ?
      ORDER BY data_length DESC
    `, dbName);

    const totalRows = tables.reduce((sum, t) => sum + Number(t.row_count || 0), 0);
    const totalSize = tables.reduce((sum, t) => sum + Number(t.data_size_mb || 0) + Number(t.index_size_mb || 0), 0);

    return res.json({
      success: true,
      data: {
        database: dbName,
        table_count: tables.length,
        total_rows: totalRows,
        total_size_mb: totalSize.toFixed(2),
        tables: tables.map(t => ({
          name: t.table_name,
          rows: Number(t.row_count || 0),
          size_mb: (Number(t.data_size_mb || 0) + Number(t.index_size_mb || 0)).toFixed(2)
        }))
      }
    });
  } catch (error) {
    logger.error('Get database info error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil informasi database'
    });
  }
};

/**
 * Get login history for the authenticated user
 */
const getLoginHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [histories, total] = await Promise.all([
      prisma.login_histories.findMany({
        where: { user_id: BigInt(userId) },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip,
        select: {
          id: true,
          ip_address: true,
          device_type: true,
          browser: true,
          os: true,
          status: true,
          created_at: true
        }
      }),
      prisma.login_histories.count({
        where: { user_id: BigInt(userId) }
      })
    ]);

    return res.json({
      success: true,
      data: {
        histories: histories.map(h => ({
          ...h,
          id: h.id.toString()
        })),
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get login history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil riwayat login'
    });
  }
};

/**
 * Get online users (active in last 5 minutes) - superadmin only
 */
const getOnlineUsers = async (req, res) => {
  try {
    const minutesThreshold = parseInt(req.query.minutes) || 5;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const threshold = new Date(Date.now() - minutesThreshold * 60 * 1000);

    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where: {
          last_active_at: { gte: threshold },
          is_active: true
        },
        orderBy: { last_active_at: 'desc' },
        take: limit,
        skip,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatar: true,
          last_active_at: true,
          desa_id: true,
          kecamatan_id: true,
          dinas_id: true,
          login_histories: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: {
              ip_address: true,
              browser: true,
              os: true,
              device_type: true
            }
          }
        }
      }),
      prisma.users.count({
        where: {
          last_active_at: { gte: threshold },
          is_active: true
        }
      })
    ]);

    // Collect unique IDs for batch lookup
    const desaIds = [...new Set(users.map(u => u.desa_id).filter(Boolean))];
    const kecIds = [...new Set(users.map(u => u.kecamatan_id).filter(Boolean))];
    const dinasIds = [...new Set(users.map(u => u.dinas_id).filter(Boolean))];

    const [desaList, kecList, dinasList] = await Promise.all([
      desaIds.length ? prisma.desas.findMany({ where: { id: { in: desaIds } }, select: { id: true, nama: true } }) : [],
      kecIds.length ? prisma.kecamatans.findMany({ where: { id: { in: kecIds } }, select: { id: true, nama: true } }) : [],
      dinasIds.length ? prisma.dinas.findMany({ where: { id: { in: dinasIds } }, select: { id: true, nama: true } }) : [],
    ]);

    const desaMap = Object.fromEntries(desaList.map(d => [d.id.toString(), d]));
    const kecMap = Object.fromEntries(kecList.map(k => [k.id.toString(), k]));
    const dinasMap = Object.fromEntries(dinasList.map(d => [d.id.toString(), d]));

    return res.json({
      success: true,
      data: {
        users: users.map(u => ({
          id: u.id.toString(),
          name: u.name,
          email: u.email,
          role: u.role,
          avatar: u.avatar,
          last_active_at: u.last_active_at,
          last_login: u.login_histories[0] || null,
          desa: u.desa_id ? (desaMap[u.desa_id.toString()] || null) : null,
          kecamatan: u.kecamatan_id ? (kecMap[u.kecamatan_id.toString()] || null) : null,
          dinas: u.dinas_id ? (dinasMap[u.dinas_id.toString()] ? { nama_dinas: dinasMap[u.dinas_id.toString()].nama } : null) : null,
        })),
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get online users error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data user online'
    });
  }
};

module.exports = {
  changePassword,
  backupDatabase,
  getDatabaseInfo,
  getLoginHistory,
  getOnlineUsers
};
