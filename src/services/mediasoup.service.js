/**
 * Mediasoup Service
 * Handles all SFU (Selective Forwarding Unit) operations
 */

const mediasoup = require('mediasoup');
const EventEmitter = require('events');
const config = require('../config/mediasoup.config');

// Skala besar (mis. rapat 500): sebar fan-out consumer ke SEMUA worker/inti CPU
// lewat router-piping. 1 room jadi punya 1 router per worker; producer di-pipe
// ke semua router, consumer tiap peer ditempatkan round-robin antar-router.
// Default OFF supaya rapat normal tetap pakai jalur lama yang terbukti stabil —
// nyalakan dengan env MEDIASOUP_PIPE_ENABLED=1 saat menguji room besar.
const PIPE_ENABLED = process.env.MEDIASOUP_PIPE_ENABLED === '1';

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
        // Pipe mode: room membentang ke SEMUA worker → worker mana pun mati,
        // room itu terdampak. Non-pipe: hanya room di worker yang mati.
        const affected = room.worker === worker || (room.routers && room.routers.length > 1);
        if (affected) {
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
        // ── Pipe mode (skala besar) ──
        routers: null,            // 1 router per worker bila pipe aktif
        peerRouter: new Map(),    // peerId -> router yang menampung transport/consumer-nya
        producerRouter: new Map(),// producerId -> router asal (sumber) producer
        pipedProducers: new Set(),// `${producerId}@${router.id}` yang sudah ter-pipe
        nextRouterIdx: 0,
      };

      // Pipe mode: buat 1 router (codec sama) di SETIAP worker. Codec identik →
      // pipeToRouter kompatibel & rtpCapabilities seragam untuk semua peer.
      if (PIPE_ENABLED && this.workers.length > 1) {
        const extra = [];
        for (const w of this.workers) {
          if (w === worker) { extra.push(router); continue; }
          extra.push(await w.createRouter({ mediaCodecs: config.router.mediaCodecs }));
        }
        room.routers = extra;
        console.log(`[Mediasoup] Room ${roomId}: pipe mode aktif — ${extra.length} router (1/worker).`);
      }

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
   * Router yang menampung transport/consumer milik sebuah peer.
   * Non-pipe: selalu router tunggal room. Pipe: round-robin antar-worker,
   * di-cache per peer agar send & recv transport peer ada di router yang sama.
   */
  _peerRouter(room, peerId) {
    if (!room.routers || room.routers.length <= 1) return room.router;
    let r = room.peerRouter.get(peerId);
    if (!r) {
      r = room.routers[room.nextRouterIdx++ % room.routers.length];
      room.peerRouter.set(peerId, r);
    }
    return r;
  }

  /**
   * Pastikan sebuah producer tersedia (ter-pipe) di router tertentu sebelum
   * di-consume. Idempoten. Aman dipanggil walau bukan pipe mode.
   */
  async _ensureProducerOnRouter(room, producerId, targetRouter) {
    if (!room.routers || room.routers.length <= 1) return;
    const src = room.producerRouter.get(producerId);
    if (!src || src === targetRouter) return;
    const key = `${producerId}@${targetRouter.id}`;
    if (room.pipedProducers.has(key)) return;
    try {
      await src.pipeToRouter({ producerId, router: targetRouter });
      room.pipedProducers.add(key);
    } catch (e) {
      console.error(`[Mediasoup] pipe producer ${producerId} → router gagal:`, e.message);
    }
  }

  /**
   * Create WebRTC transport for a peer
   */
  async createWebRtcTransport(roomId, peerId, direction) {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Pipe mode: transport peer dibuat di router milik peer (sebar antar-worker).
    const peerRouter = this._peerRouter(room, peerId);
    const transport = await peerRouter.createWebRtcTransport(config.webRtcTransport);

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
   * Restart ICE pada transport (pemulihan saat sinyal lemah tanpa membongkar
   * producer/consumer). Mengembalikan iceParameters baru untuk dikirim ke klien.
   */
  async restartIce(roomId, peerId, transportId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error('Peer not found');

    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport not found');

    const iceParameters = await transport.restartIce();
    return iceParameters;
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

    // Pipe mode: sebar producer ke SEMUA router lain agar consumer di worker mana
    // pun bisa menontonnya. Producer biasanya sedikit (host mute mayoritas) →
    // biaya pipe kecil, fan-out consumer tersebar ke semua inti.
    if (room.routers && room.routers.length > 1) {
      const srcRouter = this._peerRouter(room, peerId);
      room.producerRouter.set(producer.id, srcRouter);
      for (const r of room.routers) {
        if (r === srcRouter) continue;
        const key = `${producer.id}@${r.id}`;
        if (room.pipedProducers.has(key)) continue;
        try {
          await srcRouter.pipeToRouter({ producerId: producer.id, router: r });
          room.pipedProducers.add(key);
        } catch (e) {
          console.error(`[Mediasoup] pipe producer ${producer.id} saat produce gagal:`, e.message);
        }
      }
      producer.on('close', () => {
        room.producerRouter.delete(producer.id);
        for (const r of room.routers) room.pipedProducers.delete(`${producer.id}@${r.id}`);
      });
    }

    // Daftarkan audio ke AudioLevelObserver untuk deteksi pembicara dominan.
    // (Pipe mode: observer ada di router primary; producer sudah ter-pipe ke sana.)
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

    // Pipe mode: consumer dibuat di router peer; pastikan producer (mungkin dari
    // worker lain) sudah ter-pipe ke router ini sebelum cek/consume.
    const consumerRouter = this._peerRouter(room, peerId);
    await this._ensureProducerOnRouter(room, producerId, consumerRouter);

    // Check if can consume
    if (!consumerRouter.canConsume({ producerId, rtpCapabilities })) {
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
   * Default tidak menyentuh media LAYAR (video 'screen' & audio 'screenAudio'),
   * agar "matikan kamera"/"matikan mic" tidak ikut menghentikan layar atau suara
   * tab yang sedang dibagikan. Pakai includeScreen:true untuk menyertakannya.
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
      // Jangan sentuh media LAYAR (video 'screen' / audio 'screenAudio') saat
      // mematikan kamera/mikrofon, kecuali includeScreen diminta. Tanpa ini, peserta
      // yang mute mic-nya akan ikut mematikan suara tab (mis. YouTube) yang dibagikan.
      const isScreenMedia = producerMediaType === 'screen' || producerMediaType === 'screenAudio';
      if (isScreenMedia && !includeScreen) continue;

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
    room.peerRouter?.delete(peerId); // lepas penugasan router peer (pipe mode)
    console.log(`[Mediasoup] Peer ${peerId} removed from room ${roomId}`);

    // If room is empty and autoDeleteRoom is true, close it
    if (autoDeleteRoom && room.peers.size === 0) {
      this._closeRouters(room);
      this.rooms.delete(roomId);
      console.log(`[Mediasoup] Room ${roomId} closed (empty)`);
    }
  }

  /** Tutup semua router room (pipe mode = banyak; non-pipe = 1). */
  _closeRouters(room) {
    if (room.routers && room.routers.length) {
      for (const r of room.routers) { try { if (!r.closed) r.close(); } catch { /* noop */ } }
    } else if (room.router && !room.router.closed) {
      room.router.close();
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

      this._closeRouters(room);
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
