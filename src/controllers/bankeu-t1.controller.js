// src/controllers/bankeu-t1.controller.js
const fs = require('fs').promises;
const path = require('path');
const ActivityLogger = require('../utils/activityLogger');
const { tahunPenyaluran, namaBerkasPenyaluran } = require('../utils/berkasPenyaluranBankeu');

/**
 * Upload and replace bankeu-tahap1.json file
 */
const uploadBankeuT1Data = async (req, res) => {
  try {
    // Check if file exists in request
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File JSON tidak ditemukan. Silakan upload file.'
      });
    }

    // Validate file extension
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (fileExt !== '.json') {
      // Remove uploaded file
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'File harus berformat JSON (.json)'
      });
    }

    // Read and validate JSON content
    let jsonData;
    try {
      const fileContent = await fs.readFile(req.file.path, 'utf-8');
      jsonData = JSON.parse(fileContent);
    } catch (error) {
      // Remove uploaded file
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'File JSON tidak valid. Pastikan format JSON benar.'
      });
    }

    // Validate JSON structure (should be array)
    if (!Array.isArray(jsonData)) {
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Format data tidak sesuai. Data harus berupa array.'
      });
    }

    // Validate required fields in first item (sample validation)
    if (jsonData.length > 0) {
      const requiredFields = ['kecamatan', 'desa', 'sts', 'Realisasi'];
      const firstItem = jsonData[0];
      const missingFields = requiredFields.filter(field => !firstItem.hasOwnProperty(field));
      
      if (missingFields.length > 0) {
        await fs.unlink(req.file.path);
        return res.status(400).json({
          success: false,
          message: `Field yang diperlukan tidak lengkap: ${missingFields.join(', ')}`
        });
      }
    }

    // Backup old file (optional, with timestamp)
    const publicDir = path.join(__dirname, '../../public');
    const tahun = tahunPenyaluran(req.query.tahun);
    const namaBerkas = namaBerkasPenyaluran(1, tahun);
    const targetFile = path.join(publicDir, namaBerkas);
    const backupDir = path.join(publicDir, 'backups');
    
    // Create backups directory if not exists
    try {
      await fs.access(backupDir);
    } catch {
      await fs.mkdir(backupDir, { recursive: true });
    }

    // Backup existing file if exists
    try {
      await fs.access(targetFile);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const backupFile = path.join(backupDir, `${namaBerkas.replace('.json', '')}_backup_${timestamp}.json`);
      await fs.copyFile(targetFile, backupFile);
    } catch (error) {
      // File doesn't exist, skip backup
      console.log('No existing file to backup');
    }

    // Move uploaded file to replace bankeu-tahap1.json
    await fs.copyFile(req.file.path, targetFile);
    
    // Remove temp uploaded file
    await fs.unlink(req.file.path);

    // Count statistics from new data
    const validData = jsonData.filter(item => {
      const realisasi = typeof item.Realisasi === 'string' 
        ? parseInt(item.Realisasi.replace(/,/g, '')) 
        : item.Realisasi;
      return realisasi > 0;
    });

    const totalRows = jsonData.length;
    const validRows = validData.length;
    
    // Count unique desa
    const desaMap = {};
    validData.forEach(item => {
      const key = `${item.kecamatan}|${item.desa}`;
      if (!desaMap[key]) {
        desaMap[key] = true;
      }
    });
    const uniqueDesa = Object.keys(desaMap).length;

    // Log activity
    try {
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        bidangId: 3, // SPKED
        module: 'bankeu',
        action: 'update',
        entityType: 'bankeu_tahap_1',
        entityName: 'Bantuan Keuangan Tahap 1',
        description: `${req.user.name} memperbarui data Bantuan Keuangan Tahap 1 TA ${tahun} (${validRows} desa)`
      });
    } catch (logError) {
      console.error('Error logging bankeu activity:', logError);
    }

    res.json({
      success: true,
      message: 'Data Bantuan Keuangan Tahap 1 berhasil diupdate',
      data: {
        tahun_anggaran: tahun,
        totalRows,
        validRows,
        uniqueDesa,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user?.nama || req.user?.email || 'System'
      }
    });

  } catch (error) {
    console.error('Error uploading bankeu tahap 1 data:', error);
    
    // Clean up uploaded file if exists
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error removing temp file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat upload data',
      error: error.message
    });
  }
};

