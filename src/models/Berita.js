// src/models/Berita.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Berita = sequelize.define('Berita', {
  id_berita: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'id_berita'
  },
  judul: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Judul tidak boleh kosong' },
      len: { args: [5, 255], msg: 'Judul harus antara 5-255 karakter' }
    }
  },
  slug: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: { msg: 'Slug tidak boleh kosong' }
    }
  },
  konten: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Konten tidak boleh kosong' }
    }
  },
  ringkasan: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  gambar: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  dokumen_pdf: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  kategori: {
    type: DataTypes.ENUM('umum', 'bumdes', 'perjadin', 'musdesus', 'pengumuman'),
    defaultValue: 'umum'
  },
  status: {
    type: DataTypes.ENUM('draft', 'published', 'archived'),
    defaultValue: 'draft'
  },
  tanggal_publish: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'tanggal_publish'
  },
  penulis: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  views: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'berita',
  timestamps: false
});

module.exports = Berita;
