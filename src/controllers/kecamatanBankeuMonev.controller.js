const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { bacaTahun, bacaMonev, bentukMonev } = require('../utils/bankeuStsMonev');

const FOLDER = path.join(__dirname, '../../storage/uploads/bankeu_monev');
const sertaUser = { users: { select: { name: true } } };
const buang = (p) => { try { if (p) fs.unlinkSync(p); } catch (e) {} };

// Kecamatan milik akun yang login; null bila akun tidak terhubung ke kecamatan.
const kecamatanId = (req) => (req.user.kecamatan_id ? BigInt(req.user.kecamatan_id) : null);
const tolakTanpaKecamatan = (res) =>
  res.status(403).json({ success: false, message: 'Akun ini tidak terhubung ke kecamatan mana pun' });

/** GET /api/kecamatan/bankeu-monev?tahun=2026 */
async function list(req, res) {
  try {
    const kec = kecamatanId(req);
    if (!kec) return tolakTanpaKecamatan(res);
    const tahun = bacaTahun(req.query.tahun) || 2026;

    const [desas, kecamatan] = await Promise.all([
      prisma.desas.findMany({
        where: { kecamatan_id: kec, status_pemerintahan: 'desa' },
        select: { id: true, nama: true },
        orderBy: { nama: 'asc' }
      }),
      prisma.kecamatans.findUnique({ where: { id: kec }, select: { nama: true } })
    ]);
    const rows = await prisma.bankeu_monev.findMany({
      where: { tahun_anggaran: tahun, desa_id: { in: desas.map(d => d.id) } },
      orderBy: { created_at: 'desc' },
      include: sertaUser
    });

    res.json({
      success: true,
      data: {
        tahun_anggaran: tahun,
        kecamatan_nama: kecamatan ? kecamatan.nama : null,
        desa: desas.map(d => ({
          desa_id: d.id,
          desa_nama: d.nama,
          monev: rows.filter(r => r.desa_id === d.id).map(bentukMonev)
        }))
      }
    });
  } catch (error) {
    logger.error('Error fetching monev Bankeu:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data monev' });
  }
}

/** POST /api/kecamatan/bankeu-monev (multipart: file, desa_id, tahun_anggaran, keterangan) */
async function upload(req, res) {
  const file = req.file;
  let tujuan = null;
  try {
    if (!file) {
      return res.status(400).json({ success: false, message: 'File hasil monev wajib diunggah (PDF/JPG/PNG, maks. 25 MB)' });
    }
    const kec = kecamatanId(req);
    if (!kec) {
      buang(file.path);
      return tolakTanpaKecamatan(res);
    }
    const hasil = bacaMonev(req.body);
    if (hasil.galat) {
      buang(file.path);
      return res.status(400).json({ success: false, message: hasil.galat });
    }
    const { data } = hasil;

    const desa = await prisma.desas.findFirst({
      where: { id: data.desa_id, kecamatan_id: kec, status_pemerintahan: 'desa' },
      select: { id: true }
    });
    if (!desa) {
      buang(file.path);
      return res.status(404).json({ success: false, message: 'Desa tidak ditemukan di kecamatan Anda' });
    }

    const dir = path.join(FOLDER, String(kec), String(desa.id));
    fs.mkdirSync(dir, { recursive: true });
    tujuan = path.join(dir, file.filename);
    fs.renameSync(file.path, tujuan);

    const row = await prisma.bankeu_monev.create({
      data: {
        ...data,
        nama_file: file.originalname,
        file_path: `${kec}/${desa.id}/${file.filename}`,
        file_size: file.size,
        uploaded_by: BigInt(req.user.id)
      },
      include: sertaUser
    });

    logger.info(`Monev Bankeu diunggah: kecamatan_id=${kec}, desa_id=${desa.id}, tahun=${data.tahun_anggaran}, user_id=${req.user.id}`);
    res.status(201).json({ success: true, data: bentukMonev(row) });
  } catch (error) {
    buang(file && file.path);
    buang(tujuan);
    logger.error('Error uploading monev Bankeu:', error);
    res.status(500).json({ success: false, message: 'Gagal mengunggah hasil monev. Silakan coba lagi.' });
  }
}

/** DELETE /api/kecamatan/bankeu-monev/:id */
async function remove(req, res) {
  try {
    const kec = kecamatanId(req);
    if (!kec) return tolakTanpaKecamatan(res);
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) {
      return res.status(404).json({ success: false, message: 'Hasil monev tidak ditemukan' });
    }
    const row = await prisma.bankeu_monev.findFirst({ where: { id: BigInt(id), desas: { kecamatan_id: kec } } });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Hasil monev tidak ditemukan' });
    }
    await prisma.bankeu_monev.delete({ where: { id: row.id } });
    buang(path.join(FOLDER, row.file_path));

    logger.info(`Monev Bankeu dihapus: id=${id}, kecamatan_id=${kec}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting monev Bankeu:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus hasil monev' });
  }
}

module.exports = { list, upload, remove };
