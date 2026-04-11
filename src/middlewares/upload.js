const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create upload directories if they don't exist
const uploadDirs = [
  'storage/uploads/bumdes',
  'storage/uploads/bumdes_laporan_keuangan',
  'storage/uploads/bumdes_dokumen_badanhukum',
  'storage/uploads/musdesus',
  'storage/uploads/perjalanan_dinas',
  'storage/uploads/hero-gallery',
  'storage/uploads/surat-masuk',
  'storage/uploads/aparatur_desa_files',
  'storage/produk_hukum'
];

uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Storage configuration for BUMDES
const storageBumdes = multer.diskStorage({
  destination: function (req, file, cb) {
    // Determine folder based on field_name
    const fieldName = req.body.field_name;
    
    let folder = 'storage/uploads/bumdes';
    
    if (fieldName) {
      const laporanKeuanganFields = ['LaporanKeuangan2021', 'LaporanKeuangan2022', 'LaporanKeuangan2023', 'LaporanKeuangan2024'];
      const dokumenBadanHukumFields = ['ProfilBUMDesa', 'BeritaAcara', 'AnggaranDasar', 'AnggaranRumahTangga', 'ProgramKerja', 'Perdes', 'SK_BUM_Desa'];
      
      if (laporanKeuanganFields.includes(fieldName)) {
        folder = 'storage/uploads/bumdes_laporan_keuangan';
      } else if (dokumenBadanHukumFields.includes(fieldName)) {
        folder = 'storage/uploads/bumdes_dokumen_badanhukum';
      }
    }
    
    cb(null, folder);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const filename = `${timestamp}_${nameWithoutExt}${ext}`;
    
    cb(null, filename);
  }
});

// Storage configuration for MUSDESUS
const storageMusdesus = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/musdesus');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const filename = `${timestamp}_${nameWithoutExt}${ext}`;
    
    cb(null, filename);
  }
});

// Storage configuration for PERJALANAN DINAS
const storagePerjadinDinas = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/perjalanan_dinas');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const filename = `${timestamp}_${nameWithoutExt}${ext}`;
    
    cb(null, filename);
  }
});

// File filter for documents
const fileFilter = (req, file, cb) => {
  // Allowed extensions
  const allowedExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Only PDF, DOC, DOCX, XLS, XLSX allowed.'), false);
  }
};

// File filter for images
const imageFilter = (req, file, cb) => {
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Only JPG, JPEG, PNG, GIF, WEBP allowed.'), false);
  }
};

// Storage configuration for HERO GALLERY
const storageHeroGallery = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/hero-gallery');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const filename = `${timestamp}_${nameWithoutExt}${ext}`;
    
    cb(null, filename);
  }
});

// Storage configuration for BERITA
const storageBerita = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'storage/uploads/berita';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const filename = `${timestamp}_${nameWithoutExt}${ext}`;
    
    cb(null, filename);
  }
});

// Multer configurations
const uploadBumdes = multer({
  storage: storageBumdes,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB default
  }
});

const uploadMusdesus = multer({
  storage: storageMusdesus,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024
  }
});

const uploadPerjadinDinas = multer({
  storage: storagePerjadinDinas,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024
  }
});

const uploadHeroGallery = multer({
  storage: storageHeroGallery,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB for images
  }
});

const uploadBerita = multer({
  storage: storageBerita,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB for images
  }
});

// Storage configuration for PRODUK HUKUM (PDF only)
const storageProdukHukum = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/produk_hukum');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    // Sanitize filename: remove special characters
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedName}_${timestamp}${ext}`;
    
    cb(null, filename);
  }
});

// File filter for PDF only
const pdfFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (ext === '.pdf' && file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Hanya file PDF yang diperbolehkan'), false);
  }
};

const uploadProdukHukum = multer({
  storage: storageProdukHukum,
  fileFilter: pdfFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB for PDF
  }
});

// Storage configuration for SURAT MASUK (PDF, JPG, PNG)
const storageSuratMasuk = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/surat-masuk');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const nameWithoutExt = path.basename(file.originalname, ext);
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedName}_${timestamp}${ext}`;
    
    cb(null, filename);
  }
});

// File filter for PDF and Images
const documentImageFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
  const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
  
  if (allowedExts.includes(ext) && allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file PDF, JPG, JPEG, dan PNG yang diperbolehkan'), false);
  }
};

