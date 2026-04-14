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
		desaIds.size > 0 ? prisma.desas.findMany({ where: { id: { in: [...desaIds].map(BigInt) } }, select: { id: true, nama: true, status_pemerintahan: true } }) : [],
		kecIds.size > 0 ? prisma.kecamatans.findMany({ where: { id: { in: [...kecIds].map(BigInt) } }, select: { id: true, nama: true } }) : [],
	]);
	const desaMap = Object.fromEntries(desas.map(d => [Number(d.id), { nama: d.nama, status_pemerintahan: d.status_pemerintahan }]));
	const kecMap = Object.fromEntries(kecamatans.map(k => [Number(k.id), k.nama]));
	for (const u of users) {
		if (u?.desa_id) {
			const desaInfo = desaMap[Number(u.desa_id)];
			u.desas = { nama: desaInfo?.nama || null };
			u.status_pemerintahan = desaInfo?.status_pemerintahan || null;
		}
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
		status_pemerintahan: user.status_pemerintahan || null,
		desas: user.desas ? { nama: user.desas.nama } : undefined,
		kecamatans: user.kecamatans ? { nama: user.kecamatans.nama } : undefined,
	};
}

function serializeMessage(msg) {
	const serialized = {
		id: Number(msg.id),
		conversation_id: Number(msg.conversation_id),
		sender_id: Number(msg.sender_id),
		reply_to_id: msg.reply_to_id ? Number(msg.reply_to_id) : null,
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
	// Include reply_to message summary
	if (msg.reply_to) {
		serialized.reply_to = {
			id: Number(msg.reply_to.id),
			sender_id: Number(msg.reply_to.sender_id),
			content: msg.reply_to.content,
			message_type: msg.reply_to.message_type,
			file_name: msg.reply_to.file_name,
			sender: msg.reply_to.sender ? serializeUser(msg.reply_to.sender) : undefined,
		};
	}
	// Include reactions grouped by emoji
	if (msg.reactions && msg.reactions.length > 0) {
		const grouped = {};
		for (const r of msg.reactions) {
			if (!grouped[r.emoji]) grouped[r.emoji] = [];
			grouped[r.emoji].push({
				user_id: Number(r.user_id),
				user_name: r.user?.name || 'Unknown',
			});
		}
		serialized.reactions = grouped;
	}
	return serialized;
}

function serializeConversation(conv, currentUserId) {
	// Group conversation
	if (conv.is_group) {
		const members = (conv.participants || []).map(p => ({
			...serializeUser(p.user),
			participant_role: p.role,
		}));
		return {
			id: Number(conv.id),
			type: conv.type,
			is_group: true,
			group_name: conv.group_name,
			group_avatar: conv.group_avatar,
			created_by: conv.created_by ? Number(conv.created_by) : null,
			members,
			member_count: members.length,
			reference_type: conv.reference_type || null,
			reference_id: conv.reference_id ? Number(conv.reference_id) : null,
			reference_label: conv._reference_label || null,
			other_user: null,
			last_message: conv.messages && conv.messages[0] ? serializeMessage(conv.messages[0]) : null,
			last_message_at: conv.last_message_at,
			unread_count: conv._unread_count || 0,
			created_at: conv.created_at,
		};
	}

	// 1-on-1 conversation
	const otherUser = Number(conv.participant_one_id) === currentUserId
		? conv.participant_two
		: conv.participant_one;

	return {
		id: Number(conv.id),
		type: conv.type,
		is_group: false,
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

// Check if user is participant in a conversation (supports both 1-on-1 and group)
async function isConversationParticipant(conversationId, userId) {
	const conv = await prisma.conversations.findFirst({
		where: {
			id: conversationId,
			OR: [
				{ participant_one_id: userId },
				{ participant_two_id: userId },
				{ participants: { some: { user_id: userId } } },
			],
		},
		include: {
			participant_one: { select: { id: true, name: true, role: true } },
			participant_two: { select: { id: true, name: true, role: true } },
			participants: { include: { user: { select: { id: true, name: true, role: true } } } },
		},
	});
	return conv;
}

// Get all user IDs in a conversation (for socket broadcasting)
function getConversationReceiverIds(conv, senderId) {
	const ids = new Set();
	if (conv.is_group) {
		for (const p of (conv.participants || [])) {
			const uid = Number(p.user_id || p.user?.id);
			if (uid && uid !== Number(senderId)) ids.add(uid);
		}
	} else {
		const otherId = Number(conv.participant_one_id) === Number(senderId)
			? Number(conv.participant_two_id)
			: Number(conv.participant_one_id);
		if (otherId) ids.add(otherId);
	}
	return [...ids];
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
					{ participants: { some: { user_id: userId } } },
				],
			};
			if (type) where.type = type;
			if (reference_type) where.reference_type = reference_type;

			const conversations = await prisma.conversations.findMany({
				where,
				include: {
					participant_one: { select: USER_SELECT },
					participant_two: { select: USER_SELECT },
					participants: {
						include: { user: { select: USER_SELECT } },
					},
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
			const allUsers = conversations.flatMap(c => [
				c.participant_one, c.participant_two,
				...(c.participants || []).map(p => p.user),
			].filter(Boolean));
			await enrichUserNames(...allUsers);

			const currentUserId = Number(userId);

			// Attach reference labels & compute group unread counts
			const results = [];
			for (const c of conversations) {
				if (c.reference_type && c.reference_id) {
					c._reference_label = await buildReferenceLabel(c.reference_type, c.reference_id);
				}
				// For groups, compute unread count based on last_read_at
				if (c.is_group) {
					const myParticipant = (c.participants || []).find(p => Number(p.user_id) === currentUserId);
					if (myParticipant && myParticipant.last_read_at) {
						c._unread_count = await prisma.messages.count({
							where: {
								conversation_id: c.id,
								sender_id: { not: userId },
								created_at: { gt: myParticipant.last_read_at },
							},
						});
					} else {
						c._unread_count = c._count?.messages || 0;
					}
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
			const conv = await isConversationParticipant(conversationId, userId);

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
					reply_to: {
						include: { sender: { select: { id: true, name: true, role: true, avatar: true } } },
					},
					reactions: {
						include: { user: { select: { id: true, name: true } } },
					},
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
			const { content, reply_to_id } = req.body;

			if (!content || !content.trim()) {
				return res.status(400).json({ success: false, message: 'Konten pesan diperlukan' });
			}

			// Verify user is participant
			const conv = await isConversationParticipant(conversationId, userId);

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
			}

			const now = new Date();
			const data = {
				conversation_id: conversationId,
				sender_id: userId,
				content: content.trim(),
				message_type: 'text',
				created_at: now,
				updated_at: now,
			};
			if (reply_to_id) {
				data.reply_to_id = BigInt(reply_to_id);
			}

			const message = await prisma.messages.create({
				data,
				include: {
					sender: { select: { id: true, name: true, role: true, avatar: true } },
					reply_to: {
						include: { sender: { select: { id: true, name: true, role: true, avatar: true } } },
					},
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
				const receiverIds = getConversationReceiverIds(conv, userId);
				for (const rid of receiverIds) {
					io.to(`user_${rid}`).emit('new_message', serialized);
				}
				io.to(`user_${Number(userId)}`).emit('new_message', serialized);
			}

			// Send push notification to receivers
			if (conv.is_group) {
				const receiverIds = getConversationReceiverIds(conv, userId);
				for (const rid of receiverIds) {
					const rUser = (conv.participants || []).find(p => Number(p.user?.id) === rid)?.user;
					if (rUser) {
						this._sendMessagePush(rUser, `${req.user.name || 'Pengguna'} · ${conv.group_name}`, content.trim()).catch(() => {});
					}
				}
			} else {
				const receiverUser = Number(conv.participant_one_id) === Number(userId)
					? conv.participant_two
					: conv.participant_one;
				this._sendMessagePush(receiverUser, req.user.name || 'Pengguna', content.trim()).catch(err => {
					console.error('Push notification error:', err.message);
				});
			}

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
			const conv = await isConversationParticipant(conversationId, userId);

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
				const receiverIds = getConversationReceiverIds(conv, userId);
				for (const rid of receiverIds) {
					io.to(`user_${rid}`).emit('new_message', serialized);
				}
				io.to(`user_${Number(userId)}`).emit('new_message', serialized);
			}

			// Push notifications
			const pushContent = isImage ? '📷 Foto' : `📎 ${req.file.originalname}`;
			if (conv.is_group) {
				const receiverIds = getConversationReceiverIds(conv, userId);
				for (const rid of receiverIds) {
					const rUser = (conv.participants || []).find(p => Number(p.user?.id) === rid)?.user;
					if (rUser) this._sendMessagePush(rUser, `${req.user.name || 'Pengguna'} · ${conv.group_name}`, pushContent).catch(() => {});
				}
			} else {
				const receiverUser = Number(conv.participant_one_id) === Number(userId)
					? conv.participant_two : conv.participant_one;
				this._sendMessagePush(receiverUser, req.user.name || 'Pengguna', pushContent).catch(err => {
					console.error('Push notification error:', err.message);
				});
			}

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
			const conv = await isConversationParticipant(conversationId, userId);

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

			// For groups, also update last_read_at on participant record
			if (conv.is_group) {
				await prisma.conversation_participants.updateMany({
					where: { conversation_id: conversationId, user_id: userId },
					data: { last_read_at: now },
				});
			}

			// Emit read receipt
			const io = getIO();
			if (io) {
				const receiverIds = getConversationReceiverIds(conv, userId);
				for (const rid of receiverIds) {
					io.to(`user_${rid}`).emit('messages_read', {
						conversation_id: Number(conversationId),
						read_by: Number(userId),
						read_at: now,
					});
				}
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

			const { search, role_filter, role_group } = req.query;

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

			// Filter by role group (dpmd, desa, kelurahan, kecamatan, dinas)
			let desaStatusFilter = null;
			if (role_group) {
				if (role_group === 'desa' || role_group === 'kelurahan') {
					allowedRoles = allowedRoles.filter(r => DESA_ROLES.includes(r));
					desaStatusFilter = role_group; // 'desa' or 'kelurahan'
				} else {
					const GROUPS = { dpmd: DPMD_ROLES, kecamatan: KECAMATAN_ROLES, dinas: DINAS_ROLES };
					const groupRoles = GROUPS[role_group];
					if (groupRoles) {
						allowedRoles = allowedRoles.filter(r => groupRoles.includes(r));
					}
				}
			} else if (role_filter) {
				allowedRoles = allowedRoles.filter(r => r === role_filter);
			}

			const where = {
				id: { not: userId },
				role: { in: allowedRoles },
				is_active: true,
			};

			// Filter by desa status_pemerintahan (desa vs kelurahan)
			if (desaStatusFilter) {
				const desasWithStatus = await prisma.desas.findMany({
					where: { status_pemerintahan: desaStatusFilter },
					select: { id: true },
				});
				where.desa_id = { in: desasWithStatus.map(d => d.id) };
			}

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
				take: 500,
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

			const conversation = await isConversationParticipant(conversationId, userId);

			if (!conversation) {
				return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan' });
			}

			// For groups, only admin can delete
			if (conversation.is_group) {
				const myPart = (conversation.participants || []).find(p => Number(p.user_id || p.user?.id) === Number(userId));
				if (!myPart || myPart.role !== 'admin') {
					return res.status(403).json({ success: false, message: 'Hanya admin grup yang bisa menghapus grup' });
				}
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

			// Delete participants, messages, then conversation
			await prisma.conversation_participants.deleteMany({ where: { conversation_id: conversationId } });
			await prisma.messages.deleteMany({ where: { conversation_id: conversationId } });
			await prisma.conversations.delete({ where: { id: conversationId } });

			// Notify all participants
			const io = getIO();
			if (io) {
				const allIds = getConversationReceiverIds(conversation, userId);
				for (const rid of allIds) {
					io.to(`user_${rid}`).emit('conversation_deleted', {
						conversation_id: Number(conversationId),
					});
				}
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
						select: { id: true, is_group: true, participant_one_id: true, participant_two_id: true },
						include: { participants: { select: { user_id: true } } },
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

			// Notify all participants via socket
			const io = getIO();
			if (io) {
				const conv = message.conversation;
				const receiverIds = getConversationReceiverIds(conv, userId);
				for (const rid of receiverIds) {
					io.to(`user_${rid}`).emit('message_deleted', {
						message_id: Number(messageId),
						conversation_id: Number(message.conversation_id),
					});
				}
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
	 * POST /api/messaging/messages/:id/reactions
	 * Toggle emoji reaction on a message
	 * Body: { emoji }
	 */
	async toggleReaction(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const messageId = BigInt(req.params.id);
			const { emoji } = req.body;

			if (!emoji) {
				return res.status(400).json({ success: false, message: 'Emoji diperlukan' });
			}

			// Verify message exists and user is participant in the conversation
			const message = await prisma.messages.findUnique({
				where: { id: messageId },
				select: { id: true, conversation_id: true },
			});

			if (!message) {
				return res.status(404).json({ success: false, message: 'Pesan tidak ditemukan' });
			}

			const conv = await isConversationParticipant(message.conversation_id, userId);
			if (!conv) {
				return res.status(403).json({ success: false, message: 'Tidak memiliki akses' });
			}

			// Toggle: check if reaction already exists
			const existing = await prisma.message_reactions.findFirst({
				where: { message_id: messageId, user_id: userId, emoji },
			});

			let action;
			if (existing) {
				await prisma.message_reactions.delete({ where: { id: existing.id } });
				action = 'removed';
			} else {
				await prisma.message_reactions.create({
					data: { message_id: messageId, user_id: userId, emoji },
				});
				action = 'added';
			}

			// Fetch updated reactions for this message
			const reactions = await prisma.message_reactions.findMany({
				where: { message_id: messageId },
				include: { user: { select: { id: true, name: true } } },
			});

			const grouped = {};
			for (const r of reactions) {
				if (!grouped[r.emoji]) grouped[r.emoji] = [];
				grouped[r.emoji].push({ user_id: Number(r.user_id), user_name: r.user?.name || 'Unknown' });
			}

			// Emit via socket for real-time
			const io = getIO();
			if (io) {
				const receiverIds = getConversationReceiverIds(conv, userId);
				const payload = {
					message_id: Number(messageId),
					conversation_id: Number(message.conversation_id),
					reactions: grouped,
					action,
					emoji,
					user_id: Number(userId),
					user_name: req.user.name,
				};
				for (const rid of receiverIds) {
					io.to(`user_${rid}`).emit('message_reaction', payload);
				}
				io.to(`user_${Number(userId)}`).emit('message_reaction', payload);
			}

			res.json({ success: true, data: { action, reactions: grouped } });
		} catch (error) {
			console.error('Error toggling reaction:', error);
			res.status(500).json({ success: false, message: 'Gagal memberikan reaksi', error: error.message });
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

	// ════════════════════════════════════════════════
	// GROUP CHAT METHODS
	// ════════════════════════════════════════════════

	/**
	 * POST /api/messaging/groups
	 * Create a new group conversation
	 * Body: { name, member_ids: [1,2,3] }
	 */
	async createGroup(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const { name, member_ids } = req.body;

			if (!name || !name.trim()) {
				return res.status(400).json({ success: false, message: 'Nama grup diperlukan' });
			}
			if (!Array.isArray(member_ids) || member_ids.length < 1) {
				return res.status(400).json({ success: false, message: 'Minimal 1 anggota diperlukan' });
			}
			if (member_ids.length > 50) {
				return res.status(400).json({ success: false, message: 'Maksimal 50 anggota per grup' });
			}

			// Deduplicate and exclude self
			const uniqueIds = [...new Set(member_ids.map(Number))].filter(id => id !== Number(userId));
			if (uniqueIds.length < 1) {
				return res.status(400).json({ success: false, message: 'Tambahkan minimal 1 anggota selain diri sendiri' });
			}

			// Verify all member users exist
			const members = await prisma.users.findMany({
				where: { id: { in: uniqueIds.map(BigInt) }, is_active: true },
				select: USER_SELECT,
			});
			if (members.length !== uniqueIds.length) {
				return res.status(400).json({ success: false, message: 'Beberapa user tidak ditemukan' });
			}

			const now = new Date();

			// Create conversation + participants in transaction
			const conversation = await prisma.$transaction(async (tx) => {
				const conv = await tx.conversations.create({
					data: {
						type: 'group',
						is_group: true,
						group_name: name.trim().substring(0, 100),
						created_by: userId,
						created_at: now,
						updated_at: now,
					},
				});

				// Add creator as admin
				await tx.conversation_participants.create({
					data: { conversation_id: conv.id, user_id: userId, role: 'admin', joined_at: now, last_read_at: now },
				});

				// Add members
				await tx.conversation_participants.createMany({
					data: uniqueIds.map(uid => ({
						conversation_id: conv.id,
						user_id: BigInt(uid),
						role: 'member',
						joined_at: now,
					})),
				});

				// System message: group created
				await tx.messages.create({
					data: {
						conversation_id: conv.id,
						sender_id: userId,
						content: `${req.user.name} membuat grup "${name.trim()}"`,
						message_type: 'system',
						created_at: now,
						updated_at: now,
					},
				});

				await tx.conversations.update({
					where: { id: conv.id },
					data: { last_message_at: now },
				});

				return conv;
			});

			// Re-fetch with all includes for response
			const fullConv = await prisma.conversations.findUnique({
				where: { id: conversation.id },
				include: {
					participant_one: { select: USER_SELECT },
					participant_two: { select: USER_SELECT },
					participants: { include: { user: { select: USER_SELECT } } },
					messages: { orderBy: { created_at: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true, role: true, avatar: true } } } },
				},
			});

			const allUsers = (fullConv.participants || []).map(p => p.user).filter(Boolean);
			await enrichUserNames(...allUsers);
			fullConv._unread_count = 0;

			const serialized = serializeConversation(fullConv, Number(userId));

			// Notify all members via socket
			const io = getIO();
			if (io) {
				for (const uid of uniqueIds) {
					io.to(`user_${uid}`).emit('group_created', serialized);
				}
			}

			res.json({ success: true, data: serialized });
		} catch (error) {
			console.error('Error creating group:', error);
			res.status(500).json({ success: false, message: 'Gagal membuat grup', error: error.message });
		}
	}

	/**
	 * PUT /api/messaging/groups/:id
	 * Update group name
	 * Body: { name }
	 */
	async updateGroup(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const groupId = BigInt(req.params.id);
			const { name } = req.body;

			if (!name || !name.trim()) {
				return res.status(400).json({ success: false, message: 'Nama grup diperlukan' });
			}

			const conv = await prisma.conversations.findFirst({
				where: { id: groupId, is_group: true },
				include: { participants: { include: { user: { select: { id: true, name: true } } } } },
			});

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
			}

			const myPart = conv.participants.find(p => Number(p.user_id) === Number(userId));
			if (!myPart || myPart.role !== 'admin') {
				return res.status(403).json({ success: false, message: 'Hanya admin yang bisa mengubah nama grup' });
			}

			const oldName = conv.group_name;
			const newName = name.trim().substring(0, 100);

			const now = new Date();
			await prisma.conversations.update({
				where: { id: groupId },
				data: { group_name: newName, updated_at: now },
			});

			// System message
			await prisma.messages.create({
				data: {
					conversation_id: groupId, sender_id: userId,
					content: `${req.user.name} mengubah nama grup dari "${oldName}" menjadi "${newName}"`,
					message_type: 'system', created_at: now, updated_at: now,
				},
			});
			await prisma.conversations.update({ where: { id: groupId }, data: { last_message_at: now } });

			// Notify all members
			const io = getIO();
			if (io) {
				for (const p of conv.participants) {
					io.to(`user_${Number(p.user_id)}`).emit('group_updated', {
						conversation_id: Number(groupId),
						group_name: newName,
					});
				}
			}

			res.json({ success: true, data: { group_name: newName } });
		} catch (error) {
			console.error('Error updating group:', error);
			res.status(500).json({ success: false, message: 'Gagal mengubah grup', error: error.message });
		}
	}

	/**
	 * PUT /api/messaging/groups/:id/avatar
	 * Upload/change group avatar (admin only)
	 */
	async updateGroupAvatar(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const groupId = BigInt(req.params.id);

			if (!req.file) {
				return res.status(400).json({ success: false, message: 'File avatar diperlukan' });
			}

			const conv = await prisma.conversations.findFirst({
				where: { id: groupId, is_group: true },
				include: { participants: { include: { user: { select: { id: true, name: true } } } } },
			});

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
			}

			const myPart = conv.participants.find(p => Number(p.user_id) === Number(userId));
			if (!myPart || myPart.role !== 'admin') {
				// Delete uploaded file
				fs.unlink(req.file.path, () => {});
				return res.status(403).json({ success: false, message: 'Hanya admin yang bisa mengubah foto grup' });
			}

			// Delete old avatar if exists
			if (conv.group_avatar) {
				const oldPath = path.resolve(conv.group_avatar);
				fs.unlink(oldPath, () => {});
			}

			const avatarPath = req.file.path.replace(/\\/g, '/');

			const now = new Date();
			await prisma.conversations.update({
				where: { id: groupId },
				data: { group_avatar: avatarPath, updated_at: now },
			});

			// System message
			await prisma.messages.create({
				data: {
					conversation_id: groupId, sender_id: userId,
					content: `${req.user.name} mengubah foto grup`,
					message_type: 'system', created_at: now, updated_at: now,
				},
			});
			await prisma.conversations.update({ where: { id: groupId }, data: { last_message_at: now } });

			// Notify all members
			const io = getIO();
			if (io) {
				for (const p of conv.participants) {
					io.to(`user_${Number(p.user_id)}`).emit('group_updated', {
						conversation_id: Number(groupId),
						group_avatar: avatarPath,
						group_name: conv.group_name,
					});
				}
			}

			res.json({ success: true, data: { group_avatar: avatarPath } });
		} catch (error) {
			console.error('Error updating group avatar:', error);
			res.status(500).json({ success: false, message: 'Gagal mengubah foto grup', error: error.message });
		}
	}

	/**
	 * POST /api/messaging/groups/:id/members
	 * Add members to group
	 * Body: { user_ids: [4, 5] }
	 */
	async addMembers(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const groupId = BigInt(req.params.id);
			const { user_ids } = req.body;

			if (!Array.isArray(user_ids) || user_ids.length < 1) {
				return res.status(400).json({ success: false, message: 'user_ids diperlukan' });
			}

			const conv = await prisma.conversations.findFirst({
				where: { id: groupId, is_group: true },
				include: { participants: true },
			});

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
			}

			const myPart = conv.participants.find(p => Number(p.user_id) === Number(userId));
			if (!myPart || myPart.role !== 'admin') {
				return res.status(403).json({ success: false, message: 'Hanya admin yang bisa menambah anggota' });
			}

			// Filter out existing members
			const existingIds = new Set(conv.participants.map(p => Number(p.user_id)));
			const newIds = [...new Set(user_ids.map(Number))].filter(id => !existingIds.has(id));

			if (newIds.length === 0) {
				return res.status(400).json({ success: false, message: 'Semua user sudah menjadi anggota' });
			}

			if (existingIds.size + newIds.length > 51) {
				return res.status(400).json({ success: false, message: 'Maksimal 50 anggota per grup' });
			}

			const newUsers = await prisma.users.findMany({
				where: { id: { in: newIds.map(BigInt) }, is_active: true },
				select: USER_SELECT,
			});

			if (newUsers.length === 0) {
				return res.status(400).json({ success: false, message: 'User tidak ditemukan' });
			}

			const now = new Date();
			await prisma.conversation_participants.createMany({
				data: newUsers.map(u => ({
					conversation_id: groupId, user_id: u.id, role: 'member', joined_at: now,
				})),
			});

			// System message
			const names = newUsers.map(u => u.name).join(', ');
			await prisma.messages.create({
				data: {
					conversation_id: groupId, sender_id: userId,
					content: `${req.user.name} menambahkan ${names}`,
					message_type: 'system', created_at: now, updated_at: now,
				},
			});
			await prisma.conversations.update({ where: { id: groupId }, data: { last_message_at: now, updated_at: now } });

			// Notify via socket
			const io = getIO();
			if (io) {
				for (const uid of newIds) {
					io.to(`user_${uid}`).emit('group_member_added', {
						conversation_id: Number(groupId),
						added_user_ids: newIds,
					});
				}
				for (const p of conv.participants) {
					io.to(`user_${Number(p.user_id)}`).emit('group_member_added', {
						conversation_id: Number(groupId),
						added_user_ids: newIds,
					});
				}
			}

			await enrichUserNames(...newUsers);
			res.json({ success: true, data: { added: newUsers.map(serializeUser) } });
		} catch (error) {
			console.error('Error adding members:', error);
			res.status(500).json({ success: false, message: 'Gagal menambah anggota', error: error.message });
		}
	}

	/**
	 * DELETE /api/messaging/groups/:id/members/:userId
	 * Remove a member from group (admin action) or leave group (self)
	 */
	async removeMember(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const groupId = BigInt(req.params.id);
			const targetUserId = BigInt(req.params.userId);

			const conv = await prisma.conversations.findFirst({
				where: { id: groupId, is_group: true },
				include: { participants: { include: { user: { select: { id: true, name: true } } } } },
			});

			if (!conv) {
				return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
			}

			const myPart = conv.participants.find(p => Number(p.user_id) === Number(userId));
			if (!myPart) {
				return res.status(403).json({ success: false, message: 'Anda bukan anggota grup ini' });
			}

			const isSelf = Number(userId) === Number(targetUserId);
			const isAdmin = myPart.role === 'admin';

			// Only admin can remove others; anyone can leave
			if (!isSelf && !isAdmin) {
				return res.status(403).json({ success: false, message: 'Hanya admin yang bisa mengeluarkan anggota' });
			}

			const targetPart = conv.participants.find(p => Number(p.user_id) === Number(targetUserId));
			if (!targetPart) {
				return res.status(404).json({ success: false, message: 'User bukan anggota grup ini' });
			}

			await prisma.conversation_participants.delete({ where: { id: targetPart.id } });

			const now = new Date();
			const targetName = targetPart.user?.name || 'Pengguna';
			const sysContent = isSelf
				? `${targetName} keluar dari grup`
				: `${req.user.name} mengeluarkan ${targetName}`;

			await prisma.messages.create({
				data: {
					conversation_id: groupId, sender_id: userId,
					content: sysContent, message_type: 'system',
					created_at: now, updated_at: now,
				},
			});
			await prisma.conversations.update({ where: { id: groupId }, data: { last_message_at: now, updated_at: now } });

			// If admin left, transfer admin to next oldest member
			if (isSelf && isAdmin) {
				const nextMember = await prisma.conversation_participants.findFirst({
					where: { conversation_id: groupId },
					orderBy: { joined_at: 'asc' },
				});
				if (nextMember) {
					await prisma.conversation_participants.update({
						where: { id: nextMember.id },
						data: { role: 'admin' },
					});
				}
			}

			// Notify via socket
			const io = getIO();
			if (io) {
				for (const p of conv.participants) {
					io.to(`user_${Number(p.user_id)}`).emit('group_member_removed', {
						conversation_id: Number(groupId),
						removed_user_id: Number(targetUserId),
						is_self: isSelf,
					});
				}
			}

			res.json({ success: true, message: isSelf ? 'Berhasil keluar dari grup' : 'Anggota berhasil dikeluarkan' });
		} catch (error) {
			console.error('Error removing member:', error);
			res.status(500).json({ success: false, message: 'Gagal mengeluarkan anggota', error: error.message });
		}
	}

	/**
	 * GET /api/messaging/groups/:id/members
	 * Get group members
	 */
	async getGroupMembers(req, res) {
		try {
			const userId = BigInt(req.user.id);
			const groupId = BigInt(req.params.id);

			const conv = await isConversationParticipant(groupId, userId);
			if (!conv || !conv.is_group) {
				return res.status(404).json({ success: false, message: 'Grup tidak ditemukan' });
			}

			const participants = await prisma.conversation_participants.findMany({
				where: { conversation_id: groupId },
				include: { user: { select: USER_SELECT } },
				orderBy: [{ role: 'asc' }, { joined_at: 'asc' }],
			});

			const users = participants.map(p => p.user).filter(Boolean);
			await enrichUserNames(...users);

			const data = participants.map(p => ({
				...serializeUser(p.user),
				participant_role: p.role,
				joined_at: p.joined_at,
			}));

			res.json({ success: true, data });
		} catch (error) {
			console.error('Error getting group members:', error);
			res.status(500).json({ success: false, message: 'Gagal memuat anggota grup', error: error.message });
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
