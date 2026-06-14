/**
 * Berita Acara Helper Service
 * Untuk aggregasi questionnaire, generate QR code, dan history management
 */

const { sequelize } = require('../models');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

class BeritaAcaraHelper {
  /**
   * Generate unique code untuk berita acara (tanpa QR image)
   * @param {number} desaId 
   * @param {number} proposalId 
   * @returns {{code: string}}
   */
  generateUniqueCode(desaId, proposalId) {
    const timestamp = Date.now();
    const randomPart = crypto.randomBytes(4).toString('hex');
    const code = `BA-${desaId}-${proposalId}-${timestamp}-${randomPart}`.toUpperCase();
    return { code };
  }

  /**
   * Aggregate questionnaire dari semua tim verifikasi untuk berita acara
   * Logika: Jika SEMUA tim centang OK (true) = centang di berita acara
   * @param {number} proposalId 
   * @param {number} kecamatanId 
   * @returns {Promise<{items: object, allComplete: boolean, summary: object}>}
   */
  async aggregateQuestionnaire(proposalId, kecamatanId) {
    try {
      // Get all tim verifikasi members
      // - Ketua & sekretaris: proposal_id IS NULL (shared)
      // - Anggota: proposal_id = specific proposal OR proposal_id IS NULL (for backward compat)
      // Exclude old 'anggota' format
      const timMembers = await sequelize.query(`
        SELECT 
          tc.id as tim_id,
          tc.jabatan as posisi,
          tc.nama,
          tc.proposal_id
        FROM tim_verifikasi_kecamatan tc
        WHERE tc.kecamatan_id = :kecamatanId
          AND tc.is_active = 1
          AND tc.jabatan IN ('ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3')
          AND (
            tc.proposal_id IS NULL
            OR tc.proposal_id = :proposalId
          )
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
        replacements: { kecamatanId, proposalId },
        type: sequelize.QueryTypes.SELECT
      });

      if (timMembers.length === 0) {
        return {
          items: this.getDefaultChecklist(false),
          allComplete: false,
          summary: { total_tim: 0, filled: 0, percentage: 0 }
        };
      }

      // Get all questionnaires for this proposal from tim members
      const questionnaires = await sequelize.query(`
        SELECT 
          q.*,
          tc.jabatan as posisi,
          tc.nama as tim_nama
        FROM bankeu_verification_questionnaires q
        INNER JOIN tim_verifikasi_kecamatan tc ON q.tim_verifikasi_id = tc.id
        WHERE q.proposal_id = :proposalId
          AND tc.kecamatan_id = :kecamatanId
      `, {
        replacements: { proposalId, kecamatanId },
        type: sequelize.QueryTypes.SELECT
      });

      const filledCount = questionnaires.length;
      const totalTim = timMembers.length;
      const allFilled = filledCount >= totalTim;

      // Aggregate each item - since questionnaires now only save when all items are true,
      // if there's any questionnaire, the item should be true
      // We use "any true" logic because each tim member verifies all items as true before saving
      const aggregatedItems = {};
      for (let i = 1; i <= 13; i++) {
        const key = `q${i}`;
        
        if (questionnaires.length === 0) {
          aggregatedItems[key] = null; // No data
        } else {
          // If any questionnaire has this item as true (1), mark as true
          // Since new logic requires all items checked before saving, this should always be true
          // Explicitly convert to boolean
          const anyTrue = questionnaires.some(q => q[key] === true || q[key] === 1 || q[key] === '1');
          aggregatedItems[key] = anyTrue === true; // Force boolean true/false
        }
      }

      return {
        items: aggregatedItems,
        allComplete: allFilled,
        summary: {
          total_tim: totalTim,
          filled: filledCount,
          percentage: Math.round((filledCount / totalTim) * 100),
          tim_details: timMembers.map(tm => ({
            posisi: tm.posisi,
            nama: tm.nama,
            filled: questionnaires.some(q => q.tim_verifikasi_id === tm.tim_id)
          }))
        }
      };
    } catch (error) {
      console.error('Error aggregating questionnaire:', error);
      throw error;
    }
  }

  /**
   * Get default checklist values
   */
  getDefaultChecklist(value = null) {
    const items = {};
    for (let i = 1; i <= 13; i++) {
      items[`q${i}`] = value;
    }
    return items;
  }

  /**
   * Save berita acara to history
   * @param {object} data 
   * @returns {Promise<object>}
   */
  async saveHistory(data) {
    try {
      const {
        proposalId,
        desaId,
        kecamatanId,
        kegiatanId,
        filePath,
        fileName,
        fileSize,
        qrCode,
        qrCodePath,
        generatedBy,
        checklistSummary,
        timVerifikasiData
      } = data;

      // Mark previous versions as superseded
      await sequelize.query(`
        UPDATE berita_acara_history 
        SET is_latest = FALSE, status = 'superseded', updated_at = NOW()
        WHERE desa_id = :desaId 
          AND (kegiatan_id = :kegiatanId OR (:kegiatanId IS NULL AND kegiatan_id IS NULL))
          AND is_latest = TRUE
      `, {
        replacements: { desaId, kegiatanId }
      });

      // Get next version number
      const [versionResult] = await sequelize.query(`
        SELECT COALESCE(MAX(version), 0) + 1 as next_version
        FROM berita_acara_history
        WHERE desa_id = :desaId 
          AND (kegiatan_id = :kegiatanId OR (:kegiatanId IS NULL AND kegiatan_id IS NULL))
      `, {
        replacements: { desaId, kegiatanId },
        type: sequelize.QueryTypes.SELECT
      });

      const nextVersion = versionResult?.next_version || 1;

      // Insert new history record
      const [result] = await sequelize.query(`
        INSERT INTO berita_acara_history 
        (proposal_id, desa_id, kecamatan_id, kegiatan_id, file_path, file_name, file_size,
         qr_code, qr_code_path, generated_by, checklist_summary, tim_verifikasi_data, version, is_latest)
        VALUES 
        (:proposalId, :desaId, :kecamatanId, :kegiatanId, :filePath, :fileName, :fileSize,
         :qrCode, :qrCodePath, :generatedBy, :checklistSummary, :timVerifikasiData, :version, TRUE)
      `, {
        replacements: {
          proposalId,
          desaId,
          kecamatanId,
          kegiatanId: kegiatanId || null,
          filePath,
          fileName,
          fileSize: fileSize || null,
          qrCode,
          qrCodePath: qrCodePath || null,
          generatedBy,
          checklistSummary: JSON.stringify(checklistSummary || {}),
          timVerifikasiData: JSON.stringify(timVerifikasiData || {}),
          version: nextVersion
        }
      });

      return {
        id: result,
        version: nextVersion,
        qrCode
      };
    } catch (error) {
      console.error('Error saving berita acara history:', error);
      throw error;
    }
  }

  /**
   * Get berita acara history for a desa
   * @param {number} desaId 
   * @param {number} kegiatanId - optional
   * @returns {Promise<array>}
   */
  async getHistory(desaId, kegiatanId = null) {
    try {
      let whereClause = 'bah.desa_id = :desaId';
      const replacements = { desaId };

      if (kegiatanId) {
        whereClause += ' AND bah.kegiatan_id = :kegiatanId';
        replacements.kegiatanId = kegiatanId;
      }

      const history = await sequelize.query(`
        SELECT 
          bah.*,
          u.name as generated_by_name,
          d.nama as desa_nama,
          k.nama as kecamatan_nama
        FROM berita_acara_history bah
        LEFT JOIN users u ON bah.generated_by = u.id
        LEFT JOIN desas d ON bah.desa_id = d.id
        LEFT JOIN kecamatans k ON bah.kecamatan_id = k.id
        WHERE ${whereClause}
        ORDER BY bah.version DESC, bah.created_at DESC
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      return history;
    } catch (error) {
      console.error('Error getting berita acara history:', error);
      throw error;
    }
  }

  /**
   * Verify berita acara by QR code
   * @param {string} qrCode 
   * @returns {Promise<object>}
   */
  async verifyByQRCode(qrCode) {
    try {
      const [record] = await sequelize.query(`
        SELECT 
          bah.*,
          u.name as generated_by_name,
          d.nama as desa_nama,
          k.nama as kecamatan_nama,
          bp.judul_proposal
        FROM berita_acara_history bah
        LEFT JOIN users u ON bah.generated_by = u.id
        LEFT JOIN desas d ON bah.desa_id = d.id
        LEFT JOIN kecamatans k ON bah.kecamatan_id = k.id
        LEFT JOIN bankeu_proposals bp ON bah.proposal_id = bp.id
        WHERE bah.qr_code = :qrCode
        LIMIT 1
      `, {
        replacements: { qrCode },
        type: sequelize.QueryTypes.SELECT
      });

      if (!record) {
        return {
          valid: false,
          message: 'QR Code tidak valid atau tidak ditemukan'
        };
      }

      return {
        valid: true,
        data: {
          qr_code: record.qr_code,
          desa: record.desa_nama,
          kecamatan: record.kecamatan_nama,
          proposal: record.judul_proposal,
          version: record.version,
          generated_at: record.generated_at,
          generated_by: record.generated_by_name,
          status: record.status,
          is_latest: record.is_latest,
          file_path: record.file_path
        }
      };
    } catch (error) {
      console.error('Error verifying QR code:', error);
      throw error;
    }
  }

  /**
   * Validate tim verifikasi completeness before generating berita acara
   * @param {number} proposalId 
   * @param {number} kecamatanId 
   * @returns {Promise<{valid: boolean, errors: array, details: object}>}
   */
  async validateTimCompletion(proposalId, kecamatanId) {
    try {
      const errors = [];
      const details = {
        tim_members: [],
        questionnaire_status: [],
        ttd_status: []
      };

      // Get all tim config - shared (ketua/sekretaris) + proposal-specific anggota
      // IMPORTANT: only active members and new jabatan format. Tanpa filter ini,
      // baris legacy 'anggota' atau anggota yang sudah dinonaktifkan (is_active=0)
      // ikut tervalidasi -> tidak pernah punya quisioner -> BA selalu terblokir.
      const timMembers = await sequelize.query(`
        SELECT id, jabatan as posisi, nama, nip, jabatan_label as jabatan, ttd_path, proposal_id
        FROM tim_verifikasi_kecamatan
        WHERE kecamatan_id = :kecamatanId
          AND is_active = 1
          AND jabatan IN ('ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3')
          AND (
            proposal_id IS NULL
            OR proposal_id = :proposalId
          )
        ORDER BY
          CASE jabatan
            WHEN 'ketua' THEN 1
            WHEN 'sekretaris' THEN 2
            WHEN 'anggota_1' THEN 3
            WHEN 'anggota_2' THEN 4
            WHEN 'anggota_3' THEN 5
            ELSE 6
          END
      `, {
        replacements: { kecamatanId, proposalId },
        type: sequelize.QueryTypes.SELECT
      });

      // Check minimum requirements (ketua is required, sekretaris is optional)
      const hasKetua = timMembers.some(t => t.posisi === 'ketua');

      if (!hasKetua) {
        errors.push('Ketua Tim Verifikasi belum dikonfigurasi');
      }

      // Check each member (skip sekretaris validation if not configured)
      for (const member of timMembers) {
        // Skip sekretaris validation if not filled (sekretaris is optional)
        const isSekretaris = member.posisi === 'sekretaris';
        const hasAnyData = member.nama || member.jabatan || member.ttd_path;
        
        // If sekretaris has no data at all, skip validation entirely
        if (isSekretaris && !hasAnyData) {
          continue;
        }

        const memberStatus = {
          posisi: member.posisi,
          nama: member.nama || 'Belum diisi',
          has_data: !!(member.nama && member.jabatan),
          has_ttd: !!member.ttd_path,
          has_questionnaire: false
        };

        // Check questionnaire
        const [questionnaire] = await sequelize.query(`
          SELECT id FROM bankeu_verification_questionnaires
          WHERE proposal_id = :proposalId AND tim_verifikasi_id = :timId
          LIMIT 1
        `, {
          replacements: { proposalId, timId: member.id },
          type: sequelize.QueryTypes.SELECT
        });

        memberStatus.has_questionnaire = !!questionnaire;

        // For sekretaris with partial data, still validate completely
        if (!memberStatus.has_data) {
          errors.push(`${this.getPosisiLabel(member.posisi)}: Data belum lengkap`);
        }
        if (!memberStatus.has_ttd) {
          errors.push(`${this.getPosisiLabel(member.posisi)}: Tanda tangan belum diunggah`);
        }
        if (!memberStatus.has_questionnaire) {
          errors.push(`${this.getPosisiLabel(member.posisi)}: Quisioner belum diisi untuk proposal ini`);
        }

        details.tim_members.push(memberStatus);
      }

      return {
        valid: errors.length === 0,
        errors,
        details,
        summary: {
          total_members: timMembers.length,
          complete_members: details.tim_members.filter(m => 
            m.has_data && m.has_ttd && m.has_questionnaire
          ).length
        }
      };
    } catch (error) {
      console.error('Error validating tim completion:', error);
      throw error;
    }
  }

  getPosisiLabel(posisi) {
    const labels = {
      'ketua': 'Ketua',
      'sekretaris': 'Sekretaris',
      'anggota_1': 'Anggota 1',
      'anggota_2': 'Anggota 2',
      'anggota_3': 'Anggota 3'
    };
    return labels[posisi] || posisi;
  }

  /**
   * Get aggregated checklist data from questionnaires
   * Returns object with item_1 to item_13 as true/false
   * @param {number} proposalId 
   * @param {number} kecamatanId 
   * @returns {Promise<object>}
   */
  async getAggregatedChecklistData(proposalId, kecamatanId) {
    try {
      const result = await this.aggregateQuestionnaire(proposalId, kecamatanId);
      
      // Convert q1-q13 to item_1-item_13 format
      const checklistData = {};
      for (let i = 1; i <= 13; i++) {
        const qKey = `q${i}`;
        const itemKey = `item_${i}`;
        checklistData[itemKey] = result.items[qKey] === true;
      }
      
      return checklistData;
    } catch (error) {
      console.error('Error getting aggregated checklist data:', error);
      throw error;
    }
  }
}

module.exports = new BeritaAcaraHelper();

