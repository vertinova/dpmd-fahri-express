/**
 * Socket.io Signaling Server for Video Meetings
 * Handles WebRTC signaling and mediasoup coordination
 */

const { Server } = require('socket.io');
const mediasoupService = require('../services/mediasoup.service');
const hlsBroadcaster = require('../services/hlsBroadcaster.service');
const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

let io;

// Chat rate limiter: Map<socketId, { count, resetTime }>
const chatRateLimits = new Map();

// Online users tracker: Map<userId, Set<socketId>>
const onlineUsers = new Map();

// Kontrol host & waiting room (in-memory per room; cukup untuk siklus hidup meeting).
const meetingLocks = new Map();   // roomId -> boolean (meeting dikunci)
const waitingRooms = new Map();   // roomId -> Map<peerId, { socketId, userName, joinedAt }>
const admittedPeers = new Map();  // roomId -> Set<peerId> (sudah di-admit host / host sendiri)

function getAdmitted(roomId) {
  if (!admittedPeers.has(roomId)) admittedPeers.set(roomId, new Set());
  return admittedPeers.get(roomId);
}
function getWaiting(roomId) {
  if (!waitingRooms.has(roomId)) waitingRooms.set(roomId, new Map());
  return waitingRooms.get(roomId);
}
function clearRoomState(roomId) {
  meetingLocks.delete(roomId);
  waitingRooms.delete(roomId);
  admittedPeers.delete(roomId);
}

function makeMeetingPeerId(socket) {
  const userPart = socket.user?.isGuest ? socket.user.id : `user_${socket.user?.id}`;
  return `${userPart}_${socket.id}`;
}

/**
 * Safe callback helper - prevents crash if callback is not a function
 */
function safeCallback(callback, data) {
  if (typeof callback === 'function') {
    callback(data);
  }
}

