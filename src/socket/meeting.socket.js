/**
 * Socket.io Signaling Server for Video Meetings
 * Handles WebRTC signaling and mediasoup coordination
 */

const { Server } = require('socket.io');
const mediasoupService = require('../services/mediasoup.service');
const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

let io;

// Chat rate limiter: Map<socketId, { count, resetTime }>
const chatRateLimits = new Map();

// Online users tracker: Map<userId, Set<socketId>>
const onlineUsers = new Map();

/**
 * Safe callback helper - prevents crash if callback is not a function
 */
function safeCallback(callback, data) {
  if (typeof callback === 'function') {
    callback(data);
  }
}

/**
 * Initialize Socket.io server
 */
function initSocketServer(httpServer) {
  // Use same CORS origins as Express (from CORS_ORIGIN env var)
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'https://dpmdbogorkab.id',
        'http://dpmdbogorkab.id',
        'https://dpmd.bogorkab.go.id',
        'http://dpmd.bogorkab.go.id'
      ];

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true
    },
    path: '/socket.io'
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const guestName = socket.handshake.auth.guestName;
      const guestId = socket.handshake.auth.guestId;
      
      // If no token or token is null/undefined, allow as guest
      if (!token || token === 'null' || token === 'undefined') {
        socket.user = {
          id: guestId || `guest_${socket.id}`,
          name: guestName || 'Guest',
          isGuest: true
        };
        return next();
      }

      // Try to verify token
      try {
        // Handle Bearer token format if present
        let tokenToVerify = token;
        if (token.startsWith('Bearer ')) {
          tokenToVerify = token.substring(7);
        }
        
        console.log(`[Socket] Verifying token: ${tokenToVerify.substring(0, 20)}...`);
        const decoded = jwt.verify(tokenToVerify, process.env.JWT_SECRET);
        console.log(`[Socket] Token decoded successfully: id=${decoded.id}`);
        
        const user = await prisma.users.findUnique({
          where: { id: BigInt(decoded.id) },
          select: { id: true, name: true, email: true, role: true, bidang_id: true }
        });

        if (!user) {
          // Token valid but user not found - allow as guest
          socket.user = {
            id: guestId || `guest_${socket.id}`,
            name: guestName || 'Guest',
            isGuest: true
          };
          return next();
        }

        socket.user = {
          id: user.id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          bidang_id: user.bidang_id?.toString(),
          isGuest: false
        };

        console.log(`[Socket] Authenticated user: id=${socket.user.id}, name=${socket.user.name}, isGuest=${socket.user.isGuest}`);
        next();
      } catch (jwtError) {
        // Token invalid/expired
        console.log('[Socket] JWT error:', jwtError.message);
        
        // If guestName is provided (public meeting page), allow as guest
        // Otherwise, this was an authenticated request that failed - still allow but log warning
        if (guestName || guestId) {
          socket.user = {
            id: guestId || `guest_${socket.id}`,
            name: guestName || 'Guest',
            isGuest: true
          };
          console.log(`[Socket] Allowing as guest due to JWT error: id=${socket.user.id}`);
          next();
        } else {
          // This is likely a logged-in user with invalid/expired token
          // Reject the connection so frontend can refresh token
          console.log('[Socket] Rejecting connection - JWT invalid and no guest credentials');
          next(new Error('Token invalid or expired. Please refresh the page.'));
        }
      }
    } catch (error) {
      console.error('[Socket] Auth error:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  // Handle connections  // Handle connections
  io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.user.name} (${socket.id})`);

    // Auto-join user's personal room for messaging
    if (!socket.user.isGuest && socket.user.id) {
      const userRoom = `user_${socket.user.id}`;
      socket.join(userRoom);
      console.log(`[Socket] ${socket.user.name} joined personal room ${userRoom}`);

      // Track online status
      const uid = socket.user.id.toString();
      if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
      onlineUsers.get(uid).add(socket.id);
      // Broadcast online status
      socket.broadcast.emit('user_online', { user_id: uid });

      // Update last_active_at in DB (fire & forget)
      prisma.users.update({
        where: { id: BigInt(uid) },
        data: { last_active_at: new Date() }
      }).catch(() => {});
    }

    // Get online users list
    socket.on('get_online_users', (callback) => {
      const ids = Array.from(onlineUsers.keys());
      if (typeof callback === 'function') callback(ids);
    });

    // Typing indicator for messaging
    socket.on('typing', (data) => {
      if (data.conversation_id && data.receiver_id) {
        // 1-on-1: emit to specific user
        io.to(`user_${data.receiver_id}`).emit('typing', {
          conversation_id: data.conversation_id,
          user_id: socket.user.id,
          user_name: socket.user.name,
        });
      } else if (data.conversation_id && data.receiver_ids && Array.isArray(data.receiver_ids)) {
        // Group: emit to all receiver IDs
        for (const rid of data.receiver_ids) {
          io.to(`user_${rid}`).emit('typing', {
            conversation_id: data.conversation_id,
            user_id: socket.user.id,
            user_name: socket.user.name,
          });
        }
      }
    });

    socket.on('stop_typing', (data) => {
      if (data.conversation_id && data.receiver_id) {
        io.to(`user_${data.receiver_id}`).emit('stop_typing', {
          conversation_id: data.conversation_id,
          user_id: socket.user.id,
        });
      } else if (data.conversation_id && data.receiver_ids && Array.isArray(data.receiver_ids)) {
        for (const rid of data.receiver_ids) {
          io.to(`user_${rid}`).emit('stop_typing', {
            conversation_id: data.conversation_id,
            user_id: socket.user.id,
          });
        }
      }
    });

    // Join meeting room
    socket.on('join-room', async (data, callback) => {
      try {
        const { roomId, guestName } = data;
        const peerId = socket.user.id;
        const userName = socket.user.isGuest ? (guestName || socket.user.name) : socket.user.name;

        console.log(`[Socket] ${userName} joining room ${roomId}`);

        // Verify meeting exists and is active
        const meeting = await prisma.video_meetings.findFirst({
          where: { room_id: roomId }
        });

        if (!meeting) {
          return safeCallback(callback, { error: 'Meeting not found' });
        }

        console.log(`[Socket] Meeting found: id=${meeting.id}, host_id=${meeting.host_id}, title="${meeting.title}"`);
        console.log(`[Socket] Joining user: id="${socket.user.id}", name="${userName}", isGuest=${socket.user.isGuest}`);

        if (meeting.status === 'ended' || meeting.status === 'cancelled') {
          return safeCallback(callback, { error: 'Meeting is not active' });
        }

        // Check password if required
        if (meeting.password) {
          const passwordMatch = await bcrypt.compare(data.password || '', meeting.password);
          if (!passwordMatch) {
            return safeCallback(callback, { error: 'Invalid password' });
          }
        }

        // Get or create mediasoup room
        const room = await mediasoupService.getOrCreateRoom(roomId);
        console.log(`[Socket] Got/created mediasoup room for ${roomId}. Peers before cleanup: ${mediasoupService.getPeersInRoom(roomId).length}`);

        // Clean up stale peers in mediasoup (peers without active sockets)
        const existingSocketsInRoom = io.sockets.adapter.rooms.get(roomId);
        const activePeerIds = new Set();
        if (existingSocketsInRoom) {
          for (const socketId of existingSocketsInRoom) {
            const s = io.sockets.sockets.get(socketId);
            if (s && s.peerId) {
              activePeerIds.add(s.peerId);
            }
          }
        }
        console.log(`[Socket] Active peer IDs before join: [${[...activePeerIds].join(', ')}]`);
        
        // Remove mediasoup peers that don't have active sockets
        const stalePeers = mediasoupService.cleanupStalePeers(roomId, activePeerIds);
        if (stalePeers > 0) {
          console.log(`[Socket] Cleaned up ${stalePeers} stale peers from room ${roomId}`);
        }
        console.log(`[Socket] Peers after cleanup: ${mediasoupService.getPeersInRoom(roomId).length}`);

        // Also clean up orphaned participant entries in database
        // (participants with left_at = null but no active socket)
        if (activePeerIds.size === 0) {
          // No active sockets in room, mark all active participants as left
          const staleDbResult = await prisma.video_meeting_participants.updateMany({
            where: {
              meeting_id: meeting.id,
              left_at: null
            },
            data: { left_at: new Date() }
          });
          if (staleDbResult.count > 0) {
            console.log(`[Socket] Cleaned up ${staleDbResult.count} stale participant entries for room ${roomId}`);
          }
        }

        // Ensure peer exists in mediasoup (important for tracking)
        mediasoupService.ensurePeerExists(roomId, peerId, userName);

        // Check if this is a reconnection (same peerId already in room from previous socket)
        let isReconnect = false;
        const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
        if (socketsInRoom) {
          for (const socketId of socketsInRoom) {
            const s = io.sockets.sockets.get(socketId);
            if (s && s.peerId === peerId && s.id !== socket.id) {
              // Found old socket with same peerId - this is a reconnection
              isReconnect = true;
              console.log(`[Socket] Reconnection detected for ${userName} (${peerId}). Disconnecting old socket.`);
              s.disconnect(true); // Disconnect old socket
              break;
            }
          }
        }

        // For reconnecting users, try to find existing participant entry
        let participant;
        if (isReconnect || socket.user.isGuest) {
          // For guests, try to find existing participant with same guest name in this meeting
          const existingParticipant = await prisma.video_meeting_participants.findFirst({
            where: {
              meeting_id: meeting.id,
              guest_name: socket.user.isGuest ? userName : null,
              user_id: socket.user.isGuest ? null : BigInt(socket.user.id),
              left_at: null // Still active
            },
            orderBy: { joined_at: 'desc' }
          });

          if (existingParticipant) {
            participant = existingParticipant;
            console.log(`[Socket] Reusing existing participant entry for ${userName}`);
          } else {
            participant = await prisma.video_meeting_participants.create({
              data: {
                meeting_id: meeting.id,
                user_id: socket.user.isGuest ? null : BigInt(socket.user.id),
                guest_name: socket.user.isGuest ? userName : null,
                role: meeting.host_id.toString() === socket.user.id ? 'host' : 'participant',
                joined_at: new Date()
              }
            });
          }
        } else {
          // Add new participant to database
          participant = await prisma.video_meeting_participants.create({
            data: {
              meeting_id: meeting.id,
              user_id: socket.user.isGuest ? null : BigInt(socket.user.id),
              guest_name: socket.user.isGuest ? userName : null,
              role: meeting.host_id.toString() === socket.user.id ? 'host' : 'participant',
              joined_at: new Date()
            }
          });
        }

        // Store participant info in socket
        socket.roomId = roomId;
        socket.participantId = participant.id.toString();
        socket.userName = userName;
        socket.peerId = peerId;

        // Join socket room
        socket.join(roomId);

        // Get RTP capabilities
        const rtpCapabilities = mediasoupService.getRtpCapabilities(roomId);

        // Get existing producers (from other peers)
        const producers = mediasoupService.getProducers(roomId, peerId);
        console.log(`[Socket] Existing producers for ${userName}: ${producers.length} producers`, producers.map(p => ({ producerId: p.producerId, peerId: p.peerId, kind: p.kind })));

        // Get active socket peer IDs from the socket room
        const activeSocketIds = [];
        const currentSocketsInRoom = io.sockets.adapter.rooms.get(roomId);
        if (currentSocketsInRoom) {
          for (const socketId of currentSocketsInRoom) {
            const s = io.sockets.sockets.get(socketId);
            if (s && s.peerId && s.peerId !== peerId) {
              activeSocketIds.push(s.peerId);
            }
          }
        }

        // Get existing peers in the room, filtered by active sockets
        const existingPeers = mediasoupService.getPeersInRoom(roomId, peerId, activeSocketIds);

        // Notify others in the room (only if not reconnecting)
        if (!isReconnect) {
          socket.to(roomId).emit('peer-joined', {
            peerId,
            name: userName,
            participantId: participant.id.toString()
          });
        } else {
          console.log(`[Socket] Skipping peer-joined broadcast for reconnecting user ${userName}`);
        }

        console.log(`[Socket] ${userName} joined room ${roomId} successfully. Reconnect: ${isReconnect}, Active peers: ${activeSocketIds.length}, Existing peers: ${existingPeers.length}`);

        const hostIdStr = meeting.host_id.toString();
        const userIdStr = socket.user.id?.toString();
        const isHost = hostIdStr === userIdStr;
        console.log(`[Socket] Host check for ${userName}: host_id="${hostIdStr}", socket.user.id="${userIdStr}", isHost=${isHost}`);

        safeCallback(callback, {
          success: true,
          rtpCapabilities,
          producers,
          existingPeers,
          participantId: participant.id.toString(),
          peerId,
          meetingSettings: {
            isRecordingEnabled: meeting.is_recording_enabled,
            isScreenShareEnabled: meeting.is_screen_share_enabled,
            isChatEnabled: meeting.is_chat_enabled,
            isHost: isHost
          }
        });
      } catch (error) {
        console.error('[Socket] Error joining room:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Create WebRTC transport
    socket.on('create-transport', async (data, callback) => {
      console.log(`[Socket] create-transport received from ${socket.peerId}, direction: ${data?.direction}, roomId: ${socket.roomId}`);
      try {
        const { direction } = data; // 'send' or 'recv'
        const peerId = socket.user.id;
        const roomId = socket.roomId;

        console.log(`[Socket] Creating ${direction} transport for peer ${peerId} in room ${roomId}`);
        const transport = await mediasoupService.createWebRtcTransport(roomId, peerId, direction);
        console.log(`[Socket] Transport created: ${transport.id}`);

        safeCallback(callback, { success: true, transport });
      } catch (error) {
        console.error('[Socket] Error creating transport:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Connect transport
    socket.on('connect-transport', async (data, callback) => {
      console.log(`[Socket] connect-transport received from ${socket.peerId}, transportId: ${data?.transportId}`);
      try {
        const { transportId, dtlsParameters } = data;
        const peerId = socket.user.id;
        const roomId = socket.roomId;

        console.log(`[Socket] Connecting transport ${transportId} for peer ${peerId}`);
        await mediasoupService.connectTransport(roomId, peerId, transportId, dtlsParameters);
        console.log(`[Socket] Transport ${transportId} connected successfully`);

        safeCallback(callback, { success: true });
      } catch (error) {
        console.error('[Socket] Error connecting transport:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Produce media (start sending video/audio)
    socket.on('produce', async (data, callback) => {
      console.log(`[Socket] produce received from ${socket.peerId}, kind: ${data?.kind}`);
      try {
        const { transportId, kind, rtpParameters, appData } = data;
        const peerId = socket.user.id;
        const roomId = socket.roomId;

        console.log(`[Socket] Producing ${kind} for peer ${peerId} in room ${roomId}`);
        const producer = await mediasoupService.produce(
          roomId,
          peerId,
          transportId,
          kind,
          rtpParameters,
          { ...appData, userName: socket.userName }
        );

        // Notify others about new producer
        socket.to(roomId).emit('new-producer', {
          producerId: producer.id,
          peerId,
          kind: producer.kind,
          userName: socket.userName
        });

        safeCallback(callback, { success: true, id: producer.id });
      } catch (error) {
        console.error('[Socket] Error producing:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Consume media (start receiving video/audio from another peer)
    socket.on('consume', async (data, callback) => {
      console.log(`[Socket] consume received from ${socket.peerId}, producerId: ${data?.producerId}`);
      try {
        const { transportId, producerId, rtpCapabilities } = data;
        const peerId = socket.user.id;
        const roomId = socket.roomId;

        console.log(`[Socket] Consuming producer ${producerId} for peer ${peerId} in room ${roomId}`);
        const consumer = await mediasoupService.consume(
          roomId,
          peerId,
          transportId,
          producerId,
          rtpCapabilities
        );
        console.log(`[Socket] Consumer created: ${consumer.id}, kind: ${consumer.kind}`);

        safeCallback(callback, { success: true, consumer });
      } catch (error) {
        console.error('[Socket] Error consuming:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Resume consumer
    socket.on('resume-consumer', async (data, callback) => {
      try {
        const { consumerId } = data;
        const peerId = socket.user.id;
        const roomId = socket.roomId;

        await mediasoupService.resumeConsumer(roomId, peerId, consumerId);

        safeCallback(callback, { success: true });
      } catch (error) {
        console.error('[Socket] Error resuming consumer:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Close producer (stop sending video/audio)
    socket.on('close-producer', async (data) => {
      try {
        const { producerId } = data;
        const peerId = socket.user.id;
        const roomId = socket.roomId;

        mediasoupService.closeProducer(roomId, peerId, producerId);

        // Notify others
        socket.to(roomId).emit('producer-closed', {
          producerId,
          peerId
        });
      } catch (error) {
        console.error('[Socket] Error closing producer:', error);
      }
    });

    // Chat message
    socket.on('chat-message', async (data) => {
      try {
        const { message } = data;
        const roomId = socket.roomId;
        const participantId = socket.participantId;

        // Rate limit: max 10 messages per 10 seconds per socket
        const now = Date.now();
        const limit = chatRateLimits.get(socket.id);
        if (limit && now < limit.resetTime) {
          limit.count++;
          if (limit.count > 10) {
            console.log(`[Socket] Chat rate limited for ${socket.userName}`);
            return;
          }
        } else {
          chatRateLimits.set(socket.id, { count: 1, resetTime: now + 10000 });
        }

        // Sanitize message length
        const sanitizedMessage = message?.slice(0, 2000);
        if (!sanitizedMessage?.trim()) return;

        // Save to database
        const chatMessage = await prisma.video_meeting_chats.create({
          data: {
            meeting_id: BigInt(
              (await prisma.video_meetings.findFirst({ where: { room_id: roomId } })).id
            ),
            participant_id: BigInt(participantId),
            message: sanitizedMessage,
            message_type: 'text'
          }
        });

        // Broadcast to all in room (including sender)
        io.to(roomId).emit('chat-message', {
          id: chatMessage.id.toString(),
          message: sanitizedMessage,
          senderName: socket.userName,
          senderId: socket.user.id,
          timestamp: chatMessage.created_at
        });
      } catch (error) {
        console.error('[Socket] Error sending chat message:', error);
      }
    });

    // Screen share status
    socket.on('screen-share-started', () => {
      socket.to(socket.roomId).emit('screen-share-started', {
        peerId: socket.user.id,
        userName: socket.userName
      });
    });

    socket.on('screen-share-stopped', () => {
      socket.to(socket.roomId).emit('screen-share-stopped', {
        peerId: socket.user.id
      });
    });

    // Mute/unmute status
    socket.on('mute-status-changed', (data) => {
      socket.to(socket.roomId).emit('peer-mute-changed', {
        peerId: socket.user.id,
        isMuted: data.isMuted,
        kind: data.kind // 'audio' or 'video'
      });
    });

    // End meeting (host only)
    socket.on('end-meeting', async (data, callback) => {
      try {
        const roomId = socket.roomId;
        console.log(`[Socket] end-meeting called by ${socket.user?.name} (id: ${socket.user?.id}, isGuest: ${socket.user?.isGuest}), roomId: ${roomId}`);
        
        if (!roomId) {
          console.log('[Socket] end-meeting failed: not in a room');
          return safeCallback(callback, { error: 'Not in a room' });
        }

        // Verify user is host
        const meeting = await prisma.video_meetings.findFirst({
          where: { room_id: roomId }
        });

        if (!meeting) {
          console.log('[Socket] end-meeting failed: meeting not found');
          return safeCallback(callback, { error: 'Meeting not found' });
        }

        const hostIdStr = meeting.host_id.toString();
        const userIdStr = socket.user.id?.toString();
        console.log(`[Socket] Comparing host_id: "${hostIdStr}" with socket.user.id: "${userIdStr}"`);
        
        if (hostIdStr !== userIdStr) {
          console.log('[Socket] end-meeting failed: user is not host');
          return safeCallback(callback, { error: 'Only host can end the meeting' });
        }

        console.log(`[Socket] Host ${socket.userName} ending meeting ${roomId}`);

        // Update meeting status and actual_end in database
        await prisma.video_meetings.update({
          where: { id: meeting.id },
          data: { 
            status: 'ended',
            actual_end: new Date()
          }
        });

        // Update all participants as left
        await prisma.video_meeting_participants.updateMany({
          where: { 
            meeting_id: meeting.id,
            left_at: null
          },
          data: { left_at: new Date() }
        });

        // Notify all participants that meeting has ended
        io.to(roomId).emit('meeting-ended', {
          message: 'Meeting telah diakhiri oleh host',
          endedBy: socket.userName
        });

        // Send success callback to host BEFORE disconnecting sockets
        console.log(`[Socket] Meeting ${roomId} ended successfully`);
        safeCallback(callback, { success: true });

        // Remove all peers from mediasoup room
        try {
          mediasoupService.closeRoom(roomId);
        } catch (mediasoupErr) {
          console.error('[Socket] Error closing mediasoup room:', mediasoupErr);
          // Continue - this shouldn't block ending the meeting
        }

        // Disconnect all sockets in the room (after callback sent)
        const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
        if (socketsInRoom) {
          for (const socketId of socketsInRoom) {
            const s = io.sockets.sockets.get(socketId);
            if (s) {
              s.leave(roomId);
              s.roomId = null;
            }
          }
        }
      } catch (error) {
        console.error('[Socket] Error ending meeting:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Leave room
    socket.on('leave-room', async () => {
      await handlePeerLeave(socket);
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`[Socket] User disconnected: ${socket.user.name}`);
      chatRateLimits.delete(socket.id);

      // Update online status tracking
      if (!socket.user.isGuest && socket.user.id) {
        const uid = socket.user.id.toString();
        const sockets = onlineUsers.get(uid);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            onlineUsers.delete(uid);
            // User is fully offline - broadcast & update last_active_at
            socket.broadcast.emit('user_offline', { user_id: uid, last_active_at: new Date().toISOString() });
            prisma.users.update({
              where: { id: BigInt(uid) },
              data: { last_active_at: new Date() }
            }).catch(() => {});
          }
        }
      }

      await handlePeerLeave(socket);
    });
  });

  console.log('[Socket] Signaling server initialized');
  return io;
}

/**
 * Handle peer leaving
 */
async function handlePeerLeave(socket) {
  try {
    const roomId = socket.roomId;
    const peerId = socket.peerId || socket.user?.id;
    const participantId = socket.participantId;

    if (!roomId) return;

    console.log(`[Socket] Handling leave for ${socket.userName} (peerId: ${peerId}) from room ${roomId}`);

    // Update participant in database
    if (participantId) {
      try {
        await prisma.video_meeting_participants.update({
          where: { id: BigInt(participantId) },
          data: { left_at: new Date() }
        });
      } catch (dbErr) {
        console.error('[Socket] Error updating participant:', dbErr.message);
      }
    }

    // Remove from mediasoup room
    if (peerId && roomId) {
      mediasoupService.removePeer(roomId, peerId);
    }

    // Leave socket room
    socket.leave(roomId);

    // Notify others
    if (io) {
      io.to(roomId).emit('peer-left', {
        peerId,
        userName: socket.userName
      });
    }

    console.log(`[Socket] ${socket.userName} left room ${roomId}`);
  } catch (error) {
    console.error('[Socket] Error handling peer leave:', error);
  }
}

/**
 * Get Socket.io instance
 */
function getIO() {
  return io;
}

module.exports = {
  initSocketServer,
  getIO
};
