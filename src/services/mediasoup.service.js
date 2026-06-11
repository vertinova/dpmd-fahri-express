/**
 * Mediasoup Service
 * Handles all SFU (Selective Forwarding Unit) operations
 */

const mediasoup = require('mediasoup');
const EventEmitter = require('events');
const config = require('../config/mediasoup.config');

class MediasoupService extends EventEmitter {
  constructor() {
    super();
    this.workers = [];
    this.nextWorkerIdx = 0;
    this.rooms = new Map(); // roomId -> { router, peers: Map<peerId, peer>, audioLevelObserver, dominantPeerId }
  }

  /**
   * Initialize mediasoup workers
   */
  async init() {
    const numWorkers = require('os').cpus().length;
    console.log(`[Mediasoup] Creating ${numWorkers} workers...`);

    // Check MEDIASOUP_ANNOUNCED_IP configuration
    const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1';
    if (announcedIp === '127.0.0.1' && process.env.NODE_ENV === 'production') {
      console.warn('======================================================================');
      console.warn('[Mediasoup] WARNING: MEDIASOUP_ANNOUNCED_IP is set to 127.0.0.1');
      console.warn('[Mediasoup] Video meetings will NOT work between different devices!');
      console.warn('[Mediasoup] Please set MEDIASOUP_ANNOUNCED_IP to your server\'s public IP');
      console.warn('[Mediasoup] Get your IP with: curl ifconfig.me');
      console.warn('======================================================================');
    } else {
      console.log(`[Mediasoup] Announced IP: ${announcedIp}`);
    }

    for (let i = 0; i < numWorkers; i++) {
      await this._spawnWorker();
    }

    console.log(`[Mediasoup] ${this.workers.length} workers ready`);
  }

  /**
   * Spawn satu worker dan pasang handler 'died' yang benar (tanpa closure ke
   * worker lama). Saat worker mati: tutup semua room di worker itu, beri tahu
   * klien lewat event 'worker-died' { roomIds }, lalu buat worker pengganti.
   */
  async _spawnWorker() {
    const worker = await mediasoup.createWorker({
      logLevel: config.worker.logLevel,
      logTags: config.worker.logTags,
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
    });

    worker.once('died', () => {
      console.error(`[Mediasoup] Worker ${worker.pid} died`);
      // Lepas worker mati dari pool.
      const idx = this.workers.indexOf(worker);
      if (idx !== -1) this.workers.splice(idx, 1);

      // Kumpulkan & bersihkan room yang dijalankan worker ini (router-nya ikut mati).
      const deadRoomIds = [];
      for (const [roomId, room] of this.rooms) {
        if (room.worker === worker) {
          deadRoomIds.push(roomId);
          this.rooms.delete(roomId);
        }
      }
      if (deadRoomIds.length) {
        console.error(`[Mediasoup] Rooms hilang akibat worker mati: [${deadRoomIds.join(', ')}]`);
        // Beri tahu lapisan signaling agar peserta tahu (bukan menggantung diam).
        this.emit('worker-died', { roomIds: deadRoomIds });
      }

      // Buat worker pengganti agar kapasitas pulih.
      this._spawnWorker()
        .then((w) => console.log(`[Mediasoup] Replacement worker ${w.pid} created`))
        .catch((err) => console.error('[Mediasoup] Failed to recreate worker:', err));
    });

    this.workers.push(worker);
    console.log(`[Mediasoup] Worker ${worker.pid} created`);
    return worker;
  }

