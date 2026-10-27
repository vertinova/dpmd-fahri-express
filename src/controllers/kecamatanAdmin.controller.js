/**
 * Akun Operator Kecamatan — dikelola oleh akun UTAMA kecamatan.
 *
 * Satu kecamatan tetap punya satu akun utama (dibuat superadmin, dipantau
 * bidang). Akun utama itu membuat akun operator untuk petugasnya sendiri dan
 * menentukan fitur apa yang boleh dibuka tiap operator, supaya:
 *   - setiap verifikasi tercatat atas nama petugas yang melakukannya, dan
 *   - sandi akun utama tidak perlu dibagikan ke semua petugas.
 *
 * Operator tetap ber-role `kecamatan` dengan kecamatan_id yang sama, ditandai
 * `operator_kecamatan = 1`. Semua endpoint di sini dikunci ke kecamatan_id akun
 * yang login, dan hanya bisa dipakai akun utama (requireKecamatanUtama).
 */

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const {
  BATAS_OPERATOR_KECAMATAN: BATAS_OPERATOR,
  KECAMATAN_PERMISSIONS,
  sanitizeKecamatanPermissionKeys,
} = require('../config/kecamatanPermissions');
const { normalizePhone } = require('../config/desaProfile');
const { invalidateKecamatanAkses } = require('../middlewares/kecamatanPermission');
const ActivityLogger = require('../utils/activityLogger');

const LOG_MODULE = 'manajemen_akun_kecamatan';
const ROLE_KECAMATAN = 'kecamatan';
const MIN_PASSWORD_LENGTH = 6;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const badRequest = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res) => res.status(404).json({ success: false, message: 'Akun operator tidak ditemukan di kecamatan Anda' });

const logAksi = (req, { action, target, description, oldValue = null, newValue = null }) => {
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

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  jabatan_desa: true,
  no_hp: true,
  kecamatan_id: true,
  operator_kecamatan: true,
  is_active: true,
  last_active_at: true,
  created_at: true,
  updated_at: true,
  kecamatan_user_permissions: { select: { permission_key: true } },
};

// `jabatan_desa` dipakai ulang sebagai "bagian/seksi" operator kecamatan —
// kolomnya generik (VARCHAR 100), hanya namanya yang berasal dari fitur desa.
const serializeUser = (u) => ({
  id: String(u.id),
  name: u.name,
  email: u.email,
  jabatan: u.jabatan_desa || null,
  no_hp: u.no_hp || null,
  is_active: u.is_active,
  last_active_at: u.last_active_at || null,
  created_at: u.created_at,
  updated_at: u.updated_at,
  permissions: (u.kecamatan_user_permissions || []).map((p) => p.permission_key),
});

const getScopeKecamatanId = (req) => {
  const id = parseInt(req.user?.kecamatan_id, 10);
  return Number.isNaN(id) ? null : id;
};

/** Operator milik kecamatan yang login, atau null (404 disamakan supaya tidak membocorkan akun lain). */
const findOperator = async (id, kecamatanId) => {
  let userId;
  try {
    userId = BigInt(String(id));
  } catch {
    return null;
  }
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { ...USER_SELECT, role: true } });
  if (!user || user.role !== ROLE_KECAMATAN || !user.operator_kecamatan) return null;
  if (user.kecamatan_id !== kecamatanId) return null;
  return user;
};

const izinDari = (u) => (u.kecamatan_user_permissions || []).map((p) => p.permission_key);

