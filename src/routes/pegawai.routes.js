/**
 * Pegawai Routes
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth } = require('../middlewares/auth');

// Get pegawai with birthday today
router.get('/birthdays/today', auth, async (req, res) => {
  try {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const birthdayPegawai = await prisma.$queryRaw`
      SELECT p.id_pegawai, p.nama_pegawai, p.jabatan, p.tanggal_lahir,
             b.nama as bidang_nama,
             u.id as user_id, u.name as user_name, u.avatar
      FROM pegawai p
      LEFT JOIN bidangs b ON p.id_bidang = b.id
      LEFT JOIN users u ON u.pegawai_id = p.id_pegawai
      WHERE MONTH(p.tanggal_lahir) = ${month}
        AND DAY(p.tanggal_lahir) = ${day}
    `;

    // Serialize BigInt values
    const data = (birthdayPegawai || []).map(p => ({
      id: Number(p.id_pegawai),
      nama: p.nama_pegawai,
      jabatan: p.jabatan || '-',
      bidang: p.bidang_nama || '-',
      avatar: p.avatar || null,
      tanggal_lahir: p.tanggal_lahir,
      user_id: p.user_id ? Number(p.user_id) : null,
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching birthdays:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch birthdays' });
  }
});

// Get all pegawai
router.get('/', auth, async (req, res) => {
  try {
    const { bidang_id, include_users } = req.query;

    const where = {};
    if (bidang_id) {
      where.id_bidang = BigInt(bidang_id);
    }

    const includeConfig = {
      bidangs: {
        select: {
          id: true,
          nama: true
        }
      }
    };

    // Optionally include linked users
    if (include_users === 'true') {
      includeConfig.users = {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatar: true
        }
      };
    }

    const pegawai = await prisma.pegawai.findMany({
      where,
      include: includeConfig,
      orderBy: {
        nama_pegawai: 'asc'
      }
    });

    // Convert BigInt fields to Number for JSON serialization
    const serializedPegawai = pegawai.map(p => ({
      id_pegawai: Number(p.id_pegawai),
      id_bidang: p.id_bidang ? Number(p.id_bidang) : null,
      nama_pegawai: p.nama_pegawai,
      nip: p.nip,
      jabatan: p.jabatan,
      golongan: p.golongan,
      pangkat: p.pangkat,
      eselon: p.eselon,
      jenis_kelamin: p.jenis_kelamin,
      tempat_lahir: p.tempat_lahir,
      tanggal_lahir: p.tanggal_lahir,
      pendidikan_terakhir: p.pendidikan_terakhir,
      status_kepegawaian: p.status_kepegawaian,
      no_hp: p.no_hp,
      alamat: p.alamat,
      tmt_jabatan: p.tmt_jabatan,
      unit_kerja: p.unit_kerja,
      created_at: p.created_at,
      updated_at: p.updated_at,
      bidangs: p.bidangs ? {
        id: Number(p.bidangs.id),
        nama: p.bidangs.nama
      } : null,
      ...(p.users ? {
        users: p.users.map(u => ({
          id: Number(u.id),
          name: u.name,
          email: u.email,
          role: u.role,
          avatar: u.avatar
        }))
      } : {})
    }));

    res.json({
      success: true,
      message: 'Pegawai retrieved successfully',
      data: serializedPegawai
    });
  } catch (error) {
    console.error('[Pegawai API] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pegawai',
      error: error.message
    });
  }
});

// Get pegawai by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const pegawai = await prisma.pegawai.findUnique({
      where: { id_pegawai: BigInt(id) },
      include: {
        bidangs: {
          select: {
            id: true,
            nama: true
          }
        },
        users: {
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
            pegawai_id: true
          }
        }
      }
    });

    if (!pegawai) {
      return res.status(404).json({
        success: false,
        message: 'Pegawai not found'
      });
    }

    // Convert BigInt fields to Number for JSON serialization
    const serializedPegawai = {
      id_pegawai: Number(pegawai.id_pegawai),
      id_bidang: pegawai.id_bidang ? Number(pegawai.id_bidang) : null,
      nama_pegawai: pegawai.nama_pegawai,
      created_at: pegawai.created_at,
      updated_at: pegawai.updated_at,
      nip: pegawai.nip,
      jabatan: pegawai.jabatan,
      golongan: pegawai.golongan,
      pangkat: pegawai.pangkat,
      eselon: pegawai.eselon,
      jenis_kelamin: pegawai.jenis_kelamin,
      tempat_lahir: pegawai.tempat_lahir,
      tanggal_lahir: pegawai.tanggal_lahir,
      pendidikan_terakhir: pegawai.pendidikan_terakhir,
      status_kepegawaian: pegawai.status_kepegawaian,
      no_hp: pegawai.no_hp,
      alamat: pegawai.alamat,
      tmt_jabatan: pegawai.tmt_jabatan,
      unit_kerja: pegawai.unit_kerja,
      bidangs: pegawai.bidangs ? {
        id: Number(pegawai.bidangs.id),
        nama: pegawai.bidangs.nama
      } : null,
      users: pegawai.users ? pegawai.users.map(user => ({
        id: Number(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        desa_id: user.desa_id ? Number(user.desa_id) : null,
        kecamatan_id: user.kecamatan_id ? Number(user.kecamatan_id) : null,
        bidang_id: user.bidang_id ? Number(user.bidang_id) : null,
        dinas_id: user.dinas_id ? Number(user.dinas_id) : null,
        pegawai_id: user.pegawai_id ? Number(user.pegawai_id) : null
      })) : []
    };

    res.json({
      success: true,
      message: 'Pegawai retrieved successfully',
      data: serializedPegawai
    });
  } catch (error) {
    console.error('Error fetching pegawai:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pegawai',
      error: error.message
    });
  }
});

// Create pegawai
router.post('/', auth, async (req, res) => {
  try {
    const { nama_pegawai, id_bidang, nip, jabatan, golongan, pangkat, eselon, jenis_kelamin, tempat_lahir, tanggal_lahir, pendidikan_terakhir, status_kepegawaian, no_hp, alamat, tmt_jabatan, unit_kerja } = req.body;

    if (!nama_pegawai || !id_bidang) {
      return res.status(400).json({
        success: false,
        message: 'nama_pegawai and id_bidang are required'
      });
    }

    const pegawai = await prisma.pegawai.create({
      data: {
        nama_pegawai,
        id_bidang: BigInt(id_bidang),
        nip: nip || null,
        jabatan: jabatan || null,
        golongan: golongan || null,
        pangkat: pangkat || null,
        eselon: eselon || null,
        jenis_kelamin: jenis_kelamin || null,
        tempat_lahir: tempat_lahir || null,
        tanggal_lahir: tanggal_lahir ? new Date(tanggal_lahir) : null,
        pendidikan_terakhir: pendidikan_terakhir || null,
        status_kepegawaian: status_kepegawaian || null,
        no_hp: no_hp || null,
        alamat: alamat || null,
        tmt_jabatan: tmt_jabatan ? new Date(tmt_jabatan) : null,
        unit_kerja: unit_kerja || null,
        created_at: new Date(),
        updated_at: new Date()
      },
      include: {
        bidangs: {
          select: {
            id: true,
            nama: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Pegawai created successfully',
      data: {
        id_pegawai: Number(pegawai.id_pegawai),
        id_bidang: Number(pegawai.id_bidang),
        nama_pegawai: pegawai.nama_pegawai,
        nip: pegawai.nip, jabatan: pegawai.jabatan, golongan: pegawai.golongan,
        pangkat: pegawai.pangkat, eselon: pegawai.eselon, jenis_kelamin: pegawai.jenis_kelamin,
        tempat_lahir: pegawai.tempat_lahir, tanggal_lahir: pegawai.tanggal_lahir,
        pendidikan_terakhir: pegawai.pendidikan_terakhir, status_kepegawaian: pegawai.status_kepegawaian,
        no_hp: pegawai.no_hp, alamat: pegawai.alamat, tmt_jabatan: pegawai.tmt_jabatan, unit_kerja: pegawai.unit_kerja,
        bidangs: pegawai.bidangs ? { id: Number(pegawai.bidangs.id), nama: pegawai.bidangs.nama } : null
      }
    });
  } catch (error) {
    console.error('Error creating pegawai:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create pegawai',
      error: error.message
    });
  }
});

// Update pegawai
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_pegawai, id_bidang, nip, jabatan, golongan, pangkat, eselon, jenis_kelamin, tempat_lahir, tanggal_lahir, pendidikan_terakhir, status_kepegawaian, no_hp, alamat, tmt_jabatan, unit_kerja } = req.body;

    const updateData = { updated_at: new Date() };
    if (nama_pegawai !== undefined) updateData.nama_pegawai = nama_pegawai;
    if (id_bidang !== undefined) updateData.id_bidang = BigInt(id_bidang);
    if (nip !== undefined) updateData.nip = nip || null;
    if (jabatan !== undefined) updateData.jabatan = jabatan || null;
    if (golongan !== undefined) updateData.golongan = golongan || null;
    if (pangkat !== undefined) updateData.pangkat = pangkat || null;
    if (eselon !== undefined) updateData.eselon = eselon || null;
    if (jenis_kelamin !== undefined) updateData.jenis_kelamin = jenis_kelamin || null;
    if (tempat_lahir !== undefined) updateData.tempat_lahir = tempat_lahir || null;
    if (tanggal_lahir !== undefined) updateData.tanggal_lahir = tanggal_lahir ? new Date(tanggal_lahir) : null;
    if (pendidikan_terakhir !== undefined) updateData.pendidikan_terakhir = pendidikan_terakhir || null;
    if (status_kepegawaian !== undefined) updateData.status_kepegawaian = status_kepegawaian || null;
    if (no_hp !== undefined) updateData.no_hp = no_hp || null;
    if (alamat !== undefined) updateData.alamat = alamat || null;
    if (tmt_jabatan !== undefined) updateData.tmt_jabatan = tmt_jabatan ? new Date(tmt_jabatan) : null;
    if (unit_kerja !== undefined) updateData.unit_kerja = unit_kerja || null;

    const pegawai = await prisma.pegawai.update({
      where: { id_pegawai: BigInt(id) },
      data: updateData,
      include: {
        bidangs: {
          select: {
            id: true,
            nama: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Pegawai updated successfully',
      data: {
        id_pegawai: Number(pegawai.id_pegawai),
        id_bidang: Number(pegawai.id_bidang),
        nama_pegawai: pegawai.nama_pegawai,
        nip: pegawai.nip, jabatan: pegawai.jabatan, golongan: pegawai.golongan,
        pangkat: pegawai.pangkat, eselon: pegawai.eselon, jenis_kelamin: pegawai.jenis_kelamin,
        tempat_lahir: pegawai.tempat_lahir, tanggal_lahir: pegawai.tanggal_lahir,
        pendidikan_terakhir: pegawai.pendidikan_terakhir, status_kepegawaian: pegawai.status_kepegawaian,
        no_hp: pegawai.no_hp, alamat: pegawai.alamat, tmt_jabatan: pegawai.tmt_jabatan, unit_kerja: pegawai.unit_kerja,
        bidangs: pegawai.bidangs ? { id: Number(pegawai.bidangs.id), nama: pegawai.bidangs.nama } : null
      }
    });
  } catch (error) {
    console.error('Error updating pegawai:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update pegawai',
      error: error.message
    });
  }
});

// Delete pegawai
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.pegawai.delete({
      where: { id_pegawai: BigInt(id) }
    });

    res.json({
      success: true,
      message: 'Pegawai deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting pegawai:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete pegawai',
      error: error.message
    });
  }
});

module.exports = router;
