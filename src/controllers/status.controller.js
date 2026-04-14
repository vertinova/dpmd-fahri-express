/**
 * Status Controller - WhatsApp-like status/story feature
 */

const prisma = require('../config/prisma');
const fs = require('fs');
const path = require('path');
const { getIO } = require('../socket/meeting.socket');

// Role groupings (mirror messaging.controller.js)
const DPMD_ROLES = ['superadmin', 'admin', 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai', 'sarpras', 'sekretariat'];
const DESA_ROLES = ['desa'];
const KECAMATAN_ROLES = ['kecamatan'];
const DINAS_ROLES = ['dinas_terkait', 'verifikator_dinas'];

function resolveConversationType(senderRole, receiverRole) {
  const sIsDpmd = DPMD_ROLES.includes(senderRole), sIsDesa = DESA_ROLES.includes(senderRole);
  const sIsKec = KECAMATAN_ROLES.includes(senderRole), sIsDinas = DINAS_ROLES.includes(senderRole);
  const rIsDpmd = DPMD_ROLES.includes(receiverRole), rIsDesa = DESA_ROLES.includes(receiverRole);
  const rIsKec = KECAMATAN_ROLES.includes(receiverRole), rIsDinas = DINAS_ROLES.includes(receiverRole);
  if ((sIsDpmd && rIsDesa) || (sIsDesa && rIsDpmd)) return 'dpmd_desa';
  if ((sIsDinas && rIsDesa) || (sIsDesa && rIsDinas)) return 'dinas_desa';
  if ((sIsKec && rIsDesa) || (sIsDesa && rIsKec)) return 'kecamatan_desa';
  if ((sIsDpmd && rIsDinas) || (sIsDinas && rIsDpmd)) return 'dpmd_dinas';
  if ((sIsDpmd && rIsKec) || (sIsKec && rIsDpmd)) return 'dpmd_kecamatan';
  if (sIsDpmd && rIsDpmd) return 'dpmd_internal';
  return 'dpmd_desa';
}

class StatusController {
  /**
   * POST /api/status
   * Create a new status (expires in 24 hours)
   * Supports text-only or media (photo/video) upload via multipart form
   */
  async createStatus(req, res) {
    try {
      const userId = BigInt(req.user.id);
      const { content, background_color } = req.body;
      const file = req.file;

      // Must have either content or media
      if ((!content || !content.trim()) && !file) {
        return res.status(400).json({ success: false, message: 'Konten atau media diperlukan' });
      }

      if (content && content.length > 500) {
        return res.status(400).json({ success: false, message: 'Status maksimal 500 karakter' });
      }

      // Determine media type
      let mediaPath = null;
      let mediaType = null;
      if (file) {
        mediaPath = `storage/uploads/status/${file.filename}`;
        const ext = path.extname(file.originalname).toLowerCase();
        const videoExts = ['.mp4', '.webm', '.mov'];
        mediaType = videoExts.includes(ext) ? 'video' : 'image';
      }

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const status = await prisma.user_statuses.create({
        data: {
          user_id: userId,
          content: content?.trim() || '',
          background_color: background_color || '#059669',
          media_path: mediaPath,
          expires_at: expiresAt
        }
      });

      res.status(201).json({ success: true, data: { ...status, media_type: mediaType } });
    } catch (error) {
      console.error('Error creating status:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat status', error: error.message });
    }
  }

  /**
   * GET /api/status
   * Get all active (non-expired) statuses grouped by user
   */
  async getStatuses(req, res) {
    try {
      const userId = BigInt(req.user.id);
      const now = new Date();

      const statuses = await prisma.user_statuses.findMany({
        where: { expires_at: { gt: now } },
        include: {
          users: { select: { id: true, name: true, role: true, avatar: true } },
          status_views: {
            where: { viewer_id: userId },
            select: { id: true }
          }
        },
        orderBy: { created_at: 'asc' }
      });

      // Group by user
      const groupedMap = {};
      for (const s of statuses) {
        const uid = String(s.user_id);
        if (!groupedMap[uid]) {
          groupedMap[uid] = {
            user: s.users,
            is_own: s.user_id === userId,
            statuses: [],
            has_unviewed: false
          };
        }
        const viewed = s.status_views.length > 0;
        groupedMap[uid].statuses.push({
          id: s.id,
          content: s.content,
          background_color: s.background_color,
          media_path: s.media_path,
          created_at: s.created_at,
          expires_at: s.expires_at,
          viewed
        });
        if (!viewed && s.user_id !== userId) {
          groupedMap[uid].has_unviewed = true;
        }
      }

      // Sort: own first, then unviewed, then viewed
      const grouped = Object.values(groupedMap).sort((a, b) => {
        if (a.is_own) return -1;
        if (b.is_own) return 1;
        if (a.has_unviewed && !b.has_unviewed) return -1;
        if (!a.has_unviewed && b.has_unviewed) return 1;
        return 0;
      });

      res.json({ success: true, data: grouped });
    } catch (error) {
      console.error('Error getting statuses:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat status', error: error.message });
    }
  }

  /**
   * POST /api/status/:id/view
   * Mark a status as viewed by current user
   */
  async viewStatus(req, res) {
    try {
      const statusId = BigInt(req.params.id);
      const viewerId = BigInt(req.user.id);

      await prisma.status_views.upsert({
        where: { status_id_viewer_id: { status_id: statusId, viewer_id: viewerId } },
        update: { viewed_at: new Date() },
        create: { status_id: statusId, viewer_id: viewerId }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error viewing status:', error);
      res.status(500).json({ success: false, message: 'Gagal mencatat view', error: error.message });
    }
  }

  /**
   * GET /api/status/:id/viewers
   * Get viewers of a specific status (only status owner can see)
   */
  async getViewers(req, res) {
    try {
      const statusId = BigInt(req.params.id);
      const userId = BigInt(req.user.id);

      // Verify ownership
      const status = await prisma.user_statuses.findUnique({
        where: { id: statusId },
        select: { user_id: true }
      });

      if (!status || status.user_id !== userId) {
        return res.status(403).json({ success: false, message: 'Tidak memiliki akses' });
      }

      const viewers = await prisma.status_views.findMany({
        where: { status_id: statusId },
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
      console.error('Error getting status viewers:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat viewers', error: error.message });
    }
  }

  /**
   * DELETE /api/status/:id
   * Delete own status
   */
  async deleteStatus(req, res) {
    try {
      const statusId = BigInt(req.params.id);
      const userId = BigInt(req.user.id);

      const status = await prisma.user_statuses.findUnique({
        where: { id: statusId },
        select: { user_id: true, media_path: true }
      });

      if (!status || status.user_id !== userId) {
        return res.status(403).json({ success: false, message: 'Tidak memiliki akses' });
      }

      // Delete media file if exists
      if (status.media_path) {
        const filePath = path.resolve(status.media_path);
        fs.unlink(filePath, () => {}); // silent fail
      }

      await prisma.user_statuses.delete({ where: { id: statusId } });
      res.json({ success: true, message: 'Status berhasil dihapus' });
    } catch (error) {
      console.error('Error deleting status:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus status', error: error.message });
    }
  }

  /**
   * POST /api/status/:id/reply
   * Reply or react to a status - sends a DM to the status owner (WhatsApp-like)
   * Body: { content: "text reply or emoji", type: "reply" | "reaction" }
   */
  async replyToStatus(req, res) {
    try {
      const statusId = BigInt(req.params.id);
      const userId = BigInt(req.user.id);
      const { content, type } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: 'Konten diperlukan' });
      }

      // Get the status + owner
      const status = await prisma.user_statuses.findUnique({
        where: { id: statusId },
        include: {
          users: { select: { id: true, name: true, role: true } }
        }
      });

      if (!status) {
        return res.status(404).json({ success: false, message: 'Status tidak ditemukan' });
      }

      if (status.user_id === userId) {
        return res.status(400).json({ success: false, message: 'Tidak bisa membalas status sendiri' });
      }

      const ownerId = status.user_id;
      const ownerRole = status.users.role;
      const senderRole = req.user.role;

      // Find or create 1-on-1 conversation
      const convType = resolveConversationType(senderRole, ownerRole);
      const [p1, p2] = userId < ownerId ? [userId, ownerId] : [ownerId, userId];

      let conversation = await prisma.conversations.findFirst({
        where: { participant_one_id: p1, participant_two_id: p2, type: convType },
      });

      const now = new Date();

      if (!conversation) {
        conversation = await prisma.conversations.create({
          data: { type: convType, participant_one_id: p1, participant_two_id: p2, created_at: now, updated_at: now },
        });
      }

      // Build status context for the message
      const statusPreview = status.content
        ? (status.content.length > 80 ? status.content.substring(0, 80) + '...' : status.content)
        : (status.media_path ? '📷 Media' : 'Status');

      const isReaction = type === 'reaction';
      const messageContent = isReaction
        ? `${content.trim()}`
        : content.trim();

      // Create the message with status_reply type
      const message = await prisma.messages.create({
        data: {
          conversation_id: conversation.id,
          sender_id: userId,
          content: messageContent,
          message_type: 'status_reply',
          // Store status context in file_name field (JSON metadata)
          file_name: JSON.stringify({
            status_id: Number(statusId),
            status_content: statusPreview,
            status_media: status.media_path || null,
            status_bg: status.background_color || '#059669',
            is_reaction: isReaction,
            owner_name: status.users.name,
          }),
          created_at: now,
          updated_at: now,
        },
      });

      // Update conversation last_message_at
      await prisma.conversations.update({
        where: { id: conversation.id },
        data: { last_message_at: now, updated_at: now },
      });

      // Notify via socket
      const io = getIO();
      if (io) {
        io.to(`user_${Number(ownerId)}`).emit('new_message', {
          conversation_id: Number(conversation.id),
          message: {
            id: Number(message.id),
            conversation_id: Number(conversation.id),
            sender_id: Number(userId),
            content: messageContent,
            message_type: 'status_reply',
            created_at: now,
            sender: { id: Number(userId), name: req.user.name, role: senderRole, avatar: req.user.avatar || null },
          },
        });
      }

      res.json({
        success: true,
        data: {
          conversation_id: Number(conversation.id),
          message_id: Number(message.id),
        }
      });
    } catch (error) {
      console.error('Error replying to status:', error);
      res.status(500).json({ success: false, message: 'Gagal membalas status', error: error.message });
    }
  }
}

module.exports = new StatusController();
