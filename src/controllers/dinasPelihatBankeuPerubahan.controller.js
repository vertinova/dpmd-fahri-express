/**
 * Bankeu Perubahan — akses BACA-SAJA untuk dinas pelihat (BPKAD & Inspektorat).
 *
 * Mereka berperan PELIHAT: boleh membaca dan mengunduh arsip proposal
 * perubahan, tidak boleh memverifikasi, mengedit, atau menghapus apa pun. Karena itu
 * modul ini sengaja hanya membungkus handler READ milik controller DPMD dan
 * tidak pernah menyentuh handler tulis (verify/cancel/troubleshoot/edit).
 *
 * Dua pembatas yang dipasang di sini (untuk cakupan 'final', BPKAD/Inspektorat):
 *  1. Hanya proposal yang keputusan DPMD-nya sudah FINAL yang dikirim ke mereka
 *     — proposal yang masih berjalan (pending/revisi) bukan urusannya.
 *  2. Endpoint detail per-proposal menolak id yang belum final, supaya data
 *     tidak bisa dikorek satu per satu lewat URL.
 *
 * Cakupan 'all' (DLH, lihat req.bankeuPerubahanScope dari authorizeDinasPelihat)
 * melihat SEMUA proposal di semua tahap — tetap tanpa satupun handler tulis.
 */
const sequelize = require('../config/database');
const logger = require('../utils/logger');
const dpmdController = require('./bankeuPerubahanDpmd.controller');

// Keputusan DPMD dianggap final ketika sudah disetujui atau ditolak.
const STATUS_FINAL = ['approved', 'rejected'];

const isFinal = (proposal) =>
  !!proposal && !!proposal.submitted_to_dpmd && STATUS_FINAL.includes(proposal.dpmd_status);

/**
 * Jalankan handler READ milik DPMD dengan `res` tiruan, lalu saring hasilnya
 * ke proposal final saja sebelum diteruskan ke klien. Dengan cara ini query
 * SQL-nya tetap satu sumber (tidak diduplikasi) dan otomatis ikut kalau
 * kolomnya berubah, tetapi dinas pelihat tetap tidak melihat proposal berjalan.
 */
const finalOnly = (handler) => (req, res) => {
  const capture = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      if (this.statusCode >= 400) return res.status(this.statusCode).json(payload);
      const data = Array.isArray(payload?.data) ? payload.data.filter(isFinal) : payload?.data;
      return res.status(this.statusCode).json({ ...payload, data });
    },
  };
  return handler(req, capture);
};

const isScopeAll = (req) => req.bankeuPerubahanScope === 'all';

/**
 * Pastikan proposal yang dibuka detailnya memang sudah final di DPMD
 * (tidak berlaku untuk cakupan 'all').
 */
const ensureFinalProposal = async (req, res, next) => {
  if (isScopeAll(req)) return next();
  const id = req.params.id || req.params.proposalId;
  try {
    const [rows] = await sequelize.query(
      'SELECT submitted_to_dpmd, dpmd_status FROM bankeu_perubahan_proposals WHERE id = ? LIMIT 1',
      { replacements: [id] }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
    }
    if (!isFinal(rows[0])) {
      logger.warn(`❌ Dinas pelihat menolak akses proposal ${id} — belum final di DPMD`);
      return res.status(403).json({
        success: false,
        message: 'Proposal ini belum final di DPMD sehingga belum dapat dilihat'
      });
    }
    next();
  } catch (error) {
    logger.error('[BankeuPerubahan Pelihat] Error ensureFinalProposal:', error);
    return res.status(500).json({ success: false, message: 'Gagal memeriksa status proposal' });
  }
};

// Cakupan 'all' memakai query tracking DPMD, yang memang memuat SEMUA proposal
// (termasuk yang masih di Desa/Kecamatan) lengkap dengan tautan dokumennya.
const getProposals = (req, res) =>
  isScopeAll(req)
    ? dpmdController.getTracking(req, res)
    : finalOnly(dpmdController.getProposals)(req, res);

const getTracking = (req, res) =>
  isScopeAll(req)
    ? dpmdController.getTracking(req, res)
    : finalOnly(dpmdController.getTracking)(req, res);

module.exports = {
  ensureFinalProposal,
  getProposals,
  getTracking,
  getProposalVersions: dpmdController.getProposalVersions,
  getProposalRevisions: dpmdController.getProposalRevisions,
  getProposalVerificationHistory: dpmdController.getProposalVerificationHistory,
};