function normalizeDisplayName(value, fallback = 'Peserta') {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || fallback;
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
      const rawGuestName = socket.handshake.auth.guestName || socket.handshake.auth.displayName;
      const guestName = normalizeDisplayName(rawGuestName, 'Guest');
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
        if (rawGuestName || guestId) {
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
        const { roomId, guestName, displayName } = data || {};
        const peerId = makeMeetingPeerId(socket);
        const userName = normalizeDisplayName(
          displayName || guestName || socket.user.name,
          socket.user.isGuest ? 'Guest' : (socket.user.name || 'Peserta')
        );

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

        // Apakah peserta ini host meeting?
        const joinIsHost = meeting.host_id.toString() === socket.user.id?.toString();

        // Check password if required. Host boleh masuk tanpa password karena ia
        // sudah terautentikasi sebagai pemilik meeting.
        if (meeting.password && !joinIsHost) {
          const passwordMatch = await bcrypt.compare(data.password || '', meeting.password);
          if (!passwordMatch) {
            return safeCallback(callback, { error: 'Invalid password' });
          }
        }

        const admitted = getAdmitted(roomId);
        if (joinIsHost) admitted.add(String(peerId)); // host otomatis ter-admit

        // Kunci meeting: tolak peserta baru yang belum di-admit (host & yang sudah
        // masuk daftar admit tetap boleh — mis. reconnect).
        if (meetingLocks.get(roomId) && !joinIsHost && !admitted.has(String(peerId))) {
          return safeCallback(callback, { error: 'Meeting sedang dikunci oleh host.' });
        }

        // Waiting room: peserta non-host yang belum di-admit masuk ruang tunggu.
        // Host diberi tahu agar bisa menerima/menolak; peserta menunggu event 'admitted'.
        if (meeting.waiting_room_enabled && !joinIsHost && !admitted.has(String(peerId))) {
          const waiting = getWaiting(roomId);
          waiting.set(String(peerId), { socketId: socket.id, userName, joinedAt: Date.now() });
          socket.waitingRoomId = roomId;
          socket.peerId = peerId;
          socket.userName = userName;
          // Beri tahu host yang sedang di room.
          io.to(roomId).emit('waiting-updated', {
            waiting: [...waiting.entries()].map(([pid, v]) => ({ peerId: pid, userName: v.userName })),
          });
          return safeCallback(callback, { waiting: true, title: meeting.title });
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

        // Check if this is a reconnection (same peerId already in room from previous socket).
        // peerId sekarang unik per koneksi, jadi satu akun bisa membuka lebih dari satu device.
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
        if (isReconnect) {
          const existingParticipant = await prisma.video_meeting_participants.findFirst({
            where: {
              meeting_id: meeting.id,
              ...(socket.user.isGuest
                ? { guest_name: userName, user_id: null }
                : { user_id: BigInt(socket.user.id) }),
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
                guest_name: userName,
                role: meeting.host_id.toString() === socket.user.id?.toString() ? 'host' : 'participant',
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
              guest_name: userName,
              role: meeting.host_id.toString() === socket.user.id?.toString() ? 'host' : 'participant',
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

        // Mode webinar: hanya host (dan peserta yang diangkat) yang boleh publish.
        // Mode meeting biasa: semua peserta publish (onStage=true) seperti sebelumnya.
        const isWebinar = (meeting.mode || 'meeting') === 'webinar';
        const onStage = isWebinar ? (isHost || participant.on_stage === true) : true;
        if (isWebinar && isHost && participant.on_stage !== true) {
          await prisma.video_meeting_participants.update({
            where: { id: participant.id }, data: { on_stage: true },
          }).catch(() => {});
        }

        // Cache info meeting di socket (hindari query berulang per chat/aksi) &
        // dipakai untuk enforcement publish mode webinar.
        socket.meetingId = meeting.id;
        socket.meetingHostId = hostIdStr;
        socket.meetingMode = meeting.mode || 'meeting';
        socket.isHost = isHost;
        socket.onStage = onStage;
        socket.waitingRoomId = null; // sudah masuk room, bukan menunggu lagi

        // Peserta ini berhasil masuk → keluarkan dari daftar tunggu (bila ada) &
        // tandai ter-admit (agar reconnect tidak menunggu lagi).
        const admittedSet = getAdmitted(roomId);
        admittedSet.add(String(peerId));
        const waitingMap = getWaiting(roomId);
        if (waitingMap.delete(String(peerId))) {
          io.to(roomId).emit('waiting-updated', {
            waiting: [...waitingMap.entries()].map(([pid, v]) => ({ peerId: pid, userName: v.userName })),
          });
        }

        safeCallback(callback, {
          success: true,
          rtpCapabilities,
          producers,
          existingPeers,
          participantId: participant.id.toString(),
          peerId,
          userName,
          displayName: userName,
          meetingSettings: {
            isRecordingEnabled: meeting.is_recording_enabled,
            isScreenShareEnabled: meeting.is_screen_share_enabled,
            isChatEnabled: meeting.is_chat_enabled,
            isHost: isHost,
            mode: meeting.mode || 'meeting',
            onStage,
            waitingRoomEnabled: meeting.waiting_room_enabled === true,
            isLocked: meetingLocks.get(roomId) === true,
            // Host menerima daftar tunggu saat ini agar bisa langsung mengelola.
            waiting: isHost
              ? [...getWaiting(roomId).entries()].map(([pid, v]) => ({ peerId: pid, userName: v.userName }))
              : [],
          }
        });
      } catch (error) {
        console.error('[Socket] Error joining room:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    socket.on('update-display-name', async (data, callback) => {
      try {
        if (!socket.roomId || !socket.peerId) {
          return safeCallback(callback, { error: 'Belum bergabung ke room' });
        }

        const nextName = normalizeDisplayName(
          data?.displayName || data?.userName,
          socket.userName || socket.user?.name || 'Peserta'
        );
        const oldName = socket.userName;

        socket.userName = nextName;
        if (socket.user) socket.user.name = nextName;
        mediasoupService.setPeerName(socket.roomId, socket.peerId, nextName);

        if (socket.participantId) {
          await prisma.video_meeting_participants.update({
            where: { id: BigInt(socket.participantId) },
            data: { guest_name: nextName },
          }).catch(() => {});
        }

        if (socket.waitingRoomId) {
          const waiting = getWaiting(socket.waitingRoomId);
          const entry = waiting.get(String(socket.peerId));
          if (entry) {
            waiting.set(String(socket.peerId), { ...entry, userName: nextName });
            io.to(socket.waitingRoomId).emit('waiting-updated', {
              waiting: [...waiting.entries()].map(([pid, v]) => ({ peerId: pid, userName: v.userName })),
            });
          }
        }

        io.to(socket.roomId).emit('participant-renamed', {
          peerId: socket.peerId,
          userName: nextName,
          displayName: nextName,
          oldName,
        });

        safeCallback(callback, { success: true, userName: nextName, displayName: nextName });
      } catch (error) {
        console.error('[Socket] Error updating display name:', error);
        safeCallback(callback, { error: error.message || 'Gagal mengganti nama' });
      }
    });

    // Create WebRTC transport
    socket.on('create-transport', async (data, callback) => {
      console.log(`[Socket] create-transport received from ${socket.peerId}, direction: ${data?.direction}, roomId: ${socket.roomId}`);
      try {
        const { direction } = data; // 'send' or 'recv'
        const peerId = socket.peerId || socket.user.id;
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
        const peerId = socket.peerId || socket.user.id;
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
        const peerId = socket.peerId || socket.user.id;
        const roomId = socket.roomId;

        // Enforcement webinar: hanya host / peserta on-stage yang boleh publish.
        // (Sebelumnya gating hanya di klien — kooperatif. Ini penegakan di server.)
        if (socket.meetingMode === 'webinar' && !socket.isHost && socket.onStage !== true) {
          console.warn(`[Socket] Tolak produce ${kind} dari penonton ${peerId} (webinar)`);
          return safeCallback(callback, { error: 'Hanya pembicara di panggung yang boleh menyalakan kamera/mikrofon.' });
        }

        console.log(`[Socket] Producing ${kind} for peer ${peerId} in room ${roomId}`);
        const producer = await mediasoupService.produce(
          roomId,
          peerId,
          transportId,
          kind,
          rtpParameters,
          { ...appData, userName: socket.userName }
        );

        // Notify others about new producer (sertakan mediaType agar penerima tahu
        // ini kamera/mic biasa atau SCREEN SHARE → ditampilkan terpisah ala Zoom).
        socket.to(roomId).emit('new-producer', {
          producerId: producer.id,
          peerId,
          kind: producer.kind,
          mediaType: appData?.mediaType || 'video',
          userName: socket.userName
        });

        // Auto-start siaran HLS: di mode webinar, saat peserta panggung (host / on-stage)
        // mulai publish, mulai siaran otomatis bila belum live & belum dihentikan host.
        // Diam-diam diabaikan jika auto-start dimatikan (HLS_AUTOSTART=0).
        if (socket.meetingMode === 'webinar' && (socket.isHost || socket.onStage === true)) {
          hlsBroadcaster.autoStart(roomId).catch(() => {});
        }

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
        const peerId = socket.peerId || socket.user.id;
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
        const peerId = socket.peerId || socket.user.id;
        const roomId = socket.roomId;

        await mediasoupService.resumeConsumer(roomId, peerId, consumerId);

        safeCallback(callback, { success: true });
      } catch (error) {
        console.error('[Socket] Error resuming consumer:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Pause consumer — klien menjeda video tile yang tidak terlihat (di luar
    // halaman galeri aktif) supaya tidak menghabiskan bandwidth saat peserta banyak.
    socket.on('pause-consumer', async (data, callback) => {
      try {
        const { consumerId } = data;
        await mediasoupService.pauseConsumer(socket.roomId, socket.peerId || socket.user.id, consumerId);
        safeCallback(callback, { success: true });
      } catch (error) {
        console.error('[Socket] Error pausing consumer:', error);
        safeCallback(callback, { error: error.message });
      }
    });

    // Atur lapis simulcast yang diinginkan untuk video dari peer sumber tertentu.
    // Klien meminta lapis rendah (spatialLayer 0) untuk thumbnail dan lapis penuh
    // (2) untuk tile yang di-pin/spotlight → hemat bandwidth & realisasi simulcast.
    socket.on('set-preferred-layers', async (data, callback) => {
      try {
        const { sourcePeerId, spatialLayer } = data || {};
        const ok = await mediasoupService.setPreferredLayers(
          socket.roomId, socket.peerId || socket.user.id, String(sourcePeerId), spatialLayer
        );
        safeCallback(callback, { success: ok });
      } catch (error) {
        safeCallback(callback, { error: error.message });
      }
    });

    // Close producer (stop sending video/audio)
    socket.on('close-producer', async (data) => {
      try {
        const { producerId } = data;
        const peerId = socket.peerId || socket.user.id;
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

    // ===== Webinar: angkat tangan & promote/demote ke panggung =====
    // Mode webinar: hanya peserta on_stage (+ host) yang publish audio/video; sisanya penonton.
    const findSocketByPeerId = (roomId, targetPeerId) => {
      const ids = io.sockets.adapter.rooms.get(roomId);
      if (!ids) return null;
      for (const id of ids) {
        const s = io.sockets.sockets.get(id);
        if (s && String(s.peerId) === String(targetPeerId)) return s;
      }
      return null;
    };
    const isRoomHost = async (sock) => {
      if (!sock.roomId || sock.user?.isGuest) return false;
      // Pakai cache dari join-room bila ada; fallback query.
      if (sock.meetingHostId) return String(sock.meetingHostId) === String(sock.user.id);
      const meeting = await prisma.video_meetings.findFirst({ where: { room_id: sock.roomId }, select: { host_id: true } });
      return meeting && String(meeting.host_id) === String(sock.user.id);
    };

    // Peserta mengangkat / menurunkan tangan
    socket.on('raise-hand', async (data, callback) => {
      try {
        if (!socket.roomId) return safeCallback(callback, { error: 'Belum di dalam room' });
        const raised = data?.raised !== false;
        if (socket.participantId) {
          await prisma.video_meeting_participants.update({
            where: { id: BigInt(socket.participantId) },
            data: { hand_raised: raised, hand_raised_at: raised ? new Date() : null },
          }).catch(() => {});
        }
        io.to(socket.roomId).emit('hand-updated', { peerId: socket.peerId, userName: socket.userName, raised });
        safeCallback(callback, { success: true });
      } catch (err) {
        console.error('[Socket] raise-hand error:', err);
        safeCallback(callback, { error: err.message });
      }
    });

    // Host menaikkan peserta ke panggung (boleh publish)
    socket.on('promote-to-stage', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host yang bisa menaikkan ke panggung' });
        const { targetPeerId } = data || {};
        const target = findSocketByPeerId(socket.roomId, targetPeerId);
        if (target?.participantId) {
          await prisma.video_meeting_participants.update({
            where: { id: BigInt(target.participantId) },
            data: { on_stage: true, hand_raised: false, hand_raised_at: null },
          }).catch(() => {});
        }
        if (target) target.onStage = true; // izinkan publish (enforcement server)
        io.to(socket.roomId).emit('stage-updated', { peerId: targetPeerId, onStage: true, by: socket.userName });
        safeCallback(callback, { success: true });
      } catch (err) {
        console.error('[Socket] promote-to-stage error:', err);
        safeCallback(callback, { error: err.message });
      }
    });

    // Host menurunkan peserta dari panggung (berhenti publish)
    socket.on('demote-from-stage', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host yang bisa menurunkan dari panggung' });
        const { targetPeerId } = data || {};
        const target = findSocketByPeerId(socket.roomId, targetPeerId);
        if (target?.participantId) {
          await prisma.video_meeting_participants.update({
            where: { id: BigInt(target.participantId) },
            data: { on_stage: false },
          }).catch(() => {});
        }
        if (target) target.onStage = false; // cabut izin publish (enforcement server)
        // Peserta tetap di room (masih bisa menonton); klien target akan menutup
        // producer-nya sendiri saat menerima event ini (berhenti tayang/bersuara).
        io.to(socket.roomId).emit('stage-updated', { peerId: targetPeerId, onStage: false, by: socket.userName });
        safeCallback(callback, { success: true });
      } catch (err) {
        console.error('[Socket] demote-from-stage error:', err);
        safeCallback(callback, { error: err.message });
      }
    });

    // ===== Reactions (emoji) — efemeral, tidak disimpan ke DB =====
    socket.on('reaction', (data) => {
      if (!socket.roomId) return;
      const emoji = String(data?.emoji || '').slice(0, 8);
      if (!emoji) return;
      io.to(socket.roomId).emit('reaction', {
        peerId: socket.peerId,
        userName: socket.userName,
        emoji,
        id: `${socket.id}-${Date.now()}`,
      });
    });

    const emitProducerPauseState = (roomId, peerId, producers, paused) => {
      for (const producer of producers || []) {
        io.to(roomId).emit(paused ? 'producer-paused' : 'producer-resumed', {
          peerId: String(peerId),
          producerId: producer.producerId,
          kind: producer.kind,
          mediaType: producer.mediaType,
        });
      }
    };

    const setParticipantMediaState = async (sock, next) => {
      if (!sock?.participantId) return;
      const data = {};
      if (typeof next.isMuted === 'boolean') data.is_muted = next.isMuted;
      if (typeof next.isVideoOff === 'boolean') data.is_video_on = !next.isVideoOff;
      if (Object.keys(data).length === 0) return;
      await prisma.video_meeting_participants.update({
        where: { id: BigInt(sock.participantId) },
        data,
      }).catch(() => {});
    };

    // ===== Kontrol host: mute peserta / mute semua / keluarkan / kunci =====
    // Host mute memakai pause producer di SFU (hard enforcement), lalu tetap
    // mengirim event ke klien target agar UI lokal ikut menampilkan status mute.
    socket.on('host-mute-participant', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const { targetPeerId, kind = 'audio' } = data || {};
        const mediaKind = kind === 'video' ? 'video' : 'audio';
        const target = findSocketByPeerId(socket.roomId, targetPeerId);

        const paused = await mediasoupService.setProducerPausedByKind(
          socket.roomId,
          String(targetPeerId),
          mediaKind,
          true,
          { includeScreen: false }
        );
        emitProducerPauseState(socket.roomId, targetPeerId, paused, true);

        if (target) {
          target.emit('force-muted', { kind: mediaKind, by: socket.userName });
          await setParticipantMediaState(target, mediaKind === 'audio' ? { isMuted: true } : { isVideoOff: true });
        }

        safeCallback(callback, { success: true, paused: paused.length });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    socket.on('host-unmute-participant', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const { targetPeerId, kind = 'audio' } = data || {};
        const mediaKind = kind === 'video' ? 'video' : 'audio';
        const target = findSocketByPeerId(socket.roomId, targetPeerId);

        const resumed = await mediasoupService.setProducerPausedByKind(
          socket.roomId,
          String(targetPeerId),
          mediaKind,
          false,
          { includeScreen: false }
        );
        emitProducerPauseState(socket.roomId, targetPeerId, resumed, false);

        if (target) {
          target.emit('force-unmuted', { kind: mediaKind, by: socket.userName });
          await setParticipantMediaState(target, mediaKind === 'audio' ? { isMuted: false } : { isVideoOff: false });
        }

        safeCallback(callback, { success: true, resumed: resumed.length });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    // Host mematikan mic SEMUA peserta (kecuali dirinya).
    socket.on('host-mute-all', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const ids = io.sockets.adapter.rooms.get(socket.roomId);
        if (ids) {
          for (const id of ids) {
            const s = io.sockets.sockets.get(id);
            if (s && s.id !== socket.id) {
              const paused = await mediasoupService.setProducerPausedByKind(
                socket.roomId,
                String(s.peerId),
                'audio',
                true
              );
              emitProducerPauseState(socket.roomId, s.peerId, paused, true);
              s.emit('force-muted', { kind: 'audio', by: socket.userName });
              await setParticipantMediaState(s, { isMuted: true });
            }
          }
        }
        safeCallback(callback, { success: true });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    socket.on('host-unmute-all', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const ids = io.sockets.adapter.rooms.get(socket.roomId);
        if (ids) {
          for (const id of ids) {
            const s = io.sockets.sockets.get(id);
            if (s && s.id !== socket.id) {
              const resumed = await mediasoupService.setProducerPausedByKind(
                socket.roomId,
                String(s.peerId),
                'audio',
                false
              );
              emitProducerPauseState(socket.roomId, s.peerId, resumed, false);
              s.emit('force-unmuted', { kind: 'audio', by: socket.userName });
              await setParticipantMediaState(s, { isMuted: false });
            }
          }
        }
        safeCallback(callback, { success: true });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    // Host mengeluarkan peserta dari meeting.
    socket.on('host-remove-participant', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const { targetPeerId } = data || {};
        const target = findSocketByPeerId(socket.roomId, targetPeerId);
        if (target) {
          target.emit('removed-by-host', { by: socket.userName });
          // Beri jeda agar pesan sampai sebelum koneksi diputus.
          setTimeout(() => { try { handlePeerLeave(target); target.disconnect(true); } catch { /* noop */ } }, 400);
        }
        safeCallback(callback, { success: true });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    // Host mengunci / membuka meeting (cegah peserta baru bergabung).
    socket.on('toggle-lock', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const locked = data?.locked === true;
        meetingLocks.set(socket.roomId, locked);
        io.to(socket.roomId).emit('lock-updated', { locked, by: socket.userName });
        safeCallback(callback, { success: true, locked });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    // ===== Waiting room: host menerima / menolak peserta =====
    const emitWaitingUpdate = (roomId) => {
      const waiting = getWaiting(roomId);
      io.to(roomId).emit('waiting-updated', {
        waiting: [...waiting.entries()].map(([pid, v]) => ({ peerId: pid, userName: v.userName })),
      });
    };

    socket.on('admit-participant', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const { targetPeerId } = data || {};
        getAdmitted(socket.roomId).add(String(targetPeerId));
        const waiting = getWaiting(socket.roomId);
        const entry = waiting.get(String(targetPeerId));
        waiting.delete(String(targetPeerId));
        if (entry) {
          const s = io.sockets.sockets.get(entry.socketId);
          if (s) s.emit('admitted', { roomId: socket.roomId });
        }
        emitWaitingUpdate(socket.roomId);
        safeCallback(callback, { success: true });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    socket.on('admit-all', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const waiting = getWaiting(socket.roomId);
        const admitted = getAdmitted(socket.roomId);
        for (const [pid, entry] of waiting.entries()) {
          admitted.add(String(pid));
          const s = io.sockets.sockets.get(entry.socketId);
          if (s) s.emit('admitted', { roomId: socket.roomId });
        }
        waiting.clear();
        emitWaitingUpdate(socket.roomId);
        safeCallback(callback, { success: true });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    socket.on('reject-participant', async (data, callback) => {
      try {
        if (!(await isRoomHost(socket))) return safeCallback(callback, { error: 'Hanya host' });
        const { targetPeerId } = data || {};
        const waiting = getWaiting(socket.roomId);
        const entry = waiting.get(String(targetPeerId));
        waiting.delete(String(targetPeerId));
        if (entry) {
          const s = io.sockets.sockets.get(entry.socketId);
          if (s) { s.emit('join-rejected', { by: socket.userName }); setTimeout(() => { try { s.disconnect(true); } catch { /* noop */ } }, 400); }
        }
        emitWaitingUpdate(socket.roomId);
        safeCallback(callback, { success: true });
      } catch (err) {
        safeCallback(callback, { error: err.message });
      }
    });

    // Klien mengubah status mic/kamera. Server menyinkronkan status DB dan
    // pause/resume producer terkait di SFU agar media benar-benar berhenti jalan.
    socket.on('media-state-change', async (data, callback) => {
      try {
        if (!socket.roomId || !socket.peerId) return safeCallback(callback, { error: 'Belum di dalam room' });
        const updates = [];

        if (typeof data?.isMuted === 'boolean') {
          const changed = await mediasoupService.setProducerPausedByKind(
            socket.roomId,
            String(socket.peerId),
            'audio',
            data.isMuted
          );
          emitProducerPauseState(socket.roomId, socket.peerId, changed, data.isMuted);
          updates.push(...changed);
        }

        if (typeof data?.isVideoOff === 'boolean') {
          const changed = await mediasoupService.setProducerPausedByKind(
            socket.roomId,
            String(socket.peerId),
            'video',
            data.isVideoOff,
            { includeScreen: false }
          );
          emitProducerPauseState(socket.roomId, socket.peerId, changed, data.isVideoOff);
          updates.push(...changed);
        }

        await setParticipantMediaState(socket, {
          isMuted: typeof data?.isMuted === 'boolean' ? data.isMuted : undefined,
          isVideoOff: typeof data?.isVideoOff === 'boolean' ? data.isVideoOff : undefined,
        });

        socket.to(socket.roomId).emit('participant-media-state', {
          peerId: String(socket.peerId),
          isMuted: typeof data?.isMuted === 'boolean' ? data.isMuted : undefined,
          isVideoOff: typeof data?.isVideoOff === 'boolean' ? data.isVideoOff : undefined,
        });

        safeCallback(callback, { success: true, changed: updates.length });
      } catch (err) {
        console.error('[Socket] media-state-change error:', err);
        safeCallback(callback, { error: err.message });
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

        // Konteks balasan (opsional). Ephemeral — tidak disimpan ke DB, hanya
        // diteruskan agar semua peserta melihat pesan yang dibalas.
        let replyTo = null;
        if (data.replyTo && (data.replyTo.message || data.replyTo.senderName)) {
          replyTo = {
            id: data.replyTo.id ? String(data.replyTo.id) : null,
            senderName: String(data.replyTo.senderName || '').slice(0, 120),
            message: String(data.replyTo.message || '').slice(0, 200),
          };
        }

        // meeting_id dari cache socket (di-set saat join-room); fallback query bila perlu.
        let meetingId = socket.meetingId;
        if (!meetingId) {
          const m = await prisma.video_meetings.findFirst({ where: { room_id: roomId }, select: { id: true } });
          meetingId = m?.id;
        }
        if (!meetingId) return;

        // Save to database
        const chatMessage = await prisma.video_meeting_chats.create({
          data: {
            meeting_id: BigInt(meetingId),
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
          senderPeerId: socket.peerId,
          replyTo,
          timestamp: chatMessage.created_at
        });
      } catch (error) {
        console.error('[Socket] Error sending chat message:', error);
      }
    });

    // Screen share status
    socket.on('screen-share-started', () => {
      socket.to(socket.roomId).emit('screen-share-started', {
        peerId: socket.peerId || socket.user.id,
        userName: socket.userName
      });
    });

    socket.on('screen-share-stopped', () => {
      socket.to(socket.roomId).emit('screen-share-stopped', {
        peerId: socket.peerId || socket.user.id
      });
    });

    // Mute/unmute status
    socket.on('mute-status-changed', (data) => {
      socket.to(socket.roomId).emit('peer-mute-changed', {
        peerId: socket.peerId || socket.user.id,
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

        // Bersihkan state lock/waiting/admit room ini.
        clearRoomState(roomId);

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
      try {
        await handlePeerLeave(socket);
      } catch (err) {
        console.error('[Socket] Error in leave-room:', err);
      }
    });

    // Handle socket errors
    socket.on('error', (err) => {
      console.error(`[Socket] Error for ${socket.user?.name}:`, err);
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`[Socket] User disconnected: ${socket.user.name}`);
      chatRateLimits.delete(socket.id);

      // Jika peserta sedang menunggu di waiting room, keluarkan & beri tahu host.
      if (socket.waitingRoomId) {
        const waiting = getWaiting(socket.waitingRoomId);
        if (waiting.delete(String(socket.peerId))) {
          io.to(socket.waitingRoomId).emit('waiting-updated', {
            waiting: [...waiting.entries()].map(([pid, v]) => ({ peerId: pid, userName: v.userName })),
          });
        }
        socket.waitingRoomId = null;
      }

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

  // Relay pembicara dominan (dari AudioLevelObserver) ke seluruh peserta room
  // → frontend menyorot tile pembicara aktif.
  mediasoupService.on('dominant-speaker', ({ roomId, peerId }) => {
    io.to(roomId).emit('active-speaker', { peerId });
  });

  // Worker mediasoup mati → room di worker itu hilang. Beri tahu peserta agar
  // tidak menggantung (klien dapat menampilkan pesan & reconnect/keluar).
  mediasoupService.on('worker-died', ({ roomIds }) => {
    (roomIds || []).forEach((roomId) => {
      io.to(roomId).emit('meeting-interrupted', {
        message: 'Server media terputus sesaat. Silakan muat ulang halaman untuk bergabung kembali.',
      });
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
  if (!io) {
    console.warn('[Socket] getIO() called but Socket.IO not initialized yet');
    // Return a safe no-op object to prevent crashes
    return { to: () => ({ emit: () => {} }), emit: () => {} };
  }
  return io;
}

module.exports = {
  initSocketServer,
  getIO
};
