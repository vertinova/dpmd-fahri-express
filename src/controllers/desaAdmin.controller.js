/**
 * Manajemen Akun oleh Admin Desa.
 *
 * Semua endpoint di sini WAJIB dipagari `checkRole('admin_desa')` dan selalu
 * dikunci ke `req.user.desa_id` — Admin Desa tidak boleh menyentuh akun desa lain.
 */

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { DESA_PERMISSIONS, sanitizePermissionKeys } = require('../config/desaPermissions');
const { normalizePhone } = require('../config/desaProfile');
const { invalidateDesaPermissions } = require('../middlewares/desaPermission');
const ActivityLogger = require('../utils/activityLogger');

// Modul untuk jejak audit di tabel activity_logs.
const LOG_MODULE = 'manajemen_akun_desa';

/** Catat aksi Admin Desa. Fire-and-forget: kegagalan log tidak boleh menggagalkan request. */
const logDesaAdminAction = (req, { action, target, description, oldValue = null, newValue = null }) => {
  ActivityLogger.log({
    userId: BigInt(String(req.user.id)),
    userName: req.user.name,
    userRole: req.user.role,
    module: LOG_MODULE,
    action,
    entityType: 'users',
    entityId: target?.id ?? null,
    entityName: target?.name ?? null,
    description,
    oldValue,
    newValue,
    ipAddress: ActivityLogger.getIpFromRequest(req),
    userAgent: ActivityLogger.getUserAgentFromRequest(req),
  }).catch(() => {});
};

// Akun yang dibuat Admin Desa selalu berupa akun operasional desa.
const MANAGED_ROLE = 'desa';
const MIN_PASSWORD_LENGTH = 6;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const badRequest = (res, message) => res.status(400).json({ success: false, message });

/** desa_id Admin Desa yang sedang login, atau null bila akunnya belum terhubung ke desa. */
const getScopeDesaId = (req) => {
  const desaId = req.user?.desa_id;
  if (desaId === undefined || desaId === null) return null;
  const parsed = BigInt(desaId);
  return parsed;
};

const serializeUser = (user) => ({
  id: String(user.id),
  name: user.name,
  email: user.email,
  role: user.role,
  jabatan_desa: user.jabatan_desa || null,
  no_hp: user.no_hp || null,
  desa_id: user.desa_id === null || user.desa_id === undefined ? null : String(user.desa_id),
  is_active: user.is_active,
  last_active_at: user.last_active_at || null,
  created_at: user.created_at,
  updated_at: user.updated_at,
  permissions: (user.desa_user_permissions || []).map((p) => p.permission_key),
});

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  jabatan_desa: true,
  no_hp: true,
  desa_id: true,
  is_active: true,
  last_active_at: true,
  created_at: true,
  updated_at: true,
  desa_user_permissions: { select: { permission_key: true } },
};

/**
 * Ambil akun target dan pastikan benar-benar milik desa Admin Desa yang login.
 * Mengembalikan null bila tidak ada / bukan milik desa tersebut (respons 404 disamakan
 * supaya tidak bocor keberadaan akun desa lain).
 */
const findManagedUser = async (id, desaId) => {
  let userId;
  try {
    userId = BigInt(String(id));
  } catch {
    return null;
  }

  const user = await prisma.users.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user) return null;
  if (user.role !== MANAGED_ROLE) return null;
  if (user.desa_id === null || BigInt(user.desa_id) !== desaId) return null;
  return user;
};

class DesaAdminController {
  /** Katalog hak akses yang bisa dicentang Admin Desa. */
  async getPermissionCatalog(req, res) {
    res.json({ success: true, data: DESA_PERMISSIONS });
  }