const uploadSuratMasuk = multer({
  storage: storageSuratMasuk,
  fileFilter: documentImageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Storage configuration for APARATUR DESA
const storageAparaturDesa = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/aparatur_desa_files');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedName}_${timestamp}${ext}`;
    
    cb(null, filename);
  }
});

// File filter for Aparatur Desa (PDF, JPG, JPEG, PNG)
const aparaturDesaFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  
  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file PDF, JPG, JPEG, dan PNG yang diperbolehkan'), false);
  }
};

const uploadAparaturDesa = multer({
  storage: storageAparaturDesa,
  fileFilter: aparaturDesaFileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB for files
  }
});

// Storage configuration for Pengurus
const storagePengurus = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/pengurus_files');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedName}_${timestamp}${ext}`;
    
    cb(null, filename);
  }
});

// File filter for Pengurus (JPG, JPEG, PNG for avatar)
const pengurusFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png'];
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  
  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file JPG, JPEG, dan PNG yang diperbolehkan untuk avatar'), false);
  }
};

const uploadPengurus = multer({
  storage: storagePengurus,
  fileFilter: pengurusFileFilter,
  limits: {
    fileSize: 1 * 1024 * 1024 // 1MB for avatar
  }
});

// Storage configuration for Profil Desa (Foto Kantor Desa)
const storageProfilDesa = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/profil_desa');
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `foto_kantor_desa_${timestamp}${ext}`;
    
    cb(null, filename);
  }
});

// File filter for Profil Desa (JPG, JPEG, PNG for foto kantor desa)
const profilDesaFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png'];
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  
  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file JPG, JPEG, dan PNG yang diperbolehkan untuk foto kantor desa'), false);
  }
};

const uploadProfilDesa = multer({
  storage: storageProfilDesa,
  fileFilter: profilDesaFileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB for foto kantor desa
  }
});

// Storage configuration for BANKEU LPJ (PDF only)
const storageBankeuLpj = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'storage/uploads/bankeu_lpj';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50);
    const filename = `lpj_${timestamp}_${nameWithoutExt}${ext}`;
    cb(null, filename);
  }
});

const uploadBankeuLpj = multer({
  storage: storageBankeuLpj,
  fileFilter: pdfFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB for LPJ
  }
});

// Storage configuration for BANKEU PROPOSAL
const storageBankeuProposal = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'storage/uploads/bankeu';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50);
    const filename = `${timestamp}_${nameWithoutExt}${ext}`;
    cb(null, filename);
  }
});

// File filter for Bankeu Proposal (PDF, DOC, DOCX)
const bankeuFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.pdf'];
  const allowedMimeTypes = ['application/pdf'];
  
  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file PDF yang diperbolehkan untuk proposal'), false);
  }
};

const uploadBankeuProposal = multer({
  storage: storageBankeuProposal,
  fileFilter: bankeuFileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB for proposals
  }
});

// Storage: Contoh Proposal (format surat)
const storageContohProposal = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/contoh-proposal');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Temporary name — will be renamed in controller
    const tempName = `temp_${Date.now()}_${file.originalname}`;
    cb(null, tempName);
  }
});

// Storage configuration for INFORMASI (banner images)
const storageInformasi = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'storage/uploads/informasi';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${timestamp}_${sanitizedName}${ext}`;
    
    cb(null, filename);
  }
});

const uploadInformasi = multer({
  storage: storageInformasi,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB for images
  }
});

const contohProposalFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format file tidak didukung. Gunakan: .docx, .doc, .pdf, .png, .jpg, .xlsx'));
  }
};

const uploadContohProposal = multer({
  storage: storageContohProposal,
  fileFilter: contohProposalFileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB
  }
});

module.exports = {
  uploadBumdes,
  uploadMusdesus,
  uploadPerjadinDinas,
  uploadHeroGallery,
  uploadBerita,
  uploadProdukHukum,
  uploadSuratMasuk,
  uploadAparaturDesa,
  uploadPengurus,
  uploadProfilDesa,
  uploadInformasi,
  bankeuProposal: uploadBankeuProposal.single('file'),
  bankeuLpj: uploadBankeuLpj.array('files', 10),
  contohProposalUpload: uploadContohProposal.single('file')
};
