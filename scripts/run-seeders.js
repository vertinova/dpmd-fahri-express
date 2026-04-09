/**
 * Main Prisma-based Seeder for DPMD Express Backend
 * Seeds: bidangs, kecamatans, desas, users, pegawai, roles, master_dinas, berita
 * 
 * Usage: node scripts/run-seeders.js
 * Password default: password
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();
const DEFAULT_PASSWORD = 'password';

// ============================================
// DATA: Bidangs
// ============================================
const bidangsData = [
  { id: 1, nama: 'Kepala Dinas' },
  { id: 2, nama: 'Sekretariat' },
  { id: 3, nama: 'Sarana Prasarana Kewilayahan dan Ekonomi Desa' },
  { id: 4, nama: 'Kekayaan dan Keuangan Desa' },
  { id: 5, nama: 'Pemberdayaan Masyarakat Desa' },
  { id: 6, nama: 'Pemerintahan Desa' },
  { id: 7, nama: 'Tenaga Alih Daya' },
  { id: 8, nama: 'Tenaga Keamanan' },
  { id: 9, nama: 'Tenaga Kebersihan' },
];

// ============================================
// DATA: Kecamatans (40 Kecamatan Kab. Bogor)
// ============================================
const kecamatansData = [
  { id: 1, kode: '32.01.01', nama: 'Cibinong' },
  { id: 2, kode: '32.01.02', nama: 'Gunung Putri' },
  { id: 3, kode: '32.01.03', nama: 'Citeureup' },
  { id: 4, kode: '32.01.04', nama: 'Sukaraja' },
  { id: 5, kode: '32.01.05', nama: 'Babakan Madang' },
  { id: 6, kode: '32.01.06', nama: 'Jonggol' },
  { id: 7, kode: '32.01.07', nama: 'Cileungsi' },
  { id: 8, kode: '32.01.08', nama: 'Cariu' },
  { id: 9, kode: '32.01.09', nama: 'Sukamakmur' },
  { id: 10, kode: '32.01.10', nama: 'Parung' },
  { id: 11, kode: '32.01.11', nama: 'Gunung Sindur' },
  { id: 12, kode: '32.01.12', nama: 'Kemang' },
  { id: 13, kode: '32.01.13', nama: 'Bojong Gede' },
  { id: 14, kode: '32.01.14', nama: 'Leuwiliang' },
  { id: 15, kode: '32.01.15', nama: 'Ciampea' },
  { id: 16, kode: '32.01.16', nama: 'Cibungbulang' },
  { id: 17, kode: '32.01.17', nama: 'Pamijahan' },
  { id: 18, kode: '32.01.18', nama: 'Rumpin' },
  { id: 19, kode: '32.01.19', nama: 'Jasinga' },
  { id: 20, kode: '32.01.20', nama: 'Parung Panjang' },
  { id: 21, kode: '32.01.21', nama: 'Nanggung' },
  { id: 22, kode: '32.01.22', nama: 'Cigudeg' },
  { id: 23, kode: '32.01.23', nama: 'Tenjo' },
  { id: 24, kode: '32.01.24', nama: 'Ciawi' },
  { id: 25, kode: '32.01.25', nama: 'Cisarua' },
  { id: 26, kode: '32.01.26', nama: 'Megamendung' },
  { id: 27, kode: '32.01.27', nama: 'Caringin' },
  { id: 28, kode: '32.01.28', nama: 'Cijeruk' },
  { id: 29, kode: '32.01.29', nama: 'Ciomas' },
  { id: 30, kode: '32.01.30', nama: 'Dramaga' },
  { id: 31, kode: '32.01.31', nama: 'Tamansari' },
  { id: 32, kode: '32.01.32', nama: 'Klapanunggal' },
  { id: 33, kode: '32.01.33', nama: 'Ciseeng' },
  { id: 34, kode: '32.01.34', nama: 'Rancabungur' },
  { id: 35, kode: '32.01.35', nama: 'Tajurhalang' },
  { id: 36, kode: '32.01.36', nama: 'Sukajaya' },
  { id: 37, kode: '32.01.37', nama: 'Tanjungsari' },
  { id: 38, kode: '32.01.38', nama: 'Leuwisadeng' },
  { id: 39, kode: '32.01.39', nama: 'Tenjolaya' },
  { id: 40, kode: '32.01.40', nama: 'Cigombong' },
];

// ============================================
// DATA: Desas (434 desa/kelurahan Kab. Bogor)
// ============================================
const kelurahanList = [
  'PONDOK RAJEG', 'KARADENAN', 'HARAPAN JAYA', 'NANGGEWER', 'NANGGEWER MEKAR',
  'CIBINONG', 'PAKANSARI', 'TENGAH', 'SUKAHATI', 'CIRIUNG', 'CIRIMEKAR',
  'PABUARAN', 'PABUARAN MEKAR', 'PUSPANEGARA', 'KARANG ASEM BARAT',
  'ATANG SENJAYA', 'CISARUA', 'PADASUKA'
];

const desasData = [
  // Kecamatan Cibinong
  { kode: '32.01.01.1001', nama: 'Pondok Rajeg', kec_id: 1 },
  { kode: '32.01.01.1002', nama: 'Karadenan', kec_id: 1 },
  { kode: '32.01.01.1003', nama: 'Harapan Jaya', kec_id: 1 },
  { kode: '32.01.01.1004', nama: 'Nanggewer', kec_id: 1 },
  { kode: '32.01.01.1005', nama: 'Nanggewer Mekar', kec_id: 1 },
  { kode: '32.01.01.1006', nama: 'Cibinong', kec_id: 1 },
  { kode: '32.01.01.1007', nama: 'Pakansari', kec_id: 1 },
  { kode: '32.01.01.1008', nama: 'Tengah', kec_id: 1 },
  { kode: '32.01.01.1009', nama: 'Sukahati', kec_id: 1 },
  { kode: '32.01.01.1010', nama: 'Ciriung', kec_id: 1 },
  { kode: '32.01.01.1011', nama: 'Cirimekar', kec_id: 1 },
  { kode: '32.01.01.1012', nama: 'Pabuaran', kec_id: 1 },
  { kode: '32.01.01.1013', nama: 'Pabuaran Mekar', kec_id: 1 },
  // Kecamatan Gunung Putri
  { kode: '32.01.02.2001', nama: 'Wanaherang', kec_id: 2 },
  { kode: '32.01.02.2002', nama: 'Bojong Kulur', kec_id: 2 },
  { kode: '32.01.02.2003', nama: 'Ciangsana', kec_id: 2 },
  { kode: '32.01.02.2004', nama: 'Gunung Putri', kec_id: 2 },
  { kode: '32.01.02.2005', nama: 'Bojong Nangka', kec_id: 2 },
  { kode: '32.01.02.2006', nama: 'Tlajung Udik', kec_id: 2 },
  { kode: '32.01.02.2007', nama: 'Cicadas', kec_id: 2 },
  { kode: '32.01.02.2008', nama: 'Cikeas Udik', kec_id: 2 },
  { kode: '32.01.02.2009', nama: 'Nagrak', kec_id: 2 },
  { kode: '32.01.02.2010', nama: 'Karanggan', kec_id: 2 },
  // Kecamatan Citeureup
  { kode: '32.01.03.1006', nama: 'Puspanegara', kec_id: 3 },
  { kode: '32.01.03.1007', nama: 'Karang Asem Barat', kec_id: 3 },
  { kode: '32.01.03.2001', nama: 'Puspasari', kec_id: 3 },
  { kode: '32.01.03.2002', nama: 'Citeureup', kec_id: 3 },
  { kode: '32.01.03.2003', nama: 'Leuwinutug', kec_id: 3 },
  { kode: '32.01.03.2004', nama: 'Tajur', kec_id: 3 },
  { kode: '32.01.03.2005', nama: 'Sanja', kec_id: 3 },
  { kode: '32.01.03.2008', nama: 'Karang Asem Timur', kec_id: 3 },
  { kode: '32.01.03.2009', nama: 'Tarikolot', kec_id: 3 },
  { kode: '32.01.03.2010', nama: 'Gunungsari', kec_id: 3 },
  { kode: '32.01.03.2011', nama: 'Tangkil', kec_id: 3 },
  { kode: '32.01.03.2012', nama: 'Sukahati', kec_id: 3 },
  { kode: '32.01.03.2013', nama: 'Hambalang', kec_id: 3 },
  { kode: '32.01.03.2014', nama: 'Pasirmukti', kec_id: 3 },
  // Kecamatan Sukaraja
  { kode: '32.01.04.2001', nama: 'Gununggeulis', kec_id: 4 },
  { kode: '32.01.04.2002', nama: 'Cilebut Timur', kec_id: 4 },
  { kode: '32.01.04.2003', nama: 'Cilebut Barat', kec_id: 4 },
  { kode: '32.01.04.2004', nama: 'Cibanon', kec_id: 4 },
  { kode: '32.01.04.2005', nama: 'Nagrak', kec_id: 4 },
  { kode: '32.01.04.2006', nama: 'Sukatani', kec_id: 4 },
  { kode: '32.01.04.2007', nama: 'Sukaraja', kec_id: 4 },
  { kode: '32.01.04.2008', nama: 'Cikeas', kec_id: 4 },
  { kode: '32.01.04.2009', nama: 'Pasir Jambu', kec_id: 4 },
  { kode: '32.01.04.2010', nama: 'Cimandala', kec_id: 4 },
  { kode: '32.01.04.2011', nama: 'Cijujung', kec_id: 4 },
  { kode: '32.01.04.2012', nama: 'Cadasngampar', kec_id: 4 },
  { kode: '32.01.04.2013', nama: 'Pasirlaja', kec_id: 4 },
  // Kecamatan Babakan Madang
  { kode: '32.01.05.2001', nama: 'Cijayanti', kec_id: 5 },
  { kode: '32.01.05.2002', nama: 'Sumurbatu', kec_id: 5 },
  { kode: '32.01.05.2003', nama: 'Sentul', kec_id: 5 },
  { kode: '32.01.05.2004', nama: 'Karangtengah', kec_id: 5 },
  { kode: '32.01.05.2005', nama: 'Cipambuan', kec_id: 5 },
  { kode: '32.01.05.2006', nama: 'Kadumanggu', kec_id: 5 },
  { kode: '32.01.05.2007', nama: 'Citaringgul', kec_id: 5 },
  { kode: '32.01.05.2008', nama: 'Babakan Madang', kec_id: 5 },
  { kode: '32.01.05.2009', nama: 'Bojong Koneng', kec_id: 5 },
  // Kecamatan Jonggol
  { kode: '32.01.06.2001', nama: 'Sukamaju', kec_id: 6 },
  { kode: '32.01.06.2002', nama: 'Sirnagalih', kec_id: 6 },
  { kode: '32.01.06.2003', nama: 'Singajaya', kec_id: 6 },
  { kode: '32.01.06.2004', nama: 'Sukasirna', kec_id: 6 },
  { kode: '32.01.06.2005', nama: 'Sukanegara', kec_id: 6 },
  { kode: '32.01.06.2006', nama: 'Sukamanah', kec_id: 6 },
  { kode: '32.01.06.2007', nama: 'Weninggalih', kec_id: 6 },
  { kode: '32.01.06.2008', nama: 'Cibodas', kec_id: 6 },
  { kode: '32.01.06.2009', nama: 'Jonggol', kec_id: 6 },
  { kode: '32.01.06.2010', nama: 'Bendungan', kec_id: 6 },
  { kode: '32.01.06.2011', nama: 'Singasari', kec_id: 6 },
  { kode: '32.01.06.2012', nama: 'Balekambang', kec_id: 6 },
  { kode: '32.01.06.2013', nama: 'Sukajaya', kec_id: 6 },
  { kode: '32.01.06.2014', nama: 'Sukagalih', kec_id: 6 },
  // Kecamatan Cileungsi
  { kode: '32.01.07.2001', nama: 'Pasirangin', kec_id: 7 },
  { kode: '32.01.07.2002', nama: 'Mekarsari', kec_id: 7 },
  { kode: '32.01.07.2003', nama: 'Mampir', kec_id: 7 },
  { kode: '32.01.07.2004', nama: 'Dayeuh', kec_id: 7 },
  { kode: '32.01.07.2005', nama: 'Gandoang', kec_id: 7 },
  { kode: '32.01.07.2006', nama: 'Jatisari', kec_id: 7 },
  { kode: '32.01.07.2007', nama: 'Cileungsi Kidul', kec_id: 7 },
  { kode: '32.01.07.2008', nama: 'Cipeucang', kec_id: 7 },
  { kode: '32.01.07.2009', nama: 'Situsari', kec_id: 7 },
  { kode: '32.01.07.2010', nama: 'Cipenjo', kec_id: 7 },
  { kode: '32.01.07.2011', nama: 'Limusnunggal', kec_id: 7 },
  { kode: '32.01.07.2012', nama: 'Cileungsi', kec_id: 7 },
  // Kecamatan Cariu
  { kode: '32.01.08.2001', nama: 'Karyamekar', kec_id: 8 },
  { kode: '32.01.08.2002', nama: 'Babakanraden', kec_id: 8 },
  { kode: '32.01.08.2003', nama: 'Cikutamahi', kec_id: 8 },
  { kode: '32.01.08.2004', nama: 'Kutamekar', kec_id: 8 },
  { kode: '32.01.08.2005', nama: 'Cariu', kec_id: 8 },
  { kode: '32.01.08.2006', nama: 'Mekarwangi', kec_id: 8 },
  { kode: '32.01.08.2007', nama: 'Bantarkuning', kec_id: 8 },
  { kode: '32.01.08.2008', nama: 'Sukajadi', kec_id: 8 },
  { kode: '32.01.08.2009', nama: 'Tegalpanjang', kec_id: 8 },
  { kode: '32.01.08.2010', nama: 'Cibatutiga', kec_id: 8 },
  // Kecamatan Sukamakmur
  { kode: '32.01.09.2001', nama: 'Wargajaya', kec_id: 9 },
  { kode: '32.01.09.2002', nama: 'Pabuaran', kec_id: 9 },
  { kode: '32.01.09.2003', nama: 'Sukadamai', kec_id: 9 },
  { kode: '32.01.09.2004', nama: 'Sukawangi', kec_id: 9 },
  { kode: '32.01.09.2005', nama: 'Cibadak', kec_id: 9 },
  { kode: '32.01.09.2006', nama: 'Sukaresmi', kec_id: 9 },
  { kode: '32.01.09.2007', nama: 'Sukamulya', kec_id: 9 },
  { kode: '32.01.09.2008', nama: 'Sukaharja', kec_id: 9 },
  { kode: '32.01.09.2009', nama: 'Sirnajaya', kec_id: 9 },
  { kode: '32.01.09.2010', nama: 'Sukamakmur', kec_id: 9 },
  // Kecamatan Parung
  { kode: '32.01.10.2001', nama: 'Parung', kec_id: 10 },
  { kode: '32.01.10.2002', nama: 'Iwul', kec_id: 10 },
  { kode: '32.01.10.2003', nama: 'Bojongsempu', kec_id: 10 },
  { kode: '32.01.10.2004', nama: 'Waru', kec_id: 10 },
  { kode: '32.01.10.2005', nama: 'Cogreg', kec_id: 10 },
  { kode: '32.01.10.2006', nama: 'Pamegarsari', kec_id: 10 },
  { kode: '32.01.10.2007', nama: 'Warujaya', kec_id: 10 },
  { kode: '32.01.10.2008', nama: 'Bojongindah', kec_id: 10 },
  { kode: '32.01.10.2009', nama: 'Jabonmekar', kec_id: 10 },
  // Kecamatan Gunung Sindur
  { kode: '32.01.11.2001', nama: 'Cidokom', kec_id: 11 },
  { kode: '32.01.11.2002', nama: 'Padurenan', kec_id: 11 },
  { kode: '32.01.11.2003', nama: 'Pengasinan', kec_id: 11 },
  { kode: '32.01.11.2004', nama: 'Curug', kec_id: 11 },
  { kode: '32.01.11.2005', nama: 'Gunungsindur', kec_id: 11 },
  { kode: '32.01.11.2006', nama: 'Jampang', kec_id: 11 },
  { kode: '32.01.11.2007', nama: 'Cibadung', kec_id: 11 },
  { kode: '32.01.11.2008', nama: 'Cibinong', kec_id: 11 },
  { kode: '32.01.11.2009', nama: 'Rawakalong', kec_id: 11 },
  { kode: '32.01.11.2010', nama: 'Pabuaran', kec_id: 11 },
  // Kecamatan Kemang
  { kode: '32.01.12.1006', nama: 'Atang Senjaya', kec_id: 12 },
  { kode: '32.01.12.2001', nama: 'Bojong', kec_id: 12 },
  { kode: '32.01.12.2002', nama: 'Parakanjaya', kec_id: 12 },
  { kode: '32.01.12.2003', nama: 'Kemang', kec_id: 12 },
  { kode: '32.01.12.2004', nama: 'Pabuaran', kec_id: 12 },
  { kode: '32.01.12.2005', nama: 'Semplak Barat', kec_id: 12 },
  { kode: '32.01.12.2007', nama: 'Jampang', kec_id: 12 },
  { kode: '32.01.12.2008', nama: 'Pondok Udik', kec_id: 12 },
  { kode: '32.01.12.2009', nama: 'Tegal', kec_id: 12 },
  // Kecamatan Bojong Gede
  { kode: '32.01.13.1007', nama: 'Pabuaran', kec_id: 13 },
  { kode: '32.01.13.2001', nama: 'Bojongbaru', kec_id: 13 },
  { kode: '32.01.13.2002', nama: 'Cimanggis', kec_id: 13 },
  { kode: '32.01.13.2003', nama: 'Susukan', kec_id: 13 },
  { kode: '32.01.13.2004', nama: 'Ragajaya', kec_id: 13 },
  { kode: '32.01.13.2005', nama: 'Kedungwaringin', kec_id: 13 },
  { kode: '32.01.13.2006', nama: 'Waringinjaya', kec_id: 13 },
  { kode: '32.01.13.2008', nama: 'Rawapanjang', kec_id: 13 },
  { kode: '32.01.13.2009', nama: 'Bojonggede', kec_id: 13 },
  // Kecamatan Leuwiliang
  { kode: '32.01.14.2001', nama: 'Leuwiliang', kec_id: 14 },
  { kode: '32.01.14.2002', nama: 'Purasari', kec_id: 14 },
  { kode: '32.01.14.2003', nama: 'Karyasari', kec_id: 14 },
  { kode: '32.01.14.2004', nama: 'Pabangbon', kec_id: 14 },
  { kode: '32.01.14.2005', nama: 'Karacak', kec_id: 14 },
  { kode: '32.01.14.2006', nama: 'Barengkok', kec_id: 14 },
  { kode: '32.01.14.2007', nama: 'Leuwimekar', kec_id: 14 },
  { kode: '32.01.14.2008', nama: 'Puraseda', kec_id: 14 },
  { kode: '32.01.14.2009', nama: 'Cibeber I', kec_id: 14 },
  { kode: '32.01.14.2010', nama: 'Cibeber II', kec_id: 14 },
  { kode: '32.01.14.2011', nama: 'Karehkel', kec_id: 14 },
  // Kecamatan Ciampea
  { kode: '32.01.15.2001', nama: 'Ciampea', kec_id: 15 },
  { kode: '32.01.15.2002', nama: 'Ciampea Udik', kec_id: 15 },
  { kode: '32.01.15.2003', nama: 'Tegalwaru', kec_id: 15 },
  { kode: '32.01.15.2004', nama: 'Bojong Rangkas', kec_id: 15 },
  { kode: '32.01.15.2005', nama: 'Cibadak', kec_id: 15 },
  { kode: '32.01.15.2006', nama: 'Cibanteng', kec_id: 15 },
  { kode: '32.01.15.2007', nama: 'Cinangka', kec_id: 15 },
  { kode: '32.01.15.2008', nama: 'Bojong Jengkol', kec_id: 15 },
  { kode: '32.01.15.2009', nama: 'Cihideung Ilir', kec_id: 15 },
  { kode: '32.01.15.2010', nama: 'Cihideung Udik', kec_id: 15 },
  { kode: '32.01.15.2011', nama: 'Benteng', kec_id: 15 },
  { kode: '32.01.15.2012', nama: 'Cicadas', kec_id: 15 },
  { kode: '32.01.15.2013', nama: 'Cimanggu', kec_id: 15 },
  // Kecamatan Cibungbulang
  { kode: '32.01.16.2001', nama: 'Cibungbulang', kec_id: 16 },
  { kode: '32.01.16.2002', nama: 'Galuga', kec_id: 16 },
  { kode: '32.01.16.2003', nama: 'Girimulya', kec_id: 16 },
  { kode: '32.01.16.2004', nama: 'Ciaruteun Ilir', kec_id: 16 },
  { kode: '32.01.16.2005', nama: 'Ciaruteun Udik', kec_id: 16 },
  { kode: '32.01.16.2006', nama: 'Situ Ilir', kec_id: 16 },
  { kode: '32.01.16.2007', nama: 'Situ Udik', kec_id: 16 },
  { kode: '32.01.16.2008', nama: 'Dukuh', kec_id: 16 },
  { kode: '32.01.16.2009', nama: 'Leuwimekar', kec_id: 16 },
  { kode: '32.01.16.2010', nama: 'Cimanggu I', kec_id: 16 },
  { kode: '32.01.16.2011', nama: 'Cimanggu II', kec_id: 16 },
  { kode: '32.01.16.2012', nama: 'Sukamaju', kec_id: 16 },
  { kode: '32.01.16.2013', nama: 'Leuweung Kolot', kec_id: 16 },
  { kode: '32.01.16.2014', nama: 'Cijujung', kec_id: 16 },
  { kode: '32.01.16.2015', nama: 'Semplak Barat', kec_id: 16 },
  // Kecamatan Pamijahan
  { kode: '32.01.17.2001', nama: 'Pamijahan', kec_id: 17 },
  { kode: '32.01.17.2002', nama: 'Gunung Bunder I', kec_id: 17 },
  { kode: '32.01.17.2003', nama: 'Gunung Bunder II', kec_id: 17 },
  { kode: '32.01.17.2004', nama: 'Cimayang', kec_id: 17 },
  { kode: '32.01.17.2005', nama: 'Gunung Picung', kec_id: 17 },
  { kode: '32.01.17.2006', nama: 'Gunung Sari', kec_id: 17 },
  { kode: '32.01.17.2007', nama: 'Cibunian', kec_id: 17 },
  { kode: '32.01.17.2008', nama: 'Pasarean', kec_id: 17 },
  { kode: '32.01.17.2009', nama: 'Cibening', kec_id: 17 },
  { kode: '32.01.17.2010', nama: 'Ciasihan', kec_id: 17 },
  { kode: '32.01.17.2011', nama: 'Ciasmara', kec_id: 17 },
  { kode: '32.01.17.2012', nama: 'Purwabakti', kec_id: 17 },
  { kode: '32.01.17.2013', nama: 'Gunungmenyan', kec_id: 17 },
  { kode: '32.01.17.2014', nama: 'Ciherang', kec_id: 17 },
  { kode: '32.01.17.2015', nama: 'Cibitung Kulon', kec_id: 17 },
  // Kecamatan Rumpin
  { kode: '32.01.18.2001', nama: 'Rumpin', kec_id: 18 },
  { kode: '32.01.18.2002', nama: 'Gobang', kec_id: 18 },
  { kode: '32.01.18.2003', nama: 'Cidokom', kec_id: 18 },
  { kode: '32.01.18.2004', nama: 'Kampung Sawah', kec_id: 18 },
  { kode: '32.01.18.2005', nama: 'Mekarjaya', kec_id: 18 },
  { kode: '32.01.18.2006', nama: 'Tamansari', kec_id: 18 },
  { kode: '32.01.18.2007', nama: 'Sukasari', kec_id: 18 },
  { kode: '32.01.18.2008', nama: 'Leuwibatu', kec_id: 18 },
  { kode: '32.01.18.2009', nama: 'Cipinang', kec_id: 18 },
  { kode: '32.01.18.2010', nama: 'Cibodas', kec_id: 18 },
  { kode: '32.01.18.2011', nama: 'Rabak', kec_id: 18 },
  { kode: '32.01.18.2012', nama: 'Kertajaya', kec_id: 18 },
  { kode: '32.01.18.2013', nama: 'Mekarsari', kec_id: 18 },
  { kode: '32.01.18.2014', nama: 'Sukamulya', kec_id: 18 },
  // Kecamatan Jasinga
  { kode: '32.01.19.2001', nama: 'Jasinga', kec_id: 19 },
  { kode: '32.01.19.2002', nama: 'Koleang', kec_id: 19 },
  { kode: '32.01.19.2003', nama: 'Jugala Jaya', kec_id: 19 },
  { kode: '32.01.19.2004', nama: 'Curug', kec_id: 19 },
  { kode: '32.01.19.2005', nama: 'Setu', kec_id: 19 },
  { kode: '32.01.19.2006', nama: 'Pangradin', kec_id: 19 },
  { kode: '32.01.19.2007', nama: 'Pamagersari', kec_id: 19 },
  { kode: '32.01.19.2008', nama: 'Bagoang', kec_id: 19 },
  { kode: '32.01.19.2009', nama: 'Cikopomayak', kec_id: 19 },
  { kode: '32.01.19.2010', nama: 'Barengkok', kec_id: 19 },
  { kode: '32.01.19.2011', nama: 'Tegal Lega', kec_id: 19 },
  { kode: '32.01.19.2012', nama: 'Wirajaya', kec_id: 19 },
  { kode: '32.01.19.2013', nama: 'Neglasari', kec_id: 19 },
  { kode: '32.01.19.2014', nama: 'Sipak', kec_id: 19 },
  { kode: '32.01.19.2015', nama: 'Pangaur', kec_id: 19 },
  // Kecamatan Parung Panjang
  { kode: '32.01.20.2001', nama: 'Parung Panjang', kec_id: 20 },
  { kode: '32.01.20.2002', nama: 'Dago', kec_id: 20 },
  { kode: '32.01.20.2003', nama: 'Cibunar', kec_id: 20 },
  { kode: '32.01.20.2004', nama: 'Jagabaya', kec_id: 20 },
  { kode: '32.01.20.2005', nama: 'Jagabita', kec_id: 20 },
  { kode: '32.01.20.2006', nama: 'Gintung Cilejet', kec_id: 20 },
  { kode: '32.01.20.2007', nama: 'Cikuda', kec_id: 20 },
  { kode: '32.01.20.2008', nama: 'Lumpang', kec_id: 20 },
  { kode: '32.01.20.2009', nama: 'Gorowong', kec_id: 20 },
  { kode: '32.01.20.2010', nama: 'Kabasiran', kec_id: 20 },
  { kode: '32.01.20.2011', nama: 'Pingku', kec_id: 20 },
  // Kecamatan Nanggung
  { kode: '32.01.21.2001', nama: 'Nanggung', kec_id: 21 },
  { kode: '32.01.21.2002', nama: 'Malasari', kec_id: 21 },
  { kode: '32.01.21.2003', nama: 'Pangkal Jaya', kec_id: 21 },
  { kode: '32.01.21.2004', nama: 'Sukaluyu', kec_id: 21 },
  { kode: '32.01.21.2005', nama: 'Hambaro', kec_id: 21 },
  { kode: '32.01.21.2006', nama: 'Cisarua', kec_id: 21 },
  { kode: '32.01.21.2007', nama: 'Curug Bitung', kec_id: 21 },
  { kode: '32.01.21.2008', nama: 'Parakanmuncang', kec_id: 21 },
  { kode: '32.01.21.2009', nama: 'Bantar Karet', kec_id: 21 },
  { kode: '32.01.21.2010', nama: 'Kalong Liud', kec_id: 21 },
  // Kecamatan Cigudeg
  { kode: '32.01.22.2001', nama: 'Cigudeg', kec_id: 22 },
  { kode: '32.01.22.2002', nama: 'Argapura', kec_id: 22 },
  { kode: '32.01.22.2003', nama: 'Bangunjaya', kec_id: 22 },
  { kode: '32.01.22.2004', nama: 'Batujajar', kec_id: 22 },
  { kode: '32.01.22.2005', nama: 'Bitung Sari', kec_id: 22 },
  { kode: '32.01.22.2006', nama: 'Buanajaya', kec_id: 22 },
  { kode: '32.01.22.2007', nama: 'Cintamanik', kec_id: 22 },
  { kode: '32.01.22.2008', nama: 'Mekarjaya', kec_id: 22 },
  { kode: '32.01.22.2009', nama: 'Rengasjajar', kec_id: 22 },
  { kode: '32.01.22.2010', nama: 'Sukamaju', kec_id: 22 },
  { kode: '32.01.22.2011', nama: 'Sukamakmur', kec_id: 22 },
  { kode: '32.01.22.2012', nama: 'Sukamulih', kec_id: 22 },
  { kode: '32.01.22.2013', nama: 'Tegallega', kec_id: 22 },
  { kode: '32.01.22.2014', nama: 'Wargajaya', kec_id: 22 },
  { kode: '32.01.22.2015', nama: 'Cisarua', kec_id: 22 },
  // Kecamatan Tenjo
  { kode: '32.01.23.2001', nama: 'Tenjo', kec_id: 23 },
  { kode: '32.01.23.2002', nama: 'Cilaku', kec_id: 23 },
  { kode: '32.01.23.2003', nama: 'Ciomas', kec_id: 23 },
  { kode: '32.01.23.2004', nama: 'Batok', kec_id: 23 },
  { kode: '32.01.23.2005', nama: 'Singabangsa', kec_id: 23 },
  { kode: '32.01.23.2006', nama: 'Tapos', kec_id: 23 },
  { kode: '32.01.23.2007', nama: 'Babakan', kec_id: 23 },
  { kode: '32.01.23.2008', nama: 'Bojong', kec_id: 23 },
  { kode: '32.01.23.2009', nama: 'Jasinga', kec_id: 23 },
  // Kecamatan Ciawi
  { kode: '32.01.24.1001', nama: 'Cisarua', kec_id: 24 },
  { kode: '32.01.24.1002', nama: 'Padasuka', kec_id: 24 },
  { kode: '32.01.24.2001', nama: 'Ciawi', kec_id: 24 },
  { kode: '32.01.24.2002', nama: 'Teluk Pinang', kec_id: 24 },
  { kode: '32.01.24.2003', nama: 'Banjarwangi', kec_id: 24 },
  { kode: '32.01.24.2004', nama: 'Bendungan', kec_id: 24 },
  { kode: '32.01.24.2005', nama: 'Bitungtonggoh', kec_id: 24 },
  { kode: '32.01.24.2006', nama: 'Bojongmurni', kec_id: 24 },
  { kode: '32.01.24.2007', nama: 'Byongkok', kec_id: 24 },
  { kode: '32.01.24.2008', nama: 'Cibedug', kec_id: 24 },
  { kode: '32.01.24.2009', nama: 'Jambubudur', kec_id: 24 },
  { kode: '32.01.24.2010', nama: 'Pandansari', kec_id: 24 },
  { kode: '32.01.24.2011', nama: 'Sukajadi', kec_id: 24 },
  // Kecamatan Cisarua
  { kode: '32.01.25.2001', nama: 'Cisarua', kec_id: 25 },
  { kode: '32.01.25.2002', nama: 'Citeko', kec_id: 25 },
  { kode: '32.01.25.2003', nama: 'Jogjogan', kec_id: 25 },
  { kode: '32.01.25.2004', nama: 'Batu Layang', kec_id: 25 },
  { kode: '32.01.25.2005', nama: 'Cibeureum', kec_id: 25 },
  { kode: '32.01.25.2006', nama: 'Cilember', kec_id: 25 },
  { kode: '32.01.25.2007', nama: 'Kopo', kec_id: 25 },
  { kode: '32.01.25.2008', nama: 'Leuwimalang', kec_id: 25 },
  { kode: '32.01.25.2009', nama: 'Tugu Selatan', kec_id: 25 },
  { kode: '32.01.25.2010', nama: 'Tugu Utara', kec_id: 25 },
  // Kecamatan Megamendung
  { kode: '32.01.26.2001', nama: 'Megamendung', kec_id: 26 },
  { kode: '32.01.26.2002', nama: 'Cipayung', kec_id: 26 },
  { kode: '32.01.26.2003', nama: 'Cipayung Girang', kec_id: 26 },
  { kode: '32.01.26.2004', nama: 'Gadog', kec_id: 26 },
  { kode: '32.01.26.2005', nama: 'Kuta', kec_id: 26 },
  { kode: '32.01.26.2006', nama: 'Pasir Angin', kec_id: 26 },
  { kode: '32.01.26.2007', nama: 'Sukakarya', kec_id: 26 },
  { kode: '32.01.26.2008', nama: 'Sukaresmi', kec_id: 26 },
  { kode: '32.01.26.2009', nama: 'Sukamahi', kec_id: 26 },
  // Kecamatan Caringin
  { kode: '32.01.27.2001', nama: 'Caringin', kec_id: 27 },
  { kode: '32.01.27.2002', nama: 'Ciherang Pondok', kec_id: 27 },
  { kode: '32.01.27.2003', nama: 'Cimande', kec_id: 27 },
  { kode: '32.01.27.2004', nama: 'Cimande Hilir', kec_id: 27 },
  { kode: '32.01.27.2005', nama: 'Cinagara', kec_id: 27 },
  { kode: '32.01.27.2006', nama: 'Lemah Duhur', kec_id: 27 },
  { kode: '32.01.27.2007', nama: 'Muarajaya', kec_id: 27 },
  { kode: '32.01.27.2008', nama: 'Pancawati', kec_id: 27 },
  { kode: '32.01.27.2009', nama: 'Pasir Buncir', kec_id: 27 },
  { kode: '32.01.27.2010', nama: 'Tangkil', kec_id: 27 },
  { kode: '32.01.27.2011', nama: 'Teluk Pinang', kec_id: 27 },
  { kode: '32.01.27.2012', nama: 'Ciderum', kec_id: 27 },
  // Kecamatan Cijeruk
  { kode: '32.01.28.2001', nama: 'Cijeruk', kec_id: 28 },
  { kode: '32.01.28.2002', nama: 'Tajur Halang', kec_id: 28 },
  { kode: '32.01.28.2003', nama: 'Cibalung', kec_id: 28 },
  { kode: '32.01.28.2004', nama: 'Cipicung', kec_id: 28 },
  { kode: '32.01.28.2005', nama: 'Cipelang', kec_id: 28 },
  { kode: '32.01.28.2006', nama: 'Palasari', kec_id: 28 },
  { kode: '32.01.28.2007', nama: 'Sukaharja', kec_id: 28 },
  { kode: '32.01.28.2008', nama: 'Tanjung Sari', kec_id: 28 },
  { kode: '32.01.28.2009', nama: 'Warung Menteng', kec_id: 28 },
  // Kecamatan Ciomas
  { kode: '32.01.29.2001', nama: 'Ciomas', kec_id: 29 },
  { kode: '32.01.29.2002', nama: 'Ciomas Rahayu', kec_id: 29 },
  { kode: '32.01.29.2003', nama: 'Pagelaran', kec_id: 29 },
  { kode: '32.01.29.2004', nama: 'Parakan', kec_id: 29 },
  { kode: '32.01.29.2005', nama: 'Sukamakmur', kec_id: 29 },
  { kode: '32.01.29.2006', nama: 'Sukaharja', kec_id: 29 },
  { kode: '32.01.29.2007', nama: 'Laladon', kec_id: 29 },
  { kode: '32.01.29.2008', nama: 'Mekarjaya', kec_id: 29 },
  { kode: '32.01.29.2009', nama: 'Kota Batu', kec_id: 29 },
  // Kecamatan Dramaga
  { kode: '32.01.30.2001', nama: 'Dramaga', kec_id: 30 },
  { kode: '32.01.30.2002', nama: 'Ciherang', kec_id: 30 },
  { kode: '32.01.30.2003', nama: 'Babakan', kec_id: 30 },
  { kode: '32.01.30.2004', nama: 'Sukawening', kec_id: 30 },
  { kode: '32.01.30.2005', nama: 'Petir', kec_id: 30 },
  { kode: '32.01.30.2006', nama: 'Sinarsari', kec_id: 30 },
  { kode: '32.01.30.2007', nama: 'Neglasari', kec_id: 30 },
  { kode: '32.01.30.2008', nama: 'Purwasari', kec_id: 30 },
  { kode: '32.01.30.2009', nama: 'Sukadamai', kec_id: 30 },
  { kode: '32.01.30.2010', nama: 'Cikarawang', kec_id: 30 },
  // Kecamatan Tamansari
  { kode: '32.01.31.2001', nama: 'Tamansari', kec_id: 31 },
  { kode: '32.01.31.2002', nama: 'Sukaluyu', kec_id: 31 },
  { kode: '32.01.31.2003', nama: 'Sukaresmi', kec_id: 31 },
  { kode: '32.01.31.2004', nama: 'Sirnagalih', kec_id: 31 },
  { kode: '32.01.31.2005', nama: 'Sukamantri', kec_id: 31 },
  { kode: '32.01.31.2006', nama: 'Pasir Eurih', kec_id: 31 },
  { kode: '32.01.31.2007', nama: 'Sukalestari', kec_id: 31 },
  { kode: '32.01.31.2008', nama: 'Sukajaya', kec_id: 31 },
  // Kecamatan Klapanunggal
  { kode: '32.01.32.2001', nama: 'Klapanunggal', kec_id: 32 },
  { kode: '32.01.32.2002', nama: 'Bantar Jati', kec_id: 32 },
  { kode: '32.01.32.2003', nama: 'Bojong', kec_id: 32 },
  { kode: '32.01.32.2004', nama: 'Cikahuripan', kec_id: 32 },
  { kode: '32.01.32.2005', nama: 'Hambalang', kec_id: 32 },
  { kode: '32.01.32.2006', nama: 'Kembang Kuning', kec_id: 32 },
  { kode: '32.01.32.2007', nama: 'Leuwikaret', kec_id: 32 },
  { kode: '32.01.32.2008', nama: 'Ligarmukti', kec_id: 32 },
  { kode: '32.01.32.2009', nama: 'Nambo', kec_id: 32 },
  // Kecamatan Ciseeng
  { kode: '32.01.33.2001', nama: 'Ciseeng', kec_id: 33 },
  { kode: '32.01.33.2002', nama: 'Babakan', kec_id: 33 },
  { kode: '32.01.33.2003', nama: 'Parigi Mekar', kec_id: 33 },
  { kode: '32.01.33.2004', nama: 'Putat Nutug', kec_id: 33 },
  { kode: '32.01.33.2005', nama: 'Cibeuteung Muara', kec_id: 33 },
  { kode: '32.01.33.2006', nama: 'Cibeuteung Udik', kec_id: 33 },
  { kode: '32.01.33.2007', nama: 'Cibentang', kec_id: 33 },
  { kode: '32.01.33.2008', nama: 'Kuripan', kec_id: 33 },
  { kode: '32.01.33.2009', nama: 'Karihkil', kec_id: 33 },
  { kode: '32.01.33.2010', nama: 'Cihowe', kec_id: 33 },
  // Kecamatan Rancabungur
  { kode: '32.01.34.2001', nama: 'Rancabungur', kec_id: 34 },
  { kode: '32.01.34.2002', nama: 'Bantarjaya', kec_id: 34 },
  { kode: '32.01.34.2003', nama: 'Bantarsari', kec_id: 34 },
  { kode: '32.01.34.2004', nama: 'Candali', kec_id: 34 },
  { kode: '32.01.34.2005', nama: 'Mekarsari', kec_id: 34 },
  { kode: '32.01.34.2006', nama: 'Pasirgaok', kec_id: 34 },
  { kode: '32.01.34.2007', nama: 'Cimulang', kec_id: 34 },
  // Kecamatan Tajurhalang
  { kode: '32.01.35.2001', nama: 'Tajurhalang', kec_id: 35 },
  { kode: '32.01.35.2002', nama: 'Kalisuren', kec_id: 35 },
  { kode: '32.01.35.2003', nama: 'Nanggerang', kec_id: 35 },
  { kode: '32.01.35.2004', nama: 'Sasak Panjang', kec_id: 35 },
  { kode: '32.01.35.2005', nama: 'Sukmajaya', kec_id: 35 },
  { kode: '32.01.35.2006', nama: 'Tonjong', kec_id: 35 },
  { kode: '32.01.35.2007', nama: 'Citayam', kec_id: 35 },
  // Kecamatan Sukajaya
  { kode: '32.01.36.2001', nama: 'Sukajaya', kec_id: 36 },
  { kode: '32.01.36.2002', nama: 'Cisarua', kec_id: 36 },
  { kode: '32.01.36.2003', nama: 'Harkatjaya', kec_id: 36 },
  { kode: '32.01.36.2004', nama: 'Jayaraharja', kec_id: 36 },
  { kode: '32.01.36.2005', nama: 'Kiarapandak', kec_id: 36 },
  { kode: '32.01.36.2006', nama: 'Kiara Sari', kec_id: 36 },
  { kode: '32.01.36.2007', nama: 'Pasir Madang', kec_id: 36 },
  { kode: '32.01.36.2008', nama: 'Sipayung', kec_id: 36 },
  { kode: '32.01.36.2009', nama: 'Sukamulya', kec_id: 36 },
  { kode: '32.01.36.2010', nama: 'Urug', kec_id: 36 },
  // Kecamatan Tanjungsari
  { kode: '32.01.37.2001', nama: 'Tanjungsari', kec_id: 37 },
  { kode: '32.01.37.2002', nama: 'Antajaya', kec_id: 37 },
  { kode: '32.01.37.2003', nama: 'Buanajaya', kec_id: 37 },
  { kode: '32.01.37.2004', nama: 'Cibadak', kec_id: 37 },
  { kode: '32.01.37.2005', nama: 'Selawangi', kec_id: 37 },
  { kode: '32.01.37.2006', nama: 'Sirnarasa', kec_id: 37 },
  { kode: '32.01.37.2007', nama: 'Sukaringin', kec_id: 37 },
  // Kecamatan Leuwisadeng
  { kode: '32.01.38.2001', nama: 'Leuwisadeng', kec_id: 38 },
  { kode: '32.01.38.2002', nama: 'Babakan Sadeng', kec_id: 38 },
  { kode: '32.01.38.2003', nama: 'Kalong I', kec_id: 38 },
  { kode: '32.01.38.2004', nama: 'Kalong II', kec_id: 38 },
  { kode: '32.01.38.2005', nama: 'Sadeng', kec_id: 38 },
  { kode: '32.01.38.2006', nama: 'Sadeng Kolot', kec_id: 38 },
  { kode: '32.01.38.2007', nama: 'Wangun Jaya', kec_id: 38 },
  { kode: '32.01.38.2008', nama: 'Cidokom', kec_id: 38 },
  // Kecamatan Tenjolaya
  { kode: '32.01.39.2001', nama: 'Tenjolaya', kec_id: 39 },
  { kode: '32.01.39.2002', nama: 'Cinangneng', kec_id: 39 },
  { kode: '32.01.39.2003', nama: 'Gunung Malang', kec_id: 39 },
  { kode: '32.01.39.2004', nama: 'Situ Daun', kec_id: 39 },
  { kode: '32.01.39.2005', nama: 'Tapos I', kec_id: 39 },
  { kode: '32.01.39.2006', nama: 'Tapos II', kec_id: 39 },
  // Kecamatan Cigombong
  { kode: '32.01.40.2001', nama: 'Cigombong', kec_id: 40 },
  { kode: '32.01.40.2002', nama: 'Ciburayut', kec_id: 40 },
  { kode: '32.01.40.2003', nama: 'Cisalada', kec_id: 40 },
  { kode: '32.01.40.2004', nama: 'Ciburuy', kec_id: 40 },
  { kode: '32.01.40.2005', nama: 'Srogol', kec_id: 40 },
  { kode: '32.01.40.2006', nama: 'Tugujaya', kec_id: 40 },
  { kode: '32.01.40.2007', nama: 'Watesjaya', kec_id: 40 },
  { kode: '32.01.40.2008', nama: 'Cijedil', kec_id: 40 },
  { kode: '32.01.40.2009', nama: 'Cisalada Baru', kec_id: 40 },
];

// ============================================
// DATA: Roles
// ============================================
const rolesData = [
  { name: 'superadmin', label: 'Super Admin', color: 'red', category: 'admin', is_system: true },
  { name: 'admin', label: 'Admin', color: 'red', category: 'admin', is_system: true },
  { name: 'kepala_dinas', label: 'Kepala Dinas', color: 'purple', category: 'dpmd' },
  { name: 'sekretaris_dinas', label: 'Sekretaris Dinas', color: 'indigo', category: 'dpmd' },
  { name: 'kabid_sekretariat', label: 'Kabid Sekretariat', color: 'blue', category: 'dpmd', needs_entity: true },
  { name: 'kabid_pemerintahan_desa', label: 'Kabid Pemerintahan Desa', color: 'blue', category: 'dpmd', needs_entity: true },
  { name: 'kabid_spked', label: 'Kabid SPKED', color: 'blue', category: 'dpmd', needs_entity: true },
  { name: 'kabid_kekayaan_keuangan_desa', label: 'Kabid Kekayaan & Keuangan Desa', color: 'blue', category: 'dpmd', needs_entity: true },
  { name: 'kabid_pemberdayaan_masyarakat_desa', label: 'Kabid Pemberdayaan Masyarakat Desa', color: 'blue', category: 'dpmd', needs_entity: true },
  { name: 'pegawai', label: 'Pegawai', color: 'cyan', category: 'dpmd', needs_entity: true },
  { name: 'kecamatan', label: 'Admin Kecamatan', color: 'green', category: 'wilayah', needs_entity: true },
  { name: 'desa', label: 'Admin Desa', color: 'emerald', category: 'wilayah', needs_entity: true },
  { name: 'dinas', label: 'Dinas Terkait', color: 'orange', category: 'dinas', needs_entity: true },
];

// ============================================
// DATA: Master Dinas
// ============================================
const masterDinasData = [
  { kode_dinas: 'PUPR', nama_dinas: 'Dinas Pekerjaan Umum dan Penataan Ruang', singkatan: 'PUPR' },
  { kode_dinas: 'DISKOMINFO', nama_dinas: 'Dinas Komunikasi dan Informatika', singkatan: 'Diskominfo' },
  { kode_dinas: 'DINKES', nama_dinas: 'Dinas Kesehatan', singkatan: 'Dinkes' },
  { kode_dinas: 'DISDIK', nama_dinas: 'Dinas Pendidikan', singkatan: 'Disdik' },
  { kode_dinas: 'DISPARBUD', nama_dinas: 'Dinas Pariwisata dan Kebudayaan', singkatan: 'Disparbud' },
  { kode_dinas: 'DISKOPUMKM', nama_dinas: 'Dinas Koperasi dan UMKM', singkatan: 'Diskopumkm' },
  { kode_dinas: 'DISTAN', nama_dinas: 'Dinas Pertanian', singkatan: 'Distan' },
  { kode_dinas: 'DISHUB', nama_dinas: 'Dinas Perhubungan', singkatan: 'Dishub' },
  { kode_dinas: 'DLHK', nama_dinas: 'Dinas Lingkungan Hidup dan Kehutanan', singkatan: 'DLHK' },
  { kode_dinas: 'DINSOS', nama_dinas: 'Dinas Sosial', singkatan: 'Dinsos' },
];

// ============================================
// SEEDER FUNCTIONS
// ============================================

function slugify(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');
}

async function seedBidangs() {
  console.log('📋 Seeding bidangs...');
  for (const b of bidangsData) {
    await prisma.bidangs.upsert({
      where: { id: BigInt(b.id) },
      update: { nama: b.nama },
      create: { id: BigInt(b.id), nama: b.nama, created_at: new Date(), updated_at: new Date() },
    });
  }
  console.log(`   ✅ ${bidangsData.length} bidangs seeded\n`);
}

async function seedKecamatans() {
  console.log('📍 Seeding kecamatans...');
  for (const k of kecamatansData) {
    await prisma.kecamatans.upsert({
      where: { kode: k.kode },
      update: { nama: k.nama },
      create: { id: BigInt(k.id), kode: k.kode, nama: k.nama, created_at: new Date(), updated_at: new Date() },
    });
  }
  console.log(`   ✅ ${kecamatansData.length} kecamatans seeded\n`);
}

async function seedDesas() {
  console.log('🏘️  Seeding desas...');
  let count = 0;
  for (const d of desasData) {
    const isKelurahan = kelurahanList.includes(d.nama.toUpperCase());
    await prisma.desas.upsert({
      where: { kode: d.kode },
      update: { nama: d.nama, kecamatan_id: BigInt(d.kec_id), status_pemerintahan: isKelurahan ? 'kelurahan' : 'desa' },
      create: {
        kecamatan_id: BigInt(d.kec_id),
        kode: d.kode,
        nama: d.nama,
        status_pemerintahan: isKelurahan ? 'kelurahan' : 'desa',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    count++;
  }
  console.log(`   ✅ ${count} desas seeded\n`);
}

async function seedRoles() {
  console.log('🔑 Seeding roles...');
  for (const r of rolesData) {
    await prisma.roles.upsert({
      where: { name: r.name },
      update: { label: r.label, color: r.color, category: r.category },
      create: {
        name: r.name,
        label: r.label,
        color: r.color || 'gray',
        category: r.category || 'other',
        is_system: r.is_system || false,
        needs_entity: r.needs_entity || false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }
  console.log(`   ✅ ${rolesData.length} roles seeded\n`);
}

async function seedMasterDinas() {
  console.log('🏛️  Seeding master_dinas...');
  for (const d of masterDinasData) {
    await prisma.master_dinas.upsert({
      where: { kode_dinas: d.kode_dinas },
      update: { nama_dinas: d.nama_dinas, singkatan: d.singkatan },
      create: {
        kode_dinas: d.kode_dinas,
        nama_dinas: d.nama_dinas,
        singkatan: d.singkatan,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }
  console.log(`   ✅ ${masterDinasData.length} master_dinas seeded\n`);
}

async function seedPegawai() {
  console.log('👷 Seeding pegawai...');
  const dataPath = path.join(__dirname, '..', 'database-express', 'seeders', 'pegawai-data.json');
  if (!fs.existsSync(dataPath)) {
    console.log('   ⚠️  pegawai-data.json not found, skipping\n');
    return;
  }
  const pegawaiData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  let count = 0;
  for (const p of pegawaiData) {
    try {
      await prisma.pegawai.upsert({
        where: { id_pegawai: BigInt(p.id_pegawai) },
        update: { nama_pegawai: p.nama_pegawai, id_bidang: BigInt(p.id_bidang) },
        create: {
          id_pegawai: BigInt(p.id_pegawai),
          id_bidang: BigInt(p.id_bidang),
          nama_pegawai: p.nama_pegawai,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      count++;
    } catch (err) {
      console.log(`   ⚠️  Skip pegawai ${p.nama_pegawai}: ${err.message.substring(0, 80)}`);
    }
  }
  console.log(`   ✅ ${count} pegawai seeded\n`);
}

async function seedUsers() {
  console.log('👤 Seeding users...');
  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  let count = 0;

  // 1. Super Admin
  await prisma.users.upsert({
    where: { email: 'superadmin@dpmd.bogorkab.go.id' },
    update: {},
    create: { name: 'Super Admin DPMD', email: 'superadmin@dpmd.bogorkab.go.id', password: hashedPassword, role: 'superadmin', created_at: new Date(), updated_at: new Date() },
  });
  count++;

  // 2. Kepala Dinas
  await prisma.users.upsert({
    where: { email: 'kepaladinas@dpmd.bogorkab.go.id' },
    update: {},
    create: { name: 'Kepala Dinas DPMD', email: 'kepaladinas@dpmd.bogorkab.go.id', password: hashedPassword, role: 'kepala_dinas', created_at: new Date(), updated_at: new Date() },
  });
  count++;

  // 3. Sekretaris Dinas
  await prisma.users.upsert({
    where: { email: 'sekretaris@dpmd.bogorkab.go.id' },
    update: {},
    create: { name: 'Sekretaris Dinas DPMD', email: 'sekretaris@dpmd.bogorkab.go.id', password: hashedPassword, role: 'sekretaris_dinas', created_at: new Date(), updated_at: new Date() },
  });
  count++;

  // 4. Kepala Bidang users
  const kabidUsers = [
    { name: 'Kepala Sub Bagian Umum dan Pegawai', email: 'subag.umpeg@dpmd.bogorkab.go.id', role: 'kabid_sekretariat', bidang_id: 2 },
    { name: 'Kepala Bidang Pemerintahan Desa', email: 'kabid.pemdes@dpmd.bogorkab.go.id', role: 'kabid_pemerintahan_desa', bidang_id: 6 },
    { name: 'Kepala Bidang SPKED', email: 'kabid.spked@dpmd.bogorkab.go.id', role: 'kabid_spked', bidang_id: 3 },
    { name: 'Kepala Bidang Kekayaan dan Keuangan Desa', email: 'kabid.kkd@dpmd.bogorkab.go.id', role: 'kabid_kekayaan_keuangan_desa', bidang_id: 4 },
    { name: 'Kepala Bidang Pemberdayaan Masyarakat Desa', email: 'kabid.pm@dpmd.bogorkab.go.id', role: 'kabid_pemberdayaan_masyarakat_desa', bidang_id: 5 },
  ];
  for (const u of kabidUsers) {
    await prisma.users.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, password: hashedPassword, role: u.role, bidang_id: u.bidang_id, created_at: new Date(), updated_at: new Date() },
    });
    count++;
  }

  // 5. Kecamatan users
  for (const k of kecamatansData) {
    const email = `kecamatan.${slugify(k.nama)}@dpmd.bogorkab.go.id`;
    await prisma.users.upsert({
      where: { email },
      update: {},
      create: { name: `Admin Kecamatan ${k.nama}`, email, password: hashedPassword, role: 'kecamatan', kecamatan_id: k.id, created_at: new Date(), updated_at: new Date() },
    });
    count++;
  }

  // 6. Sample desa users (first 3 desa per kecamatan for dev, to save time)
  const desasByKec = {};
  desasData.forEach(d => {
    if (!desasByKec[d.kec_id]) desasByKec[d.kec_id] = [];
    desasByKec[d.kec_id].push(d);
  });

  // Get all desas from DB to get their IDs
  const allDesas = await prisma.desas.findMany({ select: { id: true, kode: true, nama: true, kecamatan_id: true } });
  const desaByKode = {};
  allDesas.forEach(d => { desaByKode[d.kode] = d; });

  for (const kecId of Object.keys(desasByKec)) {
    const kec = kecamatansData.find(k => k.id === Number(kecId));
    const desas = desasByKec[kecId].slice(0, 3); // First 3 per kecamatan for dev
    for (const d of desas) {
      const dbDesa = desaByKode[d.kode];
      if (!dbDesa) continue;
      const email = `desa.${slugify(d.nama)}.${slugify(kec.nama)}@dpmd.bogorkab.go.id`;
      try {
        await prisma.users.upsert({
          where: { email },
          update: {},
          create: { name: `Admin Desa ${d.nama}`, email, password: hashedPassword, role: 'desa', desa_id: dbDesa.id, created_at: new Date(), updated_at: new Date() },
        });
        count++;
      } catch (err) {
        // skip duplicate
      }
    }
  }

  console.log(`   ✅ ${count} users seeded`);
  console.log(`   🔑 Password: ${DEFAULT_PASSWORD}\n`);
}

async function seedBerita() {
  console.log('📰 Seeding sample berita...');
  const beritaData = [
    { judul: 'Selamat Datang di DPMD Kabupaten Bogor', slug: 'selamat-datang-dpmd', konten: 'Selamat datang di portal Dinas Pemberdayaan Masyarakat dan Desa Kabupaten Bogor.', kategori: 'umum', status: 'published', tanggal_publish: new Date() },
    { judul: 'Musyawarah Desa Tahun 2026', slug: 'musdesus-2026', konten: 'Pemerintah Kabupaten Bogor melalui DPMD menyelenggarakan Musyawarah Desa tahun 2026.', kategori: 'musdesus', status: 'published', tanggal_publish: new Date() },
    { judul: 'Pengajuan Bantuan Keuangan Desa', slug: 'bankeu-desa-2026', konten: 'Informasi terkait pengajuan bantuan keuangan desa tahun anggaran 2026.', kategori: 'pengumuman', status: 'published', tanggal_publish: new Date() },
  ];
  for (const b of beritaData) {
    await prisma.berita.upsert({
      where: { slug: b.slug },
      update: {},
      create: { ...b, penulis: 'Admin DPMD', created_at: new Date(), updated_at: new Date() },
    });
  }
  console.log(`   ✅ ${beritaData.length} berita seeded\n`);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('🌱 DPMD Express - Database Seeder');
  console.log('='.repeat(60));
  console.log('');

  await seedBidangs();
  await seedKecamatans();
  await seedDesas();
  await seedRoles();
  await seedMasterDinas();
  await seedPegawai();
  await seedUsers();
  await seedBerita();

  console.log('='.repeat(60));
  console.log('🎉 All seeders completed successfully!');
  console.log('='.repeat(60));
  console.log('');
  console.log('📝 Login Credentials:');
  console.log(`   Super Admin : superadmin@dpmd.bogorkab.go.id / ${DEFAULT_PASSWORD}`);
  console.log(`   Kepala Dinas: kepaladinas@dpmd.bogorkab.go.id / ${DEFAULT_PASSWORD}`);
  console.log(`   Sekretaris  : sekretaris@dpmd.bogorkab.go.id / ${DEFAULT_PASSWORD}`);
  console.log(`   Kecamatan   : kecamatan.[nama]@dpmd.bogorkab.go.id / ${DEFAULT_PASSWORD}`);
  console.log(`   Desa        : desa.[nama-desa].[nama-kec]@dpmd.bogorkab.go.id / ${DEFAULT_PASSWORD}`);
  console.log('');
}

main()
  .catch((e) => { console.error('❌ Seeder failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
