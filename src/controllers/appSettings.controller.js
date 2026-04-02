const prisma = require('../config/prisma');

/**
 * Evaluate if a bankeu schedule setting is currently "open"
 * based on day-of-week and time range (Asia/Jakarta timezone).
 * 
 * setting_value format (JSON string):
 * { "enabled": true, "schedule": { "days": [1,2,3,4,5], "startTime": "08:00", "endTime": "16:00" } }
 * 
 * Legacy format: "true" or "false" (still supported)
 */
function evaluateBankeuSchedule(settingValue) {
  if (!settingValue) return { isOpen: true, config: null };

  // Legacy boolean format
  if (settingValue === 'true') return { isOpen: true, config: null };
  if (settingValue === 'false') return { isOpen: false, config: null };

  try {
    const config = JSON.parse(settingValue);

    // If not enabled, it's closed regardless of schedule
    if (!config.enabled) return { isOpen: false, config };

    // If no schedule defined, just use enabled flag
    if (!config.schedule) return { isOpen: config.enabled, config };

    const { days, startTime, endTime } = config.schedule;

    // Get current time in Asia/Jakarta
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    // Check day
    if (days && days.length > 0 && !days.includes(currentDay)) {
      return { isOpen: false, config, reason: 'outside_day' };
    }

    // Check time range
    if (startTime && endTime) {
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (currentTimeMinutes < startMinutes || currentTimeMinutes > endMinutes) {
        return { isOpen: false, config, reason: 'outside_time' };
      }
    }

    return { isOpen: true, config };
  } catch {
    // If JSON parse fails, treat as legacy
    return { isOpen: settingValue === 'true', config: null };
  }
}

