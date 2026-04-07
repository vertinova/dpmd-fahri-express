const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs');

// Koordinat kantor DPMD Bogor
const KANTOR_LAT = -6.47553948391432;
const KANTOR_LNG = 106.8276556221009;
const MAX_DISTANCE_METERS = 500;

// Status kepegawaian yang wajib absen (Prisma enum keys)
const ABSENSI_REQUIRED_STATUS = [
  'PPPK_Paruh_Waktu',
  'Tenaga_Alih_Daya',
  'Tenaga_Keamanan',
  'Tenaga_Kebersihan',
];

// Hari Libur Nasional Indonesia 2026 (format: MM-DD)
const HOLIDAYS_2026 = {
  '01-01': 'Tahun Baru 2026',
  '01-29': 'Tahun Baru Imlek 2577',
  '03-20': 'Isra Mi\'raj Nabi Muhammad SAW',
  '03-22': 'Hari Suci Nyepi Tahun Baru Saka 1948',
  '04-03': 'Wafat Isa Al Masih',
  '04-05': 'Hari Paskah', // Minggu
  '05-01': 'Hari Buruh Internasional',
  '05-14': 'Kenaikan Isa Al Masih',
  '05-15': 'Hari Raya Waisak 2570',
  '06-01': 'Hari Lahir Pancasila',
  '06-26': 'Hari Raya Idul Adha 1447 H',
  '06-27': 'Cuti Bersama Idul Adha',
  '07-17': 'Tahun Baru Islam 1448 H',
  '08-17': 'Hari Kemerdekaan RI',
  '09-25': 'Maulid Nabi Muhammad SAW',
  '12-25': 'Hari Raya Natal',
  // Cuti Bersama & Libur tambahan (sesuaikan dengan SKB Menteri)
  '01-02': 'Cuti Bersama Tahun Baru',
  '01-30': 'Cuti Bersama Imlek',
  '03-23': 'Cuti Bersama Nyepi',
  '12-24': 'Cuti Bersama Natal',
  '12-31': 'Cuti Bersama Tahun Baru',
};

/**
 * Cek apakah tanggal adalah hari libur (weekend atau tanggal merah)
 * @param {Date} date - Tanggal yang dicek (dalam WIB)
 * @returns {{ isHoliday: boolean, reason: string|null }}
 */
function checkHoliday(date = new Date()) {
  const wib = getWIB(date);
  const dayOfWeek = new Date(Date.UTC(wib.year, wib.month - 1, wib.day)).getUTCDay();
  
  // Cek weekend (0 = Minggu, 6 = Sabtu)
  if (dayOfWeek === 0) {
    return { isHoliday: true, reason: 'Hari Minggu' };
  }
  if (dayOfWeek === 6) {
    return { isHoliday: true, reason: 'Hari Sabtu' };
  }
  
  // Cek tanggal merah nasional
  const monthDay = `${String(wib.month).padStart(2, '0')}-${String(wib.day).padStart(2, '0')}`;
  if (HOLIDAYS_2026[monthDay]) {
    return { isHoliday: true, reason: HOLIDAYS_2026[monthDay] };
  }
  
  return { isHoliday: false, reason: null };
}

/**
 * Hitung jarak antara 2 titik koordinat (Haversine formula)
 * @returns jarak dalam meter
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // radius bumi dalam meter
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Simpan foto base64 ke file
 */
function saveBase64Photo(base64Data, userId, type) {
  const dir = path.join(__dirname, '../../storage/uploads/absensi');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Strip data URL prefix if present
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Clean, 'base64');

  const timestamp = Date.now();
  const filename = `${userId}_${type}_${timestamp}.jpg`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  return `uploads/absensi/${filename}`;
}

/**
 * Convert UTC Date to WIB (UTC+7) components
 * VPS runs in UTC, but all absensi times must be in WIB
 */
function getWIB(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return {
    hours: wib.getUTCHours(),
    minutes: wib.getUTCMinutes(),
    seconds: wib.getUTCSeconds(),
    year: wib.getUTCFullYear(),
    month: wib.getUTCMonth() + 1,
    day: wib.getUTCDate(),
    timeString: `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')}:${String(wib.getUTCSeconds()).padStart(2, '0')}`,
    dateString: `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}-${String(wib.getUTCDate()).padStart(2, '0')}`,
  };
}

/**
 * Fetch absensi settings and return parsed values
 */
async function getAbsensiSettings() {
  const rows = await prisma.absensi_settings.findMany();
  const map = {};
  rows.forEach(s => { map[s.key] = s.value; });
  return {
    jamMasuk: map.jam_masuk || '08:00',
    jamPulang: map.jam_pulang || '16:00',
    toleransi: parseInt(map.toleransi_terlambat || '15', 10),
  };
}

/**
 * Hitung telat masuk menit untuk sebuah record absensi
 * @param {Date|string|null} jamMasukRecord - jam_masuk dari record (Time stored as Date)
 * @param {string} jamMasukSetting - e.g. "08:00"
 * @param {number} toleransi - menit toleransi
 * @returns {number} menit telat (0 jika tidak telat)
 */
function hitungTelatMenit(jamMasukRecord, jamMasukSetting, toleransi) {
  if (!jamMasukRecord) return 0;
  const masuk = new Date(jamMasukRecord);
  const [jmH, jmM] = jamMasukSetting.split(':').map(Number);
  const batas = new Date('1970-01-01T00:00:00');
  batas.setHours(jmH, jmM + toleransi, 0, 0);
  const masukTime = new Date('1970-01-01T00:00:00');
  masukTime.setHours(masuk.getUTCHours(), masuk.getUTCMinutes(), 0, 0);
  return Math.max(0, Math.floor((masukTime - batas) / 60000));
}

