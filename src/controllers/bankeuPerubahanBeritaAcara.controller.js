const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const beritaAcaraService = require('../services/beritaAcaraService');
const { checkTanggalMerah } = require('../utils/tanggalMerah');

const MODULE_NAME = 'bankeu_perubahan';
const isValidDocumentDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const POSISI_LABELS = {
  ketua: 'Ketua',
  sekretaris: 'Sekretaris',
  anggota_1: 'Anggota 1',
  anggota_2: 'Anggota 2',
  anggota_3: 'Anggota 3',
  anggota: 'Anggota',
};

function getPosisiLabel(posisi) {
  return POSISI_LABELS[posisi] || posisi;
}

async function ensureUserKecamatan(userId) {
  const [users] = await sequelize.query(`SELECT id, kecamatan_id, name FROM users WHERE id = ?`, { replacements: [userId] });
  if (!users[0]?.kecamatan_id) return null;
  return users[0];
}

async function loadProposal(proposalId) {
  const [rows] = await sequelize.query(`
    SELECT bp.*, d.nama AS desa_nama, d.kecamatan_id AS desa_kecamatan_id, k.nama AS kecamatan_nama
    FROM bankeu_perubahan_proposals bp
    INNER JOIN desas d ON bp.desa_id = d.id
    LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
    WHERE bp.id = ?
    LIMIT 1
  `, { replacements: [proposalId] });
  return rows[0] || null;
}

async function loadActiveTim(kecamatanId, proposalId) {
  const [rows] = await sequelize.query(`
    SELECT id, jabatan, jabatan_label, nama, nip, ttd_path, proposal_id
    FROM tim_verifikasi_bankeu_perubahan
    WHERE kecamatan_id = ?
      AND is_active = TRUE
      AND (proposal_id IS NULL OR proposal_id = ?)
    ORDER BY
      CASE jabatan
        WHEN 'ketua' THEN 1
        WHEN 'sekretaris' THEN 2
        WHEN 'anggota_1' THEN 3
        WHEN 'anggota_2' THEN 4
        WHEN 'anggota_3' THEN 5
        ELSE 6
      END,
      id ASC
  `, { replacements: [kecamatanId, proposalId] });
  return rows;
}

async function loadConfig(kecamatanId) {
  const [rows] = await sequelize.query(`
    SELECT * FROM kecamatan_bankeu_perubahan_config WHERE kecamatan_id = ?
  `, { replacements: [kecamatanId] });
  return rows[0] || null;
}

async function loadQuestionnaires(proposalId) {
  const [rows] = await sequelize.query(`
    SELECT q.*, t.jabatan AS posisi, t.nama AS tim_nama
    FROM bankeu_perubahan_questionnaires q
    LEFT JOIN tim_verifikasi_bankeu_perubahan t ON q.tim_verifikasi_id = t.id
    WHERE q.proposal_id = ?
  `, { replacements: [proposalId] });
  return rows;
}

async function updateProposalQuisionerFlag(proposalId) {
  // Set quisioner_completed = TRUE if all active tim members have submitted questionnaire
  const [rows] = await sequelize.query(`
    SELECT bp.id, bp.kecamatan_id
    FROM bankeu_perubahan_proposals bp
    WHERE bp.id = ?
  `, { replacements: [proposalId] });
  if (!rows.length) return;
  const kecamatanId = rows[0].kecamatan_id;

  const [timRows] = await sequelize.query(`
    SELECT COUNT(*) AS total FROM tim_verifikasi_bankeu_perubahan
    WHERE kecamatan_id = ? AND is_active = TRUE
      AND (proposal_id IS NULL OR proposal_id = ?)
  `, { replacements: [kecamatanId, proposalId] });
  const totalTim = Number(timRows[0].total);

  const [qRows] = await sequelize.query(`
    SELECT COUNT(*) AS total FROM bankeu_perubahan_questionnaires
    WHERE proposal_id = ? AND status IN ('submitted','draft')
  `, { replacements: [proposalId] });
  const submittedQ = Number(qRows[0].total);

  const completed = totalTim > 0 && submittedQ >= totalTim;
  await sequelize.query(`
    UPDATE bankeu_perubahan_proposals SET quisioner_completed = ?, updated_at = NOW() WHERE id = ?
  `, { replacements: [completed, proposalId] });
}

