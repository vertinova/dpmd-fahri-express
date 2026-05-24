const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const { updateProposalQuisionerFlag } = require('./bankeuPerubahanBeritaAcara.controller');

const MODULE_NAME = 'bankeu_perubahan';

/**
 * Resolve tim_verifikasi_id dari verifier_id ("{kecamatan_id}_{posisi}" atau plain id)
 * Untuk kecamatan_tim: jika verifier_id berformat "{kecId}_{posisi}", lookup tim member by kecamatan_id + jabatan + (proposal_id atau null).
 * Jika tidak ditemukan, return null.
 */
async function resolveTimIdFromVerifierId(verifier_id, proposalId) {
  if (!verifier_id) return null;
  const raw = String(verifier_id);

  // Plain numeric ID
  if (/^\d+$/.test(raw)) return Number(raw);

  // Format "{kecId}_{posisi}"
  const firstUnderscore = raw.indexOf('_');
  if (firstUnderscore <= 0) return null;
  const kecamatanId = raw.substring(0, firstUnderscore);
  const posisi = raw.substring(firstUnderscore + 1);
  const isAnggota = posisi.startsWith('anggota');

  let query = `
    SELECT id FROM tim_verifikasi_bankeu_perubahan
    WHERE kecamatan_id = ? AND jabatan = ? AND is_active = TRUE
  `;
  const replacements = [kecamatanId, posisi];

  if (isAnggota) {
    query += ` AND (proposal_id = ? OR proposal_id IS NULL)`;
    replacements.push(proposalId);
  } else {
    query += ` AND proposal_id IS NULL`;
  }
  query += ` ORDER BY id ASC LIMIT 1`;

  const [rows] = await sequelize.query(query, { replacements });
  return rows[0]?.id || null;
}

