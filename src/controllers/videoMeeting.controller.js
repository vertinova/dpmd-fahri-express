/**
 * Video Meeting Controller
 * Handles CRUD operations for video meetings
 */

const prisma = require('../config/prisma');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const ActivityLogger = require('../utils/activityLogger');

class VideoMeetingController {
  /**
   * Generate unique room ID
   */
  generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let roomId = '';
    for (let i = 0; i < 3; i++) {
      if (i > 0) roomId += '-';
      for (let j = 0; j < 4; j++) {
        roomId += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    return roomId; // e.g., "abcd-efgh-ijkl"
  }

  /**
   * Create a new meeting
   */
  async createMeeting(req, res) {
    try {
      const {
        title,
        description,
        scheduled_start,
        scheduled_end,
        max_participants = 50,
        is_recording_enabled = false,
        is_screen_share_enabled = true,
        is_chat_enabled = true,
        password,
        waiting_room_enabled = false,
        invited_users = []
      } = req.body;

      const userId = req.user.id;
      const bidangId = req.user.bidang_id;

      // Generate unique room ID
      let roomId = this.generateRoomId();
      let existingRoom = await prisma.video_meetings.findFirst({ where: { room_id: roomId } });
      while (existingRoom) {
        roomId = this.generateRoomId();
        existingRoom = await prisma.video_meetings.findFirst({ where: { room_id: roomId } });
      }

      // Create meeting
      const meeting = await prisma.video_meetings.create({
        data: {
          uuid: uuidv4(),
          room_id: roomId,
          title,
          description,
          host_id: BigInt(userId),
          bidang_id: bidangId ? BigInt(bidangId) : null,
          scheduled_start: scheduled_start ? new Date(scheduled_start) : null,
          scheduled_end: scheduled_end ? new Date(scheduled_end) : null,
          max_participants,
          is_recording_enabled,
          is_screen_share_enabled,
          is_chat_enabled,
          password: password ? await bcrypt.hash(password, 10) : null,
          waiting_room_enabled,
          status: scheduled_start ? 'scheduled' : 'active'
        }
      });

      // Create invitations
      if (invited_users.length > 0) {
        await prisma.video_meeting_invitations.createMany({
          data: invited_users.map(u => ({
            meeting_id: meeting.id,
            user_id: u.user_id ? BigInt(u.user_id) : null,
            email: u.email || null
          }))
        });
      }

      // Activity Log
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        bidangId: 2, // Sekretariat
        module: 'video_meeting',
        action: 'create',
        entityType: 'video_meeting',
        entityId: Number(meeting.id),
        entityName: title,
        description: `${req.user.name} membuat video meeting: ${title}`,
        newValue: { title, room_id: roomId, scheduled_start },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.status(201).json({
        success: true,
        message: 'Meeting berhasil dibuat',
        data: {
          ...meeting,
          id: meeting.id.toString(),
          host_id: meeting.host_id.toString(),
          bidang_id: meeting.bidang_id?.toString()
        }
      });
    } catch (error) {
      console.error('[VideoMeeting] Error creating meeting:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal membuat meeting',
        error: error.message
      });
    }
  }

