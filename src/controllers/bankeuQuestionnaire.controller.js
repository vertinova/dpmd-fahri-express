const sequelize = require('../config/database');

/**
 * Controller for Bankeu Verification Questionnaire (13 Item Checklist)
 * 
 * Table: bankeu_verification_questionnaires
 * - tim_verifikasi_id: ID from tim_verifikasi_kecamatan table
 * - verifikasi_type: kecamatan, dinas, kecamatan_tim
 * - dinas_id: For dinas verifier
 * - q1-q13: Boolean fields for checklist items
 * - q1_keterangan - q13_keterangan: Notes for each item
 */
class BankeuQuestionnaireController {
  /**
   * Get questionnaire by proposal and verifier
   * GET /api/bankeu/questionnaire/:proposalId?verifier_type=kecamatan_tim&verifier_id=29_ketua
   * 
   * verifier_id format for kecamatan_tim: "{kecamatan_id}_{posisi}"
   */
  async getQuestionnaire(req, res) {
    try {
      const { proposalId } = req.params;
      const { verifier_type, verifier_id } = req.query;

      if (!verifier_type) {
        return res.status(400).json({
          success: false,
          message: 'verifier_type wajib diisi (kecamatan, dinas, kecamatan_tim)'
        });
      }

      let whereClause = 'proposal_id = :proposalId AND verifikasi_type = :verifier_type';
      const replacements = { proposalId, verifier_type };

      // For kecamatan_tim, verifier_id = "{kecamatan_id}_{posisi}"
      // posisi can be: ketua, sekretaris, anggota_1, anggota_2, etc.
      if (verifier_type === 'kecamatan_tim' && verifier_id) {
        // Split only on first underscore to handle "29_anggota_1" correctly
        const firstUnderscoreIndex = verifier_id.indexOf('_');
        const kecamatanId = verifier_id.substring(0, firstUnderscoreIndex);
        const posisi = verifier_id.substring(firstUnderscoreIndex + 1);
        const { proposal_id: queryProposalId } = req.query;
        
        // For anggota, we need to look up with proposal_id
        // For ketua/sekretaris, proposal_id is NULL (shared)
        const isAnggota = posisi.startsWith('anggota');
        
        let timQuery = `
          SELECT id FROM tim_verifikasi_kecamatan 
          WHERE kecamatan_id = :kecamatanId AND jabatan = :posisi
        `;
        const timReplacements = { kecamatanId, posisi };

        if (isAnggota && queryProposalId) {
          timQuery += ` AND proposal_id = :proposalId`;
          timReplacements.proposalId = queryProposalId;
        } else if (!isAnggota) {
          timQuery += ` AND proposal_id IS NULL`;
        }
        timQuery += ` LIMIT 1`;
        
        // Get tim_verifikasi_id
        const [timMember] = await sequelize.query(timQuery, {
          replacements: timReplacements,
          type: sequelize.QueryTypes.SELECT
        });

        if (timMember) {
          whereClause += ' AND tim_verifikasi_id = :timId';
          replacements.timId = timMember.id;
        } else {
          // Tim member doesn't exist yet, return empty
          return res.json({
            success: true,
            data: null,
            message: 'Anggota tim belum terdaftar'
          });
        }
      } else if (verifier_type === 'dinas' && verifier_id) {
        whereClause += ' AND dinas_id = :dinasId';
        replacements.dinasId = verifier_id;
      }

      const [questionnaire] = await sequelize.query(`
        SELECT * FROM bankeu_verification_questionnaires
        WHERE ${whereClause}
        LIMIT 1
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      if (!questionnaire) {
        return res.json({
          success: true,
          data: null,
          message: 'Quisioner belum diisi'
        });
      }

      res.json({
        success: true,
        data: questionnaire
      });
    } catch (error) {
      console.error('Error getting questionnaire:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data quisioner',
        error: error.message
      });
    }
  }

  /**
   * Get all questionnaires for a proposal (for berita acara aggregation)
   * GET /api/bankeu/questionnaire/:proposalId/all
   */
  async getAllQuestionnaires(req, res) {
    try {
      const { proposalId } = req.params;

      const questionnaires = await sequelize.query(`
        SELECT 
          q.*,
          tv.nama as verifier_nama,
          tv.jabatan as verifier_posisi,
          tv.jabatan_label as verifier_jabatan
        FROM bankeu_verification_questionnaires q
        LEFT JOIN tim_verifikasi_kecamatan tv ON q.tim_verifikasi_id = tv.id
        WHERE q.proposal_id = :proposalId
        ORDER BY 
          CASE q.verifikasi_type
            WHEN 'kecamatan' THEN 1
            WHEN 'kecamatan_tim' THEN 2
            WHEN 'dinas' THEN 3
          END,
          tv.jabatan
      `, {
        replacements: { proposalId },
        type: sequelize.QueryTypes.SELECT
      });

      res.json({
        success: true,
        data: questionnaires
      });
    } catch (error) {
      console.error('Error getting all questionnaires:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data quisioner',
        error: error.message
      });
    }
  }

  /**
   * Create or update questionnaire
   * POST /api/bankeu/questionnaire/:proposalId
   */
  async upsertQuestionnaire(req, res) {
    try {
      const { proposalId } = req.params;
      const {
        verifier_type,
        verifier_id,
        q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13,
        q1_keterangan, q2_keterangan, q3_keterangan, q4_keterangan,
        q5_keterangan, q6_keterangan, q7_keterangan, q8_keterangan,
        q9_keterangan, q10_keterangan, q11_keterangan, q12_keterangan, q13_keterangan,
        overall_recommendation,
        overall_notes
      } = req.body;

      // Validate required fields
      if (!verifier_type) {
        return res.status(400).json({
          success: false,
          message: 'verifier_type wajib diisi'
        });
      }

      const validTypes = ['kecamatan', 'dinas', 'kecamatan_tim'];
      if (!validTypes.includes(verifier_type)) {
        return res.status(400).json({
          success: false,
          message: `verifier_type harus salah satu dari: ${validTypes.join(', ')}`
        });
      }

      let timVerifikasiId = null;
      let dinasId = null;

      // Resolve verifier_id based on type
      if (verifier_type === 'kecamatan_tim' && verifier_id) {
        const parts = verifier_id.split('_');
        const kecamatanId = parts[0];
        const posisi = parts.slice(1).join('_'); // Handle anggota_1, anggota_2 etc
        
        // For anggota, we need to look up with proposal_id
        // For ketua/sekretaris, proposal_id is NULL (shared)
        const isAnggota = posisi.startsWith('anggota');
        
        let timQuery = `
          SELECT id FROM tim_verifikasi_kecamatan 
          WHERE kecamatan_id = :kecamatanId AND jabatan = :posisi
        `;
        const timReplacements = { kecamatanId, posisi };

        if (isAnggota) {
          timQuery += ` AND proposal_id = :proposalId`;
          timReplacements.proposalId = proposalId;
        } else {
          timQuery += ` AND proposal_id IS NULL`;
        }
        timQuery += ` LIMIT 1`;
        
        // Get tim member
        const [timMember] = await sequelize.query(timQuery, {
          replacements: timReplacements,
          type: sequelize.QueryTypes.SELECT
        });

        if (!timMember) {
          return res.status(400).json({
            success: false,
            message: 'Anggota tim belum terdaftar. Silakan isi data tim terlebih dahulu.'
          });
        }
        timVerifikasiId = timMember.id;
      } else if (verifier_type === 'dinas' && verifier_id) {
        dinasId = verifier_id;
      }

      // Check if questionnaire exists
      let whereClause = 'proposal_id = :proposalId AND verifikasi_type = :verifier_type';
      const checkReplacements = { proposalId, verifier_type };
      
      if (timVerifikasiId) {
        whereClause += ' AND tim_verifikasi_id = :timVerifikasiId';
        checkReplacements.timVerifikasiId = timVerifikasiId;
      }
      if (dinasId) {
        whereClause += ' AND dinas_id = :dinasId';
        checkReplacements.dinasId = dinasId;
      }

      const [existing] = await sequelize.query(`
        SELECT id FROM bankeu_verification_questionnaires
        WHERE ${whereClause}
        LIMIT 1
      `, {
        replacements: checkReplacements,
        type: sequelize.QueryTypes.SELECT
      });

      const questionData = {
        q1: q1 ? 1 : 0,
        q2: q2 ? 1 : 0,
        q3: q3 ? 1 : 0,
        q4: q4 ? 1 : 0,
        q5: q5 ? 1 : 0,
        q6: q6 ? 1 : 0,
        q7: q7 ? 1 : 0,
        q8: q8 ? 1 : 0,
        q9: q9 ? 1 : 0,
        q10: q10 ? 1 : 0,
        q11: q11 ? 1 : 0,
        q12: q12 ? 1 : 0,
        q13: q13 ? 1 : 0,
        q1_keterangan: q1_keterangan || null,
        q2_keterangan: q2_keterangan || null,
        q3_keterangan: q3_keterangan || null,
        q4_keterangan: q4_keterangan || null,
        q5_keterangan: q5_keterangan || null,
        q6_keterangan: q6_keterangan || null,
        q7_keterangan: q7_keterangan || null,
        q8_keterangan: q8_keterangan || null,
        q9_keterangan: q9_keterangan || null,
        q10_keterangan: q10_keterangan || null,
        q11_keterangan: q11_keterangan || null,
        q12_keterangan: q12_keterangan || null,
        q13_keterangan: q13_keterangan || null,
        overall_recommendation: overall_recommendation || null,
        overall_notes: overall_notes || null
      };

      if (existing) {
        // Update
        await sequelize.query(`
          UPDATE bankeu_verification_questionnaires 
          SET 
            q1 = :q1, q2 = :q2, q3 = :q3, q4 = :q4, q5 = :q5, q6 = :q6, q7 = :q7,
            q8 = :q8, q9 = :q9, q10 = :q10, q11 = :q11, q12 = :q12, q13 = :q13,
            q1_keterangan = :q1_keterangan, q2_keterangan = :q2_keterangan,
            q3_keterangan = :q3_keterangan, q4_keterangan = :q4_keterangan,
            q5_keterangan = :q5_keterangan, q6_keterangan = :q6_keterangan,
            q7_keterangan = :q7_keterangan, q8_keterangan = :q8_keterangan,
            q9_keterangan = :q9_keterangan, q10_keterangan = :q10_keterangan,
            q11_keterangan = :q11_keterangan, q12_keterangan = :q12_keterangan,
            q13_keterangan = :q13_keterangan,
            overall_recommendation = :overall_recommendation,
            overall_notes = :overall_notes,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = :id
        `, {
          replacements: { ...questionData, id: existing.id }
        });

        res.json({
          success: true,
          message: 'Quisioner berhasil diperbarui',
          data: { id: existing.id }
        });
      } else {
        // Insert
        const [result] = await sequelize.query(`
          INSERT INTO bankeu_verification_questionnaires 
          (proposal_id, tim_verifikasi_id, verifikasi_type, dinas_id,
           q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13,
           q1_keterangan, q2_keterangan, q3_keterangan, q4_keterangan,
           q5_keterangan, q6_keterangan, q7_keterangan, q8_keterangan,
           q9_keterangan, q10_keterangan, q11_keterangan, q12_keterangan, q13_keterangan,
           overall_recommendation, overall_notes, status)
          VALUES 
          (:proposalId, :timVerifikasiId, :verifier_type, :dinasId,
           :q1, :q2, :q3, :q4, :q5, :q6, :q7, :q8, :q9, :q10, :q11, :q12, :q13,
           :q1_keterangan, :q2_keterangan, :q3_keterangan, :q4_keterangan,
           :q5_keterangan, :q6_keterangan, :q7_keterangan, :q8_keterangan,
           :q9_keterangan, :q10_keterangan, :q11_keterangan, :q12_keterangan, :q13_keterangan,
           :overall_recommendation, :overall_notes, 'draft')
        `, {
          replacements: { 
            proposalId, 
            timVerifikasiId, 
            verifier_type, 
            dinasId,
            ...questionData 
          }
        });

        res.status(201).json({
          success: true,
          message: 'Quisioner berhasil disimpan',
          data: { id: result }
        });
      }
    } catch (error) {
      console.error('Error upserting questionnaire:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menyimpan quisioner',
        error: error.message
      });
    }
  }

  /**
   * Submit questionnaire (finalize)
   * POST /api/bankeu/questionnaire/:proposalId/submit
   */
  async submitQuestionnaire(req, res) {
    try {
      const { proposalId } = req.params;
      const { verifier_type, verifier_id } = req.body;

      if (!verifier_type) {
        return res.status(400).json({
          success: false,
          message: 'verifier_type wajib diisi'
        });
      }

      let timVerifikasiId = null;
      let dinasId = null;

      if (verifier_type === 'kecamatan_tim' && verifier_id) {
        const parts = verifier_id.split('_');
        const kecamatanId = parts[0];
        const posisi = parts.slice(1).join('_');
        
        const [timMember] = await sequelize.query(`
          SELECT id FROM tim_verifikasi_kecamatan 
          WHERE kecamatan_id = :kecamatanId AND jabatan = :posisi
          LIMIT 1
        `, {
          replacements: { kecamatanId, posisi },
          type: sequelize.QueryTypes.SELECT
        });

        if (timMember) {
          timVerifikasiId = timMember.id;
        }
      } else if (verifier_type === 'dinas' && verifier_id) {
        dinasId = verifier_id;
      }

      let whereClause = 'proposal_id = :proposalId AND verifikasi_type = :verifier_type';
      const replacements = { proposalId, verifier_type };
      
      if (timVerifikasiId) {
        whereClause += ' AND tim_verifikasi_id = :timVerifikasiId';
        replacements.timVerifikasiId = timVerifikasiId;
      }
      if (dinasId) {
        whereClause += ' AND dinas_id = :dinasId';
        replacements.dinasId = dinasId;
      }

      await sequelize.query(`
        UPDATE bankeu_verification_questionnaires 
        SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
        WHERE ${whereClause}
      `, { replacements });

      res.json({
        success: true,
        message: 'Quisioner berhasil disubmit'
      });
    } catch (error) {
      console.error('Error submitting questionnaire:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal submit quisioner',
        error: error.message
      });
    }
  }

  /**
   * Get questionnaire summary for berita acara
   * GET /api/bankeu/questionnaire/:proposalId/summary
   */
  async getQuestionnaireSummary(req, res) {
    try {
      const { proposalId } = req.params;

      // Get all questionnaires for this proposal
      const questionnaires = await sequelize.query(`
        SELECT 
          q.*,
          tv.nama as verifier_nama,
          tv.jabatan as verifier_posisi
        FROM bankeu_verification_questionnaires q
        LEFT JOIN tim_verifikasi_kecamatan tv ON q.tim_verifikasi_id = tv.id
        WHERE q.proposal_id = :proposalId
      `, {
        replacements: { proposalId },
        type: sequelize.QueryTypes.SELECT
      });

      if (questionnaires.length === 0) {
        return res.json({
          success: true,
          data: null,
          message: 'Belum ada quisioner yang diisi'
        });
      }

      // Aggregate: item is checked if ALL verifiers checked it
      const summary = {};
      for (let i = 1; i <= 13; i++) {
        const key = `q${i}`;
        summary[key] = questionnaires.every(q => q[key] === 1);
        summary[`${key}_count`] = questionnaires.filter(q => q[key] === 1).length;
        summary[`${key}_total`] = questionnaires.length;
      }

      summary.total_verifiers = questionnaires.length;
      summary.all_submitted = questionnaires.every(q => q.status === 'submitted');

      res.json({
        success: true,
        data: {
          summary,
          details: questionnaires
        }
      });
    } catch (error) {
      console.error('Error getting questionnaire summary:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil summary quisioner',
        error: error.message
      });
    }
  }

  /**
   * Check if dinas questionnaire + TTD is complete
   * GET /api/bankeu/questionnaire/:proposalId/dinas/check
   */
  async checkDinasQuestionnaireComplete(req, res) {
    try {
      const { proposalId } = req.params;
      const { dinas_id } = req.query;

      if (!dinas_id) {
        return res.status(400).json({
          success: false,
          message: 'dinas_id wajib diisi'
        });
      }

      // Check questionnaire
      const [questionnaire] = await sequelize.query(`
        SELECT id, status FROM bankeu_verification_questionnaires
        WHERE proposal_id = :proposalId 
          AND verifikasi_type = 'dinas' 
          AND dinas_id = :dinas_id
        LIMIT 1
      `, {
        replacements: { proposalId, dinas_id },
        type: sequelize.QueryTypes.SELECT
      });

      const hasQuestionnaire = !!questionnaire;
      const questionnaireSubmitted = questionnaire?.status === 'submitted';

      res.json({
        success: true,
        data: {
          has_questionnaire: hasQuestionnaire,
          questionnaire_submitted: questionnaireSubmitted,
          is_complete: hasQuestionnaire && questionnaireSubmitted
        }
      });
    } catch (error) {
      console.error('Error checking dinas questionnaire:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memeriksa kelengkapan quisioner dinas',
        error: error.message
      });
    }
  }

  /**
   * Check if ALL kecamatan tim verifikasi are complete (for berita acara button)
   * GET /api/bankeu/questionnaire/:proposalId/kecamatan/check-all
   */
  async checkKecamatanTimComplete(req, res) {
    try {
      const { proposalId } = req.params;
      const { kecamatan_id } = req.query;

      if (!kecamatan_id) {
        return res.status(400).json({
          success: false,
          message: 'kecamatan_id wajib diisi'
        });
      }

      // Get all active tim members - include proposal-specific anggota
      // Ketua & Sekretaris: proposal_id IS NULL (shared)
      // Anggota: proposal_id = specific proposal OR proposal_id IS NULL (backward compatibility)
      // Only include new format 'anggota_X' (exclude deprecated 'anggota' format)
      const timMembers = await sequelize.query(`
        SELECT id, jabatan, nama, nip, jabatan_label, ttd_path, proposal_id
        FROM tim_verifikasi_kecamatan
        WHERE kecamatan_id = :kecamatan_id 
          AND is_active = 1
          AND jabatan IN ('ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3')
          AND (proposal_id IS NULL OR proposal_id = :proposalId)
        ORDER BY FIELD(jabatan, 'ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3')
      `, {
        replacements: { kecamatan_id, proposalId },
        type: sequelize.QueryTypes.SELECT
      });

      if (timMembers.length === 0) {
        return res.json({
          success: true,
          data: {
            is_complete: false,
            message: 'Belum ada anggota tim yang terdaftar',
            tim_members: [],
            questionnaires: []
          }
        });
      }

      // Get questionnaires for all tim members
      const timIds = timMembers.map(m => m.id);
      const questionnaires = await sequelize.query(`
        SELECT tim_verifikasi_id, status
        FROM bankeu_verification_questionnaires
        WHERE proposal_id = :proposalId 
          AND verifikasi_type = 'kecamatan_tim'
          AND tim_verifikasi_id IN (:timIds)
      `, {
        replacements: { proposalId, timIds },
        type: sequelize.QueryTypes.SELECT
      });

      // Build status for each member
      const memberStatus = timMembers.map(member => {
        const questionnaire = questionnaires.find(q => q.tim_verifikasi_id === member.id);
        const hasData = !!(member.nama && member.jabatan_label);
        const hasTTD = !!member.ttd_path;
        const hasQuestionnaire = !!questionnaire;
        const questionnaireSubmitted = questionnaire?.status === 'submitted';

        return {
          id: member.id,
          posisi: member.jabatan,
          nama: member.nama,
          has_data: hasData,
          has_ttd: hasTTD,
          has_questionnaire: hasQuestionnaire,
          questionnaire_submitted: questionnaireSubmitted,
          is_complete: hasData && hasTTD && hasQuestionnaire
        };
      });

      const allComplete = memberStatus.every(m => m.is_complete);
      const hasKetua = memberStatus.some(m => m.posisi === 'ketua' && m.is_complete);
      const hasSekretaris = memberStatus.some(m => m.posisi === 'sekretaris' && m.is_complete);
      
      // Debug: log completion reasons
      const incompleteMembers = memberStatus.filter(m => !m.is_complete);
      const completionIssues = incompleteMembers.map(m => {
        const issues = [];
        if (!m.has_data) issues.push('belum isi data');
        if (!m.has_ttd) issues.push('belum upload TTD');
        if (!m.has_questionnaire) issues.push('belum isi quisioner');
        return `${m.posisi}: ${issues.join(', ')}`;
      });

      res.json({
        success: true,
        data: {
          is_complete: allComplete && hasKetua && hasSekretaris,
          has_ketua: hasKetua,
          has_sekretaris: hasSekretaris,
          total_members: timMembers.length,
          complete_members: memberStatus.filter(m => m.is_complete).length,
          member_status: memberStatus,
          completion_issues: completionIssues
        }
      });
    } catch (error) {
      console.error('Error checking kecamatan tim:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memeriksa kelengkapan tim verifikasi',
        error: error.message
      });
    }
  }
}

module.exports = new BankeuQuestionnaireController();
