const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const MODULE_NAME = 'bankeu_perubahan';

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

      const proposal = await loadProposal(proposalId);
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      if (Number(proposal.desa_id) !== Number(desaId)) {
        return res.status(400).json({ success: false, message: 'desaId tidak cocok dengan proposal' });
      }
      if (Number(proposal.desa_kecamatan_id) !== Number(user.kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Proposal bukan dari kecamatan Anda' });
      }
      if (proposal.kecamatan_status !== 'approved') {
        return res.status(400).json({ success: false, message: 'Hanya proposal yang sudah disetujui yang dapat di-generate Berita Acara' });
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

      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Logo Kabupaten Bogor standar (di tengah atas)
      try {
        const logoAbs = path.join(__dirname, '../../public/logo-bogor.png');
        if (fs.existsSync(logoAbs)) {
          doc.image(logoAbs, (doc.page.width - 55) / 2, 40, { width: 55, height: 55 });
          doc.y = 105;
        }
      } catch (e) {}

      // Header
      doc.fontSize(13).font('Helvetica-Bold').text('BERITA ACARA VERIFIKASI', { align: 'center' });
      doc.fontSize(11).text('PROPOSAL BANTUAN KEUANGAN PERUBAHAN DESA', { align: 'center' });
      doc.text(`TAHUN ANGGARAN ${proposal.tahun_anggaran}`, { align: 'center' });
      doc.fontSize(9).font('Helvetica').text(`Nomor Verifikasi: ${qrCode}`, { align: 'center' });
      doc.moveDown();

      const tanggalBA = tanggal
        ? new Date(tanggal).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      doc.fontSize(11).font('Helvetica').text(
        `Pada hari ini, ${tanggalBA}, bertempat di Kantor Kecamatan ${proposal.kecamatan_nama}, ` +
        `Tim Verifikasi Kecamatan telah melakukan verifikasi proposal Bantuan Keuangan Perubahan dengan rincian sebagai berikut:`,
        { align: 'justify' }
      );
      doc.moveDown();

      doc.font('Helvetica-Bold').text('Identitas Proposal:');
      doc.font('Helvetica').text(`Desa             : ${proposal.desa_nama}`);
      doc.text(`Kecamatan        : ${proposal.kecamatan_nama}`);
      doc.text(`Tahun Anggaran   : ${proposal.tahun_anggaran}`);
      doc.text(`Judul            : ${proposal.judul_proposal}`);
      doc.text(`Jenis Kegiatan   : ${proposal.jenis_kegiatan}`);
      if (proposal.nama_kegiatan_spesifik) doc.text(`Kegiatan Spesifik: ${proposal.nama_kegiatan_spesifik}`);
      if (proposal.volume) doc.text(`Volume           : ${proposal.volume}`);
      if (proposal.lokasi) doc.text(`Lokasi           : ${proposal.lokasi}`);
      if (proposal.anggaran_usulan) {
        doc.text(`Anggaran Usulan  : Rp ${Number(proposal.anggaran_usulan).toLocaleString('id-ID')}`);
      }
      doc.moveDown();

      // Checklist
      const isInfra = proposal.jenis_kegiatan === 'pilihan_infrastruktur';
      const checklistItems = isInfra ? [
        { key: 'q1', label: 'Surat Pengantar dari Kepala Desa' },
        { key: 'q2', label: 'Surat Permohonan Bantuan Keuangan Perubahan' },
        { key: 'q3', label: 'Proposal (Latar Belakang, Maksud dan Tujuan, Bentuk Kegiatan, Jadwal Pelaksanaan)' },
        { key: 'q4', label: 'RPA dan RAB' },
        { key: 'q5', label: 'Surat Pernyataan Kepala Desa (lokasi tidak dalam sengketa)' },
        { key: 'q6', label: 'Bukti kepemilikan Aset Desa (untuk Rehab Kantor Desa)' },
        { key: 'q7', label: 'Dokumen kesediaan peralihan hak hibah atas tanah' },
        { key: 'q8', label: 'Dokumen pernyataan kesanggupan (tidak minta ganti rugi)' },
        { key: 'q9', label: 'Persetujuan pemanfaatan barang milik Daerah/Negara' },
        { key: 'q10', label: 'Foto lokasi rencana pelaksanaan kegiatan' },
        { key: 'q11', label: 'Peta lokasi rencana kegiatan' },
        { key: 'q12', label: 'Berita Acara Musyawarah Desa' },
      ] : [
        { key: 'q1', label: 'Surat Pengantar dari Kepala Desa' },
        { key: 'q2', label: 'Surat Permohonan Bantuan Keuangan Perubahan' },
        { key: 'q3', label: 'Proposal (Latar Belakang, Maksud dan Tujuan, Bentuk Kegiatan, Jadwal Pelaksanaan)' },
        { key: 'q4', label: 'Rencana Anggaran Biaya' },
        { key: 'q5', label: 'Tidak Duplikasi Anggaran' },
      ];

      // Aggregate: item dianggap "Tersedia" jika MINIMAL SATU tim member centang true
      const aggItem = (key) => questionnaires.some(q => q[key] === true || q[key] === 1);

      // Override dengan optionalItems dari request (untuk item opsional)
      doc.font('Helvetica-Bold').text('Hasil Verifikasi Kelengkapan Dokumen:');
      checklistItems.forEach((item, idx) => {
        let checked = aggItem(item.key);
        // Untuk item opsional (q5, q7, q8, q9 di infra), boleh override dengan optionalItems
        if (isInfra && optionalItems && ['q5','q7','q8','q9'].includes(item.key)) {
          const optKey = `item_${item.key.replace('q','')}`;
          if (typeof optionalItems[optKey] === 'boolean') checked = optionalItems[optKey] || checked;
        }
        doc.font('Helvetica').text(`${idx + 1}. [${checked ? '✓' : ' '}] ${item.label}`);
      });
      doc.moveDown();

      doc.text(
        'Berdasarkan hasil verifikasi tersebut, Tim Verifikasi Kecamatan menyatakan bahwa proposal ' +
        'memenuhi syarat administrasi untuk diteruskan ke DPMD Kabupaten.',
        { align: 'justify' }
      );
      doc.moveDown(2);

      // TTD section
      doc.font('Helvetica-Bold').text('Tim Verifikasi Kecamatan:', 50);
      doc.moveDown(0.5);
      if (tim.length === 0) {
        doc.font('Helvetica').text('(Tidak ada anggota tim terdaftar)');
      } else {
        tim.forEach((t, idx) => {
          const yStart = doc.y;
          doc.font('Helvetica').fontSize(10).text(`${idx + 1}. ${getPosisiLabel(t.jabatan)}`, 50, yStart);
          doc.text(`   ${t.nama}`, 50);
          if (t.nip) doc.text(`   NIP. ${t.nip}`, 50);
          // TTD image
          if (t.ttd_path) {
            try {
              const ttdAbsPath = path.join(__dirname, '../../storage/uploads/signatures', t.ttd_path);
              if (fs.existsSync(ttdAbsPath)) {
                doc.image(ttdAbsPath, 50, doc.y + 2, { width: 60, height: 30 });
              }
            } catch (e) { /* ignore image errors */ }
          }
          doc.moveDown(2.5);
        });
      }

      // Camat signature on the right
      doc.fontSize(11).font('Helvetica-Bold');
      const rightCol = 350;
      const camatStartY = Math.max(doc.y, 600);
      doc.text(`Mengetahui,`, rightCol, camatStartY - 80);
      doc.text(`${config.jabatan_penandatangan || 'Camat'} ${proposal.kecamatan_nama}`, rightCol, camatStartY - 65);
      if (config.ttd_camat_path) {
        try {
          const ttdAbsPath = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/config', config.ttd_camat_path);
          if (fs.existsSync(ttdAbsPath)) {
            doc.image(ttdAbsPath, rightCol, camatStartY - 50, { width: 80, height: 40 });
          }
        } catch (e) { /* ignore */ }
      }
      doc.font('Helvetica-Bold').text(config.nama_camat, rightCol, camatStartY);
      if (config.nip_camat) {
        doc.font('Helvetica').fontSize(9).text(`NIP. ${config.nip_camat}`, rightCol);
      }

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

      const proposal = await loadProposal(proposalId);
      if (!proposal) return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      if (Number(proposal.desa_kecamatan_id) !== Number(user.kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Proposal bukan dari kecamatan Anda' });
      }
      if (proposal.kecamatan_status !== 'approved') {
        return res.status(400).json({ success: false, message: 'Hanya proposal yang sudah disetujui yang dapat di-generate Surat Pengantar' });
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

      const tanggalSurat = tanggal
        ? new Date(tanggal).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
        : new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });

      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Kop Surat - logo Kabupaten Bogor standar (bukan logo upload kecamatan)
      try {
        const logoAbs = path.join(__dirname, '../../public/logo-bogor.png');
        if (fs.existsSync(logoAbs)) doc.image(logoAbs, 50, 45, { width: 55, height: 55 });
      } catch (e) {}

      doc.fontSize(11).font('Helvetica-Bold').text('PEMERINTAH KABUPATEN BOGOR', 120, 50, { align: 'left' });
      doc.fontSize(13).text(`KECAMATAN ${(proposal.kecamatan_nama || '').toUpperCase()}`, 120);
      doc.fontSize(9).font('Helvetica').text(config.alamat || '', 120);
      if (config.telepon) doc.text(`Telp. ${config.telepon}`, 120);
      if (config.email) doc.text(`Email: ${config.email}`, 120);
      doc.moveTo(50, 130).lineTo(545, 130).stroke();
      doc.moveTo(50, 133).lineTo(545, 133).stroke();
      doc.moveDown(2);

      doc.fontSize(11);
      doc.font('Helvetica').text(`Nomor    : ${nomor_surat}`, 50, 150);
      doc.text(`Lampiran : 1 (satu) berkas proposal`, 50);
      doc.text(`Perihal  : Pengantar Proposal Bantuan Keuangan Perubahan`, 50);
      doc.moveDown();
      doc.text(`${proposal.kecamatan_nama}, ${tanggalSurat}`, { align: 'right' });
      doc.moveDown();

      doc.text(`Kepada Yth.`, 50);
      doc.text(`Bupati Bogor`, 50);
      doc.text(`Cq. Kepala DPMD Kabupaten Bogor`, 50);
      doc.text(`di -`, 50);
      doc.text(`     Cibinong`, 50);
      doc.moveDown();

      doc.text(
        `Bersama ini kami sampaikan Proposal Bantuan Keuangan Perubahan Tahun Anggaran ${proposal.tahun_anggaran} ` +
        `dari Pemerintah Desa ${proposal.desa_nama}, Kecamatan ${proposal.kecamatan_nama}, dengan rincian sebagai berikut:`,
        { align: 'justify' }
      );
      doc.moveDown();

      doc.font('Helvetica-Bold').text('Identitas Proposal:');
      doc.font('Helvetica').text(`  • Judul Proposal    : ${proposal.judul_proposal}`);
      doc.text(`  • Jenis Kegiatan    : ${proposal.jenis_kegiatan}`);
      if (proposal.nama_kegiatan_spesifik) doc.text(`  • Kegiatan Spesifik : ${proposal.nama_kegiatan_spesifik}`);
      if (proposal.volume) doc.text(`  • Volume            : ${proposal.volume}`);
      if (proposal.lokasi) doc.text(`  • Lokasi            : ${proposal.lokasi}`);
      if (proposal.anggaran_usulan) {
        doc.text(`  • Anggaran Usulan   : Rp ${Number(proposal.anggaran_usulan).toLocaleString('id-ID')}`);
      }
      doc.moveDown();

      doc.text(
        'Proposal tersebut telah melalui proses verifikasi Tim Verifikasi Kecamatan dan dinyatakan memenuhi ' +
        'syarat administrasi. Atas perhatian dan kerjasamanya, kami sampaikan terima kasih.',
        { align: 'justify' }
      );
      doc.moveDown(3);

      // TTD camat
      const ttdX = 350;
      const ttdY = doc.y;
      doc.font('Helvetica-Bold').text(config.jabatan_penandatangan || 'Camat', ttdX, ttdY);
      doc.text(`${proposal.kecamatan_nama},`, ttdX);
      if (config.ttd_camat_path) {
        try {
          const ttdAbs = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/config', config.ttd_camat_path);
          if (fs.existsSync(ttdAbs)) doc.image(ttdAbs, ttdX, doc.y + 5, { width: 80, height: 40 });
        } catch (e) {}
      }
      // Stempel (overlap with TTD)
      if (config.stempel_path) {
        try {
          const stempelAbs = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/config', config.stempel_path);
          if (fs.existsSync(stempelAbs)) doc.image(stempelAbs, ttdX - 30, doc.y + 5, { width: 70, height: 70, opacity: 0.6 });
        } catch (e) {}
      }
      doc.moveDown(3.5);
      doc.font('Helvetica-Bold').text(config.nama_camat, ttdX);
      if (config.nip_camat) {
        doc.font('Helvetica').fontSize(9).text(`NIP. ${config.nip_camat}`, ttdX);
      }

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
