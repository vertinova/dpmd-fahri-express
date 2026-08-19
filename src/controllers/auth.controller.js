const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateToken, invalidateRoleCache } = require('../middlewares/auth');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { validateDesaProfile, mustCompleteDesaProfile } = require('../config/desaProfile');

const JWT_SECRET = process.env.JWT_SECRET;

// Password bawaan (seeder). User yang masih memakai ini WAJIB menggantinya dulu.
const DEFAULT_PASSWORD = 'password';

// Apakah hash password ini masih sama dengan password default?
const isUsingDefaultPassword = async (passwordHash) => {
  try {
    return await bcrypt.compare(DEFAULT_PASSWORD, passwordHash);
  } catch {
    return false;
  }
};

// Validasi koordinat lokasi yang dikirim klien (lokasi WAJIB saat login).
/**
 * Hak akses fitur halaman desa untuk akun operasional (role `desa`).
 * Role lain tidak memakai mekanisme ini sehingga selalu mengembalikan array kosong.
 */
const loadDesaPermissions = async (userId, role) => {
  if (String(role || '').trim().toLowerCase() !== 'desa') return [];
  try {
    const rows = await prisma.desa_user_permissions.findMany({
      where: { user_id: BigInt(String(userId)) },
      select: { permission_key: true }
    });
    return rows.map((row) => row.permission_key);
  } catch (error) {
    logger.error(`Gagal memuat hak akses desa untuk user ${userId}:`, error.message);
    return [];
  }
};

const parseCoordinate = (value, min, max) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
};

