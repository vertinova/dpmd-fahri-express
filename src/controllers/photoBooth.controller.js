const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storageDir = path.join(__dirname, '../../storage/uploads/photo-booth');
const galleryFile = path.join(storageDir, 'gallery.json');

function ensureStorage() {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  if (!fs.existsSync(galleryFile)) {
    fs.writeFileSync(galleryFile, '[]');
  }
}

function readGallery() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeGallery(items) {
  ensureStorage();
  fs.writeFileSync(galleryFile, JSON.stringify(items, null, 2));
}

exports.getGallery = (req, res) => {
  const gallery = readGallery();
  res.json({ success: true, data: gallery });
};

exports.savePhoto = (req, res) => {
  try {
    const { image, layout = 'single', filter = 'normal', title = 'Photo Booth DPMD' } = req.body || {};
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'Data foto tidak valid.' });
    }

    ensureStorage();
    const id = crypto.randomUUID();
    const extension = image.includes('image/png') ? 'png' : 'jpg';
    const filename = `${id}.${extension}`;
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const filePath = path.join(storageDir, filename);

    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

    const item = {
      id,
      title,
      layout,
      filter,
      filename,
      url: `/storage/uploads/photo-booth/${filename}`,
      created_at: new Date().toISOString(),
    };

    const gallery = [item, ...readGallery()].slice(0, 200);
    writeGallery(gallery);

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('[PhotoBooth] save failed:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan foto.' });
  }
};

exports.deletePhoto = (req, res) => {
  try {
    const gallery = readGallery();
    const item = gallery.find((entry) => entry.id === req.params.id);
    const nextGallery = gallery.filter((entry) => entry.id !== req.params.id);

    if (item?.filename) {
      const filePath = path.join(storageDir, path.basename(item.filename));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    writeGallery(nextGallery);
    res.json({ success: true });
  } catch (error) {
    console.error('[PhotoBooth] delete failed:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus foto.' });
  }
};