/**
 * Enrich records array with telat_masuk_menit field
 * Only records with jam_masuk get telat calculation
 */
function enrichRecordsWithTelat(records, jamMasukSetting, toleransi) {
  return records.map(r => {
    const rec = typeof r.toJSON === 'function' ? r.toJSON() : { ...r };
    rec.telat_masuk_menit = rec.jam_masuk ? hitungTelatMenit(rec.jam_masuk, jamMasukSetting, toleransi) : 0;
    return rec;
  });
}

const absensiController = {
  /**
   * Clock in - Absen masuk
   * POST /api/absensi/clock-in
   * Body: { latitude, longitude, foto (base64), device_id, mode?, tujuan_dinas? }
   * mode: 'hadir' (default) | 'dinas_luar' | 'wfh' | 'wfa'
   */
  async clockIn(req, res) {
    try {
      const userId = BigInt(req.user.id);
      const { latitude, longitude, foto, device_id, mode, tujuan_dinas } = req.body;
      const absensiMode = mode || 'hadir';

      // Validasi mode
      if (!['hadir', 'dinas_luar', 'wfh', 'wfa'].includes(absensiMode)) {
        return res.status(400).json({ success: false, message: 'Mode absensi tidak valid' });
      }

      // Validasi: harus ada foto
      if (!foto) {
        return res.status(400).json({ success: false, message: 'Foto selfie wajib diambil' });
      }

      // Validasi: harus ada koordinat
      if (latitude == null || longitude == null) {
        return res.status(400).json({ success: false, message: 'Lokasi GPS wajib diaktifkan' });
      }

      // Validasi dinas luar: harus ada tujuan
      if (absensiMode === 'dinas_luar' && !tujuan_dinas) {
        return res.status(400).json({ success: false, message: 'Tujuan dinas luar wajib diisi' });
      }

      // Validasi: device_id harus cocok dengan yang terdaftar
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { device_id: true }
      });

      if (!user.device_id) {
        return res.status(403).json({
          success: false,
          message: 'Device belum terdaftar. Hubungi admin untuk mendaftarkan perangkat Anda.'
        });
      }

      if (user.device_id !== device_id) {
        return res.status(403).json({
          success: false,
          message: 'Absensi hanya bisa dilakukan dari perangkat yang terdaftar.'
        });
      }

      // Hitung jarak dari kantor
      const jarak = calculateDistance(parseFloat(latitude), parseFloat(longitude), KANTOR_LAT, KANTOR_LNG);

      // Cek jarak hanya untuk mode 'hadir' (WFH/WFA/dinas luar bebas lokasi)
      if (absensiMode === 'hadir' && jarak > MAX_DISTANCE_METERS) {
        return res.status(400).json({
          success: false,
          message: `Anda berada ${Math.round(jarak)} meter dari kantor. Maksimal jarak absensi adalah ${MAX_DISTANCE_METERS} meter.`
        });
      }

      // Gunakan WIB (UTC+7) untuk tanggal dan waktu
      const now = new Date();
      const wib = getWIB(now);
      const todayStr = wib.dateString;
      const today = new Date(`${todayStr}T00:00:00.000Z`);

      // Check if already clocked in
      const existing = await prisma.absensi_pegawai.findUnique({
        where: { user_id_tanggal: { user_id: userId, tanggal: today } }
      });

      if (existing?.jam_masuk) {
        return res.status(400).json({
          success: false,
          message: 'Anda sudah melakukan absen masuk hari ini'
        });
      }

      // Cek jika sudah submit izin/sakit/cuti hari ini
      if (existing && ['izin', 'sakit', 'cuti'].includes(existing.status)) {
        const statusLabel = { izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti' };
        return res.status(400).json({
          success: false,
          message: `Anda sudah submit ${statusLabel[existing.status]} hari ini. Hanya bisa 1x absensi per hari.`
        });
      }

      // Simpan foto
      const fotoPath = saveBase64Photo(foto, userId.toString(), 'masuk');

      // jam_masuk: pakai WIB time string dengan explicit +07:00 timezone
      const jamMasuk = new Date(`1970-01-01T${wib.timeString}+07:00`);

      const data = {
        jam_masuk: jamMasuk,
        status: absensiMode,
        foto_masuk: fotoPath,
        latitude_masuk: parseFloat(latitude),
        longitude_masuk: parseFloat(longitude),
        jarak_masuk: Math.round(jarak),
        lokasi_masuk: `${latitude},${longitude}`,
        device_id: device_id,
        tujuan_dinas: absensiMode === 'dinas_luar' ? tujuan_dinas : null,
        updated_at: new Date(),
      };

      let result;
      if (existing) {
        result = await prisma.absensi_pegawai.update({
          where: { id: existing.id },
          data
        });
      } else {
        result = await prisma.absensi_pegawai.create({
          data: {
            user_id: userId,
            tanggal: today,
            ...data,
            created_at: new Date(),
          }
        });
      }

      const modeLabel = { hadir: 'Hadir', dinas_luar: 'Dinas Luar', wfh: 'WFH', wfa: 'WFA' };

      // Calculate late info (semua dalam WIB)
      const settingsRows = await prisma.absensi_settings.findMany();
      const settingsMap = {};
      settingsRows.forEach(s => { settingsMap[s.key] = s.value; });
      const jamMasukSetting = settingsMap.jam_masuk || '08:00';
      const toleransi = parseInt(settingsMap.toleransi_terlambat || '15', 10);
      const [jmH, jmM] = jamMasukSetting.split(':').map(Number);
      const batasMasuk = new Date('1970-01-01T00:00:00');
      batasMasuk.setHours(jmH, jmM + toleransi, 0, 0);
      const masukTime = new Date('1970-01-01T00:00:00');
      masukTime.setHours(wib.hours, wib.minutes, 0, 0);
      const telatMenit = Math.max(0, Math.floor((masukTime - batasMasuk) / 60000));

      let message = `Absen masuk ${modeLabel[absensiMode]} berhasil (jarak: ${Math.round(jarak)}m)`;
      if (telatMenit > 0) {
        const jam = Math.floor(telatMenit / 60);
        const menit = telatMenit % 60;
        const telatStr = jam > 0 ? `${jam} jam ${menit} menit` : `${menit} menit`;
        message += ` — Telat ${telatStr} (batas masuk: ${jamMasukSetting} + ${toleransi} menit toleransi)`;
      }

      return res.status(201).json({
        success: true,
        message,
        data: result,
        telat_masuk_menit: telatMenit,
      });
    } catch (error) {
      console.error('[Absensi] Clock-in error:', error);
      return res.status(500).json({ success: false, message: 'Gagal absen masuk', error: error.message });
    }
  },

  /**
   * Clock out - Absen keluar
   * POST /api/absensi/clock-out
   * Body: { latitude, longitude, foto (base64), device_id }
   */
  async clockOut(req, res) {
    try {
      const userId = BigInt(req.user.id);
      const { latitude, longitude, foto, device_id } = req.body;

      if (!foto) {
        return res.status(400).json({ success: false, message: 'Foto selfie wajib diambil' });
      }

      if (latitude == null || longitude == null) {
        return res.status(400).json({ success: false, message: 'Lokasi GPS wajib diaktifkan' });
      }

      // Validasi device
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { device_id: true }
      });

      if (!user.device_id || user.device_id !== device_id) {
        return res.status(403).json({
          success: false,
          message: 'Absensi hanya bisa dilakukan dari perangkat yang terdaftar.'
        });
      }

      // Hitung jarak
      const jarak = calculateDistance(parseFloat(latitude), parseFloat(longitude), KANTOR_LAT, KANTOR_LNG);

      // Gunakan WIB date yang sama dengan clockIn untuk konsistensi
      const now = new Date();
      const wib = getWIB(now);
      const today = new Date(`${wib.dateString}T00:00:00.000Z`);

      const existing = await prisma.absensi_pegawai.findUnique({
        where: { user_id_tanggal: { user_id: userId, tanggal: today } }
      });

      if (!existing || !existing.jam_masuk) {
        return res.status(400).json({ success: false, message: 'Anda belum melakukan absen masuk hari ini' });
      }

      if (existing.jam_keluar) {
        return res.status(400).json({ success: false, message: 'Anda sudah melakukan absen keluar hari ini' });
      }

      // Cek jarak hanya jika clock-in mode adalah 'hadir'
      if (existing.status === 'hadir' && jarak > MAX_DISTANCE_METERS) {
        return res.status(400).json({
          success: false,
          message: `Anda berada ${Math.round(jarak)} meter dari kantor. Maksimal jarak absensi adalah ${MAX_DISTANCE_METERS} meter.`
        });
      }

      const fotoPath = saveBase64Photo(foto, userId.toString(), 'keluar');

      const jamKeluar = new Date(`1970-01-01T${wib.timeString}+07:00`);

      const result = await prisma.absensi_pegawai.update({
        where: { id: existing.id },
        data: {
          jam_keluar: jamKeluar,
          foto_keluar: fotoPath,
          latitude_keluar: parseFloat(latitude),
          longitude_keluar: parseFloat(longitude),
          jarak_keluar: Math.round(jarak),
          lokasi_keluar: `${latitude},${longitude}`,
          updated_at: new Date(),
        }
      });

      return res.json({
        success: true,
        message: `Absen keluar berhasil (jarak: ${Math.round(jarak)}m)`,
        data: result
      });
    } catch (error) {
      console.error('[Absensi] Clock-out error:', error);
      return res.status(500).json({ success: false, message: 'Gagal absen keluar', error: error.message });
    }
  },

  /**
   * Get today's absensi
   * GET /api/absensi/today
   */
  async getToday(req, res) {
    try {
      const userId = BigInt(req.user.id);
      // Gunakan WIB date untuk konsistensi dengan clockIn/clockOut
      const now = new Date();
      const wib = getWIB(now);
      const today = new Date(`${wib.dateString}T00:00:00.000Z`);

      const absensi = await prisma.absensi_pegawai.findUnique({
        where: { user_id_tanggal: { user_id: userId, tanggal: today } }
      });

      // Fetch settings for late calculation
      const settingsRows = await prisma.absensi_settings.findMany();
      const settings = {};
      settingsRows.forEach(s => { settings[s.key] = s.value; });
      const jamMasukSetting = settings.jam_masuk || '08:00';
      const jamPulangSetting = settings.jam_pulang || '16:00';
      const toleransi = parseInt(settings.toleransi_terlambat || '15', 10);

      let telat_masuk_menit = 0;
      let telat_pulang_menit = 0;
      let pulang_lebih_awal_menit = 0;

      if (absensi?.jam_masuk) {
        const masuk = new Date(absensi.jam_masuk);
        const [jmH, jmM] = jamMasukSetting.split(':').map(Number);
        const batasMasuk = new Date('1970-01-01T00:00:00');
        batasMasuk.setHours(jmH, jmM + toleransi, 0, 0);
        const masukTime = new Date('1970-01-01T00:00:00');
        masukTime.setHours(masuk.getUTCHours(), masuk.getUTCMinutes(), 0, 0);
        const diffMasuk = Math.floor((masukTime - batasMasuk) / 60000);
        if (diffMasuk > 0) telat_masuk_menit = diffMasuk;
      }

      if (absensi?.jam_keluar) {
        const keluar = new Date(absensi.jam_keluar);
        const [jpH, jpM] = jamPulangSetting.split(':').map(Number);
        const batasPulang = new Date('1970-01-01T00:00:00');
        batasPulang.setHours(jpH, jpM, 0, 0);
        const keluarTime = new Date('1970-01-01T00:00:00');
        keluarTime.setHours(keluar.getUTCHours(), keluar.getUTCMinutes(), 0, 0);
        const diffPulang = Math.floor((batasPulang - keluarTime) / 60000);
        if (diffPulang > 0) pulang_lebih_awal_menit = diffPulang;
      }

      return res.json({
        success: true,
        data: absensi || null,
        settings: { jam_masuk: jamMasukSetting, jam_pulang: jamPulangSetting, toleransi_terlambat: toleransi },
        telat_masuk_menit,
        pulang_lebih_awal_menit,
      });
    } catch (error) {
      console.error('[Absensi] Get today error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data absensi', error: error.message });
    }
  },

  /**
   * Get history
   * GET /api/absensi/history?bulan=4&tahun=2026
   */
  async getHistory(req, res) {
    try {
      const userId = BigInt(req.user.id);
      const { bulan, tahun } = req.query;

      const now = new Date();
      const month = bulan ? parseInt(bulan) : now.getMonth() + 1;
      const year = tahun ? parseInt(tahun) : now.getFullYear();

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      const records = await prisma.absensi_pegawai.findMany({
        where: { user_id: userId, tanggal: { gte: startDate, lte: endDate } },
        orderBy: { tanggal: 'desc' }
      });

      const summary = {
        hadir: records.filter(r => r.status === 'hadir').length,
        izin: records.filter(r => r.status === 'izin').length,
        sakit: records.filter(r => r.status === 'sakit').length,
        alpha: records.filter(r => r.status === 'alpha').length,
        cuti: records.filter(r => r.status === 'cuti').length,
        dinas_luar: records.filter(r => r.status === 'dinas_luar').length,
        wfh: records.filter(r => r.status === 'wfh').length,
        wfa: records.filter(r => r.status === 'wfa').length,
        total: records.length,
      };

      return res.json({ success: true, data: { records, summary, bulan: month, tahun: year } });
    } catch (error) {
      console.error('[Absensi] Get history error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil riwayat absensi', error: error.message });
    }
  },

  /**
   * Submit izin/sakit/cuti
   * POST /api/absensi/izin
   */
  async submitIzin(req, res) {
    try {
      const userId = BigInt(req.user.id);
      const { tanggal, status, keterangan } = req.body;

      if (!tanggal || !status) {
        return res.status(400).json({ success: false, message: 'Tanggal dan status wajib diisi' });
      }

      if (!['izin', 'sakit', 'cuti', 'wfh', 'wfa'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status tidak valid' });
      }

      // Fix timezone: gunakan UTC date untuk konsistensi
      const t = new Date(tanggal);
      const y = t.getUTCFullYear();
      const m = String(t.getUTCMonth() + 1).padStart(2, '0');
      const d = String(t.getUTCDate()).padStart(2, '0');
      const targetDate = new Date(`${y}-${m}-${d}T00:00:00.000Z`);

      const existing = await prisma.absensi_pegawai.findUnique({
        where: { user_id_tanggal: { user_id: userId, tanggal: targetDate } }
      });

      if (existing) {
        // Jika sudah clock-in (hadir/dinas_luar/wfh/wfa), tolak
        if (existing.jam_masuk) {
          return res.status(400).json({
            success: false,
            message: 'Anda sudah melakukan absen masuk hari ini. Tidak bisa mengubah status.'
          });
        }
        // Jika sudah submit sebelumnya, tolak
        if (['izin', 'sakit', 'cuti', 'wfh', 'wfa'].includes(existing.status)) {
          return res.status(400).json({
            success: false,
            message: `Anda sudah submit ${existing.status.toUpperCase()} hari ini. Hanya bisa 1x absensi per hari.`
          });
        }
        const updated = await prisma.absensi_pegawai.update({
          where: { id: existing.id },
          data: { status, keterangan: keterangan || null, updated_at: new Date() }
        });
        return res.json({ success: true, message: `${status} berhasil disubmit`, data: updated });
      }

      const absensi = await prisma.absensi_pegawai.create({
        data: {
          user_id: userId,
          tanggal: targetDate,
          status,
          keterangan: keterangan || null,
          created_at: new Date(),
          updated_at: new Date(),
        }
      });

      return res.status(201).json({ success: true, message: `${status} berhasil disubmit`, data: absensi });
    } catch (error) {
      console.error('[Absensi] Submit izin error:', error);
      return res.status(500).json({ success: false, message: 'Gagal submit izin', error: error.message });
    }
  },

  /**
   * Admin: Rekap absensi
   * GET /api/absensi/admin/rekap
   */
  async getRekapAdmin(req, res) {
    try {
      const { tanggal, bulan, tahun } = req.query;
      let where = {};

      if (tanggal) {
        const targetDate = new Date(tanggal);
         // Fix timezone: gunakan UTC date untuk query tanggal
        const t = new Date(tanggal);
        const y = t.getUTCFullYear();
        const m = String(t.getUTCMonth() + 1).padStart(2, '0');
        const d = String(t.getUTCDate()).padStart(2, '0');
        where.tanggal = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
      } else if (bulan && tahun) {
        const startDate = new Date(Date.UTC(parseInt(tahun), parseInt(bulan) - 1, 1));
        const endDate = new Date(Date.UTC(parseInt(tahun), parseInt(bulan), 0));
        where.tanggal = { gte: startDate, lte: endDate };
      } else {
        const wibNow = getWIB();
        where.tanggal = new Date(`${wibNow.dateString}T00:00:00.000Z`);
      }

      const settings = await getAbsensiSettings();
      const rawRecords = await prisma.absensi_pegawai.findMany({
        where,
        include: {
          user: {
            select: {
              id: true, name: true, email: true, avatar: true,
              pegawai: {
                select: { nama_pegawai: true, jabatan: true, status_kepegawaian: true, nip: true }
              }
            }
          }
        },
        orderBy: [{ tanggal: 'desc' }, { jam_masuk: 'asc' }]
      });

      const records = enrichRecordsWithTelat(rawRecords, settings.jamMasuk, settings.toleransi);

      return res.json({ success: true, data: records, settings: { jam_masuk: settings.jamMasuk, toleransi_terlambat: settings.toleransi } });
    } catch (error) {
      console.error('[Absensi] Admin rekap error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil rekap absensi', error: error.message });
    }
  },

  /**
   * Admin: Daftar pegawai wajib absensi
   * GET /api/absensi/admin/pegawai-absensi
   */
  async getPegawaiAbsensi(req, res) {
    try {
      const users = await prisma.users.findMany({
        where: {
          is_active: true,
          pegawai: { status_kepegawaian: { in: ABSENSI_REQUIRED_STATUS } }
        },
        select: {
          id: true, name: true, email: true, avatar: true, device_id: true,
          pegawai: {
            select: { nama_pegawai: true, jabatan: true, status_kepegawaian: true }
          }
        },
        orderBy: { name: 'asc' }
      });

      return res.json({ success: true, data: users });
    } catch (error) {
      console.error('[Absensi] Get pegawai absensi error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data pegawai', error: error.message });
    }
  },

  /**
   * Check eligibility
   * GET /api/absensi/check-eligible
   */
  async checkEligible(req, res) {
    try {
      const userId = BigInt(req.user.id);

      const user = await prisma.users.findUnique({
        where: { id: userId },
        include: {
          pegawai: {
            select: { status_kepegawaian: true, nama_pegawai: true, jabatan: true }
          }
        }
      });

      const statusKepegawaian = user?.pegawai?.status_kepegawaian;
      const isEligible = statusKepegawaian && ABSENSI_REQUIRED_STATUS.includes(statusKepegawaian);
      
      // Cek hari libur
      const holidayInfo = checkHoliday(new Date());

      return res.json({
        success: true,
        data: {
          eligible: !!isEligible,
          status_kepegawaian: statusKepegawaian || null,
          nama: user?.pegawai?.nama_pegawai || user?.name,
          jabatan: user?.pegawai?.jabatan || null,
          device_registered: !!user?.device_id,
          is_holiday: holidayInfo.isHoliday,
          holiday_reason: holidayInfo.reason,
        }
      });
    } catch (error) {
      console.error('[Absensi] Check eligible error:', error);
      return res.status(500).json({ success: false, message: 'Gagal cek eligibility', error: error.message });
    }
  },

  /**
   * Register device ID for current user
   * POST /api/absensi/register-device
   * Body: { device_id }
   */
  async registerDevice(req, res) {
    try {
      const userId = BigInt(req.user.id);
      const { device_id } = req.body;

      if (!device_id) {
        return res.status(400).json({ success: false, message: 'Device ID wajib diisi' });
      }

      await prisma.users.update({
        where: { id: userId },
        data: { device_id }
      });

      return res.json({ success: true, message: 'Device berhasil didaftarkan' });
    } catch (error) {
      console.error('[Absensi] Register device error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mendaftarkan device', error: error.message });
    }
  },

  /**
   * Admin: Set device ID for a user
   * PUT /api/absensi/admin/set-device/:userId
   * Body: { device_id }
   */
  async adminSetDevice(req, res) {
    try {
      const targetUserId = BigInt(req.params.userId);
      const { device_id } = req.body;

      await prisma.users.update({
        where: { id: targetUserId },
        data: { device_id: device_id || null }
      });

      return res.json({
        success: true,
        message: device_id ? 'Device berhasil didaftarkan' : 'Device berhasil dihapus'
      });
    } catch (error) {
      console.error('[Absensi] Admin set device error:', error);
      return res.status(500).json({ success: false, message: 'Gagal set device', error: error.message });
    }
  },

  /**
   * Admin: Get absensi settings
   * GET /api/absensi/admin/settings
   */
  async getSettings(req, res) {
    try {
      const settings = await prisma.absensi_settings.findMany();
      const result = {};
      settings.forEach(s => { result[s.key] = s.value; });

      // Defaults
      if (!result.jam_masuk) result.jam_masuk = '08:00';
      if (!result.jam_pulang) result.jam_pulang = '16:00';
      if (!result.toleransi_terlambat) result.toleransi_terlambat = '15';

      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('[Absensi] Get settings error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil settings', error: error.message });
    }
  },

  /**
   * Admin: Update absensi settings
   * PUT /api/absensi/admin/settings
   * Body: { jam_masuk, jam_pulang, toleransi_terlambat }
   */
  async updateSettings(req, res) {
    try {
      const { jam_masuk, jam_pulang, toleransi_terlambat } = req.body;
      const userId = BigInt(req.user.id);

      const settingsToUpdate = [];
      if (jam_masuk !== undefined) settingsToUpdate.push({ key: 'jam_masuk', value: jam_masuk, description: 'Jam masuk kantor' });
      if (jam_pulang !== undefined) settingsToUpdate.push({ key: 'jam_pulang', value: jam_pulang, description: 'Jam pulang kantor' });
      if (toleransi_terlambat !== undefined) settingsToUpdate.push({ key: 'toleransi_terlambat', value: String(toleransi_terlambat), description: 'Toleransi terlambat (menit)' });

      for (const setting of settingsToUpdate) {
        await prisma.absensi_settings.upsert({
          where: { key: setting.key },
          update: { value: setting.value, updated_by: userId, updated_at: new Date() },
          create: { key: setting.key, value: setting.value, description: setting.description, updated_by: userId },
        });
      }

      return res.json({ success: true, message: 'Settings berhasil diupdate' });
    } catch (error) {
      console.error('[Absensi] Update settings error:', error);
      return res.status(500).json({ success: false, message: 'Gagal update settings', error: error.message });
    }
  },

  /**
   * Admin: Update an absensi record (CRUD edit)
   * PUT /api/absensi/admin/:id
   */
  async adminUpdateAbsensi(req, res) {
    try {
      const absensiId = BigInt(req.params.id);
      const { status, keterangan, jam_masuk, jam_keluar, tujuan_dinas } = req.body;

      const existing = await prisma.absensi_pegawai.findUnique({ where: { id: absensiId } });
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Data absensi tidak ditemukan' });
      }

      const updateData = { updated_at: new Date() };
      if (status !== undefined) updateData.status = status;
      if (keterangan !== undefined) updateData.keterangan = keterangan || null;
      if (tujuan_dinas !== undefined) updateData.tujuan_dinas = tujuan_dinas || null;
      if (jam_masuk !== undefined) {
        // Frontend kirim waktu WIB (e.g., "07:30"), harus di-parse sebagai WIB (+07:00) agar konsisten dengan clock-in
        updateData.jam_masuk = jam_masuk ? new Date(`1970-01-01T${jam_masuk}:00+07:00`) : null;
      }
      if (jam_keluar !== undefined) {
        updateData.jam_keluar = jam_keluar ? new Date(`1970-01-01T${jam_keluar}:00+07:00`) : null;
      }

      const result = await prisma.absensi_pegawai.update({
        where: { id: absensiId },
        data: updateData,
        include: {
          user: {
            select: { id: true, name: true, pegawai: { select: { nama_pegawai: true } } }
          }
        }
      });

      return res.json({ success: true, message: 'Data absensi berhasil diupdate', data: result });
    } catch (error) {
      console.error('[Absensi] Admin update error:', error);
      return res.status(500).json({ success: false, message: 'Gagal update data absensi', error: error.message });
    }
  },

  /**
   * Admin: Delete an absensi record
   * DELETE /api/absensi/admin/:id
   */
  async adminDeleteAbsensi(req, res) {
    try {
      const absensiId = BigInt(req.params.id);

      const existing = await prisma.absensi_pegawai.findUnique({ where: { id: absensiId } });
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Data absensi tidak ditemukan' });
      }

      await prisma.absensi_pegawai.delete({ where: { id: absensiId } });

      return res.json({ success: true, message: 'Data absensi berhasil dihapus' });
    } catch (error) {
      console.error('[Absensi] Admin delete error:', error);
      return res.status(500).json({ success: false, message: 'Gagal hapus data absensi', error: error.message });
    }
  },

  // ═══════════════════════════════════════════════════════════
  // ─── Dashboard & Rekap Per Pegawai ────────────────────────
  // ═══════════════════════════════════════════════════════════

  /**
   * Admin: Dashboard hari ini — siapa saja per status
   * GET /api/absensi/admin/dashboard-hari-ini?periode=hari|minggu|bulan|tahun
   * Default: hari ini
   */
  async getDashboardHariIni(req, res) {
    try {
      const { periode = 'hari', tanggal, bulan, tahun } = req.query;
      const wibNow = getWIB();
      let where = {};

      if (periode === 'minggu') {
        // Minggu ini (Senin - Minggu)
        const refDate = tanggal ? new Date(tanggal) : new Date(`${wibNow.dateString}T00:00:00.000Z`);
        const day = refDate.getUTCDay(); // 0=Sun, 1=Mon
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const monday = new Date(refDate);
        monday.setUTCDate(refDate.getUTCDate() + mondayOffset);
        monday.setUTCHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setUTCDate(monday.getUTCDate() + 6);
        where.tanggal = { gte: monday, lte: sunday };
      } else if (periode === 'bulan') {
        const m = bulan ? parseInt(bulan) : wibNow.month;
        const y = tahun ? parseInt(tahun) : wibNow.year;
        where.tanggal = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0)) };
      } else if (periode === 'tahun') {
        const y = tahun ? parseInt(tahun) : wibNow.year;
        where.tanggal = { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31)) };
      } else {
        // Default: hari ini
        const todayStr = tanggal || wibNow.dateString;
        where.tanggal = new Date(`${todayStr}T00:00:00.000Z`);
      }

      const settings = await getAbsensiSettings();
      const rawRecords = await prisma.absensi_pegawai.findMany({
        where,
        include: {
          user: {
            select: {
              id: true, name: true, avatar: true,
              pegawai: { select: { nama_pegawai: true, jabatan: true, status_kepegawaian: true } }
            }
          }
        },
        orderBy: [{ tanggal: 'desc' }, { jam_masuk: 'asc' }]
      });

      const records = enrichRecordsWithTelat(rawRecords, settings.jamMasuk, settings.toleransi);

      // Group by status
      const grouped = {};
      const allStatuses = ['hadir', 'izin', 'sakit', 'alpha', 'cuti', 'dinas_luar', 'wfh', 'wfa'];
      allStatuses.forEach(s => { grouped[s] = []; });
      records.forEach(r => {
        if (grouped[r.status]) grouped[r.status].push(r);
      });

      // Summary counts
      const summary = {};
      allStatuses.forEach(s => { summary[s] = grouped[s].length; });
      summary.total = records.length;
      summary.telat = records.filter(r => r.telat_masuk_menit > 0).length;

      // If hari ini, also show belum absen (eligible users without record today)
      let belumAbsen = [];
      if (periode === 'hari') {
        const allEligible = await prisma.users.findMany({
          where: {
            is_active: true,
            pegawai: { status_kepegawaian: { in: ABSENSI_REQUIRED_STATUS } }
          },
          select: {
            id: true, name: true, avatar: true,
            pegawai: { select: { nama_pegawai: true, jabatan: true, status_kepegawaian: true } }
          }
        });
        const recordedUserIds = new Set(records.map(r => r.user_id.toString()));
        belumAbsen = allEligible.filter(u => !recordedUserIds.has(u.id.toString()));
      }

      return res.json({
        success: true,
        data: { grouped, summary, belum_absen: belumAbsen, total_records: records.length, periode, settings: { jam_masuk: settings.jamMasuk, toleransi_terlambat: settings.toleransi } }
      });
    } catch (error) {
      console.error('[Absensi] Dashboard error:', error);
      return res.status(500).json({ success: false, message: 'Gagal memuat dashboard', error: error.message });
    }
  },

  /**
   * Admin: Rekap per pegawai — semua user dengan ringkasan presensi
   * GET /api/absensi/admin/rekap-pegawai?periode=minggu|bulan|tahun&bulan=4&tahun=2026&tanggal=2026-04-07
   */
  async getRekapPegawai(req, res) {
    try {
      const { periode = 'bulan', bulan, tahun, tanggal } = req.query;
      const wibNow = getWIB();
      let where = {};
      let periodeLabel = '';

      if (periode === 'minggu') {
        const refDate = tanggal ? new Date(tanggal) : new Date(`${wibNow.dateString}T00:00:00.000Z`);
        const day = refDate.getUTCDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const monday = new Date(refDate);
        monday.setUTCDate(refDate.getUTCDate() + mondayOffset);
        monday.setUTCHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setUTCDate(monday.getUTCDate() + 6);
        where.tanggal = { gte: monday, lte: sunday };
        periodeLabel = `${monday.toISOString().split('T')[0]} s/d ${sunday.toISOString().split('T')[0]}`;
      } else if (periode === 'tahun') {
        const y = tahun ? parseInt(tahun) : wibNow.year;
        where.tanggal = { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31)) };
        periodeLabel = `Tahun ${y}`;
      } else {
        // Default: bulan
        const m = bulan ? parseInt(bulan) : wibNow.month;
        const y = tahun ? parseInt(tahun) : wibNow.year;
        where.tanggal = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0)) };
        const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        periodeLabel = `${monthNames[m - 1]} ${y}`;
      }

      // Get all eligible users
      const allUsers = await prisma.users.findMany({
        where: {
          is_active: true,
          pegawai: { status_kepegawaian: { in: ABSENSI_REQUIRED_STATUS } }
        },
        select: {
          id: true, name: true, avatar: true,
          pegawai: { select: { nama_pegawai: true, jabatan: true, status_kepegawaian: true, nip: true } }
        },
        orderBy: { name: 'asc' }
      });

      // Get all records for the period
      const settings = await getAbsensiSettings();
      const rawRecords = await prisma.absensi_pegawai.findMany({
        where,
        select: { user_id: true, status: true, tanggal: true, jam_masuk: true, jam_keluar: true }
      });

      const records = enrichRecordsWithTelat(rawRecords, settings.jamMasuk, settings.toleransi);

      // Group records by user
      const userRecordMap = {};
      records.forEach(r => {
        const uid = r.user_id.toString();
        if (!userRecordMap[uid]) userRecordMap[uid] = [];
        userRecordMap[uid].push(r);
      });

      const allStatuses = ['hadir', 'izin', 'sakit', 'alpha', 'cuti', 'dinas_luar', 'wfh', 'wfa'];

      // Build per-user summary
      const pegawaiRekap = allUsers.map(u => {
        const uid = u.id.toString();
        const userRecords = userRecordMap[uid] || [];
        const summary = {};
        allStatuses.forEach(s => { summary[s] = 0; });
        userRecords.forEach(r => { if (summary[r.status] !== undefined) summary[r.status]++; });
        summary.total = userRecords.length;
        summary.telat = userRecords.filter(r => r.telat_masuk_menit > 0).length;
        return {
          user: u,
          summary,
          total_records: userRecords.length,
        };
      });

      // Global summary
      const globalSummary = {};
      allStatuses.forEach(s => { globalSummary[s] = records.filter(r => r.status === s).length; });
      globalSummary.total = records.length;
      globalSummary.telat = records.filter(r => r.telat_masuk_menit > 0).length;

      return res.json({
        success: true,
        data: {
          pegawai: pegawaiRekap,
          global_summary: globalSummary,
          periode,
          periode_label: periodeLabel,
          total_pegawai: allUsers.length,
        }
      });
    } catch (error) {
      console.error('[Absensi] Rekap pegawai error:', error);
      return res.status(500).json({ success: false, message: 'Gagal memuat rekap pegawai', error: error.message });
    }
  },

  /**
   * Admin: History detail per user
   * GET /api/absensi/admin/history/:userId?periode=minggu|bulan&bulan=4&tahun=2026&tanggal=2026-04-07
   */
  async getHistoryPerUser(req, res) {
    try {
      const userId = BigInt(req.params.userId);
      const { periode = 'bulan', bulan, tahun, tanggal } = req.query;
      const wibNow = getWIB();
      let where = { user_id: userId };

      if (periode === 'minggu') {
        const refDate = tanggal ? new Date(tanggal) : new Date(`${wibNow.dateString}T00:00:00.000Z`);
        const day = refDate.getUTCDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const monday = new Date(refDate);
        monday.setUTCDate(refDate.getUTCDate() + mondayOffset);
        monday.setUTCHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setUTCDate(monday.getUTCDate() + 6);
        where.tanggal = { gte: monday, lte: sunday };
      } else {
        // Default: bulan
        const m = bulan ? parseInt(bulan) : wibNow.month;
        const y = tahun ? parseInt(tahun) : wibNow.year;
        where.tanggal = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0)) };
      }

      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, avatar: true,
          pegawai: { select: { nama_pegawai: true, jabatan: true, status_kepegawaian: true, nip: true } }
        }
      });

      if (!user) {
        return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
      }

      const settings = await getAbsensiSettings();
      const rawRecords = await prisma.absensi_pegawai.findMany({
        where,
        orderBy: { tanggal: 'desc' }
      });

      const records = enrichRecordsWithTelat(rawRecords, settings.jamMasuk, settings.toleransi);

      const allStatuses = ['hadir', 'izin', 'sakit', 'alpha', 'cuti', 'dinas_luar', 'wfh', 'wfa'];
      const summary = {};
      allStatuses.forEach(s => { summary[s] = 0; });
      records.forEach(r => { if (summary[r.status] !== undefined) summary[r.status]++; });
      summary.total = records.length;
      summary.telat = records.filter(r => r.telat_masuk_menit > 0).length;

      return res.json({
        success: true,
        data: { user, records, summary, periode, settings: { jam_masuk: settings.jamMasuk, toleransi_terlambat: settings.toleransi } }
      });
    } catch (error) {
      console.error('[Absensi] History per user error:', error);
      return res.status(500).json({ success: false, message: 'Gagal memuat history', error: error.message });
    }
  },

  // ═══════════════════════════════════════════════════════════
  // ─── Success Messages (Popup setelah absen berhasil) ──────
  // ═══════════════════════════════════════════════════════════

  /**
   * Public: Get all active success messages
   * GET /api/absensi/success-messages
   */
  async getSuccessMessages(req, res) {
    try {
      const messages = await prisma.absensi_success_messages.findMany({
        where: { is_active: true },
        orderBy: { type: 'asc' },
      });
      const result = {};
      messages.forEach(m => {
        result[m.type] = {
          id: Number(m.id),
          title: m.title,
          message: m.message,
          image_path: m.image_path,
          is_active: m.is_active,
        };
      });
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('[Absensi] Get success messages error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data', error: error.message });
    }
  },

  /**
   * Admin: Get all success messages (including inactive)
   * GET /api/absensi/admin/success-messages
   */
  async getAdminSuccessMessages(req, res) {
    try {
      const messages = await prisma.absensi_success_messages.findMany({
        orderBy: { type: 'asc' },
      });
      return res.json({ success: true, data: messages });
    } catch (error) {
      console.error('[Absensi] Admin get success messages error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data', error: error.message });
    }
  },

  /**
   * Admin: Update a success message
   * PUT /api/absensi/admin/success-messages/:type
   * Body: { title, message, is_active } + optional image via base64
   */
  async updateSuccessMessage(req, res) {
    try {
      const { type } = req.params;
      const { title, message, is_active, image_base64, remove_image } = req.body;
      const userId = BigInt(req.user.id);

      const validTypes = ['masuk', 'pulang', 'wfh', 'dinas_luar', 'wfa', 'izin', 'sakit', 'cuti'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ success: false, message: 'Tipe tidak valid' });
      }

      const updateData = { updated_by: userId, updated_at: new Date() };
      if (title !== undefined) updateData.title = title;
      if (message !== undefined) updateData.message = message;
      if (is_active !== undefined) updateData.is_active = is_active;

      // Handle image upload (base64)
      if (image_base64) {
        const dir = path.join(__dirname, '../../storage/uploads/absensi_popup');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const base64Clean = image_base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Clean, 'base64');
        const ext = image_base64.match(/^data:image\/(\w+);/) ? image_base64.match(/^data:image\/(\w+);/)[1] : 'png';
        const filename = `popup_${type}_${Date.now()}.${ext}`;
        const filepath = path.join(dir, filename);
        fs.writeFileSync(filepath, buffer);
        updateData.image_path = `uploads/absensi_popup/${filename}`;

        // Delete old image if exists
        const existing = await prisma.absensi_success_messages.findUnique({ where: { type } });
        if (existing?.image_path) {
          const oldPath = path.join(__dirname, '../../storage', existing.image_path);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      }

      // Handle image removal
      if (remove_image) {
        const existing = await prisma.absensi_success_messages.findUnique({ where: { type } });
        if (existing?.image_path) {
          const oldPath = path.join(__dirname, '../../storage', existing.image_path);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        updateData.image_path = null;
      }

      const result = await prisma.absensi_success_messages.upsert({
        where: { type },
        update: updateData,
        create: {
          type,
          title: title || '',
          message: message || '',
          image_path: updateData.image_path || null,
          is_active: is_active !== undefined ? is_active : true,
          updated_by: userId,
        },
      });

      return res.json({ success: true, message: 'Berhasil diupdate', data: result });
    } catch (error) {
      console.error('[Absensi] Update success message error:', error);
      return res.status(500).json({ success: false, message: 'Gagal update', error: error.message });
    }
  },
};

module.exports = absensiController;