/**
 * Login - Validate credentials and return Express JWT token
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Lokasi WAJIB saat login — koordinat valid harus disertakan.
    const latitude = parseCoordinate(req.body.latitude, -90, 90);
    const longitude = parseCoordinate(req.body.longitude, -180, 180);
    if (latitude === null || longitude === null) {
      return res.status(422).json({
        success: false,
        code: 'LOCATION_REQUIRED',
        message: 'Lokasi wajib diaktifkan untuk login. Izinkan akses lokasi lalu coba lagi.'
      });
    }

    // Query user from database using Prisma
    const user = await prisma.users.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        role: true,
        avatar: true,
        desa_id: true,
        jabatan_desa: true,
        no_hp: true,
        kecamatan_id: true,
        bidang_id: true,
        dinas_id: true,
        pegawai_id: true,
        pegawai: {
          select: {
            id_pegawai: true,
            id_bidang: true,
            sub_bidang: true,
            nama_pegawai: true,
            nip: true,
            jabatan: true,
            tanggal_lahir: true,
            status_kepegawaian: true,
            pangkat: true,
            golongan: true,
            bidangs: {
              select: {
                id: true,
                nama: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      logger.warn(`Login failed: User not found - ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      logger.warn(`Login failed: Invalid password - ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    logger.info(`✅ Login successful: ${user.email} (${user.role})`);

    // Role user disimpan di cache middleware selama 60 detik. Bila rolenya baru
    // saja diubah langsung di database (migrasi/SQL manual) cache itu masih
    // memegang role lama, sedangkan token yang dibuat di bawah memakai role baru
    // dari baris ini — perbandingan keduanya gagal dan request pertama setelah
    // login dibalas 401 ROLE_CHANGED. Segarkan cache-nya di sini supaya login
    // yang baru saja berhasil tidak langsung dipentalkan.
    invalidateRoleCache(user.id);

    // Record success login history (fire-and-forget) — sertakan koordinat lokasi.
    recordLoginHistory(req, user.id, 'success', { latitude, longitude });

    // Auto-register device_id if provided
    const { device_id } = req.body;
    if (device_id) {
      await prisma.users.update({
        where: { id: user.id },
        data: { device_id }
      });
      logger.info(`📱 Device registered for ${user.email}: ${device_id.substring(0, 8)}...`);
    }

    // Helper to convert BigInt to string
    const convertBigInt = (value) => {
      if (value === null || value === undefined) return value;
      return typeof value === 'bigint' ? value.toString() : value;
    };

    // Build complete user response with nested desa and kecamatan (same as verifyToken)
    // Priority: get bidang_id from pegawai.id_bidang, fallback to users.bidang_id
    let finalBidangId = user.bidang_id;
    let bidangName = null;
    
    if (user.pegawai && user.pegawai.bidangs) {
      // Use bidang from pegawai relation (more accurate)
      finalBidangId = Number(user.pegawai.id_bidang);
      bidangName = user.pegawai.bidangs.nama;
      
      // Sync users.bidang_id if it doesn't match
      if (user.bidang_id !== finalBidangId) {
        await prisma.users.update({
          where: { id: user.id },
          data: { bidang_id: finalBidangId }
        });
        logger.info(`🔧 Synced bidang_id for user ${user.email}: ${user.bidang_id} → ${finalBidangId}`);
      }
    }

    // Generate JWT token AFTER finalBidangId is determined
    // Create user object with correct bidang_id for token generation
    const userForToken = {
      ...user,
      bidang_id: finalBidangId
    };
    const token = generateToken(userForToken);
    
    const responseData = {
      id: convertBigInt(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar || null,
      desa_id: convertBigInt(user.desa_id),
      kecamatan_id: convertBigInt(user.kecamatan_id),
      bidang_id: finalBidangId,
      bidang_name: bidangName,
      dinas_id: convertBigInt(user.dinas_id),
      pegawai_id: convertBigInt(user.pegawai_id),
      nip: user.pegawai?.nip || null,
      jabatan: user.pegawai?.jabatan || null,
      tanggal_lahir: user.pegawai?.tanggal_lahir || null,
      status_kepegawaian: user.pegawai?.status_kepegawaian?.replace(/_/g, ' ') || null,
      pangkat: user.pegawai?.pangkat || null,
      golongan: user.pegawai?.golongan || null,
      sub_bidang: user.pegawai?.sub_bidang || null,
      // Wajib ganti password bila masih memakai password default 'password'.
      must_change_password: await isUsingDefaultPassword(user.password),
      // Fitur halaman desa yang boleh dibuka akun ini (diatur Admin Desa).
      desa_permissions: await loadDesaPermissions(user.id, user.role),
      jabatan_desa: user.jabatan_desa || null,
      no_hp: user.no_hp || null,
      // Admin Desa wajib melengkapi identitas dulu sebelum boleh beraktivitas.
      must_complete_profile: mustCompleteDesaProfile(user)
    };

    // If user has desa_id, fetch related desa and kecamatan
    if (user.desa_id) {
      try {
        const desa = await prisma.desas.findUnique({
          where: { id: user.desa_id },
          select: {
            id: true,
            nama: true,
            kode: true,
            kecamatan_id: true,
            status_pemerintahan: true
          }
        });

        if (desa) {
          responseData.desa = {
            id: convertBigInt(desa.id),
            nama: desa.nama,
            kode: desa.kode,
            kecamatan_id: convertBigInt(desa.kecamatan_id),
            status_pemerintahan: desa.status_pemerintahan
          };

          // Fetch related kecamatan
          const kecamatan = await prisma.kecamatans.findUnique({
            where: { id: desa.kecamatan_id },
            select: {
              id: true,
              nama: true,
              kode: true
            }
          });

          if (kecamatan) {
            responseData.desa.kecamatan = {
              id: convertBigInt(kecamatan.id),
              nama: kecamatan.nama,
              kode: kecamatan.kode
            };
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch desa/kecamatan for user ${user.email}:`, error);
        // Continue without desa data if fetch fails
      }
    }

    // If user has kecamatan_id (and no desa_id), fetch kecamatan name directly
    if (user.kecamatan_id && !responseData.desa) {
      try {
        const kecamatan = await prisma.kecamatans.findUnique({
          where: { id: user.kecamatan_id },
          select: {
            id: true,
            nama: true,
            kode: true
          }
        });

        if (kecamatan) {
          responseData.kecamatan_name = kecamatan.nama;
          responseData.kecamatan = {
            id: convertBigInt(kecamatan.id),
            nama: kecamatan.nama,
            kode: kecamatan.kode
          };
        }
      } catch (error) {
        logger.warn(`Failed to fetch kecamatan for user ${user.email}:`, error);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: responseData
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Parse user-agent string into device info
 */