class AppSettingsController {
  /**
   * Get setting by key
   * GET /api/app-settings/:key
   */
  async getSetting(req, res) {
    try {
      const { key } = req.params;

      const setting = await prisma.app_settings.findUnique({
        where: { setting_key: key }
      });

      // Default values for bankeu submission settings (including year-suffixed keys)
      const isBankeuKey = key.startsWith('bankeu_submission_desa') || key.startsWith('bankeu_submission_kecamatan');
      const defaultBankeuConfig = { enabled: true, schedule: null };

      if (!setting) {
        if (isBankeuKey) {
          const def = defaultBankeuConfig;
          return res.json({
            success: true,
            data: {
              key: key,
              value: true,
              config: def,
              description: null,
              updated_at: null,
              isDefault: true
            }
          });
        }
        return res.status(404).json({
          success: false,
          message: `Setting '${key}' not found`
        });
      }

      // For bankeu settings, evaluate schedule
      if (key.startsWith('bankeu_submission_')) {
        const { isOpen, config, reason } = evaluateBankeuSchedule(setting.setting_value);
        return res.json({
          success: true,
          data: {
            key: setting.setting_key,
            value: isOpen,
            config: config,
            reason: reason || null,
            description: setting.description,
            updated_at: setting.updated_at
          }
        });
      }

      // Parse boolean values for non-bankeu settings
      let value = setting.setting_value;
      if (value === 'true' || value === 'false') {
        value = value === 'true';
      }

      res.json({
        success: true,
        data: {
          key: setting.setting_key,
          value: value,
          description: setting.description,
          updated_at: setting.updated_at
        }
      });
    } catch (error) {
      console.error('Error getting setting:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get setting',
        error: error.message
      });
    }
  }

  /**
   * Update setting by key
   * PUT /api/app-settings/:key
   * Body: { value: string | boolean }
   */
  async updateSetting(req, res) {
    try {
      const { key } = req.params;
      const { value } = req.body;
      const userId = req.user?.id?.toString() || null;

      if (value === undefined || value === null) {
        return res.status(400).json({
          success: false,
          message: 'Value is required'
        });
      }

      // Check if user has permission
      const userRole = req.user?.role;
      const userBidangId = req.user?.bidang_id;
      const isSuperadmin = userRole === 'superadmin';
      const pmdBidangId = 5; // PMD = Pemberdayaan Masyarakat Desa
      const spkedBidangId = 3; // SPKED = Sarana Prasarana Kewilayahan dan Ekonomi Desa
      
      console.log('🔐 [App Settings] Update attempt - User:', req.user?.name, 'Role:', userRole, 'Bidang ID:', userBidangId, 'Key:', key);
      
      // Permission rules by setting key
      let hasPermission = false;
      let requiredPermission = '';
      
      if (key === 'kelembagaan_edit_mode') {
        // Kelembagaan settings: Only Superadmin OR PMD
        hasPermission = isSuperadmin || parseInt(userBidangId) === pmdBidangId;
        requiredPermission = 'Superadmin atau Bidang PMD (bidang_id=5)';
      } else if (key.startsWith('bankeu_submission_desa') || key.startsWith('bankeu_submission_kecamatan')) {
        // Bankeu settings (including year-suffixed): Only Superadmin OR SPKED
        hasPermission = isSuperadmin || parseInt(userBidangId) === spkedBidangId;
        requiredPermission = 'Superadmin atau Bidang SPKED (bidang_id=3)';
      } else {
        // Other settings: Only Superadmin OR SPKED
        hasPermission = isSuperadmin || parseInt(userBidangId) === spkedBidangId;
        requiredPermission = 'Superadmin atau Bidang SPKED (bidang_id=3)';
      }
      
      if (!hasPermission) {
        console.log('❌ [App Settings] Access denied for role:', userRole, 'bidang_id:', userBidangId, 'key:', key);
        return res.status(403).json({
          success: false,
          message: `Forbidden: Hanya ${requiredPermission} yang dapat mengubah setting ini`,
          debug: { userRole, userBidangId, settingKey: key, required: requiredPermission }
        });
      }

      // For bankeu settings, store as JSON config
      let valueStr;
      if (key.startsWith('bankeu_submission_') && typeof value === 'object' && value !== null) {
        // New format: { enabled, schedule: { days, startTime, endTime } }
        valueStr = JSON.stringify(value);
      } else {
        valueStr = typeof value === 'boolean' ? value.toString() : value.toString();
      }

      const setting = await prisma.app_settings.upsert({
        where: { setting_key: key },
        update: {
          setting_value: valueStr,
          updated_by_user_id: userId
        },
        create: {
          setting_key: key,
          setting_value: valueStr,
          updated_by_user_id: userId
        }
      });

      // Parse response
      if (key.startsWith('bankeu_submission_')) {
        const { isOpen, config } = evaluateBankeuSchedule(setting.setting_value);
        return res.json({
          success: true,
          message: 'Setting updated successfully',
          data: {
            key: setting.setting_key,
            value: isOpen,
            config: config,
            description: setting.description,
            updated_at: setting.updated_at,
            updated_by: userId
          }
        });
      }

      let responseValue = setting.setting_value;
      if (responseValue === 'true' || responseValue === 'false') {
        responseValue = responseValue === 'true';
      }

      res.json({
        success: true,
        message: 'Setting updated successfully',
        data: {
          key: setting.setting_key,
          value: responseValue,
          description: setting.description,
          updated_at: setting.updated_at,
          updated_by: userId
        }
      });
    } catch (error) {
      console.error('Error updating setting:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update setting',
        error: error.message
      });
    }
  }

  /**
   * Get all settings
   * GET /api/app-settings
   */
  async getAllSettings(req, res) {
    try {
      const settings = await prisma.app_settings.findMany({
        orderBy: { setting_key: 'asc' }
      });

      const formattedSettings = settings.map(setting => {
        let value = setting.setting_value;
        if (value === 'true' || value === 'false') {
          value = value === 'true';
        }
        return {
          key: setting.setting_key,
          value: value,
          description: setting.description,
          updated_at: setting.updated_at
        };
      });

      res.json({
        success: true,
        data: formattedSettings
      });
    } catch (error) {
      console.error('Error getting all settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get settings',
        error: error.message
      });
    }
  }
}

const appSettingsController = new AppSettingsController();
appSettingsController.evaluateBankeuSchedule = evaluateBankeuSchedule;
module.exports = appSettingsController;
