const prisma = require('../config/prisma');
const sequelize = require('../config/database');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

/**
 * Proposal Bantuan Keuangan TA 2025 — unggahan sederhana.
 *
 * Alurnya sengaja seringkas LPJ 2025: desa mengunggah berkas, DPMD/SPKED
 * melihat & mengunduh. TIDAK ada verifikasi kecamatan, dinas, maupun DPMD —
 * karena itu di modul ini tidak ada endpoint verify dan tidak ada kolom status.
 *
 * Hak akses desanya menumpang izin "bankeu" yang sama dengan halaman Bantuan
 * Keuangan (lihat routes-nya), supaya akun desa yang sudah dapat menu itu
 * otomatis bisa mengunggah proposal tanpa hak akses baru.
 */

// Folder penyimpanan: storage/uploads/bankeu_proposal_2025/{kecamatan_id}/{desa_id}/
const STORAGE_ROOT = path.join(__dirname, '../../storage/uploads/bankeu_proposal_2025');

class BankeuProposal2025Controller {
  /**
   * Daftar proposal milik desa yang sedang login
   * GET /api/desa/bankeu-proposal-2025?tahun=2025
   */
  async getMyProposal(req, res) {
    try {
      const tahun = parseInt(req.query.tahun) || 2025;

      const user = await prisma.users.findUnique({
        where: { id: BigInt(req.user.id) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      const daftar = await prisma.bankeu_proposal_2025.findMany({
        where: { desa_id: user.desa_id, tahun_anggaran: tahun },
        orderBy: { created_at: 'desc' }
      });

      res.json({ success: true, data: daftar });
    } catch (error) {
      logger.error('Error fetching proposal bankeu 2025:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data proposal',
        error: error.message
      });
    }
  }

  /**
   * Unggah satu atau beberapa berkas proposal
   * POST /api/desa/bankeu-proposal-2025/upload
   */
  async uploadProposal(req, res) {
    const bersihkan = (files) => {
      (files || []).forEach(f => { try { if (f.path) fs.unlinkSync(f.path); } catch { /* berkas sudah hilang */ } });
    };

    try {
      const tahun = parseInt(req.body.tahun_anggaran) || 2025;
      const keterangan = req.body.keterangan || null;
      const files = req.files;

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Berkas proposal harus diupload. Pilih minimal satu file PDF.',
          error_code: 'NO_FILE'
        });
      }

      const user = await prisma.users.findUnique({
        where: { id: BigInt(req.user.id) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        bersihkan(files);
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      const desa = await prisma.desas.findUnique({
        where: { id: user.desa_id },
        select: { kecamatan_id: true }
      });

      if (!desa || !desa.kecamatan_id) {
        bersihkan(files);
        return res.status(403).json({
          success: false,
          message: 'Desa tidak terkait dengan kecamatan manapun'
        });
      }

      const targetDir = path.join(STORAGE_ROOT, String(desa.kecamatan_id), String(user.desa_id));
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      const dibuat = [];
      for (const file of files) {
        fs.renameSync(file.path, path.join(targetDir, file.filename));

        const relativePath = `${desa.kecamatan_id}/${user.desa_id}/${file.filename}`;
        const proposal = await prisma.bankeu_proposal_2025.create({
          data: {
            desa_id: user.desa_id,
            tahun_anggaran: tahun,
            nama_file: file.originalname,
            file_path: relativePath,
            file_size: file.size,
            keterangan,
            uploaded_by: BigInt(req.user.id)
          }
        });
        dibuat.push(proposal);
      }

      logger.info(`Proposal Bankeu 2025 diunggah: desa_id=${user.desa_id}, kecamatan_id=${desa.kecamatan_id}, tahun=${tahun}, files=${files.length}`);

      res.status(201).json({
        success: true,
        message: `${files.length} berkas proposal berhasil diupload`,
        data: dibuat
      });
    } catch (error) {
      bersihkan(req.files);
      logger.error('Error uploading proposal bankeu 2025:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload proposal. Silakan coba lagi.',
        error: error.message
      });
    }
  }

  /**
   * Desa menghapus berkas proposalnya sendiri
   * DELETE /api/desa/bankeu-proposal-2025/:id
   */
  async deleteProposal(req, res) {
    try {
      const id = BigInt(req.params.id);

      const user = await prisma.users.findUnique({
        where: { id: BigInt(req.user.id) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      // Batasi ke berkas milik desa sendiri — desa lain tidak bisa menghapus.
      const proposal = await prisma.bankeu_proposal_2025.findFirst({
        where: { id, desa_id: user.desa_id }
      });

      if (!proposal) {
        return res.status(404).json({
          success: false,
          message: 'Data proposal tidak ditemukan'
        });
      }

      hapusBerkas(proposal.file_path);
      await prisma.bankeu_proposal_2025.delete({ where: { id } });

      logger.info(`Proposal Bankeu 2025 dihapus desa: id=${id}, desa_id=${user.desa_id}`);
      res.json({ success: true, message: 'Proposal berhasil dihapus' });
    } catch (error) {
      logger.error('Error deleting proposal bankeu 2025:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus proposal',
        error: error.message
      });
    }
  }

  /**
   * DPMD/SPKED: rekap seluruh desa, dikelompokkan per kecamatan
   * GET /api/dpmd/bankeu-proposal-2025?tahun=2025
   *
   * Desa yang belum mengunggah tetap ikut terdaftar (LEFT JOIN) supaya SPKED
   * bisa melihat siapa yang belum menyetor.
   */
  async getAllProposal(req, res) {
    try {
      const tahun = parseInt(req.query.tahun) || 2025;

      const [rows] = await sequelize.query(`
        SELECT
          d.id AS desa_id,
          d.nama AS desa_nama,
          d.kode AS desa_kode,
          k.id AS kecamatan_id,
          k.nama AS kecamatan_nama,
          p.id AS proposal_id,
          p.nama_file,
          p.file_path,
          p.file_size,
          p.keterangan,
          p.uploaded_by,
          p.created_at AS proposal_created_at,
          p.updated_at AS proposal_updated_at,
          u.name AS uploaded_by_name
        FROM desas d
        JOIN kecamatans k ON d.kecamatan_id = k.id
        LEFT JOIN bankeu_proposal_2025 p ON p.desa_id = d.id AND p.tahun_anggaran = :tahun
        LEFT JOIN users u ON p.uploaded_by = u.id
        WHERE d.status_pemerintahan = 'desa'
        ORDER BY k.nama, d.nama, p.created_at DESC
      `, { replacements: { tahun } });

      const perKecamatan = new Map();
      const desaTerdaftar = new Map();
      let totalDesa = 0;
      let totalUpload = 0;
      let totalBerkas = 0;

      rows.forEach(row => {
        if (!perKecamatan.has(row.kecamatan_id)) {
          perKecamatan.set(row.kecamatan_id, {
            kecamatan_id: row.kecamatan_id,
            kecamatan_nama: row.kecamatan_nama,
            desa_list: [],
            total_desa: 0,
            uploaded_count: 0
          });
        }
        const kec = perKecamatan.get(row.kecamatan_id);

        const kunciDesa = `${row.kecamatan_id}_${row.desa_id}`;
        if (!desaTerdaftar.has(kunciDesa)) {
          desaTerdaftar.set(kunciDesa, {
            desa_id: row.desa_id,
            desa_nama: row.desa_nama,
            desa_kode: row.desa_kode,
            has_proposal: false,
            proposal_files: []
          });
          kec.desa_list.push(desaTerdaftar.get(kunciDesa));
          kec.total_desa += 1;
          totalDesa += 1;
        }
        const desa = desaTerdaftar.get(kunciDesa);

        if (row.proposal_id) {
          if (!desa.has_proposal) {
            desa.has_proposal = true;
            kec.uploaded_count += 1;
            totalUpload += 1;
          }
          desa.proposal_files.push({
            id: row.proposal_id,
            nama_file: row.nama_file,
            file_path: row.file_path,
            file_size: row.file_size,
            keterangan: row.keterangan,
            uploaded_by: row.uploaded_by,
            uploaded_by_name: row.uploaded_by_name,
            created_at: row.proposal_created_at,
            updated_at: row.proposal_updated_at
          });
          totalBerkas += 1;
        }
      });

      res.json({
        success: true,
        data: {
          tahun_anggaran: tahun,
          summary: {
            total_desa: totalDesa,
            total_uploaded: totalUpload,
            total_belum: totalDesa - totalUpload,
            total_berkas: totalBerkas,
            persentase: totalDesa > 0 ? Math.round((totalUpload / totalDesa) * 100) : 0
          },
          kecamatan: Array.from(perKecamatan.values())
        }
      });
    } catch (error) {
      logger.error('Error fetching all proposal bankeu 2025:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data proposal',
        error: error.message
      });
    }
  }

  /**
   * DPMD/SPKED: hapus berkas yang salah unggah
   * DELETE /api/dpmd/bankeu-proposal-2025/:id
   */
  async adminDeleteProposal(req, res) {
    try {
      const id = BigInt(req.params.id);

      const proposal = await prisma.bankeu_proposal_2025.findUnique({
        where: { id },
        include: { desas: { select: { nama: true } } }
      });

      if (!proposal) {
        return res.status(404).json({
          success: false,
          message: 'Data proposal tidak ditemukan'
        });
      }

      hapusBerkas(proposal.file_path);
      await prisma.bankeu_proposal_2025.delete({ where: { id } });

      logger.info(`Proposal Bankeu 2025 dihapus DPMD: id=${id}, desa=${proposal.desas?.nama}, oleh user=${req.user.id}`);
      res.json({ success: true, message: 'Proposal berhasil dihapus' });
    } catch (error) {
      logger.error('Error admin deleting proposal bankeu 2025:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus proposal',
        error: error.message
      });
    }
  }
}

// Buang berkas fisiknya; kalau sudah tidak ada, biarkan saja agar barisnya tetap terhapus.
function hapusBerkas(relativePath) {
  try {
    const berkas = path.join(STORAGE_ROOT, relativePath);
    if (fs.existsSync(berkas)) fs.unlinkSync(berkas);
  } catch (error) {
    logger.warn(`Gagal menghapus berkas proposal ${relativePath}: ${error.message}`);
  }
}

module.exports = new BankeuProposal2025Controller();
