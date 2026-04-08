/**
 * User Management Controller
 * Handles CRUD operations for user management
 */

const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const path = require('path');

class UserController {
  /**
   * Get all users with filtering and pagination
   */
  async getAllUsers(req, res) {
    try {
      const { 
        role, 
        kecamatan_id, 
        desa_id, 
        bidang_id,
        search,
        page = 1, 
        limit = 50 
      } = req.query;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build filter conditions
      const where = {};
      
      if (role) {
        where.role = role;
      }
      
      if (kecamatan_id) {
        where.kecamatan_id = parseInt(kecamatan_id);
      }
      
      if (desa_id) {
        where.desa_id = parseInt(desa_id);
      }
      
      if (bidang_id) {
        where.bidang_id = parseInt(bidang_id);
      }
      
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { email: { contains: search } }
        ];
      }

      // Get users with Prisma relations
      const [users, total] = await Promise.all([
        prisma.users.findMany({
          where,
          skip,
          take: parseInt(limit),
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            bidang_id: true,
            kecamatan_id: true,
            desa_id: true,
            dinas_id: true,
            is_active: true,
            created_at: true,
            updated_at: true,
            pegawai_id: true,
            device_id: true,
            plain_password: true, // Include plain_password for admin view
            // Include pegawai relation (which includes bidangs)
            pegawai: {
              select: {
                id_pegawai: true,
                nama_pegawai: true,
                id_bidang: true,
                nip: true,
                jabatan: true,
                eselon: true,
                unit_kerja: true,
                tmt_jabatan: true,
                pangkat: true,
                golongan: true,
                tempat_lahir: true,
                tanggal_lahir: true,
                status_kepegawaian: true,
                bidangs: {
                  select: {
                    id: true,
                    nama: true
                  }
                }
              }
            }
          },
          orderBy: { created_at: 'desc' }
        }),
        prisma.users.count({ where })
      ]);

      // Fetch kecamatan, desa, and bidang (fallback) manually
      const usersWithRelations = await Promise.all(users.map(async (user) => {
        const userData = { ...user };
        
        // Get bidang from pegawai relation OR fallback to deprecated bidang_id
        if (user.pegawai?.bidangs) {
          // New system: bidang from pegawai table
          userData.bidang = user.pegawai.bidangs;
        } else if (user.bidang_id) {
          // Fallback: bidang from deprecated users.bidang_id column
          const bidang = await prisma.bidangs.findUnique({
            where: { id: BigInt(user.bidang_id) },
            select: { id: true, nama: true }
          });
          userData.bidang = bidang;
        } else {
          userData.bidang = null;
        }
        
        // Get kecamatan if kecamatan_id exists
        if (user.kecamatan_id) {
          const kecamatan = await prisma.kecamatans.findUnique({
            where: { id: user.kecamatan_id },
            select: { id: true, nama: true }
          });
          userData.kecamatan = kecamatan;
        }
        
        // Get desa if desa_id exists
        if (user.desa_id) {
          const desa = await prisma.desas.findUnique({
            where: { id: user.desa_id },
            select: { id: true, nama: true }
          });
          userData.desa = desa;
        }
        
        // Get dinas if dinas_id exists
        if (user.dinas_id) {
          const dinas = await prisma.master_dinas.findUnique({
            where: { id: user.dinas_id },
            select: { id: true, kode_dinas: true, nama_dinas: true, singkatan: true }
          });
          userData.dinas = dinas;
        }
        
        return userData;
      }));

      // Transform data untuk response
      const transformedUsers = usersWithRelations.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        bidang_id: user.bidang_id,
        kecamatan_id: user.kecamatan_id,
        desa_id: user.desa_id,
        dinas_id: user.dinas_id,
        pegawai_id: user.pegawai_id,
        nip: user.pegawai?.nip || null,
        jabatan: user.pegawai?.jabatan || null,
        eselon: user.pegawai?.eselon || null,
        unit_kerja: user.pegawai?.unit_kerja || null,
        tmt_jabatan: user.pegawai?.tmt_jabatan || null,
        pangkat: user.pegawai?.pangkat || null,
        golongan: user.pegawai?.golongan || null,
        tempat_lahir: user.pegawai?.tempat_lahir || null,
        tanggal_lahir: user.pegawai?.tanggal_lahir || null,
        status_kepegawaian: user.pegawai?.status_kepegawaian || null,
        device_id: user.device_id || null,
        // Bidang from pegawai relation OR fallback to deprecated bidang_id
        bidang: user.bidang || null,
        kecamatan: user.kecamatan || null,
        desa: user.desa || null,
        dinas: user.dinas || null,
        is_active: user.is_active,
        plain_password: user.role === 'superadmin' ? null : (user.plain_password || null),
        created_at: user.created_at,
        updated_at: user.updated_at
      }));

      res.json({
        success: true,
        message: 'Users retrieved successfully',
        data: transformedUsers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch users',
        error: error.message
      });
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(req, res) {
    try {
      const { id } = req.params;

      const user = await prisma.users.findUnique({
        where: { id: BigInt(String(id)) },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          bidang_id: true,
          kecamatan_id: true,
          desa_id: true,
          dinas_id: true,
          pegawai_id: true,
          created_at: true,
          updated_at: true,
          // Include pegawai relation
          pegawai: {
            select: {
              id_pegawai: true,
              nama_pegawai: true,
              id_bidang: true,
              nip: true,
              jabatan: true,
              eselon: true,
              unit_kerja: true,
              tmt_jabatan: true,
              pangkat: true,
              golongan: true,
              tempat_lahir: true,
              tanggal_lahir: true,
              status_kepegawaian: true,
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

      // Fetch kecamatan, desa, and bidang (fallback) manually
      const userData = { ...user };
      
      // Get bidang from pegawai relation OR fallback to deprecated bidang_id
      if (user.pegawai?.bidangs) {
        // New system: bidang from pegawai table
        userData.bidang = user.pegawai.bidangs;
      } else if (user.bidang_id) {
        // Fallback: bidang from deprecated users.bidang_id column
        const bidang = await prisma.bidangs.findUnique({
          where: { id: BigInt(user.bidang_id) },
          select: { id: true, nama: true }
        });
        userData.bidang = bidang;
      } else {
        userData.bidang = null;
      }
      
      if (user.kecamatan_id) {
        const kecamatan = await prisma.kecamatans.findUnique({
          where: { id: user.kecamatan_id },
          select: { id: true, nama: true }
        });
        userData.kecamatan = kecamatan;
      }
      
      if (user.desa_id) {
        const desa = await prisma.desas.findUnique({
          where: { id: user.desa_id },
          select: { id: true, nama: true }
        });
        userData.desa = desa;
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = userData;

      res.json({
        success: true,
        message: 'User retrieved successfully',
        data: userWithoutPassword
      });
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user',
        error: error.message
      });
    }
  }

  /**
   * Create new user
   */
  async createUser(req, res) {
    try {
      const { 
        name, 
        email, 
        password, 
        role, 
        bidang_id, 
        kecamatan_id, 
        desa_id,
        dinas_id,
        pegawai_id,
        is_active
      } = req.body;

      // Validate required fields
      if (!name || !email || !password || !role) {
        return res.status(400).json({
          success: false,
          message: 'Name, email, password, and role are required'
        });
      }

      // Check if email already exists
      const existingUser = await prisma.users.findFirst({
        where: { email }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const newUser = await prisma.users.create({
        data: {
          name,
          email,
          password: hashedPassword,
          plain_password: role === 'superadmin' ? null : password, // Never store plain password for superadmin
          role,
          is_active: is_active !== undefined ? is_active : true,
          bidang_id: bidang_id ? parseInt(bidang_id) : null,
          kecamatan_id: kecamatan_id ? parseInt(kecamatan_id) : null,
          desa_id: desa_id ? BigInt(desa_id) : null,
          dinas_id: dinas_id ? parseInt(dinas_id) : null,
          pegawai_id: pegawai_id ? BigInt(pegawai_id) : null
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          is_active: true,
          bidang_id: true,
          kecamatan_id: true,
          desa_id: true,
          dinas_id: true,
          pegawai_id: true,
          created_at: true,
          updated_at: true
        }
      });

      // Return user without password
      const userWithoutPassword = newUser;

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: userWithoutPassword
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create user',
        error: error.message
      });
    }
  }

  /**
   * Update user
   */
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { 
        name, 
        email, 
        password, 
        role, 
        bidang_id,  // This will update pegawai.id_bidang, not users.bidang_id
        kecamatan_id, 
        desa_id,
        dinas_id,
        pegawai_id,
        is_active,
        tanggal_lahir,
        tempat_lahir,
        jabatan,
        nip,
        status_kepegawaian,
        eselon,
        unit_kerja,
        tmt_jabatan
      } = req.body;

      // Convert id to BigInt for proper comparison
      const userId = BigInt(id);

      // Check if user exists
      const existingUser = await prisma.users.findUnique({
        where: { id: userId },
        include: { pegawai: true }
      });

      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if email already taken by another user
      if (email) {
        const duplicateUser = await prisma.users.findFirst({
          where: {
            AND: [
              { id: { not: userId } },
              { email }
            ]
          }
        });

        if (duplicateUser) {
          return res.status(400).json({
            success: false,
            message: 'Email already exists'
          });
        }
      }

      // Build update data for users table
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;
      if (role !== undefined) updateData.role = role;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (kecamatan_id !== undefined) updateData.kecamatan_id = kecamatan_id ? parseInt(kecamatan_id) : null;
      
      // Safe BigInt conversion
      if (desa_id !== undefined) {
        updateData.desa_id = desa_id ? BigInt(String(desa_id)) : null;
      }
      if (dinas_id !== undefined) updateData.dinas_id = dinas_id ? parseInt(dinas_id) : null;
      if (pegawai_id !== undefined) {
        updateData.pegawai_id = pegawai_id ? BigInt(String(pegawai_id)) : null;
      }

      // Hash password if provided
      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      // Update tanggal_lahir, jabatan, nip on pegawai table
      const hasPegawaiFields = [tanggal_lahir, tempat_lahir, jabatan, nip, status_kepegawaian, eselon, unit_kerja, tmt_jabatan].some(v => v !== undefined);
      
      if (existingUser.pegawai_id) {
        const pegawaiUpdate = {};
        if (tanggal_lahir !== undefined) pegawaiUpdate.tanggal_lahir = tanggal_lahir ? new Date(tanggal_lahir) : null;
        if (tempat_lahir !== undefined) pegawaiUpdate.tempat_lahir = tempat_lahir || null;
        if (jabatan !== undefined) pegawaiUpdate.jabatan = jabatan || null;
        if (nip !== undefined) pegawaiUpdate.nip = nip || null;
        if (status_kepegawaian !== undefined) pegawaiUpdate.status_kepegawaian = status_kepegawaian || null;
        if (eselon !== undefined) pegawaiUpdate.eselon = eselon || null;
        if (unit_kerja !== undefined) pegawaiUpdate.unit_kerja = unit_kerja || null;
        if (tmt_jabatan !== undefined) pegawaiUpdate.tmt_jabatan = tmt_jabatan ? new Date(tmt_jabatan) : null;
        
        if (Object.keys(pegawaiUpdate).length > 0) {
          await prisma.pegawai.update({
            where: { id_pegawai: existingUser.pegawai_id },
            data: pegawaiUpdate
          });
        }
      } else if (hasPegawaiFields) {
        // Auto-create pegawai record for DPMD staff without one
        // Cek bidang: dari user yang ada, dari request body, atau tolak
        const resolvedBidangId = existingUser.bidang_id || (bidang_id ? parseInt(bidang_id) : null);
        if (!resolvedBidangId) {
          return res.status(400).json({ success: false, message: 'User belum memiliki bidang. Silakan set bidang terlebih dahulu sebelum mengisi data pegawai.' });
        }
        const bidangExists = await prisma.bidangs.findUnique({ where: { id: BigInt(String(resolvedBidangId)) } });
        if (!bidangExists) {
          return res.status(400).json({ success: false, message: `Bidang dengan ID ${resolvedBidangId} tidak ditemukan di database.` });
        }
        const newPegawai = await prisma.pegawai.create({
          data: {
            nama_pegawai: existingUser.name,
            id_bidang: BigInt(String(resolvedBidangId)),
            tanggal_lahir: tanggal_lahir ? new Date(tanggal_lahir) : null,
            tempat_lahir: tempat_lahir || null,
            jabatan: jabatan || null,
            nip: nip || null,
            status_kepegawaian: status_kepegawaian || null,
            eselon: eselon || null,
            unit_kerja: unit_kerja || null,
            tmt_jabatan: tmt_jabatan ? new Date(tmt_jabatan) : null,
            created_at: new Date(),
            updated_at: new Date(),
          }
        });
        // Link pegawai to user
        updateData.pegawai_id = newPegawai.id_pegawai;
        // Sinkronkan bidang_id di users table juga
        if (!existingUser.bidang_id) {
          updateData.bidang_id = parseInt(resolvedBidangId);
        }
      }

      // Update bidang: support both systems (pegawai table & deprecated users.bidang_id)
      if (bidang_id !== undefined) {
        if (existingUser.pegawai_id) {
          // New system: update pegawai.id_bidang
          await prisma.pegawai.update({
            where: { id_pegawai: existingUser.pegawai_id },
            data: { id_bidang: bidang_id ? BigInt(String(bidang_id)) : null }
          });
        } else {
          // Fallback: update deprecated users.bidang_id
          updateData.bidang_id = bidang_id ? parseInt(bidang_id) : null;
        }
      }

      // Update user
      const updatedUser = await prisma.users.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          is_active: true,
          bidang_id: true,  // This column exists but might be deprecated
          kecamatan_id: true,
          desa_id: true,
          dinas_id: true,
          pegawai_id: true,
          created_at: true,
          updated_at: true,
          pegawai: {
            select: {
              id_pegawai: true,
              id_bidang: true,
              nip: true,
              jabatan: true,
              eselon: true,
              unit_kerja: true,
              tmt_jabatan: true,
              pangkat: true,
              golongan: true,
              tempat_lahir: true,
              tanggal_lahir: true,
              status_kepegawaian: true,
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

      // Add bidang from pegawai relation OR fallback to deprecated bidang_id
      let bidang = null;
      if (updatedUser.pegawai?.bidangs) {
        // New system: bidang from pegawai table
        bidang = updatedUser.pegawai.bidangs;
      } else if (updatedUser.bidang_id) {
        // Fallback: bidang from deprecated users.bidang_id column
        const bidangData = await prisma.bidangs.findUnique({
          where: { id: BigInt(updatedUser.bidang_id) },
          select: { id: true, nama: true }
        });
        bidang = bidangData;
      }

      const userResponse = {
        ...updatedUser,
        bidang: bidang
      };

      res.json({
        success: true,
        message: 'User updated successfully',
        data: userResponse
      });
    } catch (error) {
      console.error('Error updating user:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        code: error.code
      });
      res.status(500).json({
        success: false,
        message: 'Failed to update user',
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Delete user
   */
  async deleteUser(req, res) {
    try {
      const { id } = req.params;

      // Check if user exists
      const existingUser = await prisma.users.findUnique({
        where: { id: BigInt(String(id)) }
      });

      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Prevent deleting superadmin if it's the last one
      if (existingUser.role === 'superadmin') {
        const superadminCount = await prisma.users.count({
          where: { role: 'superadmin' }
        });

        if (superadminCount <= 1) {
          return res.status(400).json({
            success: false,
            message: 'Cannot delete the last superadmin user'
          });
        }
      }

      // Delete related records first to avoid foreign key constraint errors
      const bigId = BigInt(String(id));

      // 1. Delete disposisi where user is sender (dari_user_id)
      await prisma.disposisi.deleteMany({
        where: { dari_user_id: bigId }
      });

      // 2. Delete disposisi where user is receiver (ke_user_id)
      await prisma.disposisi.deleteMany({
        where: { ke_user_id: bigId }
      });

      // 3. Delete surat_masuk created by user
      await prisma.surat_masuk.deleteMany({
        where: { created_by: bigId }
      });

      // 4. Delete activity logs
      await prisma.activity_logs.deleteMany({
        where: { user_id: bigId }
      });

      // 5. Delete lampiran_surat
      await prisma.lampiran_surat.deleteMany({
        where: { uploaded_by: bigId }
      });

      // 6. Delete push subscriptions
      await prisma.push_subscriptions.deleteMany({
        where: { user_id: bigId }
      });

      // Finally, delete the user
      await prisma.users.delete({
        where: { id: bigId }
      });

      res.json({
        success: true,
        message: 'User and all related records deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete user',
        error: error.message
      });
    }
  }

  /**
   * Reset user password
   */
  async resetPassword(req, res) {
    try {
      const { id } = req.params;
      const { password } = req.body;

      // Validate password
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required'
        });
      }

      // Check if user exists
      const existingUser = await prisma.users.findUnique({
        where: { id: BigInt(String(id)) }
      });

      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update password - never store plain password for superadmin
      await prisma.users.update({
        where: { id: BigInt(String(id)) },
        data: { 
          password: hashedPassword,
          plain_password: existingUser.role === 'superadmin' ? null : password
        }
      });

      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset password',
        error: error.message
      });
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(req, res) {
    try {
      // First, get all user counts
      const [
        total,
        superadminCount,
        kepalaDinasCount,
        sekretarisDinasCount,
        kepalaBidangCount,
        ketuaTimCount,
        pegawaiCount,
        kecamatanCount,
        allDesaRoleCount
      ] = await Promise.all([
        prisma.users.count(),
        prisma.users.count({ where: { role: 'superadmin' } }),
        prisma.users.count({ where: { role: 'kepala_dinas' } }),
        prisma.users.count({ where: { role: 'sekretaris_dinas' } }),
        prisma.users.count({ where: { role: 'kepala_bidang' } }),
        prisma.users.count({ where: { role: 'ketua_tim' } }),
        prisma.users.count({ where: { role: 'pegawai' } }),
        prisma.users.count({ where: { role: 'kecamatan' } }),
        prisma.users.count({ where: { role: 'desa' } })
      ]);

      // Get users with role 'desa' and join with desas table
      const usersWithDesa = await prisma.users.findMany({
        where: { role: 'desa' },
        select: {
          id: true,
          desa_id: true
        }
      });

      // Count desa and kelurahan by checking desas table
      let desaCount = 0;
      let kelurahanCount = 0;

      for (const user of usersWithDesa) {
        if (user.desa_id) {
          const desa = await prisma.desas.findUnique({
            where: { id: user.desa_id },
            select: { status_pemerintahan: true }
          });
          
          if (desa) {
            if (desa.status_pemerintahan === 'desa') {
              desaCount++;
            } else if (desa.status_pemerintahan === 'kelurahan') {
              kelurahanCount++;
            }
          }
        }
      }

      // Calculate total pegawai DPMD (only 5 valid roles)
      const totalPegawaiDPMD = kepalaDinasCount + sekretarisDinasCount + kepalaBidangCount + 
                                ketuaTimCount + pegawaiCount;

      res.json({
        success: true,
        message: 'User statistics retrieved successfully',
        data: {
          total,
          superadmin: superadminCount,
          kepala_dinas: kepalaDinasCount,
          sekretaris_dinas: sekretarisDinasCount,
          kepala_bidang: kepalaBidangCount,
          ketua_tim: ketuaTimCount,
          pegawai: pegawaiCount,
          total_pegawai_dpmd: totalPegawaiDPMD, // Total pegawai internal (5 role)
          kecamatan: kecamatanCount,
          desa: desaCount, // Admin Desa (416)
          kelurahan: kelurahanCount // Admin Kelurahan (sisanya)
        }
      });
    } catch (error) {
      console.error('Error fetching user stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user statistics',
        error: error.message
      });
    }
  }

  /**
   * Change user password
   */
  async changePassword(req, res) {
    try {
      const userId = req.user.id; // From auth middleware
      const { currentPassword, newPassword } = req.body;

      // Validate input
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Password saat ini dan password baru harus diisi'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password baru minimal 6 karakter'
        });
      }

      // Get user from database
      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User tidak ditemukan'
        });
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Password saat ini salah'
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password - never store plain password for superadmin
      await prisma.users.update({
        where: { id: BigInt(userId) },
        data: { 
          password: hashedPassword,
          plain_password: user.role === 'superadmin' ? null : newPassword
        }
      });

      res.json({
        success: true,
        message: 'Password berhasil diubah'
      });
    } catch (error) {
      console.error('Error changing password:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengubah password',
        error: error.message
      });
    }
  }

  async uploadAvatar(req, res) {
    try {
      const { id } = req.params;
      const fs = require('fs');
      const path = require('path');

      console.log('[Avatar Upload] Starting upload for user ID:', id);
      console.log('[Avatar Upload] File:', req.file);

      if (!req.file) {
        console.log('[Avatar Upload] ❌ No file in request');
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      // Check if storage directory exists
      const storageDir = path.join(__dirname, '../../storage/avatars/');
      if (!fs.existsSync(storageDir)) {
        console.error('[Avatar Upload] ❌ Storage directory does not exist:', storageDir);
        return res.status(500).json({
          success: false,
          message: 'Storage directory not configured properly',
          error: 'STORAGE_DIR_NOT_FOUND'
        });
      }

      // Check write permission
      try {
        const testFile = path.join(storageDir, '.write_test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log('[Avatar Upload] ✅ Storage directory writable');
      } catch (permError) {
        console.error('[Avatar Upload] ❌ Storage directory not writable:', permError);
        return res.status(500).json({
          success: false,
          message: 'Storage directory is not writable',
          error: 'STORAGE_NOT_WRITABLE'
        });
      }

      // Check if user exists
      console.log('[Avatar Upload] Checking if user exists...');
      const user = await prisma.users.findUnique({
        where: { id: BigInt(String(id)) }
      });

      if (!user) {
        console.log('[Avatar Upload] ❌ User not found:', id);
        // Delete uploaded file if user not found
        const uploadedFilePath = path.join(__dirname, '../../storage/avatars/', req.file.filename);
        if (fs.existsSync(uploadedFilePath)) {
          fs.unlinkSync(uploadedFilePath);
        }
        
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      console.log('[Avatar Upload] ✅ User found:', user.name);

      // Delete old avatar if exists
      if (user.avatar) {
        const oldAvatarPath = path.join(__dirname, '../../', user.avatar);
        if (fs.existsSync(oldAvatarPath)) {
          try {
            fs.unlinkSync(oldAvatarPath);
            console.log('[Avatar Upload] 🗑️  Old avatar deleted');
          } catch (err) {
            console.warn('[Avatar Upload] ⚠️  Could not delete old avatar:', err);
          }
        }
      }

      // Update user with new avatar path
      const avatarPath = `/storage/avatars/${req.file.filename}`;
      console.log('[Avatar Upload] Updating database with path:', avatarPath);
      
      const updatedUser = await prisma.users.update({
        where: { id: BigInt(String(id)) },
        data: { avatar: avatarPath },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatar: true,
          is_active: true,
          created_at: true
        }
      });

      console.log('[Avatar Upload] ✅ Avatar uploaded successfully:', req.file.filename);

      return res.status(200).json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          ...updatedUser,
          nama: updatedUser.name // Add nama alias for frontend compatibility
        }
      });
    } catch (error) {
      console.error('[Avatar Upload] ❌ Error uploading avatar:', error);
      console.error('[Avatar Upload] Error stack:', error.stack);
      
      // Delete uploaded file on error
      if (req.file) {
        const fs = require('fs');
        const path = require('path');
        const uploadedFilePath = path.join(__dirname, '../../storage/avatars/', req.file.filename);
        if (fs.existsSync(uploadedFilePath)) {
          try {
            fs.unlinkSync(uploadedFilePath);
            console.log('[Avatar Upload] 🗑️  Cleaned up uploaded file after error');
          } catch (err) {
            console.warn('[Avatar Upload] ⚠️  Could not delete uploaded file after error:', err);
          }
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to upload avatar',
        error: error.message,
        errorCode: error.code || 'UNKNOWN_ERROR'
      });
    }
  }
}

module.exports = new UserController();