  /** Ringkasan desa + jumlah akun, untuk header halaman Manajemen Akun. */
  async getDesaInfo(req, res) {
    try {
      const desaId = getScopeDesaId(req);
      if (desaId === null) {
        return badRequest(res, 'Akun Admin Desa belum terhubung dengan data desa');
      }

      const [desa, total, aktif] = await Promise.all([
        prisma.desas.findUnique({
          where: { id: desaId },
          select: { id: true, nama: true, kode: true, status_pemerintahan: true, kecamatan_id: true },
        }),
        prisma.users.count({ where: { role: MANAGED_ROLE, desa_id: desaId } }),
        prisma.users.count({ where: { role: MANAGED_ROLE, desa_id: desaId, is_active: true } }),
      ]);

      let kecamatan = null;
      if (desa?.kecamatan_id) {
        kecamatan = await prisma.kecamatans.findUnique({
          where: { id: desa.kecamatan_id },
          select: { id: true, nama: true },
        });
      }

      res.json({
        success: true,
        data: {
          desa: desa
            ? {
                id: String(desa.id),
                nama: desa.nama,
                kode: desa.kode,
                status_pemerintahan: desa.status_pemerintahan,
                kecamatan: kecamatan ? { id: String(kecamatan.id), nama: kecamatan.nama } : null,
              }
            : null,
          total_akun: total,
          akun_aktif: aktif,
        },
      });
    } catch (error) {
      logger.error('Gagal memuat info desa untuk Admin Desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat informasi desa' });
    }
  }

  /** Daftar akun operasional di desa Admin Desa yang login. */
  async getUsers(req, res) {
    try {
      const desaId = getScopeDesaId(req);
      if (desaId === null) {
        return badRequest(res, 'Akun Admin Desa belum terhubung dengan data desa');
      }

      const { search } = req.query;
      const where = { role: MANAGED_ROLE, desa_id: desaId };
      if (search) {
        where.OR = [
          { name: { contains: String(search) } },
          { email: { contains: String(search) } },
          { jabatan_desa: { contains: String(search) } },
        ];
      }

      const users = await prisma.users.findMany({
        where,
        select: USER_SELECT,
        orderBy: { created_at: 'desc' },
      });

      res.json({ success: true, data: users.map(serializeUser) });
    } catch (error) {
      logger.error('Gagal memuat daftar akun desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat daftar akun' });
    }
  }

  async getUserById(req, res) {
    try {
      const desaId = getScopeDesaId(req);
      if (desaId === null) {
        return badRequest(res, 'Akun Admin Desa belum terhubung dengan data desa');
      }

      const user = await findManagedUser(req.params.id, desaId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'Akun tidak ditemukan di desa Anda' });
      }

      res.json({ success: true, data: serializeUser(user) });
    } catch (error) {
      logger.error('Gagal memuat akun desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat akun' });
    }
  }

  /** Buat akun operasional baru — role, desa, dan kecamatan dipaksa mengikuti Admin Desa. */
  async createUser(req, res) {
    try {
      const desaId = getScopeDesaId(req);
      if (desaId === null) {
        return badRequest(res, 'Akun Admin Desa belum terhubung dengan data desa');
      }

      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const jabatanDesa = String(req.body.jabatan_desa || '').trim();
      const noHp = normalizePhone(req.body.no_hp);
      const permissions = sanitizePermissionKeys(req.body.permissions);

      if (!name) return badRequest(res, 'Nama wajib diisi');
      if (!email) return badRequest(res, 'Email wajib diisi');
      if (!EMAIL_REGEX.test(email)) return badRequest(res, 'Format email tidak valid');
      if (password.length < MIN_PASSWORD_LENGTH) {
        return badRequest(res, `Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
      }

      const existing = await prisma.users.findUnique({ where: { email }, select: { id: true } });
      if (existing) return badRequest(res, 'Email sudah digunakan akun lain');

      const hashedPassword = await bcrypt.hash(password, 10);
      const adminId = BigInt(String(req.user.id));

      const created = await prisma.users.create({
        data: {
          name,
          email,
          password: hashedPassword,
          plain_password: password,
          role: MANAGED_ROLE,
          desa_id: desaId,
          kecamatan_id: req.user.kecamatan_id ? parseInt(req.user.kecamatan_id, 10) : null,
          jabatan_desa: jabatanDesa || null,
          no_hp: noHp,
          is_active: req.body.is_active === undefined ? true : Boolean(req.body.is_active),
          created_at: new Date(),
          updated_at: new Date(),
          desa_user_permissions: {
            create: permissions.map((key) => ({ permission_key: key, created_by: adminId })),
          },
        },
        select: USER_SELECT,
      });

      logger.info(`✅ Admin Desa ${req.user.email} membuat akun ${email} (${permissions.length} hak akses)`);
      logDesaAdminAction(req, {
        action: 'create',
        target: created,
        description: `${req.user.name} membuat akun desa "${name}" (${email})${jabatanDesa ? ` — bagian ${jabatanDesa}` : ''} dengan hak akses: ${permissions.join(', ') || 'tidak ada'}`,
        newValue: { name, email, jabatan_desa: jabatanDesa || null, no_hp: noHp, is_active: created.is_active, permissions },
      });

      res.status(201).json({
        success: true,
        message: 'Akun berhasil dibuat',
        data: serializeUser(created),
      });
    } catch (error) {
      logger.error('Gagal membuat akun desa:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat akun', error: error.message });
    }
  }

  /** Ubah data akun. Password & hak akses opsional; role/desa tidak pernah bisa diubah. */
  async updateUser(req, res) {
    try {
      const desaId = getScopeDesaId(req);
      if (desaId === null) {
        return badRequest(res, 'Akun Admin Desa belum terhubung dengan data desa');
      }

      const target = await findManagedUser(req.params.id, desaId);
      if (!target) {
        return res.status(404).json({ success: false, message: 'Akun tidak ditemukan di desa Anda' });
      }

      const data = { updated_at: new Date() };

      if (req.body.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) return badRequest(res, 'Nama tidak boleh kosong');
        data.name = name;
      }

      if (req.body.email !== undefined) {
        const email = String(req.body.email).trim().toLowerCase();
        if (!EMAIL_REGEX.test(email)) return badRequest(res, 'Format email tidak valid');
        if (email !== target.email) {
          const existing = await prisma.users.findUnique({ where: { email }, select: { id: true } });
          if (existing) return badRequest(res, 'Email sudah digunakan akun lain');
          data.email = email;
        }
      }

      if (req.body.jabatan_desa !== undefined) {
        const jabatan = String(req.body.jabatan_desa).trim();
        data.jabatan_desa = jabatan || null;
      }

      if (req.body.no_hp !== undefined) {
        const raw = String(req.body.no_hp).trim();
        if (!raw) {
          data.no_hp = null;
        } else {
          const phone = normalizePhone(raw);
          if (!phone) return badRequest(res, 'Nomor HP tidak valid. Contoh: 081234567890');
          data.no_hp = phone;
        }
      }

      if (req.body.is_active !== undefined) {
        data.is_active = Boolean(req.body.is_active);
      }

      if (req.body.password) {
        const password = String(req.body.password);
        if (password.length < MIN_PASSWORD_LENGTH) {
          return badRequest(res, `Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
        }
        data.password = await bcrypt.hash(password, 10);
        data.plain_password = password;
      }

      const permissionsGiven = req.body.permissions !== undefined;
      const permissions = permissionsGiven ? sanitizePermissionKeys(req.body.permissions) : [];
      const adminId = BigInt(String(req.user.id));

      const updated = await prisma.$transaction(async (tx) => {
        await tx.users.update({ where: { id: target.id }, data });

        if (permissionsGiven) {
          await tx.desa_user_permissions.deleteMany({ where: { user_id: target.id } });
          if (permissions.length > 0) {
            await tx.desa_user_permissions.createMany({
              data: permissions.map((key) => ({
                user_id: target.id,
                permission_key: key,
                created_by: adminId,
              })),
            });
          }
        }

        return tx.users.findUnique({ where: { id: target.id }, select: USER_SELECT });
      });

      invalidateDesaPermissions(target.id);
      logger.info(`✅ Admin Desa ${req.user.email} memperbarui akun ${target.email}`);

      const changes = [];
      if (data.name) changes.push('nama');
      if (data.email) changes.push('email');
      if (data.jabatan_desa !== undefined) changes.push('bagian');
      if (data.no_hp !== undefined) changes.push('nomor HP');
      if (data.is_active !== undefined) changes.push('status aktif');
      if (data.password) changes.push('password');
      if (permissionsGiven) changes.push('hak akses');

      logDesaAdminAction(req, {
        action: 'update',
        target,
        description: `${req.user.name} mengubah akun desa "${target.name}" (${target.email}) — ${changes.join(', ') || 'tanpa perubahan'}`,
        // Password sengaja tidak pernah masuk log, cukup dicatat bahwa ia diganti.
        oldValue: {
          name: target.name,
          email: target.email,
          jabatan_desa: target.jabatan_desa,
          no_hp: target.no_hp,
          is_active: target.is_active,
          permissions: (target.desa_user_permissions || []).map((p) => p.permission_key),
        },
        newValue: {
          name: updated.name,
          email: updated.email,
          jabatan_desa: updated.jabatan_desa,
          no_hp: updated.no_hp,
          is_active: updated.is_active,
          permissions: (updated.desa_user_permissions || []).map((p) => p.permission_key),
          password_changed: Boolean(data.password),
        },
      });

      res.json({ success: true, message: 'Akun berhasil diperbarui', data: serializeUser(updated) });
    } catch (error) {
      logger.error('Gagal memperbarui akun desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui akun', error: error.message });
    }
  }

  /** Ubah hak akses saja (dipakai tombol cepat di tabel). */
  async updatePermissions(req, res) {
    try {
      const desaId = getScopeDesaId(req);
      if (desaId === null) {
        return badRequest(res, 'Akun Admin Desa belum terhubung dengan data desa');
      }

      const target = await findManagedUser(req.params.id, desaId);
      if (!target) {
        return res.status(404).json({ success: false, message: 'Akun tidak ditemukan di desa Anda' });
      }

      const permissions = sanitizePermissionKeys(req.body.permissions);
      const adminId = BigInt(String(req.user.id));

      await prisma.$transaction(async (tx) => {
        await tx.desa_user_permissions.deleteMany({ where: { user_id: target.id } });
        if (permissions.length > 0) {
          await tx.desa_user_permissions.createMany({
            data: permissions.map((key) => ({
              user_id: target.id,
              permission_key: key,
              created_by: adminId,
            })),
          });
        }
      });

      invalidateDesaPermissions(target.id);
      logger.info(`✅ Admin Desa ${req.user.email} mengubah hak akses ${target.email} → [${permissions.join(', ')}]`);

      const before = (target.desa_user_permissions || []).map((p) => p.permission_key);
      logDesaAdminAction(req, {
        action: 'update',
        target,
        description: `${req.user.name} mengubah hak akses "${target.name}" (${target.email}) dari [${before.join(', ') || 'kosong'}] menjadi [${permissions.join(', ') || 'kosong'}]`,
        oldValue: { permissions: before },
        newValue: { permissions },
      });

      res.json({ success: true, message: 'Hak akses berhasil diperbarui', data: { permissions } });
    } catch (error) {
      logger.error('Gagal memperbarui hak akses desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui hak akses', error: error.message });
    }
  }

  async deleteUser(req, res) {
    try {
      const desaId = getScopeDesaId(req);
      if (desaId === null) {
        return badRequest(res, 'Akun Admin Desa belum terhubung dengan data desa');
      }

      const target = await findManagedUser(req.params.id, desaId);
      if (!target) {
        return res.status(404).json({ success: false, message: 'Akun tidak ditemukan di desa Anda' });
      }

      await prisma.users.delete({ where: { id: target.id } });
      invalidateDesaPermissions(target.id);
      logger.info(`🗑️ Admin Desa ${req.user.email} menghapus akun ${target.email}`);

      logDesaAdminAction(req, {
        action: 'delete',
        target,
        description: `${req.user.name} menghapus akun desa "${target.name}" (${target.email})`,
        oldValue: {
          name: target.name,
          email: target.email,
          jabatan_desa: target.jabatan_desa,
          permissions: (target.desa_user_permissions || []).map((p) => p.permission_key),
        },
      });

      res.json({ success: true, message: 'Akun berhasil dihapus' });
    } catch (error) {
      // FK dari modul lain (mis. proposal yang pernah dibuat akun ini) menahan penghapusan.
      if (error.code === 'P2003') {
        return res.status(409).json({
          success: false,
          message: 'Akun tidak bisa dihapus karena masih terhubung dengan data lain. Nonaktifkan akun saja.',
        });
      }
      logger.error('Gagal menghapus akun desa:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus akun', error: error.message });
    }
  }
}

module.exports = new DesaAdminController();
