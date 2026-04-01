const bcrypt = require('bcryptjs');
const { generateToken } = require('../middlewares/auth');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

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
        kecamatan_id: true,
        bidang_id: true,
        dinas_id: true,
        pegawai_id: true,
        pegawai: {
          select: {
            id_pegawai: true,
            id_bidang: true,
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
      golongan: user.pegawai?.golongan || null
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
        avatar: true,
        desa_id: true,
        kecamatan_id: true,
        bidang_id: true,
        dinas_id: true,
        pegawai_id: true,
        pegawai: {
          select: {
            id_pegawai: true,
            id_bidang: true,
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
      golongan: user.pegawai?.golongan || null
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
        avatar: true,
        desa_id: true,
        kecamatan_id: true,
        bidang_id: true,
        dinas_id: true,
        pegawai_id: true,
        pegawai: {
          select: {
            id_pegawai: true,
            id_bidang: true,
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
      golongan: user.pegawai?.golongan || null
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

module.exports = {
  login,
  verifyToken,
  getProfile
};