  /**
   * Get next worker (round-robin)
   */
  getNextWorker() {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  /**
   * Create or get existing room
   */
  async getOrCreateRoom(roomId) {
    if (this.workers.length === 0) {
      throw new Error('Mediasoup not initialized (maintenance mode)');
    }

    let room = this.rooms.get(roomId);

    if (!room) {
      console.log(`[Mediasoup] Creating new room: ${roomId}`);
      const worker = this.getNextWorker();
      const router = await worker.createRouter({
        mediaCodecs: config.router.mediaCodecs
      });

      room = {
        router,
        worker, // simpan agar bisa tahu room mana yang terdampak bila worker mati
        peers: new Map(),
        audioLevelObserver: null,
        dominantPeerId: null,
      };

      // AudioLevelObserver → deteksi pembicara dominan (untuk active-speaker HLS/UI).
      try {
        const observer = await router.createAudioLevelObserver({ maxEntries: 1, threshold: -70, interval: 800 });
        room.audioLevelObserver = observer;
        observer.on('volumes', (volumes) => {
          const top = volumes[0];
          const peerId = top?.producer?.appData?.peerId;
          if (peerId && peerId !== room.dominantPeerId) {
            room.dominantPeerId = peerId;
            this.emit('dominant-speaker', { roomId, peerId });
          }
        });
      } catch (e) {
        console.warn(`[Mediasoup] AudioLevelObserver gagal dibuat utk ${roomId}:`, e.message);
      }

      this.rooms.set(roomId, room);
      console.log(`[Mediasoup] Room ${roomId} created with router ${router.id}`);
    }

    return room;
  }

  /**
   * Ensure peer exists in room (called when peer joins)
   */
  ensurePeerExists(roomId, peerId, userName) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    let peer = room.peers.get(peerId);
    if (!peer) {
      peer = {
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        userName: userName || 'User',
        joinedAt: Date.now()
      };
      room.peers.set(peerId, peer);
      console.log(`[Mediasoup] Peer ${peerId} (${userName}) created in room ${roomId}`);
    } else {
      // Update userName and joinedAt if provided
      if (userName) {
        peer.userName = userName;
      }
      peer.joinedAt = Date.now();
    }
    return peer;
  }

