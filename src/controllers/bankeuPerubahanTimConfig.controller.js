/**
 * Controller Tim Verifikasi Bankeu Perubahan (per-proposal, berbasis posisi)
 * Mirror dari kecamatanBankeuTimConfig.controller (bankeu reguler), diadaptasi:
 *  - Tabel: tim_verifikasi_bankeu_perubahan
 *  - Quisioner: bankeu_perubahan_questionnaires (verifikasi_type='kecamatan_tim', tim_verifikasi_id)
 *  - TTD anggota: storage/uploads/signatures/<filename> (bare filename) — sesuai pembaca BA perubahan
 *
 * Struktur:
 *  - Ketua & Sekretaris : proposal_id = NULL (dipakai bersama semua proposal di kecamatan)
 *  - Anggota (anggota_N): proposal_id = id proposal (beda tiap proposal)
 *  - kolom jabatan        = posisi (ketua / sekretaris / anggota_1 ...)
 *  - kolom jabatan_label  = deskripsi jabatan sebenarnya
 *
 * Catatan: handler tidak menggunakan `this` agar aman didaftarkan langsung sebagai
 * route handler Express (menghindari kehilangan binding).
 */
const { kueri, jalankan } = require('../config/sqlMentah');
const { urutanNilai, urutNull } = require('../config/dialek');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const SIGN_DIR = path.join(__dirname, '../../storage/uploads/signatures');
const REG_UPLOADS = path.join(__dirname, '../../storage/uploads');

function cleanupFile(req) {
  if (req.file && req.file.path) {
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
  }
}

/**
 * Salin file TTD dari penyimpanan Bankeu reguler (storage/uploads/<ttd_path>,
 * mis. kecamatan_bankeu_ttd/xxx.png) ke folder signatures milik perubahan,
 * kembalikan nama file polos (sesuai pembaca BA perubahan). null bila gagal/kosong.
 */
function copyRegTtd(regTtdPath, kecamatanId, suffix) {
  if (!regTtdPath) return null;
  try {
    const src = path.join(REG_UPLOADS, regTtdPath);
    if (!fs.existsSync(src)) return null;
    if (!fs.existsSync(SIGN_DIR)) fs.mkdirSync(SIGN_DIR, { recursive: true });
    const ext = path.extname(regTtdPath) || '.png';
    const name = `ttd_perubahan_${kecamatanId}_import_${suffix}_${Date.now()}${ext}`;
    fs.copyFileSync(src, path.join(SIGN_DIR, name));
    return name;
  } catch (e) {
    logger.error('[BankeuPerubahan TimConfig] import copy TTD gagal:', e.message);
    return null;
  }
}

// Verifikasi user memang milik kecamatan tsb
async function ownsKecamatan(userId, kecamatanId) {
  const users = await kueri(`SELECT kecamatan_id FROM users WHERE id = ?`, [userId]);
  return Number(users[0]?.kecamatan_id) === Number(kecamatanId);
}

