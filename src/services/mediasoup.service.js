/**
 * Mediasoup Service
 * Handles all SFU (Selective Forwarding Unit) operations
 */

const mediasoup = require('mediasoup');
const config = require('../config/mediasoup.config');

class MediasoupService {
  constructor() {
    this.workers = [];
    this.nextWorkerIdx = 0;
    this.rooms = new Map(); // roomId -> { router, peers: Map<peerId, peer> }
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
      const worker = await mediasoup.createWorker({
        logLevel: config.worker.logLevel,
        logTags: config.worker.logTags,
        rtcMinPort: config.worker.rtcMinPort,
        rtcMaxPort: config.worker.rtcMaxPort
      });

      worker.on('died', () => {
        console.error(`[Mediasoup] Worker ${worker.pid} died, recreating...`);
        // Remove dead worker and create a replacement
        const idx = this.workers.indexOf(worker);
        if (idx !== -1) this.workers.splice(idx, 1);
        mediasoup.createWorker({
          logLevel: config.worker.logLevel,
          logTags: config.worker.logTags,
          rtcMinPort: config.worker.rtcMinPort,
          rtcMaxPort: config.worker.rtcMaxPort
        }).then(newWorker => {
          newWorker.on('died', worker.listeners('died')[0]); // reuse same handler
          this.workers.push(newWorker);
          console.log(`[Mediasoup] Replacement worker ${newWorker.pid} created`);
        }).catch(err => {
          console.error('[Mediasoup] Failed to recreate worker:', err);
        });
      });

      this.workers.push(worker);
      console.log(`[Mediasoup] Worker ${worker.pid} created`);
    }

    console.log(`[Mediasoup] ${this.workers.length} workers ready`);
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
    let room = this.rooms.get(roomId);

    if (!room) {
      console.log(`[Mediasoup] Creating new room: ${roomId}`);
      const worker = this.getNextWorker();
      const router = await worker.createRouter({
        mediaCodecs: config.router.mediaCodecs
      });

      room = {
        router,
        peers: new Map()
      };

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