class BankeuPerubahanBeritaAcaraController {
  /**
   * Validate tim & quisioner before generate
   * GET /api/bankeu-perubahan/berita-acara/validate/:desaId/:proposalId
   */
  async validate(req, res) {
    try {
      const { desaId, proposalId } = req.params;
      const user = await ensureUserKecamatan(req.user.id);
      if (!user) return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });

      const proposal = await loadProposal(proposalId);
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      if (Number(proposal.desa_id) !== Number(desaId)) {
        return res.status(400).json({ success: false, message: 'desaId tidak cocok dengan proposal' });
      }
      if (Number(proposal.desa_kecamatan_id) !== Number(user.kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Proposal bukan dari kecamatan Anda' });
      }

      const kecamatanId = user.kecamatan_id;
      const tim = await loadActiveTim(kecamatanId, proposalId);
      const questionnaires = await loadQuestionnaires(proposalId);

      const missing_tim_members = [];
      const missing_signatures = [];
      const missing_quisioner = [];

      const hasKetua = tim.some(t => t.jabatan === 'ketua');
      if (!hasKetua) {
        missing_tim_members.push('Ketua Tim Verifikasi');
      }

      // Untuk setiap anggota tim aktif, cek ttd dan quisioner
      for (const member of tim) {
        const label = `${getPosisiLabel(member.jabatan)}${member.nama ? ` (${member.nama})` : ''}`;
        if (!member.ttd_path) missing_signatures.push(label);
        const hasQ = questionnaires.some(q => Number(q.tim_verifikasi_id) === Number(member.id));
        if (!hasQ) missing_quisioner.push(label);
      }

      // Cek config kecamatan
      const config = await loadConfig(kecamatanId);
      const configMissing = [];
      if (!config) configMissing.push('Konfigurasi kecamatan belum dibuat');
      else {
        if (!config.nama_camat) configMissing.push('Nama Camat');
        if (!config.ttd_camat_path) configMissing.push('TTD Camat');
        if (!config.stempel_path) configMissing.push('Stempel');
        if (!config.alamat) configMissing.push('Alamat Kecamatan');
      }

      const valid = missing_tim_members.length === 0
        && missing_signatures.length === 0
        && missing_quisioner.length === 0
        && configMissing.length === 0;

      res.json({
        success: true,
        data: {
          valid,
          missing_tim_members,
          missing_signatures,
          missing_quisioner,
          missing_config: configMissing,
          summary: {
            total_tim: tim.length,
            total_quisioner: questionnaires.length,
            has_config: !!config,
          },
        },
      });
    } catch (error) {
      logger.error('[BankeuPerubahan BA] validate error:', error);
      res.status(500).json({ success: false, message: 'Gagal memvalidasi', error: error.message });
    }
  }

  /**
   * Generate Berita Acara per proposal
   * POST /api/kecamatan/bankeu-perubahan/desa/:desaId/berita-acara
   * body: { proposalId, kegiatanId, optionalItems, tanggal }
   */
  async generateBeritaAcara(req, res) {
    try {
      const { desaId } = req.params;
      const { proposalId, kegiatanId, optionalItems, tanggal } = req.body;
      const user = await ensureUserKecamatan(req.user.id);
      if (!user) return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });

      if (!proposalId) {
        return res.status(400).json({ success: false, message: 'proposalId wajib diisi' });
      }
      if (!isValidDocumentDate(tanggal)) {
        return res.status(400).json({ success: false, message: 'Tanggal Berita Acara wajib dipilih dengan format YYYY-MM-DD' });
      }
      const cekBA = await checkTanggalMerah(tanggal);
      if (cekBA.merah) {
        return res.status(400).json({ success: false, message: `Tanggal Berita Acara tidak boleh jatuh pada tanggal merah (${cekBA.alasan}). Silakan pilih hari kerja.` });
      }

      const proposal = await loadProposal(proposalId);
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      if (Number(proposal.desa_id) !== Number(desaId)) {
        return res.status(400).json({ success: false, message: 'desaId tidak cocok dengan proposal' });
      }
      if (Number(proposal.desa_kecamatan_id) !== Number(user.kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Proposal bukan dari kecamatan Anda' });
      }
      const returnedByDpmd = ['revision', 'rejected'].includes(proposal.dpmd_status);
      if (proposal.submitted_to_dpmd && !returnedByDpmd) {
        return res.status(400).json({ success: false, message: 'Proposal sudah dikirim ke DPMD, Berita Acara tidak dapat di-generate ulang dari tahap Kecamatan' });
      }
      if (proposal.kecamatan_status && !['pending', 'in_review', 'approved'].includes(proposal.kecamatan_status)) {
        return res.status(400).json({ success: false, message: 'Berita Acara hanya dapat di-generate untuk proposal yang masih dalam review atau sudah siap disetujui Kecamatan' });
      }

      const kecamatanId = user.kecamatan_id;
      const config = await loadConfig(kecamatanId);
      if (!config) {
        return res.status(400).json({ success: false, message: 'Konfigurasi kecamatan belum lengkap' });
      }

      const tim = await loadActiveTim(kecamatanId, proposalId);
      const questionnaires = await loadQuestionnaires(proposalId);

      // Generate PDF
      const outDir = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/berita-acara');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const ts = Date.now();
      const fileName = `BA_perubahan_p${proposalId}_${ts}.pdf`;
      const filePath = path.join(outDir, fileName);
      const relPath = `/storage/uploads/bankeu-perubahan/berita-acara/${fileName}`;
      const qrCode = `BA-PER-${proposalId}-${ts}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();

      const doc = new PDFDocument({
        size: [595.28, 935.43], // F4 — samakan dengan Berita Acara reguler
        margins: { top: 50, bottom: 50, left: 72, right: 72 },
        bufferPages: true,
      });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // ===== Adapter data → renderer Berita Acara reguler (layout sama) =====
      const isInfra = proposal.jenis_kegiatan === 'pilihan_infrastruktur';

      const desaData = {
        nama_desa: proposal.desa_nama,
        nama_kecamatan: proposal.kecamatan_nama,
      };

      const kecConfig = {
        nama_kecamatan: proposal.kecamatan_nama,
        nama_camat: config.nama_camat,
        nip_camat: config.nip_camat,
        jabatan_penandatangan: config.jabatan_penandatangan,
        logo_path: config.logo_path,
        alamat: config.alamat,
        telepon: config.telepon,
        email: config.email,
        website: config.website,
        kode_pos: config.kode_pos,
        // path TTD/stempel relatif terhadap storage/uploads
        ttd_camat: config.ttd_camat_path ? `bankeu-perubahan/config/${config.ttd_camat_path}` : null,
        stempel_path: config.stempel_path ? `bankeu-perubahan/config/${config.stempel_path}` : null,
      };

      const proposalAdapter = {
        judul_proposal: proposal.judul_proposal,
        lokasi: proposal.lokasi,
        volume: proposal.volume,
        anggaran_usulan: proposal.anggaran_usulan,
        jenis_kegiatan: isInfra ? 'infrastruktur' : 'non_infrastruktur',
      };

      const timAdapter = tim.map((t) => ({
        jabatan: t.jabatan,
        jabatan_label: t.jabatan_label,
        nama: t.nama,
        nip: t.nip,
        ttd: t.ttd_path ? `signatures/${t.ttd_path}` : null,
      }));

      // Checklist mengikuti format resmi (lihat tabel Berita Acara):
      // - Item 1–4: dokumen umum (semua jenis kegiatan)
      // - Item 5–9: khusus INFRASTRUKTUR (kolom KET = "Infrastruktur")
      const checklistItems = isInfra ? [
        { no: 1, itemKey: 'item_1', text: 'Surat Pengantar dari Kepala Desa' },
        { no: 2, itemKey: 'item_2', text: 'Surat Permohonan Bantuan Keuangan Khusus Akselerasi Pembangunan Perdesaan' },
        { no: 3, itemKey: 'item_3', text: 'Proposal Bantuan Keuangan Khusus Akselerasi Pembangunan Perdesaan',
          subItems: ['- Latar Belakang', '- Maksud dan Tujuan', '- Bentuk Kegiatan', '- Jadwal Pelaksanaan'] },
        { no: 4, itemKey: 'item_4', text: 'Rencana Penggunaan Bantuan Keuangan dan RAB' },
        { no: 5, itemKey: 'item_5', text: 'Foto lokasi rencana pelaksanaan kegiatan (0%)', ket: 'Infrastruktur' },
        { no: 6, itemKey: 'item_6', text: 'Peta desa dan titik lokasi rencana kegiatan', ket: 'Infrastruktur' },
        { no: 7, itemKey: 'item_7', text: 'Berita Acara Hasil Musyawarah Desa', ket: 'Infrastruktur' },
        { no: 8, itemKey: 'item_8', text: 'SK Kepala Desa tentang Penetapan Tim Pelaksana Kegiatan (TPK)', ket: 'Infrastruktur' },
        { no: 9, itemKey: 'item_9', text: 'Ketersediaan lahan dan kepastian status lahan :', ket: 'Infrastruktur',
          subItems: [
            '- surat pernyataan dari Kepala Desa yang menyatakan bahwa lokasi kegiatan tidak dalam keadaan bermasalah apabila merupakan Aset Desa;',
            '- surat izin/persetujuan pemanfaatan dari perorangan selaku pemilik lahan, yang menyatakan tidak keberatan lahannya akan dipergunakan untuk pembangunan infrastruktur desa dan tanpa persyaratan apa pun, yang disetujui oleh keluarga;',
            '- persetujuan pemanfaatan barang milik Daerah/Negara dalam hal lahan yang akan dipergunakan untuk pembangunan infrastruktur desa merupakan milik/dikuasai Pemerintah Daerah/Pemerintah Provinsi, Pemerintah Pusat;',
            '- persetujuan pemanfaatan/penggunaan dari Badan Usaha/Badan Hukum selaku pemilik lahan, yang menyatakan tidak keberatan lahannya akan dipergunakan untuk pembangunan infrastruktur desa dan tanpa persyaratan apa pun;',
            '- fotokopi bukti kepemilikan Aset Desa sesuai ketentuan perundang-undangan, dalam hal usulan kegiatan yang diusulkan berupa rehabilitasi kantor desa.',
          ] },
      ] : [
        { no: 1, itemKey: 'item_1', text: 'Surat Pengantar dari Kepala Desa' },
        { no: 2, itemKey: 'item_2', text: 'Surat Permohonan Bantuan Keuangan Khusus Akselerasi Pembangunan Perdesaan' },
        { no: 3, itemKey: 'item_3', text: 'Proposal Bantuan Keuangan Khusus Akselerasi Pembangunan Perdesaan',
          subItems: ['- Latar Belakang', '- Maksud dan Tujuan', '- Bentuk Kegiatan', '- Jadwal Pelaksanaan'] },
        { no: 4, itemKey: 'item_4', text: 'Rencana Penggunaan Bantuan Keuangan dan RAB' },
      ];

      // checklistData: item_N "tersedia" bila MINIMAL SATU anggota tim mencentang qN
      const aggItem = (key) => questionnaires.some((q) => q[key] === true || q[key] === 1);
      const checklistData = {};
      checklistItems.forEach((it, idx) => { checklistData[it.itemKey] = aggItem(`q${idx + 1}`); });

      beritaAcaraService.generatePage1(
        doc, desaData, kecConfig, [proposalAdapter], timAdapter,
        qrCode, checklistData, optionalItems || null, tanggal,
        {
          titleLines: ['BERITA ACARA VERIFIKASI', 'PROPOSAL BANTUAN KEUANGAN PERUBAHAN DESA'],
          programName: 'Bantuan Keuangan Perubahan',
          checklistItems,
          // Kolom HASIL dibagi 2 sub-kolom: "Ada" / "Tidak Ada" (format resmi gambar)
          hasilDualColumn: true,
          // Checklist mengalir dinamis agar seluruh poin (9 poin utk infrastruktur) tampil berurutan & lengkap
          dynamicChecklist: true,
        }
      );

      doc.end();
      await new Promise(resolve => writeStream.on('finish', resolve));

      // Get file size
      let fileSize = null;
      try { fileSize = fs.statSync(filePath).size; } catch (e) {}

      // Determine version (increment)
      const [verRows] = await sequelize.query(`
        SELECT COALESCE(berita_acara_version, 0) AS v FROM bankeu_perubahan_proposals WHERE id = ?
      `, { replacements: [proposalId] });
      const nextVersion = (Number(verRows[0]?.v) || 0) + 1;

      // Update proposal
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET berita_acara_path = ?,
            berita_acara_generated_at = NOW(),
            berita_acara_qr_code = ?,
            berita_acara_version = ?,
            updated_at = NOW()
        WHERE id = ?
      `, { replacements: [relPath, qrCode, nextVersion, proposalId] });

      ActivityLogger.log({
        userId: user.id,
        userName: user.name || `User ${user.id}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'create',
        entityType: 'bankeu_perubahan_berita_acara',
        entityId: parseInt(proposalId),
        entityName: proposal.judul_proposal,
        description: `${user.name || 'User'} generate Berita Acara proposal perubahan #${proposalId} (versi ${nextVersion})`,
        newValue: { file: fileName, version: nextVersion, qr_code: qrCode, file_size: fileSize },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req),
      });

      res.json({
        success: true,
        message: 'Berita Acara berhasil dibuat',
        data: {
          file_path: relPath,
          file_name: fileName,
          version: nextVersion,
          qr_code: qrCode,
        },
      });
    } catch (error) {
      logger.error('[BankeuPerubahan BA] generate error:', error);
      res.status(500).json({ success: false, message: 'Gagal generate Berita Acara', error: error.message });
    }
  }

  /**
   * Generate Surat Pengantar Kecamatan per proposal
   * POST /api/kecamatan/bankeu-perubahan/proposals/:proposalId/surat-pengantar
   * body: { nomor_surat, tanggal }
   */
  async generateSuratPengantar(req, res) {
    try {
      const { proposalId } = req.params;
      const { nomor_surat, tanggal } = req.body;
      const user = await ensureUserKecamatan(req.user.id);
      if (!user) return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });

      if (!nomor_surat || !String(nomor_surat).trim()) {
        return res.status(400).json({ success: false, message: 'Nomor surat wajib diisi' });
      }
      if (!isValidDocumentDate(tanggal)) {
        return res.status(400).json({ success: false, message: 'Tanggal Surat Pengantar wajib dipilih dengan format YYYY-MM-DD' });
      }
      const cekSP = await checkTanggalMerah(tanggal);
      if (cekSP.merah) {
        return res.status(400).json({ success: false, message: `Tanggal Surat Pengantar tidak boleh jatuh pada tanggal merah (${cekSP.alasan}). Silakan pilih hari kerja.` });
      }

      const proposal = await loadProposal(proposalId);
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      if (Number(proposal.desa_kecamatan_id) !== Number(user.kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Proposal bukan dari kecamatan Anda' });
      }
      const returnedByDpmd = ['revision', 'rejected'].includes(proposal.dpmd_status);
      if (proposal.submitted_to_dpmd && !returnedByDpmd) {
        return res.status(400).json({ success: false, message: 'Proposal sudah dikirim ke DPMD, Surat Pengantar tidak dapat di-generate ulang dari tahap Kecamatan' });
      }
      if (proposal.kecamatan_status && !['pending', 'in_review', 'approved'].includes(proposal.kecamatan_status)) {
        return res.status(400).json({ success: false, message: 'Surat Pengantar hanya dapat di-generate untuk proposal yang masih dalam review atau sudah siap disetujui Kecamatan' });
      }

      const config = await loadConfig(user.kecamatan_id);
      if (!config || !config.nama_camat || !config.ttd_camat_path || !config.stempel_path || !config.alamat) {
        return res.status(400).json({ success: false, message: 'Konfigurasi kecamatan belum lengkap (nama camat, TTD, stempel, alamat)' });
      }

      const outDir = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/surat-pengantar');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const ts = Date.now();
      const fileName = `SP_perubahan_p${proposalId}_${ts}.pdf`;
      const filePath = path.join(outDir, fileName);
      const relPath = `/storage/uploads/bankeu-perubahan/surat-pengantar/${fileName}`;

      const doc = new PDFDocument({
        size: [595.28, 935.43], // F4 — samakan dengan Surat Pengantar reguler
        margins: { top: 50, bottom: 50, left: 72, right: 72 },
        bufferPages: true,
      });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // ===== Adapter data → renderer Surat Pengantar reguler (layout sama) =====
      const spKecConfig = {
        nama_kecamatan: proposal.kecamatan_nama,
        nama_camat: config.nama_camat,
        nip_camat: config.nip_camat,
        jabatan_penandatangan: config.jabatan_penandatangan,
        logo_path: config.logo_path,
        alamat: config.alamat,
        telepon: config.telepon,
        email: config.email,
        website: config.website,
        kode_pos: config.kode_pos,
        ttd_camat: config.ttd_camat_path ? `bankeu-perubahan/config/${config.ttd_camat_path}` : null,
        stempel_path: config.stempel_path ? `bankeu-perubahan/config/${config.stempel_path}` : null,
      };

      const spProposalData = {
        nomor_surat,
        tahun_anggaran: proposal.tahun_anggaran,
        nama_desa: proposal.desa_nama,
      };

      beritaAcaraService.generateSuratPengantarContent(
        doc, spProposalData, spKecConfig, tanggal,
        { jenisLabel: 'Proposal Permohonan Bantuan Keuangan Perubahan Desa' }
      );

      doc.end();
      await new Promise(resolve => writeStream.on('finish', resolve));

      // Update proposal
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET surat_pengantar_kecamatan_path = ?,
            surat_pengantar_kecamatan_nomor = ?,
            surat_pengantar_kecamatan_generated_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `, { replacements: [relPath, nomor_surat, proposalId] });

      ActivityLogger.log({
        userId: user.id,
        userName: user.name || `User ${user.id}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'create',
        entityType: 'bankeu_perubahan_surat_pengantar',
        entityId: parseInt(proposalId),
        entityName: proposal.judul_proposal,
        description: `${user.name || 'User'} generate Surat Pengantar Kecamatan proposal perubahan #${proposalId} (No: ${nomor_surat})`,
        newValue: { file: fileName, nomor: nomor_surat },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req),
      });

      res.json({
        success: true,
        message: 'Surat Pengantar berhasil dibuat',
        data: {
          pdf_path: relPath,
          file_name: fileName,
          nomor_surat,
        },
      });
    } catch (error) {
      logger.error('[BankeuPerubahan SP] generate error:', error);
      res.status(500).json({ success: false, message: 'Gagal generate Surat Pengantar', error: error.message });
    }
  }
}

module.exports = {
  controller: new BankeuPerubahanBeritaAcaraController(),
  updateProposalQuisionerFlag,
};
