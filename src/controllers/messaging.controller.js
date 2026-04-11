const prisma = require('../config/prisma');
const PushNotificationService = require('../services/pushNotification.service');
const { getIO } = require('../socket/meeting.socket');
const path = require('path');
const fs = require('fs');

const pushService = PushNotificationService;

// Role groupings for conversation type resolution
const DPMD_ROLES = ['superadmin', 'admin', 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai', 'sarpras', 'sekretariat'];
const DESA_ROLES = ['desa'];
const KECAMATAN_ROLES = ['kecamatan'];
const DINAS_ROLES = ['dinas_terkait', 'verifikator_dinas'];

function resolveConversationType(senderRole, receiverRole) {
	const senderIsDpmd = DPMD_ROLES.includes(senderRole);
	const senderIsDesa = DESA_ROLES.includes(senderRole);
	const senderIsKecamatan = KECAMATAN_ROLES.includes(senderRole);
	const senderIsDinas = DINAS_ROLES.includes(senderRole);

	const receiverIsDpmd = DPMD_ROLES.includes(receiverRole);
	const receiverIsDesa = DESA_ROLES.includes(receiverRole);
	const receiverIsKecamatan = KECAMATAN_ROLES.includes(receiverRole);
	const receiverIsDinas = DINAS_ROLES.includes(receiverRole);

	if ((senderIsDpmd && receiverIsDesa) || (senderIsDesa && receiverIsDpmd)) return 'dpmd_desa';
	if ((senderIsDinas && receiverIsDesa) || (senderIsDesa && receiverIsDinas)) return 'dinas_desa';
	if ((senderIsKecamatan && receiverIsDesa) || (senderIsDesa && receiverIsKecamatan)) return 'kecamatan_desa';
	if ((senderIsDpmd && receiverIsDinas) || (senderIsDinas && receiverIsDpmd)) return 'dpmd_dinas';
	if ((senderIsDpmd && receiverIsKecamatan) || (senderIsKecamatan && receiverIsDpmd)) return 'dpmd_kecamatan';
	if (senderIsDpmd && receiverIsDpmd) return 'dpmd_internal';

	// Fallback
	return 'dpmd_desa';
}

// User select fields (without nested desas/kecamatans - resolved separately via enrichUserNames)
const USER_SELECT = { id: true, name: true, role: true, avatar: true, desa_id: true, kecamatan_id: true, dinas_id: true, last_active_at: true };

// Enrich user objects with desa/kecamatan names (batch lookup)
async function enrichUserNames(...users) {
	const desaIds = new Set();
	const kecIds = new Set();
	for (const u of users) {
		if (u?.desa_id) desaIds.add(Number(u.desa_id));
		if (u?.kecamatan_id) kecIds.add(Number(u.kecamatan_id));
	}
	const [desas, kecamatans] = await Promise.all([
		desaIds.size > 0 ? prisma.desas.findMany({ where: { id: { in: [...desaIds].map(BigInt) } }, select: { id: true, nama: true } }) : [],
		kecIds.size > 0 ? prisma.kecamatans.findMany({ where: { id: { in: [...kecIds].map(BigInt) } }, select: { id: true, nama: true } }) : [],
	]);
	const desaMap = Object.fromEntries(desas.map(d => [Number(d.id), d.nama]));
	const kecMap = Object.fromEntries(kecamatans.map(k => [Number(k.id), k.nama]));
	for (const u of users) {
		if (u?.desa_id) u.desas = { nama: desaMap[Number(u.desa_id)] || null };
		if (u?.kecamatan_id) u.kecamatans = { nama: kecMap[Number(u.kecamatan_id)] || null };
	}
}

function serializeUser(user) {
	if (!user) return null;
	return {
		id: Number(user.id),
		name: user.name,
		role: user.role,
		avatar: user.avatar,
		desa_id: user.desa_id ? Number(user.desa_id) : null,
		kecamatan_id: user.kecamatan_id ? Number(user.kecamatan_id) : null,
		dinas_id: user.dinas_id ? Number(user.dinas_id) : null,
		last_active_at: user.last_active_at || null,
		desas: user.desas ? { nama: user.desas.nama } : undefined,
		kecamatans: user.kecamatans ? { nama: user.kecamatans.nama } : undefined,
	};
}

function serializeMessage(msg) {
	return {
		id: Number(msg.id),
		conversation_id: Number(msg.conversation_id),
		sender_id: Number(msg.sender_id),
		content: msg.content,
		message_type: msg.message_type,
		file_path: msg.file_path,
		file_name: msg.file_name,
		file_size: msg.file_size ? Number(msg.file_size) : null,
		is_read: msg.is_read,
		read_at: msg.read_at,
		created_at: msg.created_at,
		sender: msg.sender ? serializeUser(msg.sender) : undefined,
	};
}

function serializeConversation(conv, currentUserId) {
	const otherUser = Number(conv.participant_one_id) === currentUserId
		? conv.participant_two
		: conv.participant_one;

	return {
		id: Number(conv.id),
		type: conv.type,
		reference_type: conv.reference_type || null,
		reference_id: conv.reference_id ? Number(conv.reference_id) : null,
		reference_label: conv._reference_label || null,
		other_user: serializeUser(otherUser),
		last_message: conv.messages && conv.messages[0] ? serializeMessage(conv.messages[0]) : null,
		last_message_at: conv.last_message_at,
		unread_count: conv._count?.messages || 0,
		created_at: conv.created_at,
	};
}

// Build a human-readable label for a conversation's reference entity
async function buildReferenceLabel(refType, refId) {
	if (!refType || !refId) return null;
	try {
		if (refType === 'bankeu_lpj') {
			const lpj = await prisma.bankeu_lpj.findUnique({
				where: { id: refId },
				select: { tahun_anggaran: true, desas: { select: { nama: true } } },
			});
			if (lpj) return `LPJ Bankeu ${lpj.tahun_anggaran} - ${lpj.desas?.nama || ''}`;
		}
		if (refType === 'bankeu_proposal') {
			const proposal = await prisma.bankeu_proposals.findUnique({
				where: { id: refId },
				select: { tahun_anggaran: true, desas: { select: { nama: true } } },
			});
			if (proposal) return `Proposal Bankeu ${proposal.tahun_anggaran} - ${proposal.desas?.nama || ''}`;
		}
	} catch (e) { console.error('buildReferenceLabel error:', e.message); }
	return `${refType} #${refId}`;
}

class MessagingController {
	/**
	 * GET /api/messaging/conversations
	 * Get all conversations for current user
	 */
	async getConversations(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const { type, reference_type } = req.query;

			const where = {
				OR: [
					{ participant_one_id: userId },
					{ participant_two_id: userId },
				],
			};
			if (type) where.type = type;
			if (reference_type) where.reference_type = reference_type;

			const conversations = await prisma.conversations.findMany({
				where,
				include: {
					participant_one: { select: USER_SELECT },
					participant_two: { select: USER_SELECT },
					messages: {
						orderBy: { created_at: 'desc' },
						take: 1,
						include: {
							sender: { select: { id: true, name: true, role: true, avatar: true } }
						}
					},
					_count: {
						select: {
							messages: {
								where: {
									is_read: false,
									sender_id: { not: userId }
								}
							}
						}
					}
				},
				orderBy: { last_message_at: 'desc' },
			});

			// Enrich users with desa/kecamatan names
			const allUsers = conversations.flatMap(c => [c.participant_one, c.participant_two].filter(Boolean));
			await enrichUserNames(...allUsers);

			const currentUserId = Number(userId);

			// Attach reference labels
			const results = [];
			for (const c of conversations) {
				if (c.reference_type && c.reference_id) {
					c._reference_label = await buildReferenceLabel(c.reference_type, c.reference_id);
				}
				results.push(serializeConversation(c, currentUserId));
			}

			res.json({ success: true, data: results });
		} catch (error) {
			console.error('Error getting conversations:', error);
			res.status(500).json({ success: false, message: 'Gagal memuat percakapan', error: error.message });
		}
	}

	/**
	 * POST /api/messaging/conversations
	 * Get or create a conversation with a target user
	 */
	async getOrCreateConversation(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const { target_user_id } = req.body;

			if (!target_user_id) {
				return res.status(400).json({ success: false, message: 'target_user_id diperlukan' });
			}

			const targetId = BigInt(target_user_id);

			if (userId === targetId) {
				return res.status(400).json({ success: false, message: 'Tidak bisa chat dengan diri sendiri' });
			}

			// Get both users to determine conversation type
			const [currentUser, targetUser] = await Promise.all([
				prisma.users.findUnique({ where: { id: userId }, select: { id: true, role: true } }),
				prisma.users.findUnique({ where: { id: targetId }, select: USER_SELECT }),
			]);

			if (!targetUser) {
				return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
			}

			const convType = resolveConversationType(currentUser.role, targetUser.role);

			// Order participant IDs consistently (lower first) to avoid duplicates
			const [p1, p2] = userId < targetId ? [userId, targetId] : [targetId, userId];

			// Try to find existing conversation
			let conversation = await prisma.conversations.findFirst({
				where: {
					participant_one_id: p1,
					participant_two_id: p2,
					type: convType,
				},
				include: {
					participant_one: { select: USER_SELECT },
					participant_two: { select: USER_SELECT },
					messages: {
						orderBy: { created_at: 'desc' },
						take: 1,
						include: { sender: { select: { id: true, name: true, role: true, avatar: true } } }
					},
					_count: {
						select: {
							messages: {
								where: { is_read: false, sender_id: { not: userId } }
							}
						}
					}
				},
			});

			if (!conversation) {
				conversation = await prisma.conversations.create({
					data: {
						type: convType,
						participant_one_id: p1,
						participant_two_id: p2,
					},
					include: {
						participant_one: { select: USER_SELECT },
						participant_two: { select: USER_SELECT },
						messages: {
							orderBy: { created_at: 'desc' },
							take: 1,
						},
						_count: {
							select: {
								messages: {
									where: { is_read: false, sender_id: { not: userId } }
								}
							}
						}
					},
				});
			}

			// Enrich user names
			await enrichUserNames(conversation.participant_one, conversation.participant_two);

			res.json({
				success: true,
				data: serializeConversation(conversation, Number(userId)),
			});
		} catch (error) {
			console.error('Error getting/creating conversation:', error);
			res.status(500).json({ success: false, message: 'Gagal membuat percakapan', error: error.message });
		}
	}

	/**
	 * GET /api/messaging/conversations/:id/messages
	 * Get messages for a conversation with pagination
	 */
	async getMessages(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const conversationId = BigInt(req.params.id);
			const { cursor, limit = 50 } = req.query;

			// Verify user is participant
			const conv = await prisma.conversations.findFirst({
				where: {
					id: conversationId,
					OR: [
						{ participant_one_id: userId },
						{ participant_two_id: userId },
					],
				},
			});

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
			}

			const where = { conversation_id: conversationId };
			if (cursor) {
				where.id = { lt: BigInt(cursor) };
			}

			const messages = await prisma.messages.findMany({
				where,
				include: {
					sender: { select: { id: true, name: true, role: true, avatar: true } },
				},
				orderBy: { created_at: 'desc' },
				take: parseInt(limit),
			});

			res.json({
				success: true,
				data: messages.map(serializeMessage),
				has_more: messages.length === parseInt(limit),
				next_cursor: messages.length > 0 ? Number(messages[messages.length - 1].id) : null,
			});
		} catch (error) {
			console.error('Error getting messages:', error);
			res.status(500).json({ success: false, message: 'Gagal memuat pesan', error: error.message });
		}
	}

	/**
	 * POST /api/messaging/conversations/:id/messages
	 * Send a text message
	 */
	async sendMessage(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const conversationId = BigInt(req.params.id);
			const { content } = req.body;

			if (!content || !content.trim()) {
				return res.status(400).json({ success: false, message: 'Konten pesan diperlukan' });
			}

			// Verify user is participant
			const conv = await prisma.conversations.findFirst({
				where: {
					id: conversationId,
					OR: [
						{ participant_one_id: userId },
						{ participant_two_id: userId },
					],
				},
				include: {
					participant_one: { select: { id: true, name: true, role: true } },
					participant_two: { select: { id: true, name: true, role: true } },
				},
			});

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
			}

			const now = new Date();
			const message = await prisma.messages.create({
				data: {
					conversation_id: conversationId,
					sender_id: userId,
					content: content.trim(),
					message_type: 'text',
					created_at: now,
					updated_at: now,
				},
				include: {
					sender: { select: { id: true, name: true, role: true, avatar: true } },
				},
			});

			// Update conversation last_message
			await prisma.conversations.update({
				where: { id: conversationId },
				data: { last_message_at: now, updated_at: now },
			});

			const serialized = serializeMessage(message);

			// Emit via socket.io for real-time delivery
			const io = getIO();
			if (io) {
				const receiverId = Number(conv.participant_one_id) === Number(userId)
					? Number(conv.participant_two_id)
					: Number(conv.participant_one_id);
				io.to(`user_${receiverId}`).emit('new_message', serialized);
				io.to(`user_${Number(userId)}`).emit('new_message', serialized);
			}

			// Send push notification to receiver
			const receiverUser = Number(conv.participant_one_id) === Number(userId)
				? conv.participant_two
				: conv.participant_one;

			this._sendMessagePush(receiverUser, req.user.name || 'Pengguna', content.trim()).catch(err => {
				console.error('Push notification error:', err.message);
			});

			res.json({ success: true, data: serialized });
		} catch (error) {
			console.error('Error sending message:', error);
			res.status(500).json({ success: false, message: 'Gagal mengirim pesan', error: error.message });
		}
	}

	/**
	 * POST /api/messaging/conversations/:id/upload
	 * Upload a file message
	 */
	async uploadFile(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const conversationId = BigInt(req.params.id);

			if (!req.file) {
				return res.status(400).json({ success: false, message: 'File diperlukan' });
			}

			// Verify user is participant
			const conv = await prisma.conversations.findFirst({
				where: {
					id: conversationId,
					OR: [
						{ participant_one_id: userId },
						{ participant_two_id: userId },
					],
				},
				include: {
					participant_one: { select: { id: true, name: true, role: true } },
					participant_two: { select: { id: true, name: true, role: true } },
				},
			});

			if (!conv) {
				// Clean up uploaded file
				if (req.file.path) fs.unlinkSync(req.file.path);
				return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
			}

			const isImage = req.file.mimetype.startsWith('image/');
			const messageType = isImage ? 'image' : 'file';
			const relativePath = req.file.path.replace(/\\/g, '/');

			const now = new Date();
			const message = await prisma.messages.create({
				data: {
					conversation_id: conversationId,
					sender_id: userId,
					content: req.file.originalname,
					message_type: messageType,
					file_path: relativePath,
					file_name: req.file.originalname,
					file_size: req.file.size,
					created_at: now,
					updated_at: now,
				},
				include: {
					sender: { select: { id: true, name: true, role: true, avatar: true } },
				},
			});

			await prisma.conversations.update({
				where: { id: conversationId },
				data: { last_message_at: now, updated_at: now },
			});

			const serialized = serializeMessage(message);

			const io = getIO();
			if (io) {
				const receiverId = Number(conv.participant_one_id) === Number(userId)
					? Number(conv.participant_two_id)
					: Number(conv.participant_one_id);
				io.to(`user_${receiverId}`).emit('new_message', serialized);
				io.to(`user_${Number(userId)}`).emit('new_message', serialized);
			}

			const receiverUser = Number(conv.participant_one_id) === Number(userId)
				? conv.participant_two
				: conv.participant_one;

			this._sendMessagePush(receiverUser, req.user.name || 'Pengguna', isImage ? '📷 Foto' : `📎 ${req.file.originalname}`).catch(err => {
				console.error('Push notification error:', err.message);
			});

			res.json({ success: true, data: serialized });
		} catch (error) {
			console.error('Error uploading file:', error);
			res.status(500).json({ success: false, message: 'Gagal mengirim file', error: error.message });
		}
	}

	/**
	 * PUT /api/messaging/conversations/:id/read
	 * Mark all messages in conversation as read
	 */
	async markAsRead(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const conversationId = BigInt(req.params.id);

			// Verify user is participant
			const conv = await prisma.conversations.findFirst({
				where: {
					id: conversationId,
					OR: [
						{ participant_one_id: userId },
						{ participant_two_id: userId },
					],
				},
			});

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
			}

			const now = new Date();
			const result = await prisma.messages.updateMany({
				where: {
					conversation_id: conversationId,
					sender_id: { not: userId },
					is_read: false,
				},
				data: { is_read: true, read_at: now },
			});

			// Emit read receipt
			const io = getIO();
			if (io) {
				const otherId = Number(conv.participant_one_id) === Number(userId)
					? Number(conv.participant_two_id)
					: Number(conv.participant_one_id);
				io.to(`user_${otherId}`).emit('messages_read', {
					conversation_id: Number(conversationId),
					read_by: Number(userId),
					read_at: now,
				});
			}

			res.json({ success: true, data: { marked_count: result.count } });
		} catch (error) {
			console.error('Error marking as read:', error);
			res.status(500).json({ success: false, message: 'Gagal menandai pesan dibaca', error: error.message });
		}
	}

	/**
	 * GET /api/messaging/contacts
	 * Get available contacts that current user can chat with
	 */
	async getContacts(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const currentUser = await prisma.users.findUnique({
				where: { id: userId },
				select: { role: true, kecamatan_id: true, desa_id: true, dinas_id: true },
			});

			const { search, role_filter } = req.query;

			// Determine which roles this user can chat with
			let allowedRoles = [];
			if (DPMD_ROLES.includes(currentUser.role)) {
				// DPMD staff can chat with other DPMD staff, desa, kecamatan, and dinas
				allowedRoles = [...DPMD_ROLES, ...DESA_ROLES, ...KECAMATAN_ROLES, ...DINAS_ROLES];
			} else if (DESA_ROLES.includes(currentUser.role)) {
				// Desa can chat with DPMD, their kecamatan, and dinas
				allowedRoles = [...DPMD_ROLES, ...KECAMATAN_ROLES, ...DINAS_ROLES];
			} else if (KECAMATAN_ROLES.includes(currentUser.role)) {
				// Kecamatan can chat with DPMD and desa in their kecamatan
				allowedRoles = [...DPMD_ROLES, ...DESA_ROLES];
			} else if (DINAS_ROLES.includes(currentUser.role)) {
				// Dinas can chat with DPMD and desa
				allowedRoles = [...DPMD_ROLES, ...DESA_ROLES];
			}

			if (role_filter) {
				allowedRoles = allowedRoles.filter(r => r === role_filter);
			}

			const where = {
				id: { not: userId },
				role: { in: allowedRoles },
				is_active: true,
			};

			// If kecamatan user, only show desa in their kecamatan
			if (KECAMATAN_ROLES.includes(currentUser.role) && currentUser.kecamatan_id) {
				if (role_filter === 'desa' || (!role_filter && allowedRoles.includes('desa'))) {
					// Add kecamatan filter only for desa users
					where.OR = [
						{ role: { in: allowedRoles.filter(r => r !== 'desa') } },
						{ role: 'desa', kecamatan_id: currentUser.kecamatan_id },
					];
					delete where.role;
				}
			}

			if (search) {
				where.name = { contains: search };
			}

			const contacts = await prisma.users.findMany({
				where,
				select: USER_SELECT,
				orderBy: [{ role: 'asc' }, { name: 'asc' }],
				take: 100,
			});

			// Enrich all contacts with desa/kecamatan names
			await enrichUserNames(...contacts);

			res.json({
				success: true,
				data: contacts.map(serializeUser),
			});
		} catch (error) {
			console.error('Error getting contacts:', error);
			res.status(500).json({ success: false, message: 'Gagal memuat kontak', error: error.message });
		}
	}

	/**
	 * GET /api/messaging/unread-count
	 * Get total unread message count for current user
	 */
	async getUnreadCount(req, res) {
		try {
			const userId = BigInt(req.user.id);

			const count = await prisma.messages.count({
				where: {
					sender_id: { not: userId },
					is_read: false,
					conversation: {
						OR: [
							{ participant_one_id: userId },
							{ participant_two_id: userId },
						],
					},
				},
			});

			res.json({ success: true, data: { unread_count: count } });
		} catch (error) {
			console.error('Error getting unread count:', error);
			res.status(500).json({ success: false, message: 'Gagal memuat jumlah pesan belum dibaca', error: error.message });
		}
	}

	/**
	 * Internal: send push notification for new message
	 */
	async _sendMessagePush(receiver, senderName, messagePreview) {
		try {
			const subscriptions = await prisma.push_subscriptions.findMany({
				where: { user_id: receiver.id },
				orderBy: { created_at: 'desc' },
				take: 1,
			});

			if (subscriptions.length === 0) return;

			const subscription = subscriptions[0];
			const pushSubscription = typeof subscription.subscription === 'string'
				? JSON.parse(subscription.subscription)
				: subscription.subscription;

			const url = pushService.getRoleBasedUrl(receiver.role, 'pesan');

			const payload = JSON.stringify({
				title: `💬 ${senderName}`,
				body: messagePreview.length > 100 ? messagePreview.substring(0, 100) + '...' : messagePreview,
				icon: '/logo-192.png',
				badge: '/logo-96.png',
				data: { url, type: 'new_message' },
				actions: [
					{ action: 'view', title: 'Buka Chat' },
					{ action: 'close', title: 'Tutup' },
				],
			});

			const webpush = require('web-push');
			await webpush.sendNotification(pushSubscription, payload);
		} catch (error) {
			if (error.statusCode === 410 || error.statusCode === 404) {
				// Clean up invalid subscription
				await prisma.push_subscriptions.deleteMany({
					where: { user_id: receiver.id },
				});
			}
			throw error;
		}
	}

	/**
	 * DELETE /api/messaging/conversations/:id
	 * Delete a conversation and all its messages (for current user)
	 */
	async deleteConversation(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const conversationId = BigInt(req.params.id);

			const conversation = await prisma.conversations.findFirst({
				where: {
					id: conversationId,
					OR: [
						{ participant_one_id: userId },
						{ participant_two_id: userId },
					],
				},
			});

			if (!conversation) {
				return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
			}

			// Delete all messages with files
			const messagesWithFiles = await prisma.messages.findMany({
				where: { conversation_id: conversationId, file_path: { not: null } },
				select: { file_path: true },
			});
			for (const msg of messagesWithFiles) {
				if (msg.file_path) {
					const fullPath = path.resolve(msg.file_path);
					if (fs.existsSync(fullPath)) {
						try { fs.unlinkSync(fullPath); } catch {}
					}
				}
			}

			// Delete messages then conversation
			await prisma.messages.deleteMany({ where: { conversation_id: conversationId } });
			await prisma.conversations.delete({ where: { id: conversationId } });

			// Notify other user
			const io = getIO();
			if (io) {
				const otherUserId = Number(conversation.participant_one_id) === Number(userId)
					? Number(conversation.participant_two_id)
					: Number(conversation.participant_one_id);
				io.to(`user_${otherUserId}`).emit('conversation_deleted', {
					conversation_id: Number(conversationId),
				});
				io.to(`user_${Number(userId)}`).emit('conversation_deleted', {
					conversation_id: Number(conversationId),
				});
			}

			res.json({ success: true, message: 'Percakapan berhasil dihapus' });
		} catch (error) {
			console.error('Error deleting conversation:', error);
			res.status(500).json({ success: false, message: 'Gagal menghapus percakapan', error: error.message });
		}
	}

	/**
	 * DELETE /api/messaging/messages/:id
	 * Delete a message (only own messages)
	 */
	async deleteMessage(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const messageId = BigInt(req.params.id);

			const message = await prisma.messages.findFirst({
				where: { id: messageId, sender_id: userId },
				include: {
					conversation: {
						select: { id: true, participant_one_id: true, participant_two_id: true }
					}
				}
			});

			if (!message) {
				return res.status(404).json({ success: false, message: 'Pesan tidak ditemukan' });
			}

			// Delete file if exists
			if (message.file_path) {
				const fullPath = path.resolve(message.file_path);
				if (fs.existsSync(fullPath)) {
					fs.unlinkSync(fullPath);
				}
			}

			await prisma.messages.delete({ where: { id: messageId } });

			// Notify other user via socket
			const io = getIO();
			if (io) {
				const receiverId = Number(message.conversation.participant_one_id) === Number(userId)
					? Number(message.conversation.participant_two_id)
					: Number(message.conversation.participant_one_id);
				io.to(`user_${receiverId}`).emit('message_deleted', {
					message_id: Number(messageId),
					conversation_id: Number(message.conversation_id),
				});
				io.to(`user_${Number(userId)}`).emit('message_deleted', {
					message_id: Number(messageId),
					conversation_id: Number(message.conversation_id),
				});
			}

			res.json({ success: true, message: 'Pesan berhasil dihapus' });
		} catch (error) {
			console.error('Error deleting message:', error);
			res.status(500).json({ success: false, message: 'Gagal menghapus pesan', error: error.message });
		}
	}

	/**
	 * POST /api/messaging/conversations/context
	 * Get or create a contextual conversation tied to a verification entity
	 * Body: { target_user_id, reference_type, reference_id }
	 */
	async getOrCreateContextualConversation(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const { target_user_id, reference_type, reference_id } = req.body;

			if (!target_user_id || !reference_type || !reference_id) {
				return res.status(400).json({ success: false, message: 'target_user_id, reference_type, dan reference_id diperlukan' });
			}

			const validRefTypes = ['bankeu_lpj', 'bankeu_proposal'];
			if (!validRefTypes.includes(reference_type)) {
				return res.status(400).json({ success: false, message: 'reference_type tidak valid' });
			}

			const targetId = BigInt(target_user_id);
			const refId = BigInt(reference_id);

			if (userId === targetId) {
				return res.status(400).json({ success: false, message: 'Tidak bisa chat dengan diri sendiri' });
			}

			const [currentUser, targetUser] = await Promise.all([
				prisma.users.findUnique({ where: { id: userId }, select: { id: true, role: true } }),
				prisma.users.findUnique({ where: { id: targetId }, select: USER_SELECT }),
			]);

			if (!targetUser) {
				return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
			}

			const convType = resolveConversationType(currentUser.role, targetUser.role);
			const [p1, p2] = userId < targetId ? [userId, targetId] : [targetId, userId];

			let conversation = await prisma.conversations.findFirst({
				where: { participant_one_id: p1, participant_two_id: p2, reference_type, reference_id: refId },
				include: {
					participant_one: { select: USER_SELECT },
					participant_two: { select: USER_SELECT },
					messages: { orderBy: { created_at: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true, role: true, avatar: true } } } },
					_count: { select: { messages: { where: { is_read: false, sender_id: { not: userId } } } } },
				},
			});

			if (!conversation) {
				conversation = await prisma.conversations.create({
					data: { type: convType, reference_type, reference_id: refId, participant_one_id: p1, participant_two_id: p2 },
					include: {
						participant_one: { select: USER_SELECT },
						participant_two: { select: USER_SELECT },
						messages: { orderBy: { created_at: 'desc' }, take: 1 },
						_count: { select: { messages: { where: { is_read: false, sender_id: { not: userId } } } } },
					},
				});
			}

			// Enrich user names
			await enrichUserNames(conversation.participant_one, conversation.participant_two);
			conversation._reference_label = await buildReferenceLabel(reference_type, refId);

			res.json({ success: true, data: serializeConversation(conversation, Number(userId)) });
		} catch (error) {
			console.error('Error creating contextual conversation:', error);
			res.status(500).json({ success: false, message: 'Gagal membuat percakapan', error: error.message });
		}
	}

	/**
	 * GET /api/messaging/conversations/reference/:type/:id
	 * Get conversation for a specific reference entity (used by verification pages)
	 */
	async getConversationByReference(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const { type: refType, id: refId } = req.params;

			const conversations = await prisma.conversations.findMany({
				where: {
					reference_type: refType,
					reference_id: BigInt(refId),
					OR: [
						{ participant_one_id: userId },
						{ participant_two_id: userId },
					],
				},
				include: {
					participant_one: { select: USER_SELECT },
					participant_two: { select: USER_SELECT },
					messages: { orderBy: { created_at: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true, role: true, avatar: true } } } },
					_count: { select: { messages: { where: { is_read: false, sender_id: { not: userId } } } } },
				},
				orderBy: { last_message_at: 'desc' },
			});

			// Enrich all participant names
			const allUsers = conversations.flatMap(c => [c.participant_one, c.participant_two]);
			await enrichUserNames(...allUsers);

			const currentUserId = Number(userId);
			const results = [];
			for (const c of conversations) {
				c._reference_label = await buildReferenceLabel(c.reference_type, c.reference_id);
				results.push(serializeConversation(c, currentUserId));
			}

			res.json({ success: true, data: results });
		} catch (error) {
			console.error('Error getting conversation by reference:', error);
			res.status(500).json({ success: false, message: 'Gagal memuat percakapan', error: error.message });
		}
	}
}