const parseUserAgent = (ua) => {
  if (!ua) return { device_type: 'unknown', browser: 'unknown', os: 'unknown' };

  // Detect device type
  let device_type = 'desktop';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(ua)) device_type = 'mobile';
  else if (/tablet|ipad|playbook|silk/i.test(ua)) device_type = 'tablet';

  // Detect browser
  let browser = 'unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';

  // Detect OS
  let os = 'unknown';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua) && !/android/i.test(ua)) os = 'Linux';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';

  return { device_type, browser, os };
};

/**
 * Record login history (fire-and-forget, no await needed)
 */
const recordLoginHistory = (req, userId, status = 'success', location = {}) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
      || req.headers['x-real-ip']
      || req.connection?.remoteAddress
      || req.socket?.remoteAddress
      || null;
    const ua = req.headers['user-agent'] || null;
    const { device_type, browser, os } = parseUserAgent(ua);

    prisma.login_histories.create({
      data: {
        user_id: BigInt(userId),
        ip_address: ip,
        user_agent: ua ? ua.substring(0, 500) : null,
        device_id: req.body.device_id || null,
        device_type,
        browser,
        os,
        status,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null
      }
    }).catch(err => logger.error('Failed to record login history:', err));
  } catch (err) {
    logger.error('recordLoginHistory error:', err);
  }
};

/**
 * Verify Token - Check if Express JWT token is valid and return complete user data
 */
