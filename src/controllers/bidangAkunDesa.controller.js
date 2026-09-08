/**
 * Pembuatan akun operasional desa oleh staf bidang DPMD.
 *
 * Bedanya dengan desaAdmin.controller.js — yang dipakai Admin Desa — ada dua:
 *
 *   1. Cakupan wilayah TERBUKA. Admin Desa terkunci ke desa_id-nya sendiri;
 *      staf bidang memilih desa mana pun se-kabupaten lewat dropdown.
 *   2. Cakupan fitur TERKUNCI. Admin Desa boleh mencentang seluruh katalog;
 *      staf bidang hanya boleh menyentuh fitur milik bidangnya (lihat
 *      config/bidangDesaPermissions.js).
 *
 * Konsekuensi dari (2): penyimpanan hak akses TIDAK boleh "hapus semua lalu
 * tulis ulang". Satu akun desa bisa memegang fitur lintas bidang, dan staf
 * bidang tidak pernah melihat fitur di luar wewenangnya — menghapusnya berarti
 * mencabut akses yang bahkan tidak muncul di layarnya. Semua penulisan di sini
 * lewat mergePermissions().
 */

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const {
  getAllowedPermissionKeys,
  getCorePermissionKeys,
  getPermissionCatalog,
  mergePermissions,
} = require('../config/bidangDesaPermissions');
const { DESA_PERMISSIONS } = require('../config/desaPermissions');
const { normalizePhone } = require('../config/desaProfile');
const { invalidateDesaPermissions } = require('../middlewares/desaPermission');
const ActivityLogger = require('../utils/activityLogger');

const LOG_MODULE = 'manajemen_akun_desa';

// Akun yang dibuat di sini selalu akun operasional desa — bukan admin_desa.
// Staf bidang membuatkan petugas, bukan menunjuk pengelola akun desa.
const MANAGED_ROLE = 'desa';
const MIN_PASSWORD_LENGTH = 6;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const badRequest = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res, message) => res.status(404).json({ success: false, message });

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  jabatan_desa: true,
  no_hp: true,
  desa_id: true,
  kecamatan_id: true,
  is_active: true,
  last_active_at: true,
  created_at: true,
  updated_at: true,
  desa_user_permissions: { select: { permission_key: true } },
};

/**
 * Ambil identitas desa untuk sekumpulan akun.
 *
 * `users.desa_id` di skema hanya kolom biasa — TIDAK ada relasi Prisma ke
 * `desas` (lihat model users di schema.prisma; yang punya relasi hanya
 * pegawai dan desa_user_permissions). Jadi nama desa tidak bisa ikut lewat
 * `select`, dan harus diambil dalam satu query terpisah lalu disambungkan.
 * Satu query untuk semua akun, bukan per akun, supaya daftar tidak jadi N+1.
 */
const muatPetaDesa = async (users) => {
  const ids = [
    ...new Set(
      users
        .map((u) => u.desa_id)
        .filter((id) => id !== null && id !== undefined)
        .map((id) => String(id)),
    ),
  ];
  if (ids.length === 0) return new Map();

  const desas = await prisma.desas.findMany({
    where: { id: { in: ids.map((id) => BigInt(id)) } },
    select: {
      id: true,
      nama: true,
      status_pemerintahan: true,
      kecamatans: { select: { id: true, nama: true } },
    },
  });

  return new Map(
    desas.map((d) => [
      String(d.id),
      {
        id: String(d.id),
        nama: d.nama,
        status_pemerintahan: d.status_pemerintahan,
        kecamatan: d.kecamatans ? { id: String(d.kecamatans.id), nama: d.kecamatans.nama } : null,
      },
    ]),
  );
};

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

/**
 * Bentuk akun untuk frontend.
 *
 * `permissions` adalah SELURUH hak akses akun itu, termasuk milik bidang lain —
 * staf perlu melihatnya supaya paham akun ini sudah dipakai untuk apa. Sedangkan
 * `permissions_dikelola` adalah bagian yang boleh ia ubah; sisanya dirender
 * sebagai keterangan yang tidak bisa dicentang.
 */
