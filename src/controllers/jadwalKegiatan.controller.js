/**
 * Jadwal Kegiatan Controller - REBUILT
 * Simple and clean implementation
 */

const prisma = require('../config/prisma');
const pushNotificationService = require('../services/pushNotification.service');
const ActivityLogger = require('../utils/activityLogger');

class JadwalKegiatanController {
  /**
   * Get all jadwal kegiatan with filters and role-based access
   */
  async getAllJadwal(req, res) {
    try {
      const { 
        status, 
        prioritas,
        search,
        tanggal,
        page = 1, 
        limit = 50 
      } = req.query;

      console.log('\n🔍 [Jadwal] GET ALL Request from user:', req.user.id);
      console.log('   Role:', req.user.role);
      console.log('   Bidang ID:', req.user.bidang_id);
      console.log('   Filters:', { status, prioritas, search, tanggal, page, limit });

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const where = {};

      // NO BIDANG FILTER - All users can see all jadwal kegiatan
      // This allows cross-bidang integration and coordination
      console.log('   ✓ No bidang filter - showing all jadwal kegiatan for coordination');

      // Apply filters
      if (status && status !== 'all') {
        where.status = status;
        console.log('   ✓ Filter by status:', status);
      }
      
      if (prioritas && prioritas !== 'all') {
        where.prioritas = prioritas;
        console.log('   ✓ Filter by prioritas:', prioritas);
      }

      // Date filter - find activities on the selected date
      // Activity spans the date if: tanggal_mulai <= selected_date AND tanggal_selesai >= selected_date
      if (tanggal) {
        // Parse the input date as local time (not UTC)
        const [year, month, day] = tanggal.split('-').map(Number);
        const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
        const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
        
        where.AND = where.AND || [];
        where.AND.push({
          tanggal_mulai: { lte: endOfDay }
        });
        where.AND.push({
          tanggal_selesai: { gte: startOfDay }
        });
        console.log('   ✓ Filter tanggal:', tanggal);
        console.log('   ✓ Date range:', startOfDay, 'to', endOfDay);
      }

      // Search filter
      if (search) {
        where.OR = [
          { judul: { contains: search } },
          { deskripsi: { contains: search } },
          { lokasi: { contains: search } },
          { asal_kegiatan: { contains: search } }
        ];
        console.log('   ✓ Search term:', search);
      }

      console.log('   Final WHERE clause:', JSON.stringify(where, null, 2));

      // Query database
      const [jadwals, total] = await Promise.all([
        prisma.jadwal_kegiatan.findMany({
          where,
          include: {
            bidangs: {
              select: { nama: true }
            },
            jadwal_kegiatan_bidang: {
              include: { bidangs: { select: { id: true, nama: true } } }
            },
            _count: {
              select: { jadwal_kegiatan_views: true }
            },
            jadwal_kegiatan_reactions: {
              select: { emoji: true, user_id: true, users: { select: { id: true, name: true, role: true, avatar: true } } }
            }
          },
          skip,
          take: parseInt(limit),
          orderBy: { tanggal_mulai: 'desc' }
        }),
        prisma.jadwal_kegiatan.count({ where })
      ]);

      console.log('   ✅ Query result: Found', jadwals.length, 'records out of', total, 'total');

      const currentUserId = BigInt(req.user.id);

      // Format response
      const formattedJadwals = jadwals.map(j => {
        // Build reaction summary
        const reactionMap = {};
        for (const r of j.jadwal_kegiatan_reactions) {
          if (!reactionMap[r.emoji]) reactionMap[r.emoji] = { emoji: r.emoji, count: 0, reacted: false, users: [] };
          reactionMap[r.emoji].count++;
          if (r.user_id === currentUserId) reactionMap[r.emoji].reacted = true;
          if (r.users) reactionMap[r.emoji].users.push({ id: Number(r.users.id), name: r.users.name, role: r.users.role, avatar: r.users.avatar });
        }

        const bidangMulti = j.jadwal_kegiatan_bidang || [];
        return {
          id: j.id,
          judul: j.judul,
          deskripsi: j.deskripsi || '-',
          bidang_id: j.bidang_id,
          bidang_nama: j.bidangs?.nama || null,
          bidang_ids: bidangMulti.map(jkb => Number(jkb.bidang_id)),
          bidang_names: bidangMulti.map(jkb => jkb.bidangs?.nama).filter(Boolean),
          tanggal_mulai: j.tanggal_mulai,
          tanggal_selesai: j.tanggal_selesai,
          lokasi: j.lokasi || '-',
          asal_kegiatan: j.asal_kegiatan || '-',
          pic_name: j.pic_name || '-',
          pic_contact: j.pic_contact || '-',
          status: j.status,
          prioritas: j.prioritas,
          kategori: j.kategori,
          view_count: j._count.jadwal_kegiatan_views,
          reactions: Object.values(reactionMap),
          created_at: j.created_at,
          updated_at: j.updated_at
        };
      });
      const totalPages = Math.ceil(total / parseInt(limit));

      res.json({
        success: true,
        data: formattedJadwals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      });

    } catch (error) {
      console.error('❌ [Jadwal] Error in getAllJadwal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data jadwal kegiatan',
        error: error.message
      });
    }
  }

  /**
   * Get single jadwal by ID
   */
  async getJadwalById(req, res) {
    try {
      const { id } = req.params;

      const jadwal = await prisma.jadwal_kegiatan.findUnique({
        where: { id: parseInt(id) },
        include: {
          bidangs: { select: { nama: true } }
        }
      });

      if (!jadwal) {
        return res.status(404).json({
          success: false,
          message: 'Jadwal kegiatan tidak ditemukan'
        });
      }

      res.json({
        success: true,
        data: {
          id: jadwal.id,
          judul: jadwal.judul,
          deskripsi: jadwal.deskripsi || '-',
          bidang_id: jadwal.bidang_id,
          bidang_nama: jadwal.bidangs?.nama || null,
          tanggal_mulai: jadwal.tanggal_mulai,
          tanggal_selesai: jadwal.tanggal_selesai,
          lokasi: jadwal.lokasi || '-',
          asal_kegiatan: jadwal.asal_kegiatan || '-',
          pic_name: jadwal.pic_name || '-',
          pic_contact: jadwal.pic_contact || '-',
          status: jadwal.status,
          prioritas: jadwal.prioritas,
          kategori: jadwal.kategori,
          created_at: jadwal.created_at,
          updated_at: jadwal.updated_at
        }
      });

    } catch (error) {
      console.error('❌ [Jadwal] Error in getJadwalById:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil detail jadwal',
        error: error.message
      });
    }
  }

  /**
   * Create new jadwal kegiatan
   */
  async createJadwal(req, res) {
    try {
      const {
        judul,
        deskripsi,
        bidang_id,
        bidang_ids,
        tanggal_mulai,
        tanggal_selesai,
        lokasi,
        asal_kegiatan,
        prioritas,
        kategori,
        pic_name,
        pic_contact
      } = req.body;

      console.log('\n✨ [Jadwal] CREATE Request');
      console.log('   User:', req.user.id, '- Role:', req.user.role, '- Bidang:', req.user.bidang_id);
      console.log('   Data:', { judul, bidang_id, tanggal_mulai, tanggal_selesai, lokasi, asal_kegiatan });

      // Validation
      if (!judul || !tanggal_mulai || !tanggal_selesai) {
        return res.status(400).json({
          success: false,
          message: 'Judul, tanggal mulai, dan tanggal selesai wajib diisi'
        });
      }

      // Authorization check: Only Sekretariat (bidang_id = 2) or superadmin can create
      const SEKRETARIAT_BIDANG_ID = 2;
      const userBidangId = Number(req.user.bidang_id);
      
      if (req.user.role !== 'superadmin' && userBidangId !== SEKRETARIAT_BIDANG_ID) {
        console.log(`   ❌ Authorization failed: User bidang_id ${userBidangId} is not Sekretariat`);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk membuat jadwal kegiatan. Hanya bidang Sekretariat yang dapat mengelola jadwal.'
        });
      }

      console.log('   ✓ Authorization passed: User can create jadwal');

      // Determine bidang_id for jadwal
      // Support both single bidang_id and bidang_ids[] (multi-select)
      // null = untuk semua pegawai (lintas bidang)
      let finalBidangId = null;
      const parsedBidangIds = Array.isArray(bidang_ids) ? bidang_ids.map(Number).filter(Boolean) : [];

      if (parsedBidangIds.length === 1) {
        finalBidangId = parsedBidangIds[0];
        console.log('   ✓ Using single bidang_id from bidang_ids:', finalBidangId);
      } else if (bidang_id) {
        finalBidangId = Number(bidang_id);
        console.log('   ✓ Using specified bidang_id:', finalBidangId);
      } else {
        console.log('   ✓ No bidang_id - kegiatan untuk semua pegawai');
      }

      // Create jadwal
      const jadwal = await prisma.jadwal_kegiatan.create({
        data: {
          judul,
          deskripsi: deskripsi || '-',
          bidang_id: finalBidangId,
          tanggal_mulai: new Date(tanggal_mulai),
          tanggal_selesai: new Date(tanggal_selesai),
          lokasi: lokasi || '-',
          asal_kegiatan: asal_kegiatan || '-',
          pic_name: pic_name || '-',
          pic_contact: pic_contact || '-',
          status: 'draft',
          prioritas: prioritas || 'sedang',
          kategori: kategori || 'lainnya',
          created_by: req.user.id
        }
      });

      // Save multiple bidang relationships
      if (parsedBidangIds.length > 0) {
        await prisma.jadwal_kegiatan_bidang.createMany({
          data: parsedBidangIds.map(bid => ({
            jadwal_kegiatan_id: jadwal.id,
            bidang_id: BigInt(bid)
          })),
          skipDuplicates: true
        });
        console.log('   ✓ Saved', parsedBidangIds.length, 'bidang relations');
      }

      console.log('   ✅ Jadwal created with ID:', jadwal.id, '- Bidang:', finalBidangId || 'ALL');

      // Activity Log
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        bidangId: 2, // Sekretariat
        module: 'jadwal_kegiatan',
        action: 'create',
        entityType: 'jadwal_kegiatan',
        entityId: jadwal.id,
        entityName: judul,
        description: `${req.user.name} menambahkan jadwal kegiatan baru: ${judul}`,
        newValue: { judul, lokasi, asal_kegiatan, tanggal_mulai, tanggal_selesai },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      // Push notification dikirim per hari via cron scheduler, bukan per kegiatan

      res.status(201).json({
        success: true,
        message: 'Jadwal kegiatan berhasil ditambahkan',
        data: jadwal
      });

    } catch (error) {
      console.error('❌ [Jadwal] Error in createJadwal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menambahkan jadwal kegiatan',
        error: error.message
      });
    }
  }

  /**
   * Update jadwal kegiatan
   */
  async updateJadwal(req, res) {
    try {
      const { id } = req.params;
      const {
        judul,
        deskripsi,
        bidang_ids,
        tanggal_mulai,
        tanggal_selesai,
        lokasi,
        asal_kegiatan,
        pic_name,
        pic_contact,
        status,
        prioritas,
        kategori
      } = req.body;

      console.log('\n📝 [Jadwal] UPDATE Request for ID:', id);
      console.log('   User:', req.user.id, '- Role:', req.user.role, '- Bidang:', req.user.bidang_id);

      // Check if jadwal exists
      const existing = await prisma.jadwal_kegiatan.findUnique({
        where: { id: parseInt(id) }
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Jadwal kegiatan tidak ditemukan'
        });
      }

      // Authorization check: Only Sekretariat (bidang_id = 2) or superadmin can edit
      const SEKRETARIAT_BIDANG_ID = 2;
      const userBidangId = Number(req.user.bidang_id);
      
      if (req.user.role !== 'superadmin' && userBidangId !== SEKRETARIAT_BIDANG_ID) {
        console.log(`   ❌ Authorization failed: User bidang_id ${userBidangId} is not Sekretariat`);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk mengubah jadwal kegiatan. Hanya bidang Sekretariat yang dapat mengelola jadwal.'
        });
      }

      console.log('   ✓ Authorization passed: User can edit jadwal');

      // Track changes for notification
      const changes = {};
      if (judul && judul !== existing.judul) changes.judul = true;
      if (tanggal_mulai && tanggal_mulai !== existing.tanggal_mulai) changes.tanggal = true;
      if (tanggal_selesai && tanggal_selesai !== existing.tanggal_selesai) changes.tanggal = true;
      if (lokasi && lokasi !== existing.lokasi) changes.lokasi = true;
      if (status && status !== existing.status) changes.status = true;
      if (prioritas && prioritas !== existing.prioritas) changes.prioritas = true;

      // Update
      const updated = await prisma.jadwal_kegiatan.update({
        where: { id: parseInt(id) },
        data: {
          ...(judul && { judul }),
          ...(deskripsi !== undefined && { deskripsi: deskripsi || '-' }),
          ...(tanggal_mulai && { tanggal_mulai: new Date(tanggal_mulai) }),
          ...(tanggal_selesai && { tanggal_selesai: new Date(tanggal_selesai) }),
          ...(lokasi !== undefined && { lokasi: lokasi || '-' }),
          ...(asal_kegiatan !== undefined && { asal_kegiatan: asal_kegiatan || '-' }),
          ...(pic_name !== undefined && { pic_name: pic_name || '-' }),
          ...(pic_contact !== undefined && { pic_contact: pic_contact || '-' }),
          ...(status && { status }),
          ...(prioritas && { prioritas }),
          ...(kategori && { kategori })
        }
      });

      // Update multiple bidang relationships
      if (Array.isArray(bidang_ids)) {
        const parsedBidangIds = bidang_ids.map(Number).filter(Boolean);
        await prisma.jadwal_kegiatan_bidang.deleteMany({
          where: { jadwal_kegiatan_id: BigInt(id) }
        });
        if (parsedBidangIds.length > 0) {
          await prisma.jadwal_kegiatan_bidang.createMany({
            data: parsedBidangIds.map(bid => ({
              jadwal_kegiatan_id: BigInt(id),
              bidang_id: BigInt(bid)
            })),
            skipDuplicates: true
          });
        }
        // Update primary bidang_id
        const primaryBidangId = parsedBidangIds.length === 1 ? parsedBidangIds[0] : null;
        await prisma.jadwal_kegiatan.update({
          where: { id: parseInt(id) },
          data: { bidang_id: primaryBidangId }
        });
        console.log('   ✓ Updated', parsedBidangIds.length, 'bidang relations');
      }

      console.log('   ✅ Jadwal updated');

      // Activity Log
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        bidangId: 2, // Sekretariat
        module: 'jadwal_kegiatan',
        action: 'update',
        entityType: 'jadwal_kegiatan',
        entityId: parseInt(id),
        entityName: updated.judul,
        description: `${req.user.name} memperbarui jadwal kegiatan: ${updated.judul}`,
        oldValue: { judul: existing.judul, lokasi: existing.lokasi, status: existing.status },
        newValue: { judul: updated.judul, lokasi: updated.lokasi, status: updated.status },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      // Push notification dikirim per hari via cron scheduler, bukan per perubahan

      res.json({
        success: true,
        message: 'Jadwal kegiatan berhasil diperbarui',
        data: updated
      });

    } catch (error) {
      console.error('❌ [Jadwal] Error in updateJadwal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memperbarui jadwal kegiatan',
        error: error.message
      });
    }
  }

  /**
   * Delete jadwal kegiatan
   */
  async deleteJadwal(req, res) {
    try {
      const { id } = req.params;

      console.log('\n🗑️ [Jadwal] DELETE Request for ID:', id);
      console.log('   User:', req.user.id, '- Role:', req.user.role, '- Bidang:', req.user.bidang_id);

      // Check if jadwal exists
      const existing = await prisma.jadwal_kegiatan.findUnique({
        where: { id: parseInt(id) }
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Jadwal kegiatan tidak ditemukan'
        });
      }

      // Authorization check: Only Sekretariat (bidang_id = 2) or superadmin can delete
      const SEKRETARIAT_BIDANG_ID = 2;
      const userBidangId = Number(req.user.bidang_id);
      
      if (req.user.role !== 'superadmin' && userBidangId !== SEKRETARIAT_BIDANG_ID) {
        console.log(`   ❌ Authorization failed: User bidang_id ${userBidangId} is not Sekretariat`);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk menghapus jadwal kegiatan. Hanya bidang Sekretariat yang dapat mengelola jadwal.'
        });
      }

      console.log('   ✓ Authorization passed: User can delete jadwal');

      await prisma.jadwal_kegiatan.delete({
        where: { id: parseInt(id) }
      });

      // Activity Log
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        bidangId: 2, // Sekretariat
        module: 'jadwal_kegiatan',
        action: 'delete',
        entityType: 'jadwal_kegiatan',
        entityId: parseInt(id),
        entityName: existing.judul,
        description: `${req.user.name} menghapus jadwal kegiatan: ${existing.judul}`,
        oldValue: { judul: existing.judul, lokasi: existing.lokasi },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      console.log('   ✅ Jadwal deleted');

      res.json({
        success: true,
        message: 'Jadwal kegiatan berhasil dihapus'
      });

    } catch (error) {
      console.error('❌ [Jadwal] Error in deleteJadwal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus jadwal kegiatan',
        error: error.message
      });
    }
  }

  /**
   * POST /api/jadwal-kegiatan/:id/view
   * Track that current user viewed this jadwal
   */
  async trackView(req, res) {
    try {
      const jadwalId = parseInt(req.params.id);
      const userId = BigInt(req.user.id);

      await prisma.jadwal_kegiatan_views.upsert({
        where: { uk_jadwal_view: { jadwal_kegiatan_id: jadwalId, user_id: userId } },
        update: { viewed_at: new Date() },
        create: { jadwal_kegiatan_id: jadwalId, user_id: userId }
      });

      const viewCount = await prisma.jadwal_kegiatan_views.count({
        where: { jadwal_kegiatan_id: jadwalId }
      });

      res.json({ success: true, data: { view_count: viewCount } });
    } catch (error) {
      console.error('❌ [Jadwal] Error in trackView:', error);
      res.status(500).json({ success: false, message: 'Gagal mencatat view', error: error.message });
    }
  }

  /**
   * GET /api/jadwal-kegiatan/:id/viewers
   * Get list of users who viewed this jadwal
   */
  async getViewers(req, res) {
    try {
      const jadwalId = parseInt(req.params.id);

      const viewers = await prisma.jadwal_kegiatan_views.findMany({
        where: { jadwal_kegiatan_id: jadwalId },
        include: {
          users: { select: { id: true, name: true, role: true, avatar: true } }
        },
        orderBy: { viewed_at: 'desc' }
      });

      res.json({
        success: true,
        data: viewers.map(v => ({
          id: v.users.id,
          name: v.users.name,
          role: v.users.role,
          avatar: v.users.avatar,
          viewed_at: v.viewed_at
        }))
      });
    } catch (error) {
      console.error('❌ [Jadwal] Error in getViewers:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat viewers', error: error.message });
    }
  }

  /**
   * POST /api/jadwal-kegiatan/:id/reactions
   * Add emoji reaction to jadwal
   */
  async addReaction(req, res) {
    try {
      const jadwalId = BigInt(req.params.id);
      const userId = BigInt(req.user.id);
      const { emoji } = req.body;

      if (!emoji || emoji.length > 10) {
        return res.status(400).json({ success: false, message: 'Emoji tidak valid' });
      }

      await prisma.jadwal_kegiatan_reactions.upsert({
        where: { 
          jadwal_kegiatan_id_user_id_emoji: { 
            jadwal_kegiatan_id: jadwalId, 
            user_id: userId, 
            emoji 
          } 
        },
        update: {},
        create: { jadwal_kegiatan_id: jadwalId, user_id: userId, emoji }
      });

      const reactions = await this._getReactionsSummary(jadwalId);
      res.json({ success: true, data: reactions });
    } catch (error) {
      console.error('❌ [Jadwal] Error in addReaction:', error);
      res.status(500).json({ success: false, message: 'Gagal menambahkan reaksi', error: error.message });
    }
  }

  /**
   * DELETE /api/jadwal-kegiatan/:id/reactions
   * Remove emoji reaction from jadwal
   */
  async removeReaction(req, res) {
    try {
      const jadwalId = BigInt(req.params.id);
      const userId = BigInt(req.user.id);
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({ success: false, message: 'Emoji diperlukan' });
      }

      await prisma.jadwal_kegiatan_reactions.deleteMany({
        where: { jadwal_kegiatan_id: jadwalId, user_id: userId, emoji }
      });

      const reactions = await this._getReactionsSummary(jadwalId);
      res.json({ success: true, data: reactions });
    } catch (error) {
      console.error('❌ [Jadwal] Error in removeReaction:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus reaksi', error: error.message });
    }
  }

  /**
   * GET /api/jadwal-kegiatan/:id/reactions
   * Get all reactions for a jadwal
   */
  async getReactions(req, res) {
    try {
      const jadwalId = BigInt(req.params.id);
      const reactions = await this._getReactionsSummary(jadwalId);
      res.json({ success: true, data: reactions });
    } catch (error) {
      console.error('❌ [Jadwal] Error in getReactions:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat reaksi', error: error.message });
    }
  }

  /**
   * Internal: Get reactions summary grouped by emoji with user list
   */
  async _getReactionsSummary(jadwalId) {
    const reactions = await prisma.jadwal_kegiatan_reactions.findMany({
      where: { jadwal_kegiatan_id: jadwalId },
      include: {
        users: { select: { id: true, name: true, role: true, avatar: true } }
      },
      orderBy: { created_at: 'asc' }
    });

    // Group by emoji
    const grouped = {};
    for (const r of reactions) {
      if (!r.users) continue;
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, users: [] };
      grouped[r.emoji].count++;
      grouped[r.emoji].users.push({ id: Number(r.users.id), name: r.users.name, role: r.users.role, avatar: r.users.avatar });
    }

    return Object.values(grouped);
  }

  // ════════════════════════════════════════════════════════════
  // COMMENTS
  // ════════════════════════════════════════════════════════════

  /**
   * GET /api/jadwal-kegiatan/:id/comments
   * Get all comments for a jadwal
   */
  async getComments(req, res) {
    try {
      const jadwalId = BigInt(req.params.id);

      const comments = await prisma.jadwal_kegiatan_comments.findMany({
        where: { jadwal_kegiatan_id: jadwalId },
        include: {
          users: { select: { id: true, name: true, role: true, avatar: true } }
        },
        orderBy: { created_at: 'asc' }
      });

      const data = comments.map(c => ({
        id: Number(c.id),
        content: c.content,
        created_at: c.created_at,
        updated_at: c.updated_at,
        user: c.users ? { id: Number(c.users.id), name: c.users.name, role: c.users.role, avatar: c.users.avatar } : null
      }));

      res.json({ success: true, data });
    } catch (error) {
      console.error('❌ [Jadwal] Error in getComments:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat komentar', error: error.message });
    }
  }

  /**
   * POST /api/jadwal-kegiatan/:id/comments
   * Add a comment to a jadwal
   */
  async addComment(req, res) {
    try {
      const jadwalId = BigInt(req.params.id);
      const userId = BigInt(req.user.id);
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: 'Komentar tidak boleh kosong' });
      }

      if (content.length > 2000) {
        return res.status(400).json({ success: false, message: 'Komentar maksimal 2000 karakter' });
      }

      // Verify jadwal exists
      const jadwal = await prisma.jadwal_kegiatan.findUnique({ where: { id: jadwalId } });
      if (!jadwal) {
        return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan' });
      }

      const comment = await prisma.jadwal_kegiatan_comments.create({
        data: {
          jadwal_kegiatan_id: jadwalId,
          user_id: userId,
          content: content.trim(),
        },
        include: {
          users: { select: { id: true, name: true, role: true, avatar: true } }
        }
      });

      res.status(201).json({
        success: true,
        data: {
          id: Number(comment.id),
          content: comment.content,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          user: comment.users ? { id: Number(comment.users.id), name: comment.users.name, role: comment.users.role, avatar: comment.users.avatar } : null
        }
      });
    } catch (error) {
      console.error('❌ [Jadwal] Error in addComment:', error);
      res.status(500).json({ success: false, message: 'Gagal menambahkan komentar', error: error.message });
    }
  }

  /**
   * DELETE /api/jadwal-kegiatan/:id/comments/:commentId
   * Delete a comment (only own comment or admin)
   */
  async deleteComment(req, res) {
    try {
      const jadwalId = BigInt(req.params.id);
      const commentId = BigInt(req.params.commentId);
      const userId = BigInt(req.user.id);

      const comment = await prisma.jadwal_kegiatan_comments.findFirst({
        where: { id: commentId, jadwal_kegiatan_id: jadwalId }
      });

      if (!comment) {
        return res.status(404).json({ success: false, message: 'Komentar tidak ditemukan' });
      }

      // Only comment owner or superadmin can delete
      if (Number(comment.user_id) !== Number(userId) && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Anda tidak dapat menghapus komentar ini' });
      }

      await prisma.jadwal_kegiatan_comments.delete({ where: { id: commentId } });

      res.json({ success: true, message: 'Komentar dihapus' });
    } catch (error) {
      console.error('❌ [Jadwal] Error in deleteComment:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus komentar', error: error.message });
    }
  }
}

module.exports = new JadwalKegiatanController();
