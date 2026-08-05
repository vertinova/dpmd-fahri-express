/**
 * Rute Drive per bidang.
 *
 * Semua rute yang terikat bidang memakai `checkBidangAccess`, middleware yang
 * sudah dipakai modul bidang lain — dia sekaligus memberi akses penuh kepada
 * superadmin/kepala_dinas/sekretaris_dinas, persis aturan yang diminta.
 *
 * `/dibagikan` sengaja TIDAK berada di bawah `/:bidangId` karena isinya justru
 * objek milik bidang lain.
 */

const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const { checkBidangAccess } = require('../middlewares/bidangAccess');
const { uploadDrive, cekKuotaAwal } = require('../middlewares/driveUpload');
const driveController = require('../controllers/drive.controller');

// Berkas yang dibagikan dari bidang lain ke pengguna ini.
router.get('/dibagikan', auth, (req, res) => driveController.dibagikanKeSaya(req, res));

// Unduh/pratinjau. Izin diperiksa di controller karena berkasnya bisa saja
// milik bidang lain yang dibagikan — jadi tidak cocok dijaga checkBidangAccess.
router.get('/file/:id/unduh', auth, (req, res) => driveController.unduh(req, res));

// Isi folder yang didapat lewat berbagi. Tidak lewat `/:bidangId` karena
// foldernya justru milik bidang lain.
router.get('/folder/:id/isi', auth, (req, res) => driveController.isiFolder(req, res));

// Ubah nama, hapus, pulihkan, bagikan: sasarannya bisa lintas bidang.
router.patch('/:tipe(folder|file)/:id/nama', auth, (req, res) => driveController.ubahNama(req, res));
router.delete('/:tipe(folder|file)/:id', auth, (req, res) => driveController.keSampah(req, res));
router.post('/:tipe(folder|file)/:id/pulihkan', auth, (req, res) => driveController.pulihkan(req, res));
router.get('/:tipe(folder|file)/:id/berbagi', auth, (req, res) => driveController.daftarBerbagi(req, res));
router.post('/:tipe(folder|file)/:id/bagikan', auth, (req, res) => driveController.bagikan(req, res));
router.delete('/berbagi/:shareId', auth, (req, res) => driveController.cabutBerbagi(req, res));

// Rute yang terikat satu bidang.
router.get('/:bidangId', auth, checkBidangAccess, (req, res) => driveController.list(req, res));
router.get('/:bidangId/sampah', auth, checkBidangAccess, (req, res) => driveController.listSampah(req, res));
router.post('/:bidangId/folder', auth, checkBidangAccess, (req, res) => driveController.buatFolder(req, res));
router.post(
  '/:bidangId/unggah',
  auth,
  checkBidangAccess,
  cekKuotaAwal,
  uploadDrive.array('files', 20),
  (req, res) => driveController.unggah(req, res)
);

module.exports = router;