class BankeuPerubahanTimConfigController {
  /**
   * GET /:kecamatanId/tim-config?proposalId=X
   * Kembalikan ketua/sekretaris (shared) + anggota (proposal tsb), beserta has_questionnaire.
   */
  async getAllTimConfig(req, res) {
    try {
      const { kecamatanId } = req.params;
      const { proposalId } = req.query;
      if (!(await ownsKecamatan(req.user.id, kecamatanId))) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Urutan ? sesuai kemunculan: join proposal, kecamatan, lalu proposal lagi di WHERE.
      const params = proposalId ? [proposalId, kecamatanId, proposalId] : [kecamatanId];
      let query = `
        SELECT
          t.id, t.kecamatan_id, t.proposal_id,
          LOWER(TRIM(t.jabatan)) AS posisi,
          t.nama, t.nip,
          t.jabatan_label AS jabatan,
          t.ttd_path, t.is_active, t.created_at, t.updated_at,
          CASE WHEN q.id IS NOT NULL THEN 1 ELSE 0 END AS has_questionnaire
        FROM tim_verifikasi_bankeu_perubahan t
        LEFT JOIN bankeu_perubahan_questionnaires q
          ON q.tim_verifikasi_id = t.id
          AND q.verifikasi_type = 'kecamatan_tim'
          ${proposalId ? 'AND q.proposal_id = ?' : ''}
        WHERE t.kecamatan_id = ? AND t.is_active = TRUE
      `;

      if (proposalId) {
        query += ` AND (t.proposal_id IS NULL OR t.proposal_id = ?)`;
      } else {
        query += ` AND t.proposal_id IS NULL`;
      }

      // Tie-breaker: bila ada baris duplikat utk posisi yang sama (mis. ketua ganda
      // sisa import lama), dahulukan yang punya nama terisi lalu yang terbaru, agar
      // frontend (yang memakai .find untuk ketua/sekretaris) tidak menampilkan baris kosong.
      query += ` ORDER BY ${urutanNilai('LOWER(TRIM(t.jabatan))', ['ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3', 'anggota_4', 'anggota_5'])},
                 (t.nama IS NULL OR TRIM(t.nama) = '') ASC, t.id DESC`;

      const rows = await kueri(query, params);
      res.json({ success: true, data: rows.map(m => ({ ...m, has_questionnaire: !!m.has_questionnaire })) });
    } catch (error) {
      logger.error('[BankeuPerubahan TimConfig] Error getAll:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil konfigurasi tim', error: error.message });
    }
  }

  /**
   * POST /:kecamatanId/tim-config/:posisi
   * Body: { nama, nip, jabatan(label), proposalId?, sourceTtdPath? }
   */
  async upsertTimMemberConfig(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { nama, nip, jabatan, proposalId, sourceTtdPath } = req.body;
      if (!(await ownsKecamatan(req.user.id, kecamatanId))) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
      if (!nama || !jabatan) {
        return res.status(400).json({ success: false, message: 'Nama dan jabatan wajib diisi' });
      }

      const isAnggota = posisi.startsWith('anggota_');
      if (isAnggota && !proposalId) {
        return res.status(400).json({ success: false, message: 'Proposal ID wajib untuk anggota tim' });
      }
      const effectiveProposalId = isAnggota ? proposalId : null;

      let whereClause = 'kecamatan_id = ? AND jabatan = ?';
      const whereParams = [kecamatanId, posisi];
      if (isAnggota) {
        whereClause += ' AND proposal_id = ?';
        whereParams.push(proposalId);
      } else {
        whereClause += ' AND proposal_id IS NULL';
      }

      const [existing] = await kueri(
        `SELECT id FROM tim_verifikasi_bankeu_perubahan WHERE ${whereClause} LIMIT 1`,
        whereParams
      );

      if (existing) {
        await jalankan(
          `UPDATE tim_verifikasi_bankeu_perubahan
           SET nama = ?, nip = ?, jabatan_label = ?, is_active = TRUE, updated_at = NOW()
           WHERE ${whereClause}`,
          [nama, nip || null, jabatan, ...whereParams]
        );
        return res.json({
          success: true, message: 'Konfigurasi anggota tim diperbarui',
          data: { id: existing.id, kecamatan_id: kecamatanId, proposal_id: effectiveProposalId, posisi, nama, nip, jabatan }
        });
      }

      // Copy TTD dari anggota sebelumnya (opsional)
      let copiedTtd = null;
      if (sourceTtdPath) {
        try {
          const src = path.join(SIGN_DIR, sourceTtdPath);
          if (fs.existsSync(src)) {
            if (!fs.existsSync(SIGN_DIR)) fs.mkdirSync(SIGN_DIR, { recursive: true });
            const ext = path.extname(sourceTtdPath) || '.png';
            const suffix = isAnggota ? `${posisi}_p${proposalId}` : posisi;
            copiedTtd = `ttd_perubahan_${kecamatanId}_${suffix}_${Date.now()}${ext}`;
            fs.copyFileSync(src, path.join(SIGN_DIR, copiedTtd));
          }
        } catch (e) {
          logger.error('[BankeuPerubahan TimConfig] copy TTD gagal:', e.message);
        }
      }

      const [{ id: newId }] = await kueri(
        `INSERT INTO tim_verifikasi_bankeu_perubahan
           (kecamatan_id, proposal_id, jabatan, jabatan_label, nama, nip, ttd_path, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE) RETURNING id`,
        [kecamatanId, effectiveProposalId, posisi, jabatan, nama, nip || null, copiedTtd]
      );

      res.status(201).json({
        success: true, message: 'Konfigurasi anggota tim dibuat',
        data: { id: newId, kecamatan_id: kecamatanId, proposal_id: effectiveProposalId, posisi, nama, nip, jabatan, ttd_path: copiedTtd }
      });
    } catch (error) {
      logger.error('[BankeuPerubahan TimConfig] Error upsert:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan konfigurasi anggota tim', error: error.message });
    }
  }

  /**
   * POST /:kecamatanId/tim-config/:posisi/upload-ttd  (field: ttd)
   */
  async uploadTTD(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { proposalId } = req.body;
      if (!req.file) return res.status(400).json({ success: false, message: 'File tanda tangan wajib diunggah' });
      if (!(await ownsKecamatan(req.user.id, kecamatanId))) {
        cleanupFile(req);
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      const isAnggota = posisi.startsWith('anggota_');
      let whereClause = 'kecamatan_id = ? AND jabatan = ?';
      const whereParams = [kecamatanId, posisi];
      if (isAnggota && proposalId) {
        whereClause += ' AND proposal_id = ?';
        whereParams.push(proposalId);
      } else if (!isAnggota) {
        whereClause += ' AND proposal_id IS NULL';
      }

      const [config] = await kueri(
        `SELECT id, ttd_path FROM tim_verifikasi_bankeu_perubahan WHERE ${whereClause} LIMIT 1`,
        whereParams
      );
      if (!config) {
        cleanupFile(req);
        return res.status(404).json({ success: false, message: 'Konfigurasi belum dibuat. Isi data anggota tim dulu.' });
      }

      // Hapus TTD lama
      if (config.ttd_path) {
        const oldPath = path.join(SIGN_DIR, config.ttd_path);
        if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (e) {} }
      }

      await jalankan(
        `UPDATE tim_verifikasi_bankeu_perubahan SET ttd_path = ?, updated_at = NOW() WHERE ${whereClause}`,
        [req.file.filename, ...whereParams]
      );

      res.json({ success: true, message: 'Tanda tangan berhasil disimpan', data: { ttd_path: req.file.filename } });
    } catch (error) {
      cleanupFile(req);
      logger.error('[BankeuPerubahan TimConfig] Error uploadTTD:', error);
      res.status(500).json({ success: false, message: 'Gagal mengunggah tanda tangan', error: error.message });
    }
  }

  /**
   * DELETE /:kecamatanId/tim-config/:posisi/ttd?proposalId=X
   */
  async deleteTTD(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { proposalId } = req.query;
      if (!(await ownsKecamatan(req.user.id, kecamatanId))) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      const isAnggota = posisi.startsWith('anggota_');
      let whereClause = 'kecamatan_id = ? AND jabatan = ?';
      const whereParams = [kecamatanId, posisi];
      if (isAnggota && proposalId) {
        whereClause += ' AND proposal_id = ?';
        whereParams.push(proposalId);
      } else if (!isAnggota) {
        whereClause += ' AND proposal_id IS NULL';
      }

      const [config] = await kueri(
        `SELECT id, ttd_path FROM tim_verifikasi_bankeu_perubahan WHERE ${whereClause} LIMIT 1`,
        whereParams
      );
      if (!config || !config.ttd_path) {
        return res.status(404).json({ success: false, message: 'Tanda tangan tidak ditemukan' });
      }

      const filePath = path.join(SIGN_DIR, config.ttd_path);
      if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }

      await jalankan(
        `UPDATE tim_verifikasi_bankeu_perubahan SET ttd_path = NULL, updated_at = NOW() WHERE ${whereClause}`,
        whereParams
      );
      res.json({ success: true, message: 'Tanda tangan berhasil dihapus' });
    } catch (error) {
      logger.error('[BankeuPerubahan TimConfig] Error deleteTTD:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus tanda tangan', error: error.message });
    }
  }

  /**
   * DELETE /:kecamatanId/tim-config/:posisi?proposalId=X  (anggota saja)
   */
  async deleteAnggota(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { proposalId } = req.query;
      if (!(await ownsKecamatan(req.user.id, kecamatanId))) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
      if (!posisi.startsWith('anggota_')) {
        return res.status(400).json({ success: false, message: 'Hanya anggota yang dapat dihapus (ketua/sekretaris tidak).' });
      }

      let config;
      if (proposalId) {
        [config] = await kueri(
          `SELECT id, ttd_path FROM tim_verifikasi_bankeu_perubahan
           WHERE kecamatan_id = ? AND jabatan = ? AND proposal_id = ? LIMIT 1`,
          [kecamatanId, posisi, proposalId]
        );
      }
      if (!config) {
        [config] = await kueri(
          `SELECT id, ttd_path FROM tim_verifikasi_bankeu_perubahan
           WHERE kecamatan_id = ? AND jabatan = ? AND proposal_id IS NULL LIMIT 1`,
          [kecamatanId, posisi]
        );
      }
      if (!config) return res.status(404).json({ success: false, message: 'Anggota tidak ditemukan' });

      if (config.ttd_path) {
        const filePath = path.join(SIGN_DIR, config.ttd_path);
        if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
      }

      await jalankan(`DELETE FROM tim_verifikasi_bankeu_perubahan WHERE id = ?`, [config.id]);
      res.json({ success: true, message: 'Anggota tim berhasil dihapus' });
    } catch (error) {
      logger.error('[BankeuPerubahan TimConfig] Error deleteAnggota:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus anggota tim', error: error.message });
    }
  }

  /**
   * POST /:kecamatanId/tim-config/import-from-reguler
   * Body: { proposalId? }
   * Salin Ketua & Sekretaris (shared, proposal_id NULL) dari Tim Verifikasi
   * Bankeu reguler (tim_verifikasi_kecamatan) ke tim_verifikasi_bankeu_perubahan,
   * berikut file TTD. Jika proposalId diberikan, anggota reguler (unik per nama)
   * juga ditambahkan sebagai anggota proposal tsb (yang belum ada).
   * (handler tidak memakai `this`)
   */
  async importFromReguler(req, res) {
    try {
      const { kecamatanId } = req.params;
      const { proposalId } = req.body;
      if (!(await ownsKecamatan(req.user.id, kecamatanId))) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // --- Ketua & Sekretaris (shared) dari reguler ---
      const sharedRows = await kueri(
        `SELECT jabatan AS posisi, nama, nip, jabatan_label, ttd_path
         FROM tim_verifikasi_kecamatan
         WHERE kecamatan_id = ? AND is_active = TRUE
           AND jabatan IN ('ketua', 'sekretaris') AND proposal_id IS NULL`,
        [kecamatanId]
      );

      if (!sharedRows.length) {
        return res.status(404).json({
          success: false,
          message: 'Tim Verifikasi Bankeu reguler (Ketua/Sekretaris) belum dibuat untuk kecamatan ini',
        });
      }

      let importedShared = 0;
      for (const r of sharedRows) {
        // Lewati sumber tanpa nama agar tidak menimpa data tujuan dengan baris kosong
        // (dan agar hitungan importedShared jujur).
        if (!r.nama || !String(r.nama).trim()) continue;

        // Normalkan posisi (lowercase + trim) agar tidak ada baris 'Ketua'/'ketua ' yang
        // gagal dicocokkan frontend (find case-sensitive). Pakai LOWER(TRIM(jabatan)) saat
        // mencari baris lama agar duplikat dengan kapital/spasi berbeda ikut terbersihkan.
        const posisi = String(r.posisi || '').trim().toLowerCase();
        if (!posisi) continue;

        const copied = copyRegTtd(r.ttd_path, kecamatanId, posisi);
        const jabatanLabel = r.jabatan_label || posisi;

        // Ambil SEMUA baris shared utk posisi ini (bukan LIMIT 1). Bila ada duplikat
        // (mis. baris ketua kosong sisa percobaan lama, atau beda kapital/spasi),
        // pertahankan satu & hapus sisanya supaya tidak ada baris kosong yang "menang".
        const existingRows = await kueri(
          `SELECT id, ttd_path FROM tim_verifikasi_bankeu_perubahan
           WHERE kecamatan_id = ? AND LOWER(TRIM(jabatan)) = ? AND proposal_id IS NULL
           ORDER BY id ASC`,
          [kecamatanId, posisi]
        );

        if (existingRows.length) {
          const keep = existingRows[0];
          // Bersihkan duplikat berlebih beserta file TTD-nya
          for (const dup of existingRows.slice(1)) {
            if (dup.ttd_path) {
              const p = path.join(SIGN_DIR, dup.ttd_path);
              if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }
            }
            await jalankan(
              `DELETE FROM tim_verifikasi_bankeu_perubahan WHERE id = ?`,
              [dup.id]
            );
          }
          // Hapus TTD lama bila digantikan hasil salin baru
          if (copied && keep.ttd_path) {
            const old = path.join(SIGN_DIR, keep.ttd_path);
            if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch (e) {} }
          }
          await jalankan(
            `UPDATE tim_verifikasi_bankeu_perubahan
             SET jabatan = ?, nama = ?, nip = ?, jabatan_label = ?, is_active = TRUE,
                 ttd_path = COALESCE(?, ttd_path), updated_at = NOW()
             WHERE id = ?`,
            [posisi, r.nama, r.nip || null, jabatanLabel, copied, keep.id]
          );
        } else {
          await jalankan(
            `INSERT INTO tim_verifikasi_bankeu_perubahan
               (kecamatan_id, proposal_id, jabatan, jabatan_label, nama, nip, ttd_path, is_active)
             VALUES (?, NULL, ?, ?, ?, ?, ?, TRUE)`,
            [kecamatanId, posisi, jabatanLabel, r.nama, r.nip || null, copied]
          );
        }
        importedShared++;
      }

      // --- Anggota (opsional, butuh proposalId) ---
      let importedAnggota = 0;
      if (proposalId) {
        const anggotaRows = await kueri(
          `SELECT nama, nip, jabatan_label, ttd_path
           FROM tim_verifikasi_kecamatan
           WHERE kecamatan_id = ? AND is_active = TRUE
             AND jabatan LIKE 'anggota_%' AND nama IS NOT NULL AND nama != ''
           ORDER BY ${urutNull('ttd_path', 'DESC')}, nama ASC, id ASC`,
          [kecamatanId]
        );

        // Dedup berdasarkan nama (case-insensitive)
        const seen = new Set();
        const uniqueAnggota = anggotaRows.filter(a => {
          const key = a.nama.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Anggota yang sudah ada di proposal ini
        const existingAnggota = await kueri(
          `SELECT jabatan AS posisi, nama FROM tim_verifikasi_bankeu_perubahan
           WHERE kecamatan_id = ? AND proposal_id = ?
             AND jabatan LIKE 'anggota_%' AND is_active = TRUE`,
          [kecamatanId, proposalId]
        );
        const existingNames = new Set(existingAnggota.map(a => (a.nama || '').toLowerCase().trim()));
        let maxN = 0;
        existingAnggota.forEach(a => {
          const m = a.posisi.match(/anggota_(\d+)/);
          if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
        });

        for (const a of uniqueAnggota) {
          if (existingNames.has(a.nama.toLowerCase().trim())) continue;
          maxN++;
          const posisi = `anggota_${maxN}`;
          const copied = copyRegTtd(a.ttd_path, kecamatanId, `${posisi}_p${proposalId}`);
          await jalankan(
            `INSERT INTO tim_verifikasi_bankeu_perubahan
               (kecamatan_id, proposal_id, jabatan, jabatan_label, nama, nip, ttd_path, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [kecamatanId, proposalId, posisi, a.jabatan_label || posisi, a.nama, a.nip || null, copied]
          );
          importedAnggota++;
        }
      }

      res.json({
        success: true,
        message: `Tim verifikasi disalin dari Bankeu reguler (${importedShared} Ketua/Sekretaris${proposalId ? `, ${importedAnggota} anggota` : ''})`,
        data: { importedShared, importedAnggota },
      });
    } catch (error) {
      logger.error('[BankeuPerubahan TimConfig] Error importFromReguler:', error);
      res.status(500).json({ success: false, message: 'Gagal mengimpor tim dari Bankeu reguler', error: error.message });
    }
  }

  /**
   * GET /:kecamatanId/tim-config-anggota-list
   * Daftar anggota unik yang pernah ditambahkan (untuk picker "pakai anggota sebelumnya").
   */
  async getAnggotaList(req, res) {
    try {
      const { kecamatanId } = req.params;
      if (!(await ownsKecamatan(req.user.id, kecamatanId))) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
      const rows = await kueri(
        `SELECT nama, nip, jabatan_label AS jabatan, ttd_path
         FROM tim_verifikasi_bankeu_perubahan
         WHERE kecamatan_id = ? AND jabatan LIKE 'anggota_%' AND is_active = TRUE
           AND nama IS NOT NULL AND nama != ''
         ORDER BY ${urutNull('ttd_path', 'DESC')}, nama ASC, id ASC`,
        [kecamatanId]
      );
      const seen = new Set();
      const unique = rows.filter(r => {
        const key = r.nama.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      res.json({ success: true, data: unique });
    } catch (error) {
      logger.error('[BankeuPerubahan TimConfig] Error anggotaList:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil daftar anggota', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanTimConfigController();