  /**
   * Get room
   */
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * Create WebRTC transport for a peer
   */
  async createWebRtcTransport(roomId, peerId, direction) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    const transport = await room.router.createWebRtcTransport(config.webRtcTransport);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        console.log(`[Mediasoup] Transport closed for peer ${peerId}`);
        transport.close();
      }
    });

    transport.on('close', () => {
      console.log(`[Mediasoup] Transport closed for peer ${peerId}`);
    });

    // Store transport in peer
    let peer = room.peers.get(peerId);
    if (!peer) {
      peer = {
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      };
      room.peers.set(peerId, peer);
    }

    peer.transports.set(transport.id, transport);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    };
  }

  /**
   * Connect transport
   */
  async connectTransport(roomId, peerId, transportId, dtlsParameters) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error('Peer not found');

    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport not found');

    await transport.connect({ dtlsParameters });
  }

  /**
   * Produce media (send stream to server)
   */
  async produce(roomId, peerId, transportId, kind, rtpParameters, appData = {}) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error('Peer not found');

    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport not found');

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { ...appData, peerId }
    });

    producer.on('transportclose', () => {
      console.log(`[Mediasoup] Producer transport closed for peer ${peerId}`);
      producer.close();
    });

    peer.producers.set(producer.id, producer);

    // Daftarkan audio ke AudioLevelObserver untuk deteksi pembicara dominan.
    if (kind === 'audio' && room.audioLevelObserver) {
      room.audioLevelObserver.addProducer({ producerId: producer.id }).catch(() => {});
    }

    return {
      id: producer.id,
      kind: producer.kind
    };
  }

  /**
   * Consume media (receive stream from server)
   */
  async consume(roomId, peerId, transportId, producerId, rtpCapabilities) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error('Peer not found');

    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport not found');

    // Check if can consume
    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume');
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true // Start paused, resume after connection
    });

    consumer.on('transportclose', () => {
      console.log(`[Mediasoup] Consumer transport closed for peer ${peerId}`);
      consumer.close();
    });

    consumer.on('producerclose', () => {
      console.log(`[Mediasoup] Producer closed for consumer ${consumer.id}`);
      consumer.close();
    });

    peer.consumers.set(consumer.id, consumer);

    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      appData: consumer.appData
    };
  }

  /**
   * Resume consumer
   */
  async resumeConsumer(roomId, peerId, consumerId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error('Peer not found');

    const consumer = peer.consumers.get(consumerId);
    if (!consumer) throw new Error('Consumer not found');

    await consumer.resume();
  }

  /**
   * Pause consumer — dipakai klien untuk menghentikan aliran video tile yang
   * sedang tidak terlihat (di luar halaman galeri aktif) → hemat bandwidth & CPU
   * saat peserta sangat banyak. Tidak melempar error agar aman dipanggil massal.
   */
  async pauseConsumer(roomId, peerId, consumerId) {
    const room = this.getRoom(roomId);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (!peer) return;

    const consumer = peer.consumers.get(consumerId);
    if (!consumer || consumer.closed || consumer.paused) return;

    await consumer.pause();
  }

  /**
   * Pause/resume producer milik peer tertentu berdasarkan kind.
   * Default untuk video tidak menyentuh screen share, agar "matikan kamera"
   * tidak ikut menghentikan layar yang sedang dibagikan.
   */
  async setProducerPausedByKind(roomId, peerId, kind, paused, options = {}) {
    const room = this.getRoom(roomId);
    if (!room) return [];

    const peer =
      room.peers.get(peerId) ||
      [...room.peers.entries()].find(([id]) => String(id) === String(peerId))?.[1];
    if (!peer) return [];

    const includeScreen = options.includeScreen === true;
    const mediaType = options.mediaType;
    const changed = [];

    for (const [, producer] of peer.producers) {
      if (!producer || producer.closed || producer.kind !== kind) continue;
      const producerMediaType = producer.appData?.mediaType || (producer.kind === 'audio' ? 'audio' : 'video');
      if (mediaType && producerMediaType !== mediaType) continue;
      if (producer.kind === 'video' && !includeScreen && producerMediaType === 'screen') continue;

      if (paused && !producer.paused) {
        await producer.pause();
      } else if (!paused && producer.paused) {
        await producer.resume();
      } else {
        continue;
      }

      changed.push({
        producerId: producer.id,
        kind: producer.kind,
        mediaType: producerMediaType,
      });
    }

    return changed;
  }

  /**
   * Atur lapis simulcast yang diinginkan untuk consumer video tertentu.
   * Dipakai agar tile kecil/penonton menerima lapis rendah (hemat bandwidth) dan
   * tile yang di-pin/spotlight menerima lapis penuh. Mengembalikan true bila ada
   * consumer video yang diset. (peerId = peer yang MENONTON; producerId = sumber)
   */
  async setPreferredLayers(roomId, viewerPeerId, sourcePeerId, spatialLayer) {
    const room = this.getRoom(roomId);
    if (!room) return false;
    const viewer = room.peers.get(viewerPeerId);
    if (!viewer) return false;

    // Kumpulkan producerId video milik peer sumber.
    const source = room.peers.get(sourcePeerId);
    const sourceVideoProducerIds = source
      ? [...source.producers.values()].filter((p) => p.kind === 'video').map((p) => p.id)
      : [];
    if (!sourceVideoProducerIds.length) return false;

    let applied = false;
    for (const [, consumer] of viewer.consumers) {
      if (consumer.kind !== 'video') continue;
      if (!sourceVideoProducerIds.includes(consumer.producerId)) continue;
      try {
        const layer = Number.isInteger(spatialLayer) ? spatialLayer : 2;
        await consumer.setPreferredLayers({ spatialLayer: layer, temporalLayer: 2 });
        applied = true;
      } catch (e) {
        // Producer mungkin bukan simulcast (mis. 1 lapis) — abaikan.
      }
    }
    return applied;
  }

  /**
   * Get RTP capabilities of room router
   */
  getRtpCapabilities(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    return room.router.rtpCapabilities;
  }

  /**
   * Get all producers in a room (for new peer joining)
   */
  getProducers(roomId, excludePeerId = null) {
    const room = this.getRoom(roomId);
    if (!room) return [];

    const producers = [];
    
    for (const [peerId, peer] of room.peers) {
      if (peerId === excludePeerId) continue;
      
      for (const [producerId, producer] of peer.producers) {
        producers.push({
          producerId,
          peerId,
          kind: producer.kind,
          appData: producer.appData
        });
      }
    }

    return producers;
  }

  /**
   * Close producer
   */
  closeProducer(roomId, peerId, producerId) {
    const room = this.getRoom(roomId);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (!peer) return;

    const producer = peer.producers.get(producerId);
    if (producer) {
      producer.close();
      peer.producers.delete(producerId);
    }
  }

  /**
   * Remove peer from room
   * @param {string} roomId - Room ID
   * @param {string} peerId - Peer ID
   * @param {boolean} autoDeleteRoom - Whether to delete room if empty (default: true)
   */
  removePeer(roomId, peerId, autoDeleteRoom = true) {
    const room = this.getRoom(roomId);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (!peer) return;

    // Close all transports (this also closes producers/consumers)
    for (const [_, transport] of peer.transports) {
      transport.close();
    }

    room.peers.delete(peerId);
    console.log(`[Mediasoup] Peer ${peerId} removed from room ${roomId}`);

    // If room is empty and autoDeleteRoom is true, close it
    if (autoDeleteRoom && room.peers.size === 0) {
      room.router.close();
      this.rooms.delete(roomId);
      console.log(`[Mediasoup] Room ${roomId} closed (empty)`);
    }
  }

  /**
   * Clean up stale peers (peers without active sockets)
   * @param {string} roomId - Room ID
   * @param {Set<string>} activePeerIds - Set of peer IDs that have active sockets
   * @returns {number} Number of peers cleaned up
   */
  cleanupStalePeers(roomId, activePeerIds) {
    const room = this.getRoom(roomId);
    if (!room) {
      console.log(`[Mediasoup] cleanupStalePeers: Room ${roomId} not found`);
      return 0;
    }

    console.log(`[Mediasoup] cleanupStalePeers: Room ${roomId} has ${room.peers.size} peers, active: [${[...activePeerIds].join(', ')}]`);

    const stalePeerIds = [];
    for (const [peerId] of room.peers) {
      if (!activePeerIds.has(peerId)) {
        stalePeerIds.push(peerId);
      }
    }

    console.log(`[Mediasoup] cleanupStalePeers: Found ${stalePeerIds.length} stale peers: [${stalePeerIds.join(', ')}]`);

    for (const peerId of stalePeerIds) {
      console.log(`[Mediasoup] Removing stale peer ${peerId} from room ${roomId}`);
      // Don't auto-delete room during cleanup - room should stay alive for new joiners
      this.removePeer(roomId, peerId, false);
    }

    return stalePeerIds.length;
  }

  /**
   * Close room
   */
  closeRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.log(`[Mediasoup] closeRoom: Room ${roomId} not found`);
      return;
    }

    try {
      // Close all peers - make a copy of the keys first
      const peerIds = [...room.peers.keys()];
      for (const peerId of peerIds) {
        try {
          this.removePeer(roomId, peerId);
        } catch (err) {
          console.error(`[Mediasoup] Error removing peer ${peerId}:`, err);
        }
      }

      if (room.router && !room.router.closed) {
        room.router.close();
      }
      this.rooms.delete(roomId);
      console.log(`[Mediasoup] Room ${roomId} forcefully closed`);
    } catch (err) {
      console.error(`[Mediasoup] Error closing room ${roomId}:`, err);
      // Still try to remove from map
      this.rooms.delete(roomId);
    }
  }

  /**
   * Get room statistics
   */
  async getRoomStats(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const stats = {
      peersCount: room.peers.size,
      peers: []
    };

    for (const [peerId, peer] of room.peers) {
      stats.peers.push({
        peerId,
        producersCount: peer.producers.size,
        consumersCount: peer.consumers.size,
        transportsCount: peer.transports.size
      });
    }

    return stats;
  }

  /**
   * Get all peers in a room with their names
   * @param {string} roomId - Room ID
   * @param {string|null} excludePeerId - Peer ID to exclude
   * @param {string[]|null} filterByPeerIds - If provided, only include peers in this list
   */
  getPeersInRoom(roomId, excludePeerId = null, filterByPeerIds = null) {
    const room = this.getRoom(roomId);
    if (!room) return [];

    const peers = [];
    for (const [peerId, peer] of room.peers) {
      if (peerId === excludePeerId) continue;
      
      // If filterByPeerIds is provided, only include peers in the list
      if (filterByPeerIds && !filterByPeerIds.includes(peerId)) {
        continue;
      }
      
      peers.push({
        oduserId: peerId,
        userName: peer.userName || 'User',
        hasVideo: [...peer.producers.values()].some(p => p.kind === 'video'),
        hasAudio: [...peer.producers.values()].some(p => p.kind === 'audio')
      });
    }
    return peers;
  }

  /**
   * Set peer name
   */
  setPeerName(roomId, peerId, userName) {
    const room = this.getRoom(roomId);
    if (!room) return;
    
    const peer = room.peers.get(peerId);
    if (peer) {
      peer.userName = userName;
    }
  }
}

// Singleton instance
module.exports = new MediasoupService();
