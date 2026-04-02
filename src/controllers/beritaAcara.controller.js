const beritaAcaraHelper = require('../services/beritaAcaraHelper');
const beritaAcaraService = require('../services/beritaAcaraService');
const { sequelize } = require('../models');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

/**
 * Controller for Berita Acara Management
 * Handles validation, preview, generation with QR, history, and notifications
 */
class BeritaAcaraController {
  /**
   * Validate tim completion before generating berita acara
   * GET /api/berita-acara/validate/:desaId/:proposalId
   */
  async validateBeforeGenerate(req, res) {
    try {
      const { desaId, proposalId } = req.params;
      const { kecamatan_id } = req.user;

      if (!kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'Hanya user kecamatan yang dapat mengakses'
        });
      }

      const validation = await beritaAcaraHelper.validateTimCompletion(proposalId, kecamatan_id);

      res.json({
        success: true,
        data: validation
      });
    } catch (error) {
      logger.error('Error validating berita acara:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memvalidasi kelengkapan tim',
        error: error.message
      });
    }
  }

  /**
   * Get preview data including aggregated questionnaire
   * GET /api/berita-acara/preview/:desaId/:proposalId
   */
  async getPreviewData(req, res) {
    try {
      const { desaId, proposalId } = req.params;
      const { kecamatan_id } = req.user;

      if (!kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'Hanya user kecamatan yang dapat mengakses'
        });
      }

      // Get desa info
      const [desa] = await sequelize.query(`
        SELECT d.*, k.nama as kecamatan_nama
        FROM desas d
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        WHERE d.id = :desaId
        LIMIT 1
      `, {
        replacements: { desaId },
        type: sequelize.QueryTypes.SELECT
      });

      // Get proposal info
      const [proposal] = await sequelize.query(`
        SELECT bp.*, mk.nama_kegiatan, mk.jenis_kegiatan
        FROM bankeu_proposals bp
        LEFT JOIN bankeu_master_kegiatan mk ON bp.kegiatan_id = mk.id
        WHERE bp.id = :proposalId
        LIMIT 1
      `, {
        replacements: { proposalId },
        type: sequelize.QueryTypes.SELECT
      });

      // Get aggregated questionnaire
      const aggregatedQuestionnaire = await beritaAcaraHelper.aggregateQuestionnaire(proposalId, kecamatan_id);

      // Get validation status
      const validation = await beritaAcaraHelper.validateTimCompletion(proposalId, kecamatan_id);

      // Get tim verifikasi data
      const timVerifikasi = await sequelize.query(`
        SELECT tc.*, 
          CASE 
            WHEN tc.jabatan = 'ketua' THEN 'Ketua Tim Verifikasi'
            WHEN tc.jabatan = 'sekretaris' THEN 'Sekretaris'
            ELSE CONCAT('Anggota ', SUBSTRING(tc.jabatan, 9))
          END as posisi_label,
          tc.jabatan as posisi
        FROM tim_verifikasi_kecamatan tc
        WHERE tc.kecamatan_id = :kecamatanId
        ORDER BY 
          CASE tc.jabatan
            WHEN 'ketua' THEN 1
            WHEN 'sekretaris' THEN 2
            WHEN 'anggota_1' THEN 3
            WHEN 'anggota_2' THEN 4
            WHEN 'anggota_3' THEN 5
            ELSE 6
          END
      `, {
        replacements: { kecamatanId: kecamatan_id },
        type: sequelize.QueryTypes.SELECT
      });

      // Checklist items berbeda berdasarkan jenis kegiatan (sinkron dengan beritaAcaraService & BankeuQuestionnaireForm)
      const jenisKegiatan = proposal?.jenis_kegiatan || 'infrastruktur';
      const isInfrastruktur = jenisKegiatan === 'infrastruktur';

      const checklistItems = isInfrastruktur ? [
        { no: 1, key: 'q1', text: 'Surat Pengantar dari Kepala Desa' },
        { no: 2, key: 'q2', text: 'Surat Permohonan Bantuan Keuangan' },
        { no: 3, key: 'q3', text: 'Proposal (Latar Belakang, Maksud dan Tujuan, Bentuk Kegiatan, Jadwal Pelaksanaan)' },
        { no: 4, key: 'q4', text: 'RPA dan RAB' },
        { no: 5, key: 'q5', text: 'Surat Pernyataan dari Kepala Desa yang menyatakan bahwa lokasi kegiatan tidak dalam keadaan sengketa/bermasalah apabila merupakan Aset Desa', optional: true },
        { no: 6, key: 'q6', text: 'Bukti kepemilikan Aset Desa sesuai ketentuan peraturan perundang-undangan, dalam hal usulan kegiatan yang diusulkan berupa Rehab Kantor Desa', optional: true },
        { no: 7, key: 'q7', text: 'Dokumen kesediaan peralihan hak melalui hibah dari warga masyarakat baik perorangan maupun Badan Usaha/Badan Hukum kepada Desa atas lahan/tanah yang menjadi Aset Desa sebagai dampak kegiatan pembangunan infrastruktur desa', optional: true },
        { no: 8, key: 'q8', text: 'Dokumen pernyataan kesanggupan dari warga masyarakat untuk tidak meminta ganti rugi', optional: true },
        { no: 9, key: 'q9', text: 'Persetujuan pemanfaatan barang milik Daerah/Negara dalam hal lahan yang akan dipergunakan untuk pembangunan infrastruktur desa', optional: true },
        { no: 10, key: 'q10', text: 'Foto lokasi rencana pelaksanaan kegiatan' },
        { no: 11, key: 'q11', text: 'Peta lokasi rencana kegiatan' },
        { no: 12, key: 'q12', text: 'Berita Acara Musyawarah Desa' },
      ] : [
        { no: 1, key: 'q1', text: 'Surat Pengantar dari Kepala Desa' },
        { no: 2, key: 'q2', text: 'Surat Permohonan Bantuan Keuangan Khusus Akselerasi Pembangunan Perdesaan' },
        { no: 3, key: 'q3', text: 'Proposal Bantuan Keuangan (Latar Belakang, Maksud dan Tujuan, Bentuk Kegiatan, Jadwal Pelaksanaan)' },
        { no: 4, key: 'q4', text: 'Rencana Anggaran Biaya' },
        { no: 5, key: 'q5', text: 'Tidak Duplikasi Anggaran' },
      ];

      // Map aggregated values to checklist
      const checklistPreview = checklistItems.map(item => ({
        ...item,
        checked: aggregatedQuestionnaire.items[item.key],
        status: aggregatedQuestionnaire.items[item.key] === true 
          ? 'ok' 
          : aggregatedQuestionnaire.items[item.key] === false 
            ? 'tidak_ok' 
            : 'belum_lengkap'
      }));

      res.json({
        success: true,
        data: {
          desa,
          proposal,
          tim_verifikasi: timVerifikasi,
          checklist_preview: checklistPreview,
          questionnaire_summary: aggregatedQuestionnaire.summary,
          validation,
          can_generate: validation.valid
        }
      });
    } catch (error) {
      logger.error('Error getting preview data:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data preview',
        error: error.message
      });
    }
  }

  /**
   * Get berita acara history for a desa
   * GET /api/berita-acara/history/:desaId
   */
  async getHistory(req, res) {
    try {
      const { desaId } = req.params;
      const { kegiatanId } = req.query;

      const history = await beritaAcaraHelper.getHistory(desaId, kegiatanId);

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('Error getting berita acara history:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil riwayat berita acara',
        error: error.message
      });
    }
  }

  /**
   * Verify berita acara by QR code (public endpoint)
   * GET /api/berita-acara/verify/:qrCode
   */
  async verifyQRCode(req, res) {
    try {
      const { qrCode } = req.params;

      const result = await beritaAcaraHelper.verifyByQRCode(qrCode);

      res.json({
        success: result.valid,
        data: result.data || null,
        message: result.message || (result.valid ? 'Berita Acara valid' : 'Tidak valid')
      });
    } catch (error) {
      logger.error('Error verifying QR code:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memverifikasi QR Code',
        error: error.message
      });
    }
  }

  /**
   * Generate berita acara with QR code and save to history
   * POST /api/berita-acara/generate/:desaId
   */
  async generateWithQRCode(req, res) {
    try {
      const { desaId } = req.params;
      const { proposalId, kegiatanId, tanggal } = req.body;
      const { kecamatan_id, id: userId } = req.user;

      if (!kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'Hanya user kecamatan yang dapat generate berita acara'
        });
      }

      // Validate first
      const validation = await beritaAcaraHelper.validateTimCompletion(proposalId, kecamatan_id);
      
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Tim verifikasi belum lengkap',
          errors: validation.errors,
          details: validation.details
        });
      }

      // Get aggregated questionnaire for checklist auto-fill
      const aggregatedQuestionnaire = await beritaAcaraHelper.aggregateQuestionnaire(proposalId, kecamatan_id);

      // Generate unique code for tracking
      const codeData = beritaAcaraHelper.generateUniqueCode(desaId, proposalId);

      // Map q1-q13 keys to item_1-item_13 keys (service uses item_X format)
      const checklistData = {};
      Object.entries(aggregatedQuestionnaire.items).forEach(([key, value]) => {
        const num = key.replace('q', '');
        checklistData[`item_${num}`] = value;
      });

      // Generate PDF with auto-filled checklist
      const filePath = await beritaAcaraService.generateBeritaAcaraVerifikasi({
        desaId,
        kecamatanId: kecamatan_id,
        kegiatanId,
        proposalId,
        checklistData,
        tanggal: tanggal || null
      });

      // Get file size
      const fullFilePath = path.join(__dirname, '../../storage/uploads', filePath.replace('/uploads/', ''));
      let fileSize = null;
      if (fs.existsSync(fullFilePath)) {
        const stats = fs.statSync(fullFilePath);
        fileSize = stats.size;
      }

      // Get tim verifikasi snapshot (ketua/sekretaris shared + anggota per proposal)
      // Exclude old 'anggota' format
      const timVerifikasi = await sequelize.query(`
        SELECT jabatan as posisi, nama, nip, jabatan_label as jabatan, ttd_path
        FROM tim_verifikasi_kecamatan
        WHERE kecamatan_id = :kecamatanId
          AND is_active = TRUE
          AND jabatan != 'anggota'
          AND (
            proposal_id IS NULL
            ${proposalId ? 'OR proposal_id = :proposalId' : ''}
          )
        ORDER BY 
          CASE jabatan 
            WHEN 'ketua' THEN 1
            WHEN 'sekretaris' THEN 2
            ELSE 3
          END,
          id ASC
      `, {
        replacements: { kecamatanId: kecamatan_id, proposalId },
        type: sequelize.QueryTypes.SELECT
      });

      // Save to history
      const historyResult = await beritaAcaraHelper.saveHistory({
        proposalId,
        desaId,
        kecamatanId: kecamatan_id,
        kegiatanId: kegiatanId || null,
        filePath,
        fileName: path.basename(filePath),
        fileSize,
        qrCode: codeData.code,
        qrCodePath: null,
        generatedBy: userId,
        checklistSummary: aggregatedQuestionnaire,
        timVerifikasiData: timVerifikasi
      });

      // Update proposal with berita acara info
      await sequelize.query(`
        UPDATE bankeu_proposals 
        SET 
          berita_acara_path = :filePath,
          berita_acara_generated_at = NOW(),
          berita_acara_qr_code = :qrCode,
          berita_acara_version = :version
        WHERE id = :proposalId
      `, {
        replacements: {
          filePath,
          qrCode: codeData.code,
          version: historyResult.version,
          proposalId
        }
      });

      logger.info(`✅ Berita Acara generated: ${codeData.code} for proposal ${proposalId}`);

      res.json({
        success: true,
        message: 'Berita Acara berhasil dibuat',
        data: {
          file_path: filePath,
          version: historyResult.version,
          history_id: historyResult.id
        }
      });
    } catch (error) {
      logger.error('Error generating berita acara with QR:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal membuat berita acara',
        error: error.message
      });
    }
  }

  /**
   * Send notification to desa after generating berita acara
   * POST /api/berita-acara/notify/:desaId/:historyId
   */
  async notifyDesa(req, res) {
    try {
      const { desaId, historyId } = req.params;
      const { kecamatan_id } = req.user;

      // Get history record
      const [history] = await sequelize.query(`
        SELECT bah.*, d.nama as desa_nama, k.nama as kecamatan_nama
        FROM berita_acara_history bah
        LEFT JOIN desas d ON bah.desa_id = d.id
        LEFT JOIN kecamatans k ON bah.kecamatan_id = k.id
        WHERE bah.id = :historyId
        LIMIT 1
      `, {
        replacements: { historyId },
        type: sequelize.QueryTypes.SELECT
      });

      if (!history) {
        return res.status(404).json({
          success: false,
          message: 'Riwayat berita acara tidak ditemukan'
        });
      }

      // Get desa users to notify
      const desaUsers = await sequelize.query(`
        SELECT id, name, email, fcm_token
        FROM users
        WHERE desa_id = :desaId AND role IN ('desa', 'kepala_desa', 'sekretaris_desa')
      `, {
        replacements: { desaId },
        type: sequelize.QueryTypes.SELECT
      });

      // Create notification records
      for (const user of desaUsers) {
        await sequelize.query(`
          INSERT INTO notifications (user_id, type, title, message, data, created_at)
          VALUES (:userId, 'berita_acara', :title, :message, :data, NOW())
        `, {
          replacements: {
            userId: user.id,
            title: 'Berita Acara Verifikasi Tersedia',
            message: `Berita Acara Verifikasi untuk Desa ${history.desa_nama} telah dibuat oleh Kecamatan ${history.kecamatan_nama}. Silakan unduh dokumen.`,
            data: JSON.stringify({
              history_id: historyId,
              file_path: history.file_path,
              qr_code: history.qr_code
            })
          }
        });
      }

      // TODO: Send push notification via FCM if fcm_token available

      logger.info(`✅ Notification sent to ${desaUsers.length} users for berita acara ${historyId}`);

      res.json({
        success: true,
        message: `Notifikasi berhasil dikirim ke ${desaUsers.length} pengguna desa`,
        data: {
          notified_users: desaUsers.length
        }
      });
    } catch (error) {
      logger.error('Error sending notification:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengirim notifikasi',
        error: error.message
      });
    }
  }

  /**
   * Generate Surat Pengantar Proposal
   * POST /api/berita-acara/surat-pengantar/:proposalId
   */
  async generateSuratPengantar(req, res) {
    try {
      const { proposalId } = req.params;
      const { nomor_surat, tanggal } = req.body;
      const { kecamatan_id } = req.user;

      if (!kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'Hanya user kecamatan yang dapat mengakses'
        });
      }

      if (!nomor_surat) {
        return res.status(400).json({
          success: false,
          message: 'Nomor surat wajib diisi'
        });
      }

      // Verify proposal belongs to this kecamatan
      const [proposal] = await sequelize.query(`
        SELECT bp.id, bp.desa_id, d.kecamatan_id
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        WHERE bp.id = :proposalId AND d.kecamatan_id = :kecamatanId
        LIMIT 1
      `, {
        replacements: { proposalId, kecamatanId: kecamatan_id },
        type: sequelize.QueryTypes.SELECT
      });

      if (!proposal) {
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan atau bukan bagian dari kecamatan ini'
        });
      }

      // Generate surat pengantar
      const pdfPath = await beritaAcaraService.generateSuratPengantar({
        proposalId,
        kecamatanId: kecamatan_id,
        nomorSurat: nomor_surat,
        tanggal: tanggal || null
      });

      // Update proposal with surat pengantar path
      await sequelize.query(`
        UPDATE bankeu_proposals 
        SET surat_pengantar = :pdfPath
        WHERE id = :proposalId
      `, {
        replacements: { pdfPath, proposalId }
      });

      logger.info(`✅ Surat Pengantar generated and sent to DPMD for proposal ${proposalId}`);

      res.json({
        success: true,
        message: 'Surat Pengantar berhasil dibuat',
        data: {
          pdf_path: pdfPath
        }
      });
    } catch (error) {
      logger.error('Error generating surat pengantar:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal membuat surat pengantar',
        error: error.message
      });
    }
  }
}

module.exports = new BeritaAcaraController();