class KecamatanAdminController {
  /** Katalog fitur + identitas kecamatan, untuk kepala halaman Akun Operator. */
  async getMeta(req, res) {
    try {
      const kecamatanId = getScopeKecamatanId(req);
      if (kecamatanId === null) return badRequest(res, 'Akun ini belum terhubung dengan kecamatan');

      const [kecamatan, total, aktif] = await Promise.all([
        prisma.kecamatans.findUnique({ where: { id: BigInt(kecamatanId) }, select: { id: true, nama: true } }),
        prisma.users.count({ where: { role: ROLE_KECAMATAN, operator_kecamatan: true, kecamatan_id: kecamatanId } }),
        prisma.users.count({
          where: { role: ROLE_KECAMATAN, operator_kecamatan: true, kecamatan_id: kecamatanId, is_active: true },
        }),
      ]);

      res.json({
        success: true,
        data: {
          kecamatan: kecamatan ? { id: String(kecamatan.id), nama: kecamatan.nama } : null,
          catalog: KECAMATAN_PERMISSIONS,
          total_operator: total,
          operator_aktif: aktif,
          batas_operator: BATAS_OPERATOR,
        },
      });
    } catch (error) {
      logger.error('Gagal memuat meta akun operator kecamatan:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat data awal' });
    }
  }

  async getUsers(req, res) {
    try {
      const kecamatanId = getScopeKecamatanId(req);
      if (kecamatanId === null) return badRequest(res, 'Akun ini belum terhubung dengan kecamatan');

      const users = await prisma.users.findMany({
        where: { role: ROLE_KECAMATAN, operator_kecamatan: true, kecamatan_id: kecamatanId },
        select: USER_SELECT,
        orderBy: { created_at: 'desc' },
      });
      res.json({ success: true, data: users.map(serializeUser) });
    } catch (error) {
      logger.error('Gagal memuat akun operator kecamatan:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat daftar akun operator' });
    }
  }

  async createUser(req, res) {
    try {
      const kecamatanId = getScopeKecamatanId(req);
      if (kecamatanId === null) return badRequest(res, 'Akun ini belum terhubung dengan kecamatan');

      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const jabatan = String(req.body.jabatan || '').trim();
      const noHpMentah = String(req.body.no_hp || '').trim();
      const noHp = noHpMentah ? normalizePhone(noHpMentah) : null;
      const permissions = sanitizeKecamatanPermissionKeys(req.body.permissions);

      if (!name) return badRequest(res, 'Nama wajib diisi');
      if (!email) return badRequest(res, 'Email wajib diisi');
      if (!EMAIL_REGEX.test(email)) return badRequest(res, 'Format email tidak valid');
      if (password.length < MIN_PASSWORD_LENGTH) return badRequest(res, `Sandi minimal ${MIN_PASSWORD_LENGTH} karakter`);
      if (noHpMentah && !noHp) return badRequest(res, 'Nomor HP tidak valid. Contoh: 081234567890');
      if (permissions.length === 0) return badRequest(res, 'Pilih minimal satu fitur untuk operator ini');

      const jumlah = await prisma.users.count({
        where: { role: ROLE_KECAMATAN, operator_kecamatan: true, kecamatan_id: kecamatanId },
      });
      if (jumlah >= BATAS_OPERATOR) {
        return badRequest(res, `Batas ${BATAS_OPERATOR} akun operator per kecamatan sudah tercapai. Nonaktifkan atau hapus yang tidak dipakai.`);
      }

      const existing = await prisma.users.findUnique({ where: { email }, select: { id: true } });
      if (existing) return badRequest(res, 'Email sudah digunakan akun lain');

      const pembuatId = BigInt(String(req.user.id));
      const created = await prisma.users.create({
        data: {
          name,
          email,
          password: await bcrypt.hash(password, 10),
          plain_password: password,
          role: ROLE_KECAMATAN,
          kecamatan_id: kecamatanId,
          operator_kecamatan: true,
          jabatan_desa: jabatan || null,
          no_hp: noHp,
          is_active: req.body.is_active === undefined ? true : Boolean(req.body.is_active),
          created_at: new Date(),
          updated_at: new Date(),
          kecamatan_user_permissions: {
            create: permissions.map((key) => ({ permission_key: key, created_by: pembuatId })),
          },
        },
        select: USER_SELECT,
      });

      logAksi(req, {
        action: 'create',
        target: created,
        description: `${req.user.name} membuat akun operator kecamatan "${name}" (${email})${jabatan ? ` — ${jabatan}` : ''} dengan hak akses: ${permissions.join(', ')}`,
        newValue: { name, email, jabatan: jabatan || null, no_hp: noHp, is_active: created.is_active, permissions },
      });

      res.status(201).json({ success: true, message: 'Akun operator berhasil dibuat', data: serializeUser(created) });
    } catch (error) {
      logger.error('Gagal membuat akun operator kecamatan:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat akun operator' });
    }
  }

  /** Ubah akun. Sandi & hak akses opsional; role dan kecamatan tidak pernah bisa diubah. */
  async updateUser(req, res) {
    try {
      const kecamatanId = getScopeKecamatanId(req);
      if (kecamatanId === null) return badRequest(res, 'Akun ini belum terhubung dengan kecamatan');

      const target = await findOperator(req.params.id, kecamatanId);
      if (!target) return notFound(res);

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

      if (req.body.jabatan !== undefined) {
        data.jabatan_desa = String(req.body.jabatan).trim() || null;
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

      if (req.body.is_active !== undefined) data.is_active = Boolean(req.body.is_active);

      if (req.body.password) {
        const password = String(req.body.password);
        if (password.length < MIN_PASSWORD_LENGTH) return badRequest(res, `Sandi minimal ${MIN_PASSWORD_LENGTH} karakter`);
        data.password = await bcrypt.hash(password, 10);
        data.plain_password = password;
      }

      const permissionsGiven = req.body.permissions !== undefined;
      const permissions = permissionsGiven ? sanitizeKecamatanPermissionKeys(req.body.permissions) : [];
      if (permissionsGiven && permissions.length === 0) {
        return badRequest(res, 'Pilih minimal satu fitur. Untuk menutup akses, nonaktifkan akunnya.');
      }
      const pembuatId = BigInt(String(req.user.id));

      const updated = await prisma.$transaction(async (tx) => {
        await tx.users.update({ where: { id: target.id }, data });
        if (permissionsGiven) {
          await tx.kecamatan_user_permissions.deleteMany({ where: { user_id: target.id } });
          await tx.kecamatan_user_permissions.createMany({
            data: permissions.map((key) => ({ user_id: target.id, permission_key: key, created_by: pembuatId })),
          });
        }
        return tx.users.findUnique({ where: { id: target.id }, select: USER_SELECT });
      });

      invalidateKecamatanAkses(target.id);

      const perubahan = [];
      if (data.name) perubahan.push('nama');
      if (data.email) perubahan.push('email');
      if (data.jabatan_desa !== undefined) perubahan.push('bagian');
      if (data.no_hp !== undefined) perubahan.push('nomor HP');
      if (data.is_active !== undefined) perubahan.push('status aktif');
      if (data.password) perubahan.push('sandi');
      if (permissionsGiven) perubahan.push('hak akses');

      logAksi(req, {
        action: 'update',
        target,
        description: `${req.user.name} mengubah akun operator kecamatan "${target.name}" (${target.email}) — ${perubahan.join(', ') || 'tanpa perubahan'}`,
        // Sandi sengaja tidak pernah masuk log, cukup dicatat bahwa ia diganti.
        oldValue: {
          name: target.name,
          email: target.email,
          jabatan: target.jabatan_desa,
          no_hp: target.no_hp,
          is_active: target.is_active,
          permissions: izinDari(target),
        },
        newValue: {
          name: updated.name,
          email: updated.email,
          jabatan: updated.jabatan_desa,
          no_hp: updated.no_hp,
          is_active: updated.is_active,
          permissions: izinDari(updated),
          password_changed: Boolean(data.password),
        },
      });

      res.json({ success: true, message: 'Akun operator berhasil diperbarui', data: serializeUser(updated) });
    } catch (error) {
      logger.error('Gagal memperbarui akun operator kecamatan:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui akun operator' });
    }
  }

  async deleteUser(req, res) {
    try {
      const kecamatanId = getScopeKecamatanId(req);
      if (kecamatanId === null) return badRequest(res, 'Akun ini belum terhubung dengan kecamatan');

      const target = await findOperator(req.params.id, kecamatanId);
      if (!target) return notFound(res);

      await prisma.users.delete({ where: { id: target.id } });
      invalidateKecamatanAkses(target.id);

      logAksi(req, {
        action: 'delete',
        target,
        description: `${req.user.name} menghapus akun operator kecamatan "${target.name}" (${target.email})`,
        oldValue: { name: target.name, email: target.email, jabatan: target.jabatan_desa, permissions: izinDari(target) },
      });

      res.json({ success: true, message: 'Akun operator berhasil dihapus' });
    } catch (error) {
      // Operator yang sudah pernah memverifikasi meninggalkan jejak di tabel lain.
      if (error.code === 'P2003') {
        return res.status(409).json({
          success: false,
          message: 'Akun ini sudah pernah dipakai bekerja dan masih terhubung dengan data lain. Nonaktifkan saja.',
        });
      }
      logger.error('Gagal menghapus akun operator kecamatan:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus akun operator' });
    }
  }
}

module.exports = new KecamatanAdminController();
