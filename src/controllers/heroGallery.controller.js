const sequelize = require('../config/database');
const dialek = require('../config/dialek');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const ActivityLogger = require('../utils/activityLogger');

// Get all gallery items (admin)
exports.getAllGallery = async (req, res) => {
  try {
    const [galleries] = await sequelize.query(`
      SELECT 
        id,
        title,
        image_path,
        is_active,
        ${dialek.id('order')} as display_order,
        created_at,
        updated_at
      FROM hero_galleries
      ORDER BY ${dialek.id('order')} ASC, created_at DESC
    `);

    res.json({
      success: true,
      data: galleries
    });
  } catch (error) {
    logger.error('Error fetching hero galleries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hero galleries',
      error: error.message
    });
  }
};

// Get public gallery (only active items)
exports.getPublicGallery = async (req, res) => {
  try {
    const [galleries] = await sequelize.query(`
      SELECT 
        id,
        title,
        image_path,
        ${dialek.id('order')} as display_order
      FROM hero_galleries
      WHERE is_active = TRUE
      ORDER BY ${dialek.id('order')} ASC
    `);

    res.json({
      success: true,
      data: galleries
    });
  } catch (error) {
    logger.error('Error fetching public hero galleries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch public hero galleries',
      error: error.message
    });
  }
};

// Create new gallery item
exports.createGallery = async (req, res) => {
  try {
    const { title, display_order } = req.body;
    const image_path = req.file ? `hero-gallery/${req.file.filename}` : null;

    if (!image_path) {
      return res.status(400).json({
        success: false,
        message: 'Image is required'
      });
    }

    const [result] = await sequelize.query(`
      INSERT INTO hero_galleries (title, image_path, ${dialek.id('order')}, is_active)
      VALUES (?, ?, ?, TRUE)
    `, {
      replacements: [title, image_path, display_order || 0]
    });

    const [newGallery] = await sequelize.query(`
      SELECT * FROM hero_galleries WHERE id = ?
    `, {
      replacements: [result]
    });

    logger.info(`✅ Hero gallery created: ${title}`);

    // Activity Log
    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2, // Sekretariat
      module: 'hero_gallery',
      action: 'create',
      entityType: 'hero_gallery',
      entityId: result,
      entityName: title,
      description: `${req.user?.name || 'Admin'} menambahkan hero gallery: ${title}`,
      newValue: { title, display_order },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.status(201).json({
      success: true,
      message: 'Hero gallery created successfully',
      data: newGallery[0]
    });
  } catch (error) {
    logger.error('Error creating hero gallery:', error);
    
    // Delete uploaded file if database insert fails
    if (req.file) {
      const filePath = path.join(__dirname, '../../storage/uploads/hero-gallery', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create hero gallery',
      error: error.message
    });
  }
};

// Update gallery item
exports.updateGallery = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, display_order } = req.body;

    // Get existing gallery
    const [existing] = await sequelize.query(`
      SELECT * FROM hero_galleries WHERE id = ?
    `, {
      replacements: [id]
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hero gallery not found'
      });
    }

    let image_path = existing[0].image_path;

    // If new image uploaded
    if (req.file) {
      // Delete old image
      if (existing[0].image_path) {
        const oldImagePath = path.join(__dirname, '../../storage/uploads', existing[0].image_path);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      image_path = `hero-gallery/${req.file.filename}`;
    }

    await sequelize.query(`
      UPDATE hero_galleries
      SET title = ?, image_path = ?, ${dialek.id('order')} = ?
      WHERE id = ?
    `, {
      replacements: [title, image_path, display_order || 0, id]
    });

    const [updated] = await sequelize.query(`
      SELECT * FROM hero_galleries WHERE id = ?
    `, {
      replacements: [id]
    });

    logger.info(`✅ Hero gallery updated: ${id}`);

    // Activity Log
    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2, // Sekretariat
      module: 'hero_gallery',
      action: 'update',
      entityType: 'hero_gallery',
      entityId: parseInt(id),
      entityName: title || existing[0].title,
      description: `${req.user?.name || 'Admin'} memperbarui hero gallery: ${title || existing[0].title}`,
      oldValue: { title: existing[0].title },
      newValue: { title, display_order },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'Hero gallery updated successfully',
      data: updated[0]
    });
  } catch (error) {
    logger.error('Error updating hero gallery:', error);
    
    // Delete uploaded file if update fails
    if (req.file) {
      const filePath = path.join(__dirname, '../../storage/uploads/hero-gallery', req.file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update hero gallery',
      error: error.message
    });
  }
};

// Delete gallery item
exports.deleteGallery = async (req, res) => {
  try {
    const { id } = req.params;

    // Get gallery to delete image file
    const [gallery] = await sequelize.query(`
      SELECT * FROM hero_galleries WHERE id = ?
    `, {
      replacements: [id]
    });

    if (!gallery || gallery.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hero gallery not found'
      });
    }

    // Delete image file
    if (gallery[0].image_path) {
      const imagePath = path.join(__dirname, '../../storage/uploads', gallery[0].image_path);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    // Delete from database
    await sequelize.query(`
      DELETE FROM hero_galleries WHERE id = ?
    `, {
      replacements: [id]
    });

    logger.info(`✅ Hero gallery deleted: ${id}`);

    // Activity Log
    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2, // Sekretariat
      module: 'hero_gallery',
      action: 'delete',
      entityType: 'hero_gallery',
      entityId: parseInt(id),
      entityName: gallery[0].title,
      description: `${req.user?.name || 'Admin'} menghapus hero gallery: ${gallery[0].title}`,
      oldValue: { title: gallery[0].title },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'Hero gallery deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting hero gallery:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete hero gallery',
      error: error.message
    });
  }
};

// Toggle active status
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    await sequelize.query(`
      UPDATE hero_galleries
      SET is_active = NOT is_active
      WHERE id = ?
    `, {
      replacements: [id]
    });

    const [updated] = await sequelize.query(`
      SELECT * FROM hero_galleries WHERE id = ?
    `, {
      replacements: [id]
    });

    if (!updated || updated.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hero gallery not found'
      });
    }

    logger.info(`✅ Hero gallery status toggled: ${id}`);

    // Activity Log
    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2, // Sekretariat
      module: 'hero_gallery',
      action: 'update',
      entityType: 'hero_gallery',
      entityId: parseInt(id),
      entityName: updated[0].title,
      description: `${req.user?.name || 'Admin'} ${updated[0].is_active ? 'mengaktifkan' : 'menonaktifkan'} hero gallery: ${updated[0].title}`,
      newValue: { is_active: updated[0].is_active },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: updated[0]
    });
  } catch (error) {
    logger.error('Error toggling hero gallery status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle status',
      error: error.message
    });
  }
};