  /**
   * Get all meetings for user
   */
  async getMeetings(req, res) {
    try {
      const userId = req.user.id;
      const { status, page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {
        OR: [
          { host_id: BigInt(userId) },
          {
            video_meeting_invitations: {
              some: { user_id: BigInt(userId) }
            }
          }
        ]
      };

      if (status && status !== 'all') {
        where.status = status;
      }

      const [meetings, total] = await Promise.all([
        prisma.video_meetings.findMany({
          where,
          include: {
            video_meeting_invitations: {
              select: { user_id: true, status: true }
            },
            video_meeting_participants: {
              select: { id: true, user_id: true, guest_name: true }
            }
          },
          skip,
          take: parseInt(limit),
          orderBy: { created_at: 'desc' }
        }),
        prisma.video_meetings.count({ where })
      ]);

      res.json({
        success: true,
        data: meetings.map(m => ({
          ...m,
          id: m.id.toString(),
          host_id: m.host_id.toString(),
          bidang_id: m.bidang_id?.toString(),
          is_host: m.host_id.toString() === userId.toString()
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('[VideoMeeting] Error fetching meetings:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data meeting',
        error: error.message
      });
    }
  }

  /**
   * Get meeting by room ID (for joining)
   */
  async getMeetingByRoomId(req, res) {
    try {
      const { roomId } = req.params;

      const meeting = await prisma.video_meetings.findFirst({
        where: { room_id: roomId },
        include: {
          video_meeting_participants: {
            where: { left_at: null },
            select: {
              id: true,
              user_id: true,
              guest_name: true,
              role: true,
              is_muted: true,
              is_video_on: true
            }
          }
        }
      });

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: 'Meeting tidak ditemukan'
        });
      }

      if (meeting.status === 'ended') {
        return res.status(400).json({
          success: false,
          message: 'Meeting sudah berakhir'
        });
      }

      if (meeting.status === 'cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Meeting dibatalkan'
        });
      }

      res.json({
        success: true,
        data: {
          ...meeting,
          id: meeting.id.toString(),
          host_id: meeting.host_id.toString(),
          bidang_id: meeting.bidang_id?.toString(),
          participants: meeting.video_meeting_participants.map(p => ({
            ...p,
            id: p.id.toString(),
            user_id: p.user_id?.toString()
          }))
        }
      });
    } catch (error) {
      console.error('[VideoMeeting] Error fetching meeting:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data meeting',
        error: error.message
      });
    }
  }

  /**
   * Start a scheduled meeting
   */
  async startMeeting(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const meeting = await prisma.video_meetings.findUnique({
        where: { id: BigInt(id) }
      });

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: 'Meeting tidak ditemukan'
        });
      }

      if (meeting.host_id.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Hanya host yang bisa memulai meeting'
        });
      }

      const updated = await prisma.video_meetings.update({
        where: { id: BigInt(id) },
        data: {
          status: 'active',
          actual_start: new Date()
        }
      });

      res.json({
        success: true,
        message: 'Meeting dimulai',
        data: {
          ...updated,
          id: updated.id.toString(),
          host_id: updated.host_id.toString()
        }
      });
    } catch (error) {
      console.error('[VideoMeeting] Error starting meeting:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memulai meeting',
        error: error.message
      });
    }
  }

  /**
   * End meeting
   */
  async endMeeting(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const meeting = await prisma.video_meetings.findUnique({
        where: { id: BigInt(id) }
      });

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: 'Meeting tidak ditemukan'
        });
      }

      if (meeting.host_id.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Hanya host yang bisa mengakhiri meeting'
        });
      }

      // Update all participants as left
      await prisma.video_meeting_participants.updateMany({
        where: {
          meeting_id: BigInt(id),
          left_at: null
        },
        data: {
          left_at: new Date()
        }
      });

      const updated = await prisma.video_meetings.update({
        where: { id: BigInt(id) },
        data: {
          status: 'ended',
          actual_end: new Date()
        }
      });

      // Activity Log
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        bidangId: 2,
        module: 'video_meeting',
        action: 'update',
        entityType: 'video_meeting',
        entityId: Number(id),
        entityName: meeting.title,
        description: `${req.user.name} mengakhiri video meeting: ${meeting.title}`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: 'Meeting berakhir',
        data: {
          ...updated,
          id: updated.id.toString(),
          host_id: updated.host_id.toString()
        }
      });
    } catch (error) {
      console.error('[VideoMeeting] Error ending meeting:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengakhiri meeting',
        error: error.message
      });
    }
  }

  /**
   * Delete meeting
   */
  async deleteMeeting(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const meeting = await prisma.video_meetings.findUnique({
        where: { id: BigInt(id) }
      });

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: 'Meeting tidak ditemukan'
        });
      }

      if (meeting.host_id.toString() !== userId.toString() && req.user.role !== 'superadmin') {
        return res.status(403).json({
          success: false,
          message: 'Tidak memiliki akses untuk menghapus meeting ini'
        });
      }

      // Delete related records first (cascade)
      await prisma.video_meeting_chats.deleteMany({
        where: { meeting_id: BigInt(id) }
      });
      await prisma.video_meeting_participants.deleteMany({
        where: { meeting_id: BigInt(id) }
      });
      await prisma.video_meeting_invitations.deleteMany({
        where: { meeting_id: BigInt(id) }
      });
      await prisma.video_meeting_recordings.deleteMany({
        where: { meeting_id: BigInt(id) }
      });

      await prisma.video_meetings.delete({
        where: { id: BigInt(id) }
      });

      // Activity Log
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        bidangId: 2,
        module: 'video_meeting',
        action: 'delete',
        entityType: 'video_meeting',
        entityId: Number(id),
        entityName: meeting.title,
        description: `${req.user.name} menghapus video meeting: ${meeting.title}`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: 'Meeting berhasil dihapus'
      });
    } catch (error) {
      console.error('[VideoMeeting] Error deleting meeting:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus meeting',
        error: error.message
      });
    }
  }

  /**
   * Get chat messages for a meeting
   */
  async getChatMessages(req, res) {
    try {
      const { id } = req.params;

      const messages = await prisma.video_meeting_chats.findMany({
        where: { meeting_id: BigInt(id) },
        include: {
          video_meeting_participants: {
            select: {
              id: true,
              user_id: true,
              guest_name: true
            }
          }
        },
        orderBy: { created_at: 'asc' }
      });

      res.json({
        success: true,
        data: messages.map(m => ({
          ...m,
          id: m.id.toString(),
          meeting_id: m.meeting_id.toString(),
          participant_id: m.participant_id.toString()
        }))
      });
    } catch (error) {
      console.error('[VideoMeeting] Error fetching chat:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil chat',
        error: error.message
      });
    }
  }

  /**
   * Get public meeting info (no auth required)
   * Returns limited info for public join page
   */
  async getPublicMeetingInfo(req, res) {
    try {
      const { roomId } = req.params;

      const meeting = await prisma.video_meetings.findFirst({
        where: { room_id: roomId },
        select: {
          id: true,
          room_id: true,
          title: true,
          description: true,
          status: true,
          scheduled_start: true,
          scheduled_end: true,
          max_participants: true,
          is_screen_share_enabled: true,
          is_chat_enabled: true,
          waiting_room_enabled: true,
          // Count active participants
          video_meeting_participants: {
            where: { left_at: null },
            select: { id: true }
          }
        }
      });

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: 'Meeting tidak ditemukan'
        });
      }

      if (meeting.status === 'ended') {
        return res.status(400).json({
          success: false,
          message: 'Meeting sudah berakhir'
        });
      }

      if (meeting.status === 'cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Meeting dibatalkan'
        });
      }

      res.json({
        success: true,
        data: {
          id: meeting.id.toString(),
          room_id: meeting.room_id,
          title: meeting.title,
          description: meeting.description,
          status: meeting.status,
          scheduled_start: meeting.scheduled_start,
          scheduled_end: meeting.scheduled_end,
          max_participants: meeting.max_participants,
          is_screen_share_enabled: meeting.is_screen_share_enabled,
          is_chat_enabled: meeting.is_chat_enabled,
          waiting_room_enabled: meeting.waiting_room_enabled,
          current_participants: meeting.video_meeting_participants.length
        }
      });
    } catch (error) {
      console.error('[VideoMeeting] Error fetching public meeting info:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil informasi meeting',
        error: error.message
      });
    }
  }
}

module.exports = new VideoMeetingController();