/**
 * Static helper: Create a conversation when a reviewer sets status to 'revision'
 * Called from verification controllers (bankeuLpj, dinasVerification, bankeuVerification)
 * @param {BigInt} reviewerId - The user who reviewed (DPMD/Dinas/Kecamatan staff)
 * @param {BigInt} desaUserId - The desa user who submitted
 * @param {string} reviewerRole - Role of the reviewer
 * @param {string} desaRole - Role of the desa user (usually 'desa')
 * @param {string} referenceType - 'bankeu_lpj' | 'bankeu_proposal'
 * @param {BigInt} referenceId - ID of the entity
 * @param {string} systemMessage - System message content (e.g. revision notes)
 */
async function createVerificationChat(reviewerId, desaUserId, reviewerRole, desaRole, referenceType, referenceId, systemMessage) {
	try {
		const rId = BigInt(reviewerId);
		const dId = BigInt(desaUserId);
		const refId = BigInt(referenceId);
		const convType = resolveConversationType(reviewerRole, desaRole);
		const [p1, p2] = rId < dId ? [rId, dId] : [dId, rId];

		// Find or create conversation
		let conversation = await prisma.conversations.findFirst({
			where: { participant_one_id: p1, participant_two_id: p2, reference_type: referenceType, reference_id: refId },
		});

		const now = new Date();

		if (!conversation) {
			conversation = await prisma.conversations.create({
				data: { type: convType, reference_type: referenceType, reference_id: refId, participant_one_id: p1, participant_two_id: p2, last_message_at: now },
			});
		}

		// Send revision notes as a text message from the reviewer
		if (systemMessage) {
			const msg = await prisma.messages.create({
				data: {
					conversation_id: conversation.id,
					sender_id: rId,
					content: systemMessage,
					message_type: 'text',
					created_at: now,
					updated_at: now,
				},
			});

			await prisma.conversations.update({
				where: { id: conversation.id },
				data: { last_message_at: now, updated_at: now },
			});

			// Emit socket event
			const io = getIO();
			if (io) {
				const serializedMsg = serializeMessage(msg);
				io.to(`user_${Number(rId)}`).emit('new_message', serializedMsg);
				io.to(`user_${Number(dId)}`).emit('new_message', serializedMsg);
			}
		}

		return Number(conversation.id);
	} catch (error) {
		console.error('createVerificationChat error:', error.message);
		return null;
	}
}

module.exports = new MessagingController();
module.exports.createVerificationChat = createVerificationChat;
