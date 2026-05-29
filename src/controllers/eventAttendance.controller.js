const crypto = require('crypto');
const QRCode = require('qrcode');
const sequelize = require('../config/database');
const { getIO } = require('../socket/meeting.socket');

const EVENT_CODE = 'hjb-544-dpmd';
const DEFAULT_SETTINGS = {
  event_code: EVENT_CODE,
  event_name: 'Daftar Hadir Booth DPMD - Hari Jadi Bogor ke-544',
  event_date: '2026-06-03',
  location: 'Booth DPMD Kabupaten Bogor',
  qr_payload: 'DPMD-HJB-544',
  is_active: true,
};

const categories = ['masyarakat', 'ASN', 'pelajar', 'mahasiswa', 'perangkat desa', 'lainnya'];

let initialized = false;

const ensureTables = async () => {
  if (initialized) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS event_attendance_settings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_code VARCHAR(80) NOT NULL UNIQUE,
      event_name VARCHAR(180) NOT NULL,
      event_date DATE NULL,
      location VARCHAR(180) NULL,
      qr_payload VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS event_attendances (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_code VARCHAR(80) NOT NULL,
      full_name VARCHAR(160) NOT NULL,
      origin VARCHAR(180) NOT NULL,
      category VARCHAR(80) NOT NULL,
      custom_category VARCHAR(120) NULL,
      duplicate_hash CHAR(64) NOT NULL,
      scan_payload VARCHAR(255) NULL,
      device_id VARCHAR(120) NULL,
      user_agent TEXT NULL,
      ip_address VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_event_visitor (event_code, duplicate_hash),
      INDEX idx_event_created (event_code, created_at),
      INDEX idx_event_category (event_code, category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [rows] = await sequelize.query(
    'SELECT id FROM event_attendance_settings WHERE event_code = ? LIMIT 1',
    { replacements: [EVENT_CODE] },
  );

  if (!rows.length) {
    await sequelize.query(
      `INSERT INTO event_attendance_settings
        (event_code, event_name, event_date, location, qr_payload, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      {
        replacements: [
          DEFAULT_SETTINGS.event_code,
          DEFAULT_SETTINGS.event_name,
          DEFAULT_SETTINGS.event_date,
          DEFAULT_SETTINGS.location,
          DEFAULT_SETTINGS.qr_payload,
          DEFAULT_SETTINGS.is_active ? 1 : 0,
        ],
      },
    );
  }

  initialized = true;
};

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeKey = (value) => normalize(value).toLowerCase();

const getClientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')?.[0]?.trim() ||
  req.socket?.remoteAddress ||
  req.ip ||
  null;

const getSettingsRow = async () => {
  await ensureTables();
  const [rows] = await sequelize.query(
    `SELECT event_code, event_name, event_date, location, qr_payload, is_active
     FROM event_attendance_settings WHERE event_code = ? LIMIT 1`,
    { replacements: [EVENT_CODE] },
  );

  return rows[0] || DEFAULT_SETTINGS;
};

const formatAttendance = (row) => ({
  id: row.id,
  event_code: row.event_code,
  full_name: row.full_name,
  origin: row.origin,
  category: row.category,
  custom_category: row.custom_category,
  category_label: row.category === 'lainnya' ? row.custom_category : row.category,
  device_id: row.device_id,
  created_at: row.created_at,
});

const getStatsPayload = async () => {
  await ensureTables();
  const today = new Date().toISOString().slice(0, 10);

  const [[totalRow], [todayRow], categoryRows, hourlyRows, latestRows] = await Promise.all([
    sequelize.query(
      'SELECT COUNT(*) AS total FROM event_attendances WHERE event_code = ?',
      { replacements: [EVENT_CODE] },
    ).then(([rows]) => rows),
    sequelize.query(
      'SELECT COUNT(*) AS total FROM event_attendances WHERE event_code = ? AND DATE(created_at) = ?',
      { replacements: [EVENT_CODE, today] },
    ).then(([rows]) => rows),
    sequelize.query(
      `SELECT CASE WHEN category = 'lainnya' THEN COALESCE(custom_category, 'lainnya') ELSE category END AS label,
              COUNT(*) AS total
       FROM event_attendances
       WHERE event_code = ?
       GROUP BY label
       ORDER BY total DESC`,
      { replacements: [EVENT_CODE] },
    ).then(([rows]) => rows),
    sequelize.query(
      `SELECT DATE_FORMAT(created_at, '%H:00') AS hour_label, COUNT(*) AS total
       FROM event_attendances
       WHERE event_code = ? AND DATE(created_at) = ?
       GROUP BY hour_label
       ORDER BY hour_label ASC`,
      { replacements: [EVENT_CODE, today] },
    ).then(([rows]) => rows),
    sequelize.query(
      `SELECT id, event_code, full_name, origin, category, custom_category, device_id, created_at
       FROM event_attendances
       WHERE event_code = ?
       ORDER BY created_at DESC
       LIMIT 8`,
      { replacements: [EVENT_CODE] },
    ).then(([rows]) => rows),
  ]);

  return {
    totalVisitors: Number(totalRow?.total || 0),
    todayVisitors: Number(todayRow?.total || 0),
    byCategory: categoryRows.map((row) => ({ label: row.label, total: Number(row.total || 0) })),
    hourly: hourlyRows.map((row) => ({ hour: row.hour_label, total: Number(row.total || 0) })),
    latest: latestRows.map(formatAttendance),
  };
};

exports.getPublicConfig = async (req, res) => {
  const settings = await getSettingsRow();
  const publicOrigin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
  const formUrl = `${publicOrigin}/hari-jadi-bogor-544/form?token=${encodeURIComponent(settings.qr_payload)}`;
  const scanUrl = `${req.protocol}://${req.get('host')}/api/event-attendance/public/resolve/${encodeURIComponent(settings.qr_payload)}`;
  const qrDataUrl = await QRCode.toDataURL(formUrl, { margin: 1, width: 512 });

  res.json({
    success: true,
    data: {
      ...settings,
      categories,
      qrDataUrl,
      formUrl,
      scanUrl,
    },
  });
};

exports.resolveScan = async (req, res) => {
  const settings = await getSettingsRow();
  const payload = decodeURIComponent(req.params.payload || '');
  const accepted = payload === settings.qr_payload || payload.includes(settings.qr_payload);

  res.json({
    success: accepted,
    data: {
      accepted,
      formPath: `/hari-jadi-bogor-544/form?token=${encodeURIComponent(settings.qr_payload)}`,
      eventName: settings.event_name,
    },
    message: accepted ? 'QR valid' : 'QR tidak sesuai untuk event ini',
  });
};

exports.registerAttendance = async (req, res) => {
  try {
    const settings = await getSettingsRow();
    if (!settings.is_active) {
      return res.status(403).json({ success: false, message: 'Daftar hadir event sedang ditutup' });
    }

    const fullName = normalize(req.body.full_name);
    const origin = normalize(req.body.origin);
    const category = normalize(req.body.category);
    const customCategory = category === 'lainnya' ? normalize(req.body.custom_category) : null;
    const scanPayload = normalize(req.body.scan_payload);
    const deviceId = normalize(req.body.device_id);

    if (!fullName || !origin || !category) {
      return res.status(422).json({ success: false, message: 'Nama, asal/instansi, dan kategori wajib diisi' });
    }

    if (!categories.includes(category)) {
      return res.status(422).json({ success: false, message: 'Kategori pengunjung tidak valid' });
    }

    if (category === 'lainnya' && !customCategory) {
      return res.status(422).json({ success: false, message: 'Kategori lainnya wajib diisi' });
    }

    if (scanPayload && scanPayload !== settings.qr_payload && !scanPayload.includes(settings.qr_payload)) {
      return res.status(422).json({ success: false, message: 'QR code tidak valid untuk event ini' });
    }

    const duplicateHash = crypto
      .createHash('sha256')
      .update(`${EVENT_CODE}|${normalizeKey(fullName)}|${normalizeKey(origin)}`)
      .digest('hex');

    const [existing] = await sequelize.query(
      `SELECT id, event_code, full_name, origin, category, custom_category, device_id, created_at
       FROM event_attendances
       WHERE event_code = ? AND duplicate_hash = ?
       LIMIT 1`,
      { replacements: [EVENT_CODE, duplicateHash] },
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: 'Data pengunjung sudah pernah tercatat',
        data: formatAttendance(existing[0]),
      });
    }

    const [result] = await sequelize.query(
      `INSERT INTO event_attendances
        (event_code, full_name, origin, category, custom_category, duplicate_hash, scan_payload, device_id, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      {
        replacements: [
          EVENT_CODE,
          fullName,
          origin,
          category,
          customCategory,
          duplicateHash,
          scanPayload || settings.qr_payload,
          deviceId || null,
          req.get('user-agent') || null,
          getClientIp(req),
        ],
      },
    );

    const [createdRows] = await sequelize.query(
      `SELECT id, event_code, full_name, origin, category, custom_category, device_id, created_at
       FROM event_attendances
       WHERE id = ?`,
      { replacements: [result] },
    );
    const attendance = formatAttendance(createdRows[0]);
    const stats = await getStatsPayload();

    getIO().emit('event_attendance:new', { attendance, stats });

    res.status(201).json({
      success: true,
      message: 'Terima kasih, daftar hadir berhasil disimpan',
      data: attendance,
      stats,
    });
  } catch (error) {
    if (error?.original?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, duplicate: true, message: 'Data pengunjung sudah pernah tercatat' });
    }

    res.status(500).json({ success: false, message: 'Gagal menyimpan daftar hadir', error: error.message });
  }
};

exports.getAttendances = async (req, res) => {
  await ensureTables();
  const search = normalize(req.query.search);
  const category = normalize(req.query.category);
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 50)));
  const offset = (page - 1) * limit;
  const where = ['event_code = ?'];
  const replacements = [EVENT_CODE];

  if (search) {
    where.push('(full_name LIKE ? OR origin LIKE ? OR custom_category LIKE ?)');
    replacements.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (category && category !== 'all') {
    where.push('category = ?');
    replacements.push(category);
  }

  const whereSql = where.join(' AND ');
  const [rows] = await sequelize.query(
    `SELECT id, event_code, full_name, origin, category, custom_category, device_id, created_at
     FROM event_attendances
     WHERE ${whereSql}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [...replacements, limit, offset] },
  );
  const [countRows] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM event_attendances WHERE ${whereSql}`,
    { replacements },
  );

  res.json({
    success: true,
    data: rows.map(formatAttendance),
    pagination: {
      page,
      limit,
      total: Number(countRows[0]?.total || 0),
    },
  });
};

exports.getStats = async (req, res) => {
  const settings = await getSettingsRow();
  const stats = await getStatsPayload();
  res.json({ success: true, data: { settings, stats, categories } });
};

exports.updateSettings = async (req, res) => {
  await ensureTables();
  const current = await getSettingsRow();
  const next = {
    event_name: normalize(req.body.event_name) || current.event_name,
    event_date: req.body.event_date || current.event_date,
    location: normalize(req.body.location) || current.location,
    qr_payload: normalize(req.body.qr_payload) || current.qr_payload,
    is_active: req.body.is_active === undefined ? current.is_active : Boolean(req.body.is_active),
  };

  await sequelize.query(
    `UPDATE event_attendance_settings
     SET event_name = ?, event_date = ?, location = ?, qr_payload = ?, is_active = ?
     WHERE event_code = ?`,
    {
      replacements: [
        next.event_name,
        next.event_date,
        next.location,
        next.qr_payload,
        next.is_active ? 1 : 0,
        EVENT_CODE,
      ],
    },
  );

  const updated = await getSettingsRow();
  getIO().emit('event_attendance:settings', updated);
  res.json({ success: true, message: 'Pengaturan event berhasil disimpan', data: updated });
};

exports.getAdminQr = async (req, res) => {
  const settings = await getSettingsRow();
  const formUrl = `${req.protocol}://${req.get('host')}/hari-jadi-bogor-544/form?token=${encodeURIComponent(settings.qr_payload)}`;
  const payloadQr = await QRCode.toDataURL(settings.qr_payload, { margin: 1, width: 512 });
  const formQr = await QRCode.toDataURL(formUrl, { margin: 1, width: 512 });
  res.json({ success: true, data: { payloadQr, formQr, payload: settings.qr_payload, formUrl } });
};
