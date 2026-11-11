const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { bacaCatatan, bentukCatatan } = require('../utils/tugasPribadi');

const BATAS = 500; // shortcut: batas jumlah catatan per pengguna tanpa paginasi, naikkan + paginasi bila ada yang butuh lebih
const TIDAK_ADA = { success: false, message: 'Catatan tidak ditemukan' };

const list = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const rows = await prisma.catatan_pribadi.findMany({
      where: { user_id },
      orderBy: [{ disematkan: 'desc' }, { updated_at: 'desc' }, { id: 'desc' }],
      take: BATAS,
    });
    res.json({ success: true, data: rows.map(bentukCatatan) });
  } catch (error) {
    logger.error('Error memuat catatan pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat catatan' });
  }
};

const create = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const { data, galat } = bacaCatatan(req.body);
    if (galat) return res.status(400).json({ success: false, message: galat });
    const jumlah = await prisma.catatan_pribadi.count({ where: { user_id } });
    if (jumlah >= BATAS) {
      return res.status(400).json({ success: false, message: `Catatan penuh (maks. ${BATAS}). Hapus catatan yang sudah tidak diperlukan.` });
    }
    const row = await prisma.catatan_pribadi.create({ data: { ...data, user_id } });
    res.status(201).json({ success: true, data: bentukCatatan(row) });
  } catch (error) {
    logger.error('Error menyimpan catatan pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan catatan' });
  }
};

const update = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const { id } = req.params;
    if (!/^\d+$/.test(id)) return res.status(404).json(TIDAK_ADA);
    const { data, versi, galat } = bacaCatatan(req.body, true);
    if (galat) return res.status(400).json({ success: false, message: galat });
    const { count } = await prisma.catatan_pribadi.updateMany({
      where: { id: BigInt(id), user_id, versi },
      data: { ...data, versi: { increment: 1 } },
    });
    if (count === 0) {
      // bedakan "sudah diubah perangkat lain" dari "tidak ada / milik orang lain"
      const ada = await prisma.catatan_pribadi.findFirst({ where: { id: BigInt(id), user_id }, select: { id: true } });
      if (ada) return res.status(409).json({ success: false, code: 'CATATAN_KEDALUWARSA', message: 'Catatan sudah diubah di perangkat lain.' });
      return res.status(404).json(TIDAK_ADA);
    }
    const row = await prisma.catatan_pribadi.findUnique({ where: { id: BigInt(id) } });
    res.json({ success: true, data: bentukCatatan(row) });
  } catch (error) {
    logger.error('Error mengubah catatan pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal mengubah catatan' });
  }
};

const remove = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const { id } = req.params;
    if (!/^\d+$/.test(id)) return res.status(404).json(TIDAK_ADA);
    const { count } = await prisma.catatan_pribadi.deleteMany({ where: { id: BigInt(id), user_id } });
    if (count === 0) return res.status(404).json(TIDAK_ADA);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error menghapus catatan pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus catatan' });
  }
};

module.exports = { list, create, update, remove };