const serializeUser = (user, allowedKeys, petaDesa = new Map()) => {
  const semua = (user.desa_user_permissions || []).map((p) => p.permission_key);
  const desaId = user.desa_id === null || user.desa_id === undefined ? null : String(user.desa_id);
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    jabatan_desa: user.jabatan_desa || null,
    no_hp: user.no_hp || null,
    desa_id: desaId,
    desa: desaId ? petaDesa.get(desaId) || null : null,
    is_active: user.is_active,
    last_active_at: user.last_active_at || null,
    created_at: user.created_at,
    updated_at: user.updated_at,
    permissions: semua,
    permissions_dikelola: semua.filter((key) => allowedKeys.includes(key)),
    permissions_bidang_lain: semua.filter((key) => !allowedKeys.includes(key)),
  };
};

/** Ambil akun target dan pastikan ia benar-benar akun operasional desa. */
const findAkunDesa = async (id) => {
  let userId;
  try {
    userId = BigInt(String(id));
  } catch {
    return null;
  }
  const user = await prisma.users.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user || user.role !== MANAGED_ROLE) return null;
  return user;
};

const parseBigId = (nilai) => {
  try {
    const id = BigInt(String(nilai));
    return id > 0n ? id : null;
  } catch {
    return null;
  }
};

class BidangAkunDesaController {
  /** Katalog hak akses + identitas bidang staf yang login. Dipanggil sekali saat halaman dibuka. */
  async getMeta(req, res) {
    try {
      const allowed = getAllowedPermissionKeys(req.user);
      const catalog = getPermissionCatalog(req.user);

      let bidang = null;
      if (req.user.bidang_id) {
        // bidangs.id bertipe BigInt di skema, jadi jangan dikirim sebagai Number.
        const baris = await prisma.bidangs
          .findUnique({
            where: { id: BigInt(String(req.user.bidang_id)) },
            select: { id: true, nama: true },
          })
          .catch(() => null);
        if (baris) bidang = { id: String(baris.id), nama: baris.nama };
      }

      const totalDikelola = await prisma.users.count({
        where: {
          role: MANAGED_ROLE,
          desa_user_permissions: { some: { permission_key: { in: allowed } } },
        },
      });

      res.json({
        success: true,
        data: {
          bidang,
          catalog,
          allowed_keys: allowed,
          // Dikirim supaya frontend bisa memberi nama pada hak akses bidang lain
          // yang ia tampilkan sebagai keterangan terkunci.
          catalog_lengkap: DESA_PERMISSIONS,
          total_akun_dikelola: totalDikelola,
        },
      });
    } catch (error) {
      logger.error('Gagal memuat meta akun desa bidang:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat data awal' });
    }
  }

  /**
   * Potret satu desa SEBELUM staf membuat akun — pencegah akun ganda.
   *
   * Admin Desa dan staf bidang membuat akun lewat pintu yang berbeda
   * (/api/desa-admin dan /api/bidang/akun-desa) ke tabel `users` yang sama.
   * Tanpa langkah ini, staf PMD tidak punya cara tahu bahwa desa itu sudah
   * menunjuk operator kelembagaan sendiri, lalu membuat akun kedua untuk
   * pekerjaan yang persis sama.
   *
   * Jawabannya dipecah jadi tiga supaya frontend bisa menawarkan jalan keluar
   * yang benar, bukan sekadar melarang:
   *
   *   sudah_pegang  → sudah ada operatornya. Jangan buat lagi; ubah yang ada.
   *   bisa_diberi   → akun desa lain yang sudah aktif tapi belum punya fitur
   *                   bidang ini. Ini jalan keluar terbaik: cukup TAMBAHKAN
   *                   hak aksesnya, tidak perlu akun (dan sandi) baru.
   *   admin_desa    → siapa yang berwenang di desa itu, supaya staf bisa
   *                   menghubunginya alih-alih mengambil alih pekerjaannya.
   */
  async getRingkasanDesa(req, res) {
    try {
      const allowed = getAllowedPermissionKeys(req.user);
      const core = getCorePermissionKeys(req.user);

      const desaId = parseBigId(req.params.desaId);
      if (!desaId) return badRequest(res, 'Desa tidak valid');

      const desa = await prisma.desas.findUnique({
        where: { id: desaId },
        select: {
          id: true,
          nama: true,
          status_pemerintahan: true,
          kecamatans: { select: { id: true, nama: true } },
        },
      });
      if (!desa) return notFound(res, 'Desa tidak ditemukan');

      // Satu query untuk seluruh akun desa itu — operasional maupun pengelolanya.
      const semuaAkun = await prisma.users.findMany({
        where: { desa_id: desaId, role: { in: [MANAGED_ROLE, 'admin_desa'] } },
        select: USER_SELECT,
        orderBy: { name: 'asc' },
      });

      const petaDesa = await muatPetaDesa(semuaAkun);

      const adminDesa = semuaAkun
        .filter((u) => u.role === 'admin_desa')
        .map((u) => ({
          id: String(u.id),
          name: u.name,
          email: u.email,
          no_hp: u.no_hp || null,
          is_active: u.is_active,
        }));

      const operator = semuaAkun
        .filter((u) => u.role === MANAGED_ROLE)
        .map((u) => serializeUser(u, allowed, petaDesa));

      // "Sudah pegang" diukur dari fitur INTI bidang, bukan dari siapa yang
      // membuat akunnya — akun bikinan Admin Desa dan bikinan staf bidang sama
      // sahnya, yang penting fiturnya sudah ada yang memegang.
      const sudahPegang = operator.filter((u) => u.permissions.some((k) => core.includes(k)));
      const bisaDiberi = operator.filter((u) => !u.permissions.some((k) => core.includes(k)));

      res.json({
        success: true,
        data: {
          desa: {
            id: String(desa.id),
            nama: desa.nama,
            status_pemerintahan: desa.status_pemerintahan,
            kecamatan: desa.kecamatans
              ? { id: String(desa.kecamatans.id), nama: desa.kecamatans.nama }
              : null,
          },
          fitur_inti: core,
          admin_desa: adminDesa,
          sudah_pegang: sudahPegang,
          bisa_diberi: bisaDiberi,
          // Akun nonaktif tidak dihitung: akses yang dimatikan bukan akses.
          // Kalau semua yang memegang fitur ini nonaktif, staf memang perlu
          // membuat atau mengaktifkan kembali.
          perlu_akun_baru: sudahPegang.filter((u) => u.is_active).length === 0,
        },
      });
    } catch (error) {
      logger.error('Gagal memuat ringkasan desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat kondisi akun desa ini' });
    }
  }

  /**
   * Daftar akun operasional desa.
   *
   * Tanpa filter, yang tampil hanya akun yang MEMEGANG fitur bidang ini — kalau
   * tidak, staf PMD disuguhi ribuan akun bankeu yang bukan urusannya. Saat satu
   * desa dipilih, seluruh akun desa itu ditampilkan supaya staf tahu email apa
   * saja yang sudah terpakai sebelum membuat yang baru.
   */
  async getUsers(req, res) {
    try {
      const allowed = getAllowedPermissionKeys(req.user);
      const desaId = req.query.desa_id ? parseBigId(req.query.desa_id) : null;
      const kecamatanId = req.query.kecamatan_id ? parseBigId(req.query.kecamatan_id) : null;
      const q = String(req.query.q || '').trim();

      const where = { role: MANAGED_ROLE };

      // Tanpa relasi Prisma ke `desas`, penyaringan per kecamatan dan pencarian
      // nama desa harus lewat daftar desa_id yang dikumpulkan lebih dulu.
      if (desaId) {
        where.desa_id = desaId;
      } else if (kecamatanId) {
        const desaSeKecamatan = await prisma.desas.findMany({
          where: { kecamatan_id: kecamatanId },
          select: { id: true },
        });
        where.desa_id = { in: desaSeKecamatan.map((d) => d.id) };
      } else if (!q) {
        where.desa_user_permissions = { some: { permission_key: { in: allowed } } };
      }

      if (q) {
        const desaCocok = await prisma.desas.findMany({
          where: { nama: { contains: q } },
          select: { id: true },
        });
        where.OR = [
          { name: { contains: q } },
          { email: { contains: q } },
          ...(desaCocok.length > 0 ? [{ desa_id: { in: desaCocok.map((d) => d.id) } }] : []),
        ];
      }

      const users = await prisma.users.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ desa_id: 'asc' }, { name: 'asc' }],
        take: 300,
      });

      const petaDesa = await muatPetaDesa(users);
      res.json({ success: true, data: users.map((u) => serializeUser(u, allowed, petaDesa)) });
    } catch (error) {
      logger.error('Gagal memuat daftar akun desa:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat daftar akun' });
    }
  }

  /** Buat akun operasional desa baru untuk desa pilihan staf. */
  async createUser(req, res) {
    try {
      const allowed = getAllowedPermissionKeys(req.user);

      const desaId = parseBigId(req.body.desa_id);
      if (!desaId) return badRequest(res, 'Desa wajib dipilih');

      const desa = await prisma.desas.findUnique({
        where: { id: desaId },
        select: { id: true, nama: true, kecamatan_id: true, kecamatans: { select: { nama: true } } },
      });
      if (!desa) return badRequest(res, 'Desa tidak ditemukan');

      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const jabatanDesa = String(req.body.jabatan_desa || '').trim();
      const noHp = normalizePhone(req.body.no_hp);

      if (!name) return badRequest(res, 'Nama wajib diisi');
      if (!email) return badRequest(res, 'Email wajib diisi');
      if (!EMAIL_REGEX.test(email)) return badRequest(res, 'Format email tidak valid');
      if (password.length < MIN_PASSWORD_LENGTH) {
        return badRequest(res, `Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
      }

      // Akun baru belum punya hak akses apa pun, jadi merge di sini setara
      // dengan penyaringan biasa — tetap lewat fungsi yang sama agar aturannya
      // hanya hidup di satu tempat.
      const permissions = mergePermissions([], req.body.permissions, req.user);
      if (permissions.length === 0) {
        return badRequest(res, 'Pilih minimal satu hak akses fitur untuk akun ini');
      }

      const existing = await prisma.users.findUnique({ where: { email }, select: { id: true } });
      if (existing) return badRequest(res, 'Email sudah digunakan akun lain');

      /**
       * Penjaga akun ganda.
       *
       * Halaman sudah menampilkan kondisi desa sebelum tombol buat ditekan,
       * tapi peringatan di layar bukan penjaga — permintaan bisa datang dari
       * tab yang dibuka setengah jam lalu, dari dua staf yang bekerja bersamaan,
       * atau langsung ke API. Jadi keadaannya diperiksa ulang di sini, pada saat
       * penulisan, bukan hanya saat halaman dimuat.
       *
       * Ini bukan larangan mati: ada desa yang memang butuh dua petugas untuk
       * satu urusan. Maka jawabannya 409 berisi daftar akun yang sudah ada, dan
       * staf bisa mengulang dengan `tetap_buat: true` setelah melihatnya.
       */
      const core = getCorePermissionKeys(req.user);
      const coreDiberikan = permissions.filter((k) => core.includes(k));

      if (coreDiberikan.length > 0 && req.body.tetap_buat !== true) {
        const pemegang = await prisma.users.findMany({
          where: {
            desa_id: desaId,
            role: MANAGED_ROLE,
            is_active: true,
            desa_user_permissions: { some: { permission_key: { in: coreDiberikan } } },
          },
          select: USER_SELECT,
        });

        if (pemegang.length > 0) {
          const petaDesa = await muatPetaDesa(pemegang);
          logger.info(
            `⚠️ ${req.user.email} dicegah membuat akun ganda di desa ${desa.nama} — sudah ada ${pemegang.length} operator`,
          );
          return res.status(409).json({
            success: false,
            code: 'AKUN_FITUR_SUDAH_ADA',
            message: `Desa ${desa.nama} sudah punya operator aktif untuk fitur ini. Tambahkan hak akses ke akun yang ada, atau lanjutkan bila petugasnya memang perlu lebih dari satu.`,
            data: {
              akun_sudah_ada: pemegang.map((u) => serializeUser(u, allowed, petaDesa)),
            },
          });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const actorId = BigInt(String(req.user.id));

      const created = await prisma.users.create({
        data: {
          name,
          email,
          password: hashedPassword,
          plain_password: password,
          role: MANAGED_ROLE,
          desa_id: desaId,
          kecamatan_id: desa.kecamatan_id ? Number(desa.kecamatan_id) : null,
          jabatan_desa: jabatanDesa || null,
          no_hp: noHp,
          is_active: req.body.is_active === undefined ? true : Boolean(req.body.is_active),
          created_at: new Date(),
          updated_at: new Date(),
          desa_user_permissions: {
            create: permissions.map((key) => ({ permission_key: key, created_by: actorId })),
          },
        },
        select: USER_SELECT,
      });

      logger.info(
        `✅ ${req.user.email} (bidang ${req.user.bidang_id}) membuat akun desa ${email} untuk ${desa.nama}`,
      );
      logAksi(req, {
        action: 'create',
        target: created,
        description: `${req.user.name} (DPMD) membuat akun desa "${name}" (${email}) untuk Desa ${desa.nama}, Kec. ${desa.kecamatans?.nama || '-'} dengan hak akses: ${permissions.join(', ')}`,
        newValue: {
          name,
          email,
          desa: desa.nama,
          jabatan_desa: jabatanDesa || null,
          no_hp: noHp,
          is_active: created.is_active,
          permissions,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Akun berhasil dibuat',
        data: serializeUser(created, allowed, await muatPetaDesa([created])),
      });
    } catch (error) {
      logger.error('Gagal membuat akun desa dari bidang:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat akun', error: error.message });
    }
  }

  /**
   * Ubah akun. Desa dan role tidak pernah bisa dipindah — memindahkan akun ke
   * desa lain akan membawa serta jejak aktivitasnya, jadi lebih benar
   * menonaktifkan yang lama dan membuat yang baru.
   */
  async updateUser(req, res) {
    try {
      const allowed = getAllowedPermissionKeys(req.user);
      const target = await findAkunDesa(req.params.id);
      if (!target) return notFound(res, 'Akun operasional desa tidak ditemukan');

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
        data.jabatan_desa = String(req.body.jabatan_desa).trim() || null;
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
        if (password.length < MIN_PASSWORD_LENGTH) {
          return badRequest(res, `Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
        }
        data.password = await bcrypt.hash(password, 10);
        data.plain_password = password;
      }

      const sebelum = (target.desa_user_permissions || []).map((p) => p.permission_key);
      const permissionsGiven = req.body.permissions !== undefined;
      const sesudah = permissionsGiven
        ? mergePermissions(sebelum, req.body.permissions, req.user)
        : sebelum;

      const actorId = BigInt(String(req.user.id));

      const updated = await prisma.$transaction(async (tx) => {
        await tx.users.update({ where: { id: target.id }, data });

        if (permissionsGiven) {
          await tx.desa_user_permissions.deleteMany({ where: { user_id: target.id } });
          if (sesudah.length > 0) {
            await tx.desa_user_permissions.createMany({
              data: sesudah.map((key) => ({
                user_id: target.id,
                permission_key: key,
                created_by: actorId,
              })),
            });
          }
        }

        return tx.users.findUnique({ where: { id: target.id }, select: USER_SELECT });
      });

      invalidateDesaPermissions(target.id);

      const perubahan = [];
      if (data.name) perubahan.push('nama');
      if (data.email) perubahan.push('email');
      if (data.jabatan_desa !== undefined) perubahan.push('bagian');
      if (data.no_hp !== undefined) perubahan.push('nomor HP');
      if (data.is_active !== undefined) perubahan.push('status aktif');
      if (data.password) perubahan.push('password');
      if (permissionsGiven) perubahan.push('hak akses');

      logAksi(req, {
        action: 'update',
        target,
        description: `${req.user.name} (DPMD) mengubah akun desa "${target.name}" (${target.email}) — ${perubahan.join(', ') || 'tanpa perubahan'}`,
        // Password tidak pernah masuk log, cukup dicatat bahwa ia diganti.
        oldValue: {
          name: target.name,
          email: target.email,
          jabatan_desa: target.jabatan_desa,
          no_hp: target.no_hp,
          is_active: target.is_active,
          permissions: sebelum,
        },
        newValue: {
          name: updated.name,
          email: updated.email,
          jabatan_desa: updated.jabatan_desa,
          no_hp: updated.no_hp,
          is_active: updated.is_active,
          permissions: sesudah,
          password_changed: Boolean(data.password),
        },
      });

      res.json({
        success: true,
        message: 'Akun berhasil diperbarui',
        data: serializeUser(updated, allowed, await muatPetaDesa([updated])),
      });
    } catch (error) {
      logger.error('Gagal memperbarui akun desa dari bidang:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui akun', error: error.message });
    }
  }

  /** Ubah hak akses saja (tombol cepat di kartu akun). */
  async updatePermissions(req, res) {
    try {
      const allowed = getAllowedPermissionKeys(req.user);
      const target = await findAkunDesa(req.params.id);
      if (!target) return notFound(res, 'Akun operasional desa tidak ditemukan');

      const sebelum = (target.desa_user_permissions || []).map((p) => p.permission_key);
      const sesudah = mergePermissions(sebelum, req.body.permissions, req.user);
      const actorId = BigInt(String(req.user.id));

      await prisma.$transaction(async (tx) => {
        await tx.desa_user_permissions.deleteMany({ where: { user_id: target.id } });
        if (sesudah.length > 0) {
          await tx.desa_user_permissions.createMany({
            data: sesudah.map((key) => ({
              user_id: target.id,
              permission_key: key,
              created_by: actorId,
            })),
          });
        }
      });

      invalidateDesaPermissions(target.id);

      logAksi(req, {
        action: 'update',
        target,
        description: `${req.user.name} (DPMD) mengubah hak akses "${target.name}" (${target.email}) dari [${sebelum.join(', ') || 'kosong'}] menjadi [${sesudah.join(', ') || 'kosong'}]`,
        oldValue: { permissions: sebelum },
        newValue: { permissions: sesudah },
      });

      res.json({
        success: true,
        message: 'Hak akses berhasil diperbarui',
        data: {
          permissions: sesudah,
          permissions_dikelola: sesudah.filter((k) => allowed.includes(k)),
        },
      });
    } catch (error) {
      logger.error('Gagal memperbarui hak akses dari bidang:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui hak akses', error: error.message });
    }
  }

  /**
   * Aktifkan / nonaktifkan akun.
   *
   * Sengaja tidak ada penghapusan akun di sini. Staf bidang tidak selalu tahu
   * akun itu dibuat siapa dan dipakai untuk apa di luar fitur bidangnya, dan
   * menghapus baris users ikut menghapus jejak aktivitas yang menggantung
   * padanya. Menonaktifkan sudah cukup untuk menutup akses, dan bisa dibatalkan.
   */
  async setStatus(req, res) {
    try {
      const allowed = getAllowedPermissionKeys(req.user);
      const target = await findAkunDesa(req.params.id);
      if (!target) return notFound(res, 'Akun operasional desa tidak ditemukan');

      const aktif = Boolean(req.body.is_active);
      const updated = await prisma.users.update({
        where: { id: target.id },
        data: { is_active: aktif, updated_at: new Date() },
        select: USER_SELECT,
      });

      invalidateDesaPermissions(target.id);

      logAksi(req, {
        action: 'update',
        target,
        description: `${req.user.name} (DPMD) ${aktif ? 'mengaktifkan' : 'menonaktifkan'} akun desa "${target.name}" (${target.email})`,
        oldValue: { is_active: target.is_active },
        newValue: { is_active: aktif },
      });

      res.json({
        success: true,
        message: aktif ? 'Akun diaktifkan' : 'Akun dinonaktifkan',
        data: serializeUser(updated, allowed, await muatPetaDesa([updated])),
      });
    } catch (error) {
      logger.error('Gagal mengubah status akun desa:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah status akun' });
    }
  }
}

module.exports = new BidangAkunDesaController();
