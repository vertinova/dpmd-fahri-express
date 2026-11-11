const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { bacaMasukan, bentukTugas } = require('../utils/tugasPribadi');

const BATAS = 500; // shortcut: batas jumlah tugas per pengguna tanpa paginasi, naikkan + paginasi bila ada yang butuh lebih
const TIDAK_ADA = { success: false, message: 'Tugas tidak ditemukan' };

const list = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const rows = await prisma.tugas_pribadi.findMany({ where: { user_id }, orderBy: { created_at: 'desc' }, take: BATAS });
    res.json({ success: true, data: rows.map(bentukTugas) });
  } catch (error) {
    logger.error('Error memuat tugas pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat tugas' });
  }
};

const create = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const { data, galat } = bacaMasukan(req.body);
    if (galat) return res.status(400).json({ success: false, message: galat });
    const jumlah = await prisma.tugas_pribadi.count({ where: { user_id } });
    if (jumlah >= BATAS) {
      return res.status(400).json({ success: false, message: `Daftar tugas penuh (maks. ${BATAS}). Hapus tugas yang sudah tidak diperlukan.` });
    }
    const row = await prisma.tugas_pribadi.create({ data: { ...data, user_id } });
    res.status(201).json({ success: true, data: bentukTugas(row) });
  } catch (error) {
    logger.error('Error menyimpan tugas pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan tugas' });
  }
};

const update = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const { id } = req.params;
    if (!/^\d+$/.test(id)) return res.status(404).json(TIDAK_ADA);
    const { data, galat } = bacaMasukan(req.body, true);
    if (galat) return res.status(400).json({ success: false, message: galat });
    const { count } = await prisma.tugas_pribadi.updateMany({ where: { id: BigInt(id), user_id }, data });
    if (count === 0) return res.status(404).json(TIDAK_ADA);
    const row = await prisma.tugas_pribadi.findUnique({ where: { id: BigInt(id) } });
    res.json({ success: true, data: bentukTugas(row) });
  } catch (error) {
    logger.error('Error mengubah tugas pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal mengubah tugas' });
  }
};

const remove = async (req, res) => {
  try {
    const user_id = BigInt(req.user.id);
    const { id } = req.params;
    if (!/^\d+$/.test(id)) return res.status(404).json(TIDAK_ADA);
    const { count } = await prisma.tugas_pribadi.deleteMany({ where: { id: BigInt(id), user_id } });
    if (count === 0) return res.status(404).json(TIDAK_ADA);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error menghapus tugas pribadi:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus tugas' });
  }
};

module.exports = { list, create, update, remove };