/**
 * Get bankeu tahap 1 data (JSON content)
 */
const getBankeuT1Data = async (req, res) => {
  try {
    const publicDir = path.join(__dirname, '../../public');
    const tahun = tahunPenyaluran(req.query.tahun);
    const namaBerkas = namaBerkasPenyaluran(1, tahun);
    const targetFile = path.join(publicDir, namaBerkas);

    // Check if file exists
    try {
      await fs.access(targetFile);
    } catch {
      return res.status(404).json({
        success: false,
        message: `File data Bantuan Keuangan Tahap 1 TA ${tahun} tidak ditemukan`
      });
    }

    // Read and return JSON data
    const fileContent = await fs.readFile(targetFile, 'utf-8');
    const jsonData = JSON.parse(fileContent);

    res.json({
      success: true,
      tahun_anggaran: tahun,
      data: jsonData
    });

  } catch (error) {
    console.error('Error getting bankeu tahap 1 data:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal membaca data Bantuan Keuangan Tahap 1',
      error: error.message
    });
  }
};

/**
 * Get current bankeu tahap 1 data info
 */
const getBankeuT1Info = async (req, res) => {
  try {
    const publicDir = path.join(__dirname, '../../public');
    const tahun = tahunPenyaluran(req.query.tahun);
    const namaBerkas = namaBerkasPenyaluran(1, tahun);
    const targetFile = path.join(publicDir, namaBerkas);

    // Check if file exists
    try {
      await fs.access(targetFile);
    } catch {
      return res.status(404).json({
        success: false,
        message: `File data Bantuan Keuangan Tahap 1 TA ${tahun} tidak ditemukan`
      });
    }

    // Get file stats
    const stats = await fs.stat(targetFile);
    const fileContent = await fs.readFile(targetFile, 'utf-8');
    const jsonData = JSON.parse(fileContent);

    // Calculate statistics
    const validData = jsonData.filter(item => {
      const realisasi = typeof item.Realisasi === 'string' 
        ? parseInt(item.Realisasi.replace(/,/g, '')) 
        : item.Realisasi;
      return realisasi > 0;
    });

    const desaMap = {};
    validData.forEach(item => {
      const key = `${item.kecamatan}|${item.desa}`;
      if (!desaMap[key]) {
        desaMap[key] = true;
      }
    });

    res.json({
      success: true,
      data: {
        fileName: namaBerkas,
        tahun_anggaran: tahun,
        fileSize: stats.size,
        lastModified: stats.mtime,
        totalRows: jsonData.length,
        validRows: validData.length,
        uniqueDesa: Object.keys(desaMap).length
      }
    });

  } catch (error) {
    console.error('Error getting bankeu tahap 1 info:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil info data',
      error: error.message
    });
  }
};

/**
 * Get list of backup files
 */
const getBankeuT1BackupList = async (req, res) => {
  try {
    const tahun = tahunPenyaluran(req.query.tahun);
    const publicDir = path.join(__dirname, '../../public');
    const backupDir = path.join(publicDir, 'backups');

    // Check if backup directory exists
    try {
      await fs.access(backupDir);
    } catch {
      return res.json({
        success: true,
        data: []
      });
    }

    // Read backup directory
    const files = await fs.readdir(backupDir);
    const backupFiles = files.filter(file => file.startsWith(`${namaBerkasPenyaluran(1, tahun).replace('.json', '')}_backup_`));

    // Get file stats for each backup
    const backups = await Promise.all(
      backupFiles.map(async (file) => {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        return {
          fileName: file,
          fileSize: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime
        };
      })
    );

    // Sort by date descending
    backups.sort((a, b) => b.createdAt - a.createdAt);

    res.json({
      success: true,
      data: backups
    });

  } catch (error) {
    console.error('Error getting backup list:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil daftar backup',
      error: error.message
    });
  }
};

module.exports = {
  uploadBankeuT1Data,
  getBankeuT1Data,
  getBankeuT1Info,
  getBankeuT1BackupList
};