const verifyToken = async (req, res) => {
  try {
    // req.user already populated by auth middleware
    const userId = req.user.id;
    
    // Fetch complete user data with desa and kecamatan relations
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        password: true,
        avatar: true,
        desa_id: true,
        jabatan_desa: true,
        no_hp: true,
        kecamatan_id: true,
        bidang_id: true,
        dinas_id: true,
        pegawai_id: true,
        pegawai: {
          select: {
            id_pegawai: true,
            id_bidang: true,
            sub_bidang: true,
            nip: true,
            jabatan: true,
            tanggal_lahir: true,
            status_kepegawaian: true,
            pangkat: true,
            golongan: true,
            bidangs: {
              select: {
                id: true,
                nama: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Helper to convert BigInt to string
    const convertBigInt = (value) => {
      if (value === null || value === undefined) return value;
      return typeof value === 'bigint' ? value.toString() : value;
    };

    // Prepare response data
    const bidangName = user.pegawai?.bidangs?.nama || null;
    const responseData = {
      id: convertBigInt(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar || null,
      desa_id: convertBigInt(user.desa_id),
      kecamatan_id: convertBigInt(user.kecamatan_id),
      bidang_id: convertBigInt(user.bidang_id),
      bidang_name: bidangName,
      dinas_id: convertBigInt(user.dinas_id),
      pegawai_id: convertBigInt(user.pegawai_id),
      nip: user.pegawai?.nip || null,
      jabatan: user.pegawai?.jabatan || null,
      tanggal_lahir: user.pegawai?.tanggal_lahir || null,
      status_kepegawaian: user.pegawai?.status_kepegawaian?.replace(/_/g, ' ') || null,
      pangkat: user.pegawai?.pangkat || null,
      golongan: user.pegawai?.golongan || null,
      sub_bidang: user.pegawai?.sub_bidang || null,
      // Wajib ganti password bila masih memakai password default 'password'.
      must_change_password: await isUsingDefaultPassword(user.password),
      // Fitur halaman desa yang boleh dibuka akun ini (diatur Admin Desa).
      desa_permissions: await loadDesaPermissions(user.id, user.role),
      jabatan_desa: user.jabatan_desa || null,
      no_hp: user.no_hp || null,
      // Admin Desa wajib melengkapi identitas dulu sebelum boleh beraktivitas.
      must_complete_profile: mustCompleteDesaProfile(user)
    };

    // If user has desa_id, fetch desa data with kecamatan
    if (user.desa_id) {
      const desa = await prisma.desas.findUnique({
        where: { id: user.desa_id },
        select: {
          id: true,
          nama: true,
          kode: true,
          kecamatan_id: true,
          status_pemerintahan: true
        }
      });

      if (desa) {
        responseData.desa = {
          id: convertBigInt(desa.id),
          nama: desa.nama,
          kode: desa.kode,
          kecamatan_id: convertBigInt(desa.kecamatan_id),
          status_pemerintahan: desa.status_pemerintahan
        };

        // Fetch kecamatan data
        const kecamatan = await prisma.kecamatans.findUnique({
          where: { id: desa.kecamatan_id },
          select: {
            id: true,
            nama: true,
            kode: true
          }
        });

        if (kecamatan) {
          responseData.desa.kecamatan = {
            id: convertBigInt(kecamatan.id),
            nama: kecamatan.nama,
            kode: kecamatan.kode
          };
        }
      }
    }

    // If user has kecamatan_id (and no desa), fetch kecamatan name directly
    if (user.kecamatan_id && !responseData.desa) {
      try {
        const kecamatan = await prisma.kecamatans.findUnique({
          where: { id: user.kecamatan_id },
          select: {
            id: true,
            nama: true,
            kode: true
          }
        });

        if (kecamatan) {
          responseData.kecamatan_name = kecamatan.nama;
          responseData.kecamatan = {
            id: convertBigInt(kecamatan.id),
            nama: kecamatan.nama,
            kode: kecamatan.kode
          };
        }
      } catch (error) {
        logger.warn(`Failed to fetch kecamatan for user ${user.email}:`, error);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        user: responseData
      }
    });
  } catch (error) {
    logger.error('Verify token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get Profile - Get current user profile with complete relations
 */
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch complete user data
    const user = await prisma.users.findUnique({
      where: { id: BigInt(userId) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        password: true,
        avatar: true,
        desa_id: true,
        jabatan_desa: true,
        no_hp: true,
        kecamatan_id: true,
        bidang_id: true,
        dinas_id: true,
        pegawai_id: true,
        pegawai: {
          select: {
            id_pegawai: true,
            id_bidang: true,
            sub_bidang: true,
            nip: true,
            jabatan: true,
            tanggal_lahir: true,
            status_kepegawaian: true,
            pangkat: true,
            golongan: true,
            bidangs: {
              select: {
                id: true,
                nama: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Helper to convert BigInt to string
    const convertBigInt = (value) => {
      if (value === null || value === undefined) return value;
      return typeof value === 'bigint' ? value.toString() : value;
    };

    // Prepare response data
    const bidangName = user.pegawai?.bidangs?.nama || null;
    const responseData = {
      id: convertBigInt(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar || null,
      desa_id: convertBigInt(user.desa_id),
      kecamatan_id: convertBigInt(user.kecamatan_id),
      bidang_id: convertBigInt(user.bidang_id),
      bidang_name: bidangName,
      dinas_id: convertBigInt(user.dinas_id),
      pegawai_id: convertBigInt(user.pegawai_id),
      nip: user.pegawai?.nip || null,
      jabatan: user.pegawai?.jabatan || null,
      tanggal_lahir: user.pegawai?.tanggal_lahir || null,
      status_kepegawaian: user.pegawai?.status_kepegawaian?.replace(/_/g, ' ') || null,
      pangkat: user.pegawai?.pangkat || null,
      golongan: user.pegawai?.golongan || null,
      sub_bidang: user.pegawai?.sub_bidang || null,
      // Wajib ganti password bila masih memakai password default 'password'.
      must_change_password: await isUsingDefaultPassword(user.password),
      // Fitur halaman desa yang boleh dibuka akun ini (diatur Admin Desa).
      desa_permissions: await loadDesaPermissions(user.id, user.role),
      jabatan_desa: user.jabatan_desa || null,
      no_hp: user.no_hp || null,
      // Admin Desa wajib melengkapi identitas dulu sebelum boleh beraktivitas.
      must_complete_profile: mustCompleteDesaProfile(user)
    };

    // If user has desa_id, fetch desa data with kecamatan
    if (user.desa_id) {
      try {
        const desa = await prisma.desas.findUnique({
          where: { id: user.desa_id },
          select: {
            id: true,
            nama: true,
            kode: true,
            kecamatan_id: true,
            status_pemerintahan: true
          }
        });

        if (desa) {
          responseData.desa = {
            id: convertBigInt(desa.id),
            nama: desa.nama,
            kode: desa.kode,
            kecamatan_id: convertBigInt(desa.kecamatan_id),
            status_pemerintahan: desa.status_pemerintahan
          };

          // Fetch kecamatan data
          const kecamatan = await prisma.kecamatans.findUnique({
            where: { id: desa.kecamatan_id },
            select: {
              id: true,
              nama: true,
              kode: true
            }
          });

          if (kecamatan) {
            responseData.desa.kecamatan = {
              id: convertBigInt(kecamatan.id),
              nama: kecamatan.nama,
              kode: kecamatan.kode
            };
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch desa/kecamatan for user ID ${userId}:`, error);
      }
    }

    // If user has kecamatan_id (and no desa), fetch kecamatan name directly
    if (user.kecamatan_id && !responseData.desa) {
      try {
        const kecamatan = await prisma.kecamatans.findUnique({
          where: { id: user.kecamatan_id },
          select: {
            id: true,
            nama: true,
            kode: true
          }
        });

        if (kecamatan) {
          responseData.kecamatan_name = kecamatan.nama;
          responseData.kecamatan = {
            id: convertBigInt(kecamatan.id),
            nama: kecamatan.nama,
            kode: kecamatan.kode
          };
        }
      } catch (error) {
        logger.warn(`Failed to fetch kecamatan for user ID ${userId}:`, error);
      }
    }

    return res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Check VPN Access - Detect if request is from Tailscale VPN
 * SECURITY: Multi-layer VPN detection for production environment
 */
const checkVpnAccess = async (req, res) => {
  try {
    // Get client IP address (handle proxy/forwarded IPs)
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     req.headers['x-real-ip'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress;

    logger.info(`VPN Check - Client IP: ${clientIP}, Headers: ${JSON.stringify({
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'user-agent': req.headers['user-agent']
    })}`);

    // Function to check if IP is in Tailscale range (100.64.0.0/10)
    const isIPInTailscaleRange = (ip) => {
      // Allow localhost for development
      if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
        logger.info('✅ VPN Check: Localhost detected (development mode)');
        return true;
      }

      // Remove IPv6 prefix if present
      const cleanIP = ip.replace('::ffff:', '');
      
      // Check Tailscale range: 100.64.0.0 to 100.127.255.255
      const parts = cleanIP.split('.');
      if (parts.length !== 4) return false;
      
      const firstOctet = parseInt(parts[0]);
      const secondOctet = parseInt(parts[1]);
      
      // Tailscale uses 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
      const isInRange = firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127;
      
      if (isInRange) {
        logger.info(`✅ VPN Check: Tailscale IP detected - ${cleanIP}`);
      } else {
        logger.info(`❌ VPN Check: Non-VPN IP - ${cleanIP}`);
      }
      
      return isInRange;
    };

    // SECURITY ENHANCEMENT: Check if request is directly to VPS Tailscale IP
    const requestHost = req.headers.host || req.hostname;
    const isTailscaleDirectAccess = requestHost.startsWith('100.107.112.30'); // VPS Tailscale IP
    
    if (isTailscaleDirectAccess) {
      logger.info(`✅ VPN Check: Direct Tailscale access detected via ${requestHost}`);
      return res.status(200).json({
        success: true,
        data: {
          isVpn: true,
          ip: clientIP,
          accessType: 'direct-tailscale',
          message: 'VPN connection detected (Direct Tailscale Access)'
        }
      });
    }

    // Standard IP range check (for VPN users accessing via public domain)
    const isVpn = isIPInTailscaleRange(clientIP);

    // Additional security: Log VPN access attempts for audit
    if (isVpn) {
      logger.info(`🔐 VPN ACCESS GRANTED: IP=${clientIP}, Host=${requestHost}`);
    } else {
      logger.warn(`⚠️ VPN ACCESS DENIED: IP=${clientIP}, Host=${requestHost}`);
    }

    return res.status(200).json({
      success: true,
      data: {
        isVpn,
        ip: clientIP,
        accessType: isVpn ? 'vpn-range' : 'public',
        message: isVpn ? 'VPN connection detected' : 'Not connected via VPN'
      }
    });
  } catch (error) {
    logger.error('Check VPN error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Check Tailscale VPN - Strict verification for VPN access
 * HYBRID APPROACH: Check both IP range AND secret key
 * - If from Tailscale IP: Auto-grant access
 * - If from public IP but has valid secret: Grant access (for Cloudflare/proxy cases)
 */
const checkTailscaleVpn = async (req, res) => {
  try {
    // Get all possible IP sources
    const forwardedFor = req.headers['x-forwarded-for'];
    const realIP = req.headers['x-real-ip'];
    const cfConnectingIP = req.headers['cf-connecting-ip']; // Cloudflare
    const remoteAddr = req.connection.remoteAddress || req.socket.remoteAddress;
    
    // 🔥 DEBUG: Log ALL IP headers
    logger.info('🌐 IP Detection Debug:', {
      'X-Forwarded-For': forwardedFor,
      'X-Real-IP': realIP,
      'CF-Connecting-IP': cfConnectingIP,
      'Remote Address': remoteAddr,
      'All Headers': JSON.stringify(req.headers, null, 2)
    });
    
    // Get VPN secret key from query or header
    const vpnSecret = req.query.secret || req.headers['x-vpn-secret'];
    const expectedSecret = process.env.VPN_SECRET_KEY || 'DPMD-INTERNAL-2025'; // Set in .env
    
    // Parse forwarded IPs - Try multiple sources in priority order
    let clientIP = remoteAddr;
    
    // Priority 1: Cloudflare connecting IP (most reliable)
    if (cfConnectingIP) {
      clientIP = cfConnectingIP.trim();
      logger.info('🔍 Using CF-Connecting-IP:', clientIP);
    }
    // Priority 2: X-Real-IP (common with Nginx)
    else if (realIP) {
      clientIP = realIP.trim();
      logger.info('🔍 Using X-Real-IP:', clientIP);
    }
    // Priority 3: X-Forwarded-For (take LAST IP = closest to server)
    else if (forwardedFor) {
      const ips = forwardedFor.split(',').map(ip => ip.trim());
      // For Tailscale, the LAST IP is usually the real client IP
      clientIP = ips[ips.length - 1];
      logger.info('🔍 Using X-Forwarded-For (last IP):', clientIP, 'from chain:', ips);
    }
    // Priority 4: Direct connection
    else {
      logger.info('🔍 Using remoteAddress:', clientIP);
    }

    logger.info(`🔐 Tailscale VPN Check:`, {
      ip: clientIP,
      hasSecret: !!vpnSecret,
      secretMatch: vpnSecret === expectedSecret,
      headers: {
        'x-forwarded-for': forwardedFor,
        'x-real-ip': realIP,
        'host': req.headers.host
      }
    });

    // Function to check if IP is in Tailscale range (100.64.0.0/10)
    const isIPInTailscaleRange = (ip) => {
      // Allow localhost for development
      if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
        logger.info('✅ Tailscale Check: Localhost detected (development mode)');
        return true;
      }

      // Remove IPv6 prefix if present
      const cleanIP = ip.replace('::ffff:', '');
      
      // Check Tailscale range: 100.64.0.0 to 100.127.255.255
      const parts = cleanIP.split('.');
      if (parts.length !== 4) return false;
      
      const firstOctet = parseInt(parts[0]);
      const secondOctet = parseInt(parts[1]);
      
      // Tailscale uses 100.64.0.0/10
      return firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127;
    };

    const isVpnIP = isIPInTailscaleRange(clientIP);
    const hasValidSecret = vpnSecret && vpnSecret === expectedSecret;

    // ✅ GRANT ACCESS IF: Tailscale IP OR valid secret key
    if (isVpnIP || hasValidSecret) {
      const accessMethod = isVpnIP ? 'tailscale-ip' : 'secret-key';
      logger.info(`✅ VPN ACCESS GRANTED via ${accessMethod}: IP=${clientIP}`);
      
      return res.status(200).json({
        success: true,
        data: {
          isVpn: true,
          ip: clientIP,
          accessMethod,
          message: 'VPN access verified'
        }
      });
    }

    // ❌ DENY ACCESS
    logger.warn(`🚫 VPN ACCESS BLOCKED: IP=${clientIP}, InvalidSecret=${!!vpnSecret && !hasValidSecret}`);
    return res.status(403).json({
      success: false,
      message: 'VPN connection or valid secret key required',
      data: {
        isVpn: false,
        ip: clientIP,
        reason: 'Not connected via Tailscale VPN and no valid secret provided'
      }
    });
  } catch (error) {
    logger.error('Tailscale VPN check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Force Change Password - khusus user yang MASIH memakai password default.
 * Tidak butuh password lama (user terbukti default & sudah terautentikasi sesi ini).
 */
const forceChangePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { newPassword } = req.body;

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ success: false, message: 'Password baru wajib diisi' });
    }
    if (newPassword.length < 8) {
      return res.status(422).json({ success: false, message: 'Password baru minimal 8 karakter' });
    }
    if (newPassword === DEFAULT_PASSWORD) {
      return res.status(422).json({ success: false, message: "Password tidak boleh memakai password default '" + DEFAULT_PASSWORD + "'" });
    }

    const user = await prisma.users.findUnique({ where: { id: BigInt(userId) } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    // Hanya boleh dipakai bila memang masih memakai password default.
    if (!(await isUsingDefaultPassword(user.password))) {
      return res.status(409).json({ success: false, message: 'Password Anda sudah bukan default, tidak perlu diganti di sini' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.users.update({
      where: { id: BigInt(userId) },
      data: {
        password: hashedPassword,
        plain_password: user.role === 'superadmin' ? null : newPassword
      }
    });

    logger.info(`🔑 Default password changed for ${user.email}`);
    return res.json({ success: true, message: 'Password berhasil diganti' });
  } catch (error) {
    logger.error('forceChangePassword error:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengganti password', error: error.message });
  }
};

/**
 * Tukar token kedaluwarsa dengan token baru, tanpa memaksa user login ulang.
 *
 * Sesi di aplikasi ini memang dirancang permanen — user hanya keluar kalau dia
 * sendiri menekan keluar. Tapi JWT-nya berumur JWT_EXPIRES_IN (7 hari): kalau
 * PWA tidak dibuka selama itu, perpanjangan bergulir lewat header
 * X-Renewed-Token tidak pernah kebagian jalan dan tokennya mati. Tanpa endpoint
 * ini, request pertama setelah user kembali dibalas 401 dan dia terlempar keluar
 * padahal tidak pernah menekan keluar.
 *
 * Sengaja TIDAK memakai middleware `auth` (tokennya memang sudah kedaluwarsa).
 * Yang tetap diperiksa: tanda tangan token harus sah, akunnya harus masih ada
 * dan aktif, dan rolenya harus sama dengan yang tercatat di token. Jadi
 * pemanggilnya tetap wajib memegang token yang pernah kita terbitkan sendiri.
 */
const renewToken = async (req, res) => {
  try {
    const token = String(
      req.body?.token || req.header('Authorization')?.replace('Bearer ', '') || ''
    ).trim();

    if (!token) {
      return res.status(400).json({
        success: false,
        code: 'TOKEN_REQUIRED',
        message: 'Token lama wajib disertakan'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    } catch {
      // Tanda tangan tidak cocok / token bukan terbitan kita.
      return res.status(401).json({
        success: false,
        code: 'SESSION_INVALID',
        message: 'Sesi tidak dikenali. Silakan login kembali.'
      });
    }

    const user = await prisma.users.findUnique({
      where: { id: BigInt(String(decoded.id)) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        is_active: true,
        desa_id: true,
        kecamatan_id: true,
        bidang_id: true,
        dinas_id: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_INVALID',
        message: 'Akun tidak ditemukan. Silakan login kembali.'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        message: 'Akun Anda dinonaktifkan. Hubungi admin.'
      });
    }

    if (String(user.role) !== String(decoded.role)) {
      return res.status(401).json({
        success: false,
        code: 'ROLE_CHANGED',
        message: 'Hak akses akun Anda telah diperbarui. Silakan login kembali.'
      });
    }

    invalidateRoleCache(user.id);
    logger.info(`♻️  Sesi diperbarui tanpa login ulang: ${user.email} (${user.role})`);

    return res.json({
      success: true,
      message: 'Sesi diperbarui',
      data: { token: generateToken(user) }
    });
  } catch (error) {
    logger.error('renewToken error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui sesi',
      error: error.message
    });
  }
};

/**
 * Simpan identitas Admin Desa (nama asli, jabatan, nomor HP).
 * Dipakai oleh popup wajib-isi maupun form ubah identitas di halaman Pengaturan.
 */
const saveDesaProfile = async (req, res) => {
  try {
    const allowedRoles = ['admin_desa', 'desa'];
    if (!allowedRoles.includes(String(req.user.role || '').trim().toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: 'Identitas ini hanya berlaku untuk akun desa'
      });
    }

    const { valid, errors, value } = validateDesaProfile(req.body);
    if (!valid) {
      return res.status(422).json({
        success: false,
        message: 'Data belum lengkap atau tidak valid',
        errors
      });
    }

    const userId = BigInt(String(req.user.id));
    const updated = await prisma.users.update({
      where: { id: userId },
      data: {
        name: value.name,
        jabatan_desa: value.jabatan_desa,
        no_hp: value.no_hp,
        updated_at: new Date()
      },
      select: { id: true, name: true, role: true, jabatan_desa: true, no_hp: true }
    });

    logger.info(`👤 Identitas desa disimpan: ${req.user.email} → ${value.name} (${value.jabatan_desa}, ${value.no_hp})`);

    return res.json({
      success: true,
      message: 'Identitas berhasil disimpan',
      data: {
        name: updated.name,
        jabatan_desa: updated.jabatan_desa,
        no_hp: updated.no_hp,
        must_complete_profile: mustCompleteDesaProfile(updated)
      }
    });
  } catch (error) {
    logger.error('saveDesaProfile error:', error);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan identitas', error: error.message });
  }
};

module.exports = {
  login,
  verifyToken,
  getProfile,
  forceChangePassword,
  saveDesaProfile,
  renewToken
};