class BankeuPerubahanQuestionnaireController {
  /**
   * GET /api/bankeu-perubahan/questionnaire/:proposalId?verifier_type=kecamatan_tim&verifier_id=...
   */
  async getQuestionnaire(req, res) {
    try {
      const { proposalId } = req.params;
      const { verifier_type, verifier_id } = req.query;
      const userId = req.user.id;

      // Validasi user-kecamatan ↔ proposal-kecamatan
      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      const userKecId = users[0]?.kecamatan_id;

      const [proposalRows] = await sequelize.query(`
        SELECT bp.id, d.kecamatan_id FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id WHERE bp.id = ?
      `, { replacements: [proposalId] });
      if (!proposalRows.length) {
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }
      if (userKecId && Number(proposalRows[0].kecamatan_id) !== Number(userKecId)) {
        return res.status(403).json({ success: false, message: 'Proposal bukan dari kecamatan Anda' });
      }

      // Resolve tim_verifikasi_id (optional)
      let timId = null;
      if (verifier_type === 'kecamatan_tim' && verifier_id) {
        timId = await resolveTimIdFromVerifierId(verifier_id, proposalId);
      }

      let whereClause = 'proposal_id = ?';
      const replacements = [proposalId];
      if (timId) {
        whereClause += ' AND tim_verifikasi_id = ?';
        replacements.push(timId);
      } else if (verifier_type) {
        // If only verifier_type given (no tim), return latest by type
        whereClause += ' AND verifikasi_type = ?';
        replacements.push(verifier_type);
      }

      const [rows] = await sequelize.query(`
        SELECT * FROM bankeu_perubahan_questionnaires
        WHERE ${whereClause}
        ORDER BY updated_at DESC LIMIT 1
      `, { replacements });

      if (!rows.length) {
        return res.json({ success: true, data: null, message: 'Quisioner belum diisi' });
      }
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      logger.error('[BankeuPerubahan Questionnaire] get error:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil quisioner', error: error.message });
    }
  }

  /**
   * POST /api/bankeu-perubahan/questionnaire/:proposalId
   * body: { verifier_type, verifier_id, q1..q12, overall_notes }
   */
  async upsertQuestionnaire(req, res) {
    try {
      const { proposalId } = req.params;
      const userId = req.user.id;
      const {
        verifier_type, verifier_id,
        q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12,
        overall_notes,
      } = req.body;

      if (!verifier_type) {
        return res.status(400).json({ success: false, message: 'verifier_type wajib diisi' });
      }
      // Currently only support 'kecamatan_tim'
      if (verifier_type !== 'kecamatan_tim') {
        return res.status(400).json({ success: false, message: 'verifier_type tidak dikenal untuk bankeu perubahan' });
      }

      // Validasi user-kecamatan
      const [users] = await sequelize.query(`SELECT kecamatan_id, name FROM users WHERE id = ?`, { replacements: [userId] });
      const userKecId = users[0]?.kecamatan_id;
      if (!userKecId) return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });

      const [proposalRows] = await sequelize.query(`
        SELECT bp.id, bp.judul_proposal, d.kecamatan_id FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id WHERE bp.id = ?
      `, { replacements: [proposalId] });
      if (!proposalRows.length) return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      if (Number(proposalRows[0].kecamatan_id) !== Number(userKecId)) {
        return res.status(403).json({ success: false, message: 'Proposal bukan dari kecamatan Anda' });
      }

      // Resolve tim_verifikasi_id
      let timId = null;
      if (verifier_id) {
        timId = await resolveTimIdFromVerifierId(verifier_id, proposalId);
      }
      // Jika tidak ada verifier_id, ambil ketua kecamatan ini sebagai default
      if (!timId) {
        const [ketuaRows] = await sequelize.query(`
          SELECT id FROM tim_verifikasi_bankeu_perubahan
          WHERE kecamatan_id = ? AND jabatan = 'ketua' AND is_active = TRUE
            AND (proposal_id IS NULL OR proposal_id = ?)
          ORDER BY id ASC LIMIT 1
        `, { replacements: [userKecId, proposalId] });
        timId = ketuaRows[0]?.id || null;
      }
      if (!timId) {
        return res.status(400).json({
          success: false,
          message: 'Tim verifikasi belum dikonfigurasi. Silakan tambah anggota tim (Ketua) terlebih dahulu.',
        });
      }

      const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true';
      const fields = {
        q1: toBool(q1), q2: toBool(q2), q3: toBool(q3), q4: toBool(q4),
        q5: toBool(q5), q6: toBool(q6), q7: toBool(q7), q8: toBool(q8),
        q9: toBool(q9), q10: toBool(q10), q11: toBool(q11), q12: toBool(q12),
        overall_notes: overall_notes || null,
      };

      // Check existing
      const [existing] = await sequelize.query(`
        SELECT id FROM bankeu_perubahan_questionnaires
        WHERE proposal_id = ? AND tim_verifikasi_id = ?
        LIMIT 1
      `, { replacements: [proposalId, timId] });

      let resultId;
      if (existing.length) {
        resultId = existing[0].id;
        await sequelize.query(`
          UPDATE bankeu_perubahan_questionnaires
          SET q1=?, q2=?, q3=?, q4=?, q5=?, q6=?, q7=?, q8=?, q9=?, q10=?, q11=?, q12=?,
              overall_notes=?, status='submitted', submitted_at=NOW(), updated_at=NOW()
          WHERE id=?
        `, { replacements: [
          fields.q1, fields.q2, fields.q3, fields.q4, fields.q5, fields.q6,
          fields.q7, fields.q8, fields.q9, fields.q10, fields.q11, fields.q12,
          fields.overall_notes, resultId,
        ] });
      } else {
        const [insertResult] = await sequelize.query(`
          INSERT INTO bankeu_perubahan_questionnaires
          (proposal_id, tim_verifikasi_id, verifikasi_type,
           q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12,
           overall_notes, status, submitted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', NOW(), NOW(), NOW())
        `, { replacements: [
          proposalId, timId, verifier_type,
          fields.q1, fields.q2, fields.q3, fields.q4, fields.q5, fields.q6,
          fields.q7, fields.q8, fields.q9, fields.q10, fields.q11, fields.q12,
          fields.overall_notes,
        ] });
        resultId = insertResult;
      }

      // Update proposal.quisioner_completed flag
      await updateProposalQuisionerFlag(proposalId);

      ActivityLogger.log({
        userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: existing.length ? 'update' : 'create',
        entityType: 'bankeu_perubahan_questionnaire',
        entityId: parseInt(proposalId),
        entityName: proposalRows[0].judul_proposal,
        description: `${users[0].name || 'User'} ${existing.length ? 'memperbarui' : 'mengisi'} quisioner verifikasi proposal perubahan #${proposalId}`,
        newValue: { tim_verifikasi_id: timId, fields },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req),
      });

      res.json({
        success: true,
        message: 'Quisioner berhasil disimpan',
        data: { id: resultId, tim_verifikasi_id: timId },
      });
    } catch (error) {
      logger.error('[BankeuPerubahan Questionnaire] upsert error:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan quisioner', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanQuestionnaireController();
