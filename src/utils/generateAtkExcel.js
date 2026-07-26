'use strict';

/**
 * Generate workbook "File Pencairan ATK" using the printable layout from
 * root/File Pencairan ATK.xls. The source workbook is an old .xls, so the
 * layout is recreated with ExcelJS and filled with pencairan data.
 */

const ExcelJS = require('exceljs');

const SATUAN = [
  '', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan',
  'Sembilan', 'Sepuluh', 'Sebelas', 'Dua Belas', 'Tiga Belas', 'Empat Belas',
  'Lima Belas', 'Enam Belas', 'Tujuh Belas', 'Delapan Belas', 'Sembilan Belas',
];
const PULUHAN = [
  '', '', 'Dua Puluh', 'Tiga Puluh', 'Empat Puluh', 'Lima Puluh',
  'Enam Puluh', 'Tujuh Puluh', 'Delapan Puluh', 'Sembilan Puluh',
];
const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const thinBorder = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};
const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const defaultMargins = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0, footer: 0 };

const font = (bold = false, size = 11) => ({ name: 'Times New Roman', size, bold });
const align = (horizontal = 'left', vertical = 'middle', wrapText = false) => ({
  horizontal,
  vertical,
  wrapText,
});

function terbilangRatus(n) {
  if (n < 20) return SATUAN[n] || '';
  if (n < 100) return PULUHAN[Math.floor(n / 10)] + (n % 10 ? ` ${SATUAN[n % 10]}` : '');
  const ratus = Math.floor(n / 100);
  const sisa = n % 100;
  return (ratus === 1 ? 'Seratus' : `${SATUAN[ratus]} Ratus`) + (sisa ? ` ${terbilangRatus(sisa)}` : '');
}

function terbilang(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Nol Rupiah';
  if (n < 0) return `Minus ${terbilang(-n)}`;

  let hasil = '';
  if (n >= 1_000_000_000_000) {
    hasil += `${terbilangRatus(Math.floor(n / 1_000_000_000_000))} Triliun `;
    n %= 1_000_000_000_000;
  }
  if (n >= 1_000_000_000) {
    hasil += `${terbilangRatus(Math.floor(n / 1_000_000_000))} Miliar `;
    n %= 1_000_000_000;
  }
  if (n >= 1_000_000) {
    hasil += `${terbilangRatus(Math.floor(n / 1_000_000))} Juta `;
    n %= 1_000_000;
  }
  if (n >= 1_000) {
    const ribuan = Math.floor(n / 1_000);
    hasil += `${ribuan === 1 ? 'Seribu' : `${terbilangRatus(ribuan)} Ribu`} `;
    n %= 1_000;
  }
  if (n > 0) hasil += terbilangRatus(n);
  return `${hasil.trim()} Rupiah`;
}

const qtyTerbilang = (n) => terbilang(n).replace(/ Rupiah$/, '');
const safe = (value, fallback = '-') => value || fallback;
const num = (value) => Number(value) || 0;
const fmtRupiah = (value) => new Intl.NumberFormat('id-ID').format(Math.round(num(value)));

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtTgl(value, fallback = '........................') {
  const date = toDate(value);
  if (!date) return fallback;
  return `${String(date.getDate()).padStart(2, '0')} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

function fmtBulanTahun(value, tahun) {
  const date = toDate(value);
  if (!date) return `........................ ${tahun || ''}`.trim();
  return `${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

function noPesanan(d) {
  // Nomor Surat Pesanan kini satu nilai tunggal (disimpan di no_pesanan_b).
  return (d.no_pesanan_b || d.no_pesanan_a || '000.3.1 / ................').trim();
}

function jenisBelanja(d) {
  return d.jenis_belanja || 'Belanja Alat/Bahan untuk Kegiatan Kantor - Alat Tulis Kantor';
}

function kegiatan(d) {
  return d.uraian_kegiatan || d.master_kegiatan?.nama_sub_kegiatan || 'Alat Tulis Kantor';
}

function setupSheet(ws, {
  orientation = 'portrait',
  printArea,
  widths,
  rowHeights = {},
  printTitlesRow,
}) {
  ws.views = [{ showGridLines: false }];
  ws.properties.defaultRowHeight = 15;
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  Object.entries(rowHeights).forEach(([row, height]) => {
    ws.getRow(Number(row)).height = height;
  });
  Object.assign(ws.pageSetup, {
    paperSize: 9,
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: defaultMargins,
    horizontalCentered: false,
    verticalCentered: false,
  });
  if (printArea) ws.pageSetup.printArea = printArea;
  if (printTitlesRow) ws.pageSetup.printTitlesRow = printTitlesRow;
}

function setCell(ws, row, col, value, opts = {}) {
  const cell = ws.getCell(row, col);
  cell.value = value ?? '';
  cell.font = opts.font || font(false, opts.size || 11);
  cell.alignment = opts.align || align('left', 'middle', false);
  if (opts.border) cell.border = opts.border;
  if (opts.fill) cell.fill = opts.fill;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  return cell;
}

function mergeAndSet(ws, startRow, startCol, endRow, endCol, value, opts = {}) {
  if (startRow !== endRow || startCol !== endCol) {
    ws.mergeCells(startRow, startCol, endRow, endCol);
  }
  return setCell(ws, startRow, startCol, value, opts);
}

function forRange(ws, startRow, startCol, endRow, endCol, callback) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      callback(ws.getCell(row, col), row, col);
    }
  }
}

function borderRange(ws, startRow, startCol, endRow, endCol) {
  forRange(ws, startRow, startCol, endRow, endCol, (cell) => {
    cell.border = thinBorder;
  });
}

function headerRange(ws, startRow, startCol, endRow, endCol) {
  forRange(ws, startRow, startCol, endRow, endCol, (cell) => {
    cell.font = font(true, 10);
    cell.alignment = align('center', 'middle', true);
    cell.fill = headerFill;
    cell.border = thinBorder;
  });
}

function hideRows(ws, startRow, endRow) {
  for (let row = startRow; row <= endRow; row += 1) {
    ws.getRow(row).hidden = true;
  }
}

function pejabat(user, fallback = '..................................') {
  return safe(user?.name, fallback);
}

function nip(user) {
  return user?.nip ? `NIP. ${user.nip}` : 'NIP. ..................................';
}

function addSheetPesanan(wb, d) {
  const ws = wb.addWorksheet('Pesanan');
  setupSheet(ws, {
    printArea: 'A1:N56',
    widths: [5.1, 3.1, 2.1, 32.2, 3.6, 3.6, 5.9, 6.8, 9.2, 8.1, 10.9, 18.6, 8.8, 8.8],
    rowHeights: { 1: 15.75, 10: 12.75, 11: 31.5, 20: 13.5, 23: 3, 25: 27.75, 41: 29.25, 50: 12.75, 51: 12.75 },
  });

  mergeAndSet(ws, 1, 3, 1, 12, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 14), align: align('center') });
  mergeAndSet(ws, 2, 3, 2, 12, 'DINAS PEMBERDAYAAN MASYARAKAT DAN DESA', { font: font(true, 14), align: align('center') });
  mergeAndSet(ws, 3, 3, 3, 12, 'Jln. KSR. Dadi Kusmayadi - Kelurahan Tengah Telp. (021) 8754102', { font: font(false, 10), align: align('center') });
  mergeAndSet(ws, 4, 3, 4, 12, 'Fax : ( 021 ) 8754102 Cibinong - 16914', { font: font(false, 10), align: align('center') });

  setCell(ws, 6, 10, 'Cibinong,', { align: align('right') });
  setCell(ws, 6, 11, fmtTgl(d.tgl_pesanan));
  setCell(ws, 7, 1, 'Nomor');
  setCell(ws, 7, 3, ':');
  mergeAndSet(ws, 7, 4, 7, 8, noPesanan(d));
  setCell(ws, 8, 1, 'Lampiran');
  setCell(ws, 8, 3, ':');
  setCell(ws, 8, 4, '-');
  mergeAndSet(ws, 8, 11, 8, 12, 'K e p a d a', { align: align('center') });
  setCell(ws, 9, 1, 'Perihal');
  setCell(ws, 9, 3, ':');
  setCell(ws, 9, 4, 'Surat Pesanan', { font: font(true) });
  setCell(ws, 9, 10, 'Yth.');
  mergeAndSet(ws, 9, 11, 9, 14, safe(d.penyedia?.nama), { font: font(true) });
  mergeAndSet(ws, 10, 11, 11, 12, safe(d.penyedia?.alamat), { align: align('left', 'top', true), size: 10 });
  setCell(ws, 13, 11, 'di -');
  setCell(ws, 14, 11, 'Bogor', { font: font(true) });

  mergeAndSet(
    ws,
    16,
    1,
    18,
    12,
    `Untuk kepentingan Dinas Pemberdayaan Masyarakat dan Desa Kabupaten Bogor, agar dilaksanakan pekerjaan ${jenisBelanja(d)} Kegiatan ${kegiatan(d)} kebutuhan DPMD Kabupaten Bogor Tahun Anggaran ${d.tahun_anggaran || ''} dengan rincian sebagai berikut :`,
    { align: align('left', 'top', true) },
  );

  mergeAndSet(ws, 20, 1, 21, 1, 'No');
  mergeAndSet(ws, 20, 2, 21, 4, 'Nama Barang');
  mergeAndSet(ws, 20, 5, 20, 8, 'Banyaknya');
  mergeAndSet(ws, 21, 5, 21, 6, 'Jumlah');
  mergeAndSet(ws, 21, 7, 21, 8, 'Satuan');
  mergeAndSet(ws, 20, 9, 21, 9, 'Harga Satuan');
  mergeAndSet(ws, 20, 10, 21, 10, 'PPN');
  mergeAndSet(ws, 20, 11, 21, 11, 'Jumlah');
  mergeAndSet(ws, 20, 12, 21, 12, 'Ket');
  headerRange(ws, 20, 1, 21, 12);

  const items = d.items || [];
  mergeAndSet(ws, 25, 2, 25, 11, jenisBelanja(d), { font: font(true, 10), align: align('left', 'top', true) });
  setCell(ws, 25, 1, 'I.', { font: font(true, 10), align: align('center') });
  mergeAndSet(ws, 26, 12, 36, 12, 'Harga Sudah Termasuk Pajak yang timbul', { size: 9, align: align('center', 'middle', true) });
  for (let row = 26; row <= 36; row += 1) {
    mergeAndSet(ws, row, 2, row, 4, '');
  }
  items.slice(0, 11).forEach((item, index) => {
    const row = 26 + index;
    setCell(ws, row, 1, index + 1, { align: align('center'), size: 10 });
    setCell(ws, row, 2, item.nama_barang, { size: 10 });
    setCell(ws, row, 6, num(item.qty), { align: align('center'), size: 10 });
    setCell(ws, row, 7, item.satuan, { align: align('center'), size: 10 });
    setCell(ws, row, 9, num(item.harga_satuan), { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 10, num(item.ppn) > 0 ? num(item.ppn) : '', { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 11, num(item.total), { align: align('right'), size: 10, numFmt: '#,##0' });
  });
  borderRange(ws, 25, 1, 37, 12);
  mergeAndSet(ws, 37, 1, 37, 9, 'JUMLAH TOTAL', { font: font(true, 10), align: align('center') });
  setCell(ws, 37, 11, num(d.total_nilai), { font: font(true, 10), align: align('right'), numFmt: '#,##0' });

  mergeAndSet(ws, 41, 3, 41, 12, `Terbilang : ${terbilang(d.total_nilai)}`, { align: align('left', 'top', true) });
  mergeAndSet(ws, 42, 3, 44, 12, `II. KETENTUAN DAN SYARAT-SYARAT\n1. Pekerjaan tersebut merupakan kegiatan Dinas Pemberdayaan Masyarakat dan Desa Kabupaten Bogor Tahun Anggaran ${d.tahun_anggaran || ''}.\n2. Cara pembayaran ditransfer ke rekening ${safe(d.penyedia?.nama)} No. Rek ${safe(d.penyedia?.no_rekening)} pada ${safe(d.penyedia?.nama_bank)} setelah pekerjaan selesai dan dibuktikan dengan Berita Acara Serah Terima Hasil Pekerjaan.`, { align: align('left', 'top', true) });
  mergeAndSet(ws, 45, 3, 45, 12, `3. Kode Rekening Kegiatan : ${safe(items[0]?.kode_rekening)}`);
  mergeAndSet(ws, 47, 1, 47, 12, 'Demikian agar dilaksanakan dengan sebaik-baiknya.');

  mergeAndSet(ws, 50, 9, 50, 12, 'Pejabat Pembuat Komitmen', { align: align('center') });
  mergeAndSet(ws, 55, 9, 55, 12, pejabat(d.ppk), { font: font(true), align: align('center') });
  mergeAndSet(ws, 56, 9, 56, 12, nip(d.ppk), { align: align('center') });
}

function addSheetFaktur(wb, d) {
  const ws = wb.addWorksheet('Faktur');
  setupSheet(ws, {
    orientation: 'landscape',
    printArea: 'A8:P105',
    widths: [5.1, 6.1, 9.1, 4.8, 1.9, 1.2, 0.6, 26.4, 3.6, 3.5, 3.5, 28.1, 14.6, 13.6, 13.8, 8.8],
    rowHeights: { 10: 15, 11: 2.1, 12: 15, 13: 2.1, 14: 13, 15: 13, 16: 15, 17: 15, 18: 15.75, 19: 6, 20: 18.75, 21: 18.75, 22: 5.1 },
  });

  mergeAndSet(ws, 10, 13, 10, 15, `Bogor, ${fmtBulanTahun(d.tgl_faktur, d.tahun_anggaran)}`, { align: align('center') });
  mergeAndSet(ws, 12, 13, 12, 15, 'Kepada Yth.', { align: align('center') });
  mergeAndSet(ws, 14, 13, 14, 15, 'PEMERINTAH DAERAH', { font: font(true), align: align('center') });
  mergeAndSet(ws, 15, 13, 15, 15, 'KABUPATEN BOGOR', { font: font(true), align: align('center') });
  mergeAndSet(ws, 16, 13, 16, 15, 'di -', { align: align('center') });
  mergeAndSet(ws, 17, 13, 17, 15, 'CIBINONG', { font: font(true), align: align('center') });
  setCell(ws, 18, 2, 'FAKTUR NO. :', { font: font(true) });
  mergeAndSet(ws, 18, 4, 18, 8, safe(d.no_faktur));

  mergeAndSet(ws, 20, 2, 21, 2, 'No');
  mergeAndSet(ws, 20, 3, 21, 7, 'Banyaknya');
  mergeAndSet(ws, 20, 8, 21, 8, 'Jenis Barang/Jasa');
  mergeAndSet(ws, 20, 9, 21, 12, 'Uraian Pekerjaan');
  setCell(ws, 20, 13, 'Harga Satuan');
  setCell(ws, 20, 14, 'PPN');
  setCell(ws, 20, 15, 'Jumlah');
  setCell(ws, 21, 13, '(Rp)');
  setCell(ws, 21, 14, '(Rp)');
  setCell(ws, 21, 15, '(Rp)');
  headerRange(ws, 20, 2, 21, 15);

  const items = d.items || [];
  const endRow = 77;
  mergeAndSet(ws, 24, 8, endRow, 8, jenisBelanja(d), { font: font(true, 10), align: align('left', 'top', true) });
  for (let row = 24; row <= endRow; row += 1) {
    mergeAndSet(ws, row, 9, row, 12, '');
  }
  items.slice(0, endRow - 23).forEach((item, index) => {
    const row = 24 + index;
    setCell(ws, row, 2, index + 1, { align: align('center'), size: 10 });
    setCell(ws, row, 3, num(item.qty), { align: align('center'), size: 10 });
    setCell(ws, row, 4, item.satuan, { align: align('center'), size: 10 });
    setCell(ws, row, 9, item.nama_barang, { size: 10 });
    setCell(ws, row, 13, num(item.harga_satuan), { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 14, num(item.ppn) > 0 ? num(item.ppn) : '', { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 15, num(item.total), { align: align('right'), size: 10, numFmt: '#,##0' });
  });
  borderRange(ws, 24, 2, endRow, 15);
  hideRows(ws, Math.max(41, 24 + items.length + 10), endRow);

  mergeAndSet(ws, 80, 2, 80, 14, 'JUMLAH', { font: font(true, 10), align: align('right') });
  setCell(ws, 80, 15, num(d.total_nilai), { font: font(true, 10), align: align('right'), numFmt: '#,##0' });
  borderRange(ws, 80, 2, 80, 15);
  setCell(ws, 82, 2, 'Terbilang :');
  mergeAndSet(ws, 82, 4, 82, 15, `( ${terbilang(d.total_nilai)} )`, { font: font(true), align: align('left', 'middle', true) });

  mergeAndSet(ws, 84, 13, 84, 15, 'HORMAT KAMI,', { font: font(true), align: align('center') });
  setCell(ws, 85, 4, 'Yang Menerima,', { align: align('center') });
  mergeAndSet(ws, 85, 13, 85, 15, safe(d.penyedia?.nama), { font: font(true), align: align('center') });
  setCell(ws, 91, 4, pejabat(d.penerima_faktur || d.bendahara), { font: font(true), align: align('center') });
  mergeAndSet(ws, 91, 13, 91, 15, safe(d.penyedia?.nama_direktur), { font: font(true), align: align('center') });
  setCell(ws, 92, 4, nip(d.penerima_faktur || d.bendahara), { align: align('center') });
  mergeAndSet(ws, 92, 13, 92, 15, d.penyedia?.jabatan_direktur || 'Direktur', { align: align('center') });
  mergeAndSet(ws, 93, 2, 93, 15, 'Mengetahui / Menyetujui :');
  setCell(ws, 95, 4, 'Pejabat Pelaksana Teknis Kegiatan', { align: align('center') });
  setCell(ws, 95, 12, 'Pejabat Pembuat Komitmen', { align: align('center') });
  setCell(ws, 101, 4, pejabat(d.pptk), { font: font(true), align: align('center') });
  setCell(ws, 102, 4, nip(d.pptk), { align: align('center') });
  setCell(ws, 101, 12, pejabat(d.ppk), { font: font(true), align: align('center') });
  setCell(ws, 102, 12, nip(d.ppk), { align: align('center') });
}

function addSheetKwitansi(wb, d) {
  const ws = wb.addWorksheet('Kwitansi');
  setupSheet(ws, {
    orientation: 'landscape',
    printArea: 'B13:N41',
    widths: [3.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 10, 8.6, 8.4, 8.4, 8.4],
    rowHeights: { 36: 20.25 },
  });

  setCell(ws, 14, 3, 'KWITANSI', { font: font(true, 12) });
  setCell(ws, 14, 7, ':');
  mergeAndSet(ws, 14, 8, 14, 10, d.no_kwitansi || '........................................');
  mergeAndSet(ws, 14, 12, 14, 14, 'Kuasa Pengguna Anggaran', { align: align('center') });
  setCell(ws, 16, 3, 'NOMOR', { font: font(true, 12) });
  setCell(ws, 16, 7, ':');
  mergeAndSet(ws, 16, 8, 16, 10, d.no_kwitansi || '........................................');
  mergeAndSet(ws, 18, 12, 18, 14, pejabat(d.kpa), { font: font(true), align: align('center') });
  mergeAndSet(ws, 19, 12, 19, 14, nip(d.kpa), { align: align('center') });

  setCell(ws, 19, 3, 'Sudah diterima dari');
  setCell(ws, 19, 7, ':');
  mergeAndSet(ws, 19, 8, 19, 10, 'Pemerintah Kabupaten Bogor', { font: font(true) });
  setCell(ws, 21, 3, 'Uang sebesar');
  setCell(ws, 21, 7, ':');
  mergeAndSet(ws, 21, 8, 21, 14, `#${terbilang(d.total_nilai)}#`, { font: font(true), align: align('left', 'middle', true) });
  setCell(ws, 23, 3, 'Untuk pembayaran');
  setCell(ws, 23, 7, ':');
  mergeAndSet(ws, 23, 8, 23, 14, kegiatan(d), { align: align('left', 'middle', true) });
  setCell(ws, 24, 8, `Bulan ${fmtBulanTahun(d.tgl_kwitansi, d.tahun_anggaran)}`);

  setCell(ws, 27, 3, 'Mengetahui/menyetujui,', { align: align('center') });
  setCell(ws, 27, 8, 'Lunas', { align: align('center') });
  mergeAndSet(ws, 27, 12, 27, 14, `Cibinong, ${fmtTgl(d.tgl_kwitansi)}`, { align: align('center') });
  mergeAndSet(ws, 28, 3, 28, 6, 'Pejabat Pelaksana Teknis Kegiatan', { align: align('center') });
  mergeAndSet(ws, 28, 8, 28, 10, 'Bendahara Pengeluaran Pembantu', { align: align('center') });
  mergeAndSet(ws, 28, 12, 28, 14, 'Yang menerima', { align: align('center') });
  mergeAndSet(ws, 33, 3, 33, 6, pejabat(d.pptk), { font: font(true), align: align('center') });
  mergeAndSet(ws, 34, 3, 34, 6, nip(d.pptk), { align: align('center') });
  mergeAndSet(ws, 34, 8, 34, 10, pejabat(d.bendahara), { font: font(true), align: align('center') });
  mergeAndSet(ws, 35, 8, 35, 10, nip(d.bendahara), { align: align('center') });
  mergeAndSet(ws, 33, 12, 33, 14, safe(d.penyedia?.nama_direktur), { font: font(true), align: align('center') });
  mergeAndSet(ws, 34, 12, 34, 14, d.penyedia?.jabatan_direktur || 'Direktur', { align: align('center') });

  setCell(ws, 36, 3, 'Jumlah', { font: font(true) });
  setCell(ws, 36, 5, 'Rp.', { align: align('center') });
  mergeAndSet(ws, 36, 6, 36, 8, `${fmtRupiah(d.total_nilai)},-`, { font: font(true), align: align('right') });
  borderRange(ws, 36, 3, 36, 8);
}

function addSheetBAPemeriksaan(wb, d) {
  const ws = wb.addWorksheet('BA Pemeriksaan');
  setupSheet(ws, {
    printArea: 'A1:U47',
    widths: [3.1, 6.7, 7, 2.4, 10.4, 9.9, 1.7, 5.7, 8.9, 13.3, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4],
    rowHeights: { 9: 15.75, 21: 15.75, 30: 15.75, 36: 16.5, 37: 16.5, 39: 15, 41: 15 },
  });

  mergeAndSet(ws, 1, 1, 1, 8, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 12) });
  mergeAndSet(ws, 1, 10, 1, 12, 'Model : Peng 2', { align: align('right') });
  mergeAndSet(ws, 4, 1, 4, 12, 'BERITA ACARA', { font: font(true, 12), align: align('center') });
  mergeAndSet(ws, 5, 1, 5, 12, 'PEMERIKSAAN / PENERIMAAN HASIL PEKERJAAN BARANG/JASA', { font: font(true), align: align('center') });
  mergeAndSet(ws, 6, 1, 6, 12, `Nomor : ${safe(d.no_ba_pemeriksaan)}`, { align: align('center') });
  mergeAndSet(ws, 9, 1, 10, 12, `Pada hari ini tanggal ${fmtTgl(d.tgl_ba_pemeriksaan)}, kami yang bertanda tangan di bawah ini:`, { align: align('left', 'top', true) });

  const pemeriksa = d.pemeriksa || [];
  [0, 1, 2].forEach((idx) => {
    const row = 12 + idx * 3;
    const p = pemeriksa[idx];
    setCell(ws, row, 4, `${idx + 1}.`);
    setCell(ws, row, 5, 'Nama');
    setCell(ws, row, 6, `: ${safe(p?.user?.name, '..................................')}`, { font: font(true) });
    setCell(ws, row + 1, 5, 'NIP');
    setCell(ws, row + 1, 6, `: ${safe(p?.user?.nip, '..................................')}`);
  });

  mergeAndSet(ws, 21, 1, 25, 12, `Berdasarkan Surat Perintah Tugas dari Pejabat Pembuat Komitmen pada Sekretariat Dinas Pemberdayaan Masyarakat dan Desa Nomor : ${safe(d.no_surat_perintah_tugas)} tanggal ${fmtTgl(d.tgl_surat_perintah_tugas)}, kami selaku Pemeriksa Hasil Pekerjaan Barang/Jasa dengan teliti telah memeriksa hasil pekerjaan terhadap barang-barang yang diadakan sebagaimana daftar terlampir yang diserahkan oleh ${safe(d.penyedia?.nama)} berdasarkan Surat Pesanan Nomor ${noPesanan(d)} tanggal ${fmtTgl(d.tgl_pesanan)}, menyimpulkan sebagai berikut:`, { align: align('left', 'top', true) });
  setCell(ws, 27, 1, 'a.');
  mergeAndSet(ws, 27, 2, 27, 12, 'Terdapat baik sesuai Pesanan/SPK/Kontrak');
  setCell(ws, 28, 1, 'b.');
  mergeAndSet(ws, 28, 2, 28, 12, 'Kurang/Tidak baik (daftar terlampir).');
  mergeAndSet(ws, 30, 1, 31, 12, 'Pekerjaan yang terdapat baik kami beri tanda (v) yang selanjutnya akan diserahkan kepada Bendahara/Pengurus Barang.', { align: align('left', 'top', true) });
  mergeAndSet(ws, 33, 1, 34, 12, 'Demikian Berita Acara dibuat dalam rangkap 6 (enam) untuk dapat dipergunakan sebagaimana mestinya.', { align: align('left', 'top', true) });

  mergeAndSet(ws, 36, 7, 37, 12, 'PEMERIKSA HASIL PEKERJAAN BARANG/JASA :', { font: font(true), align: align('center') });
  mergeAndSet(ws, 38, 3, 38, 5, 'Penyedia Barang/Jasa', { align: align('center') });
  mergeAndSet(ws, 39, 3, 39, 5, safe(d.penyedia?.nama), { align: align('center') });
  [0, 1, 2].forEach((idx) => {
    const row = 39 + idx * 3;
    const p = pemeriksa[idx];
    setCell(ws, row, 7, `${idx + 1}.`);
    mergeAndSet(ws, row, 8, row, 11, safe(p?.user?.name, '..................................'), { font: font(true) });
    mergeAndSet(ws, row + 1, 8, row + 1, 11, `NIP. ${safe(p?.user?.nip, '..................................')}`);
    setCell(ws, row + 2, 8, 'Tanda Tangan');
    setCell(ws, row + 2, 10, '........................');
  });
  mergeAndSet(ws, 45, 3, 45, 5, safe(d.penyedia?.nama_direktur), { font: font(true), align: align('center') });
  mergeAndSet(ws, 46, 3, 46, 5, d.penyedia?.jabatan_direktur || 'Direktur', { align: align('center') });
}

function addSheetLampPemeriksaan(wb, d) {
  const ws = wb.addWorksheet('Lamp Pemeriksaan');
  setupSheet(ws, {
    printArea: 'A1:K75',
    widths: [4.7, 21.7, 2.4, 32.9, 3.4, 5.7, 7.3, 10.6, 22.7, 8.4, 8.4],
    rowHeights: { 6: 3, 7: 27.75, 8: 15, 9: 15, 10: 15 },
  });

  mergeAndSet(ws, 1, 1, 1, 8, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 12) });
  setCell(ws, 1, 9, 'Lamp. Model : Peng 2', { align: align('right') });
  mergeAndSet(ws, 3, 1, 3, 9, 'LAMPIRAN BERITA ACARA PEMERIKSAAN/PENERIMAAN HASIL PEKERJAAN BARANG/JASA', { font: font(true), align: align('center') });
  mergeAndSet(ws, 4, 1, 4, 9, `Nomor : ${safe(d.no_ba_pemeriksaan)}`, { align: align('center') });
  mergeAndSet(ws, 5, 1, 5, 9, `Tanggal : ${fmtTgl(d.tgl_ba_pemeriksaan)}`, { align: align('center') });

  mergeAndSet(ws, 7, 1, 8, 1, 'No.');
  mergeAndSet(ws, 7, 2, 8, 2, 'Uraian Pekerjaan / Barang');
  mergeAndSet(ws, 7, 3, 8, 5, 'Spesifikasi');
  mergeAndSet(ws, 7, 6, 8, 7, 'Banyaknya');
  mergeAndSet(ws, 7, 8, 7, 9, 'Keterangan');
  setCell(ws, 8, 8, 'baik');
  setCell(ws, 8, 9, 'kurang baik');
  headerRange(ws, 7, 1, 8, 9);

  const items = d.items || [];
  setCell(ws, 10, 1, '1', { align: align('center'), font: font(true, 10) });
  mergeAndSet(ws, 10, 2, 10, 5, 'Belanja ATK', { font: font(true, 10) });
  borderRange(ws, 10, 1, 49, 9);
  items.slice(0, 39).forEach((item, index) => {
    const row = 11 + index;
    setCell(ws, row, 4, item.nama_barang, { size: 10 });
    setCell(ws, row, 6, num(item.qty), { align: align('center'), size: 10 });
    setCell(ws, row, 7, item.satuan, { align: align('center'), size: 10 });
    setCell(ws, row, 8, 'v', { align: align('center'), size: 10 });
  });
  hideRows(ws, 11 + items.length + 1, 49);

  mergeAndSet(ws, 63, 4, 63, 9, 'PEMERIKSA/PENERIMA HASIL PEKERJAAN BARANG/JASA :', { font: font(true), align: align('center') });
  setCell(ws, 64, 2, 'Penyedia Barang/Jasa', { align: align('center') });
  setCell(ws, 65, 2, safe(d.penyedia?.nama), { align: align('center') });
  const pemeriksa = d.pemeriksa || [];
  [0, 1, 2].forEach((idx) => {
    const row = 65 + idx * 4;
    const p = pemeriksa[idx];
    setCell(ws, row, 4, `${idx + 1}. Nama`);
    setCell(ws, row, 5, ':');
    mergeAndSet(ws, row, 6, row, 9, safe(p?.user?.name, '..................................'), { font: font(true) });
    mergeAndSet(ws, row + 1, 6, row + 1, 9, `NIP. ${safe(p?.user?.nip, '..................................')}`);
    setCell(ws, row + 2, 6, 'Tanda Tangan');
    setCell(ws, row + 2, 9, '........................');
  });
  setCell(ws, 70, 2, safe(d.penyedia?.nama_direktur), { font: font(true), align: align('center') });
  setCell(ws, 71, 2, d.penyedia?.jabatan_direktur || 'Direktur', { align: align('center') });
}

function addSheetBast(wb, d) {
  const ws = wb.addWorksheet('BAST');
  setupSheet(ws, {
    printArea: 'A1:K44',
    widths: [3.1, 2.7, 12.6, 3.1, 11.4, 9.1, 5.7, 8.9, 13.3, 8.4, 6],
    rowHeights: { 7: 15.75, 8: 15.75, 12: 15, 13: 49.5, 18: 15, 28: 59.25, 30: 15, 34: 16.5, 36: 15, 38: 15 },
  });

  mergeAndSet(ws, 1, 1, 1, 11, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 12) });
  mergeAndSet(ws, 2, 1, 2, 11, 'DINAS PEMBERDAYAAN MASYARAKAT DAN DESA');
  mergeAndSet(ws, 4, 1, 4, 11, 'BERITA ACARA SERAH TERIMA PEKERJAAN BARANG', { font: font(true, 12), align: align('center') });
  mergeAndSet(ws, 5, 1, 5, 11, `Nomor : ${safe(d.no_bast)}`, { align: align('center') });
  mergeAndSet(ws, 7, 1, 10, 11, `Menunjuk pada Peraturan Presiden Nomor 46 Tahun 2025 tentang Perubahan kedua atas Peraturan Presiden Nomor 16 Tahun 2018 Tentang Pengadaan Barang/Jasa Pemerintah, pada hari ini ${fmtTgl(d.tgl_bast)}, yang bertanda tangan di bawah ini:`, { align: align('left', 'top', true) });

  setCell(ws, 12, 2, '1.');
  mergeAndSet(ws, 12, 3, 13, 11, `Pejabat Pembuat Komitmen (PPK) sesuai dengan Surat Keputusan Kepala Dinas Nomor : ${safe(d.no_sk_kadis_ppk)} Tentang Penunjukan PPK Tahun ${d.tahun_anggaran || ''}.`, { font: font(true), align: align('left', 'top', true) });
  setCell(ws, 15, 3, 'Nama');
  setCell(ws, 15, 4, ':');
  mergeAndSet(ws, 15, 5, 15, 10, pejabat(d.ppk), { font: font(true) });
  setCell(ws, 16, 3, 'Jabatan');
  setCell(ws, 16, 4, ':');
  mergeAndSet(ws, 16, 5, 16, 10, 'Pejabat Pembuat Komitmen (PPK)');
  setCell(ws, 18, 2, '2.');
  mergeAndSet(ws, 18, 3, 19, 11, `Penyedia Barang dan Jasa sesuai dengan Surat Pesanan Nomor : ${noPesanan(d)}.`, { align: align('left', 'top', true) });
  setCell(ws, 21, 3, 'Nama');
  setCell(ws, 21, 4, ':');
  mergeAndSet(ws, 21, 5, 21, 10, safe(d.penyedia?.nama_direktur), { font: font(true) });
  setCell(ws, 22, 3, 'Jabatan');
  setCell(ws, 22, 4, ':');
  mergeAndSet(ws, 22, 5, 22, 10, d.penyedia?.jabatan_direktur || 'Direktur');

  mergeAndSet(ws, 24, 1, 28, 11, `Berdasarkan hasil Berita Acara Pemeriksaan/Penerimaan Hasil pekerjaan/barang Nomor : ${safe(d.no_ba_pemeriksaan)} ${jenisBelanja(d)} Kegiatan ${kegiatan(d)} sebesar Rp ${fmtRupiah(d.total_nilai)},- (${terbilang(d.total_nilai)}) pada Dinas Pemberdayaan Masyarakat dan Desa Kabupaten Bogor dengan hasil DITERIMA sesuai dengan ketentuan yang termuat dalam Surat Pesanan dengan Penyedia Jasa.`, { align: align('left', 'top', true) });
  mergeAndSet(ws, 30, 1, 30, 11, 'Berita Acara ini dilampiri dengan Lampiran Berita Acara Pemeriksaan dan Penerimaan Barang.');
  mergeAndSet(ws, 32, 1, 33, 11, 'Demikian Berita Acara Penyerahan ini dibuat dengan penuh tanggung jawab');
  mergeAndSet(ws, 35, 1, 35, 5, 'Pihak Ketiga', { align: align('center') });
  mergeAndSet(ws, 35, 9, 35, 11, 'Pejabat Pembuat Komitmen (PPK)', { align: align('center') });
  mergeAndSet(ws, 36, 1, 36, 5, safe(d.penyedia?.nama), { align: align('center') });
  mergeAndSet(ws, 41, 1, 41, 5, safe(d.penyedia?.nama_direktur), { font: font(true), align: align('center') });
  mergeAndSet(ws, 42, 1, 42, 5, d.penyedia?.jabatan_direktur || 'Direktur', { align: align('center') });
  mergeAndSet(ws, 41, 9, 41, 11, pejabat(d.ppk), { font: font(true), align: align('center') });
  mergeAndSet(ws, 42, 9, 42, 11, nip(d.ppk), { align: align('center') });
}

function addSheetLampiranBast(wb, d) {
  const ws = wb.addWorksheet('Lampiran');
  setupSheet(ws, {
    printArea: 'A1:P144',
    widths: [4.7, 24, 3.7, 34.7, 8, 8.9, 15, 4, 11, 14.3, 14.7, 8.4, 8.4, 8.4, 8.4, 16.3],
    rowHeights: { 9: 3, 10: 44.25, 11: 22.5, 12: 15, 13: 15, 14: 15, 15: 15, 16: 15, 17: 18 },
  });

  mergeAndSet(ws, 1, 1, 1, 11, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 12) });
  mergeAndSet(ws, 2, 1, 2, 11, 'DINAS PEMBERDAYAAN MASYARAKAT DAN DESA');
  mergeAndSet(ws, 5, 1, 5, 11, 'LAMPIRAN BERITA ACARA SERAH TERIMA BARANG', { font: font(true), align: align('center') });
  mergeAndSet(ws, 6, 1, 6, 11, '(KHUSUS POLA GANTI UANG)', { font: font(true), align: align('center') });
  mergeAndSet(ws, 7, 1, 7, 11, `Nomor : ${safe(d.no_bast)}`, { align: align('center') });

  mergeAndSet(ws, 10, 1, 11, 1, 'No.');
  mergeAndSet(ws, 10, 2, 11, 4, 'Jenis Barang');
  mergeAndSet(ws, 10, 5, 10, 6, 'Banyaknya');
  setCell(ws, 11, 5, 'Jumlah');
  setCell(ws, 11, 6, 'Satuan');
  setCell(ws, 10, 7, 'Harga Satuan');
  setCell(ws, 11, 7, '(Rp)');
  setCell(ws, 10, 8, 'PPN');
  setCell(ws, 11, 8, '(Rp)');
  setCell(ws, 10, 10, 'Jumlah');
  setCell(ws, 11, 10, '(Rp)');
  setCell(ws, 10, 11, 'Keterangan');
  headerRange(ws, 10, 1, 11, 11);

  const items = d.items || [];
  for (let row = 17; row <= 91; row += 1) {
    mergeAndSet(ws, row, 2, row, 4, '');
  }
  items.slice(0, 75).forEach((item, index) => {
    const row = 17 + index;
    setCell(ws, row, 1, index + 1, { align: align('center'), size: 10 });
    setCell(ws, row, 2, item.nama_barang, { size: 10 });
    setCell(ws, row, 5, num(item.qty), { align: align('center'), size: 10 });
    setCell(ws, row, 6, item.satuan, { align: align('center'), size: 10 });
    setCell(ws, row, 7, num(item.harga_satuan), { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 8, num(item.ppn) > 0 ? num(item.ppn) : '', { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 10, num(item.total), { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 11, 'Baik/Tidak', { align: align('center'), size: 10 });
  });
  borderRange(ws, 10, 1, 91, 11);
  hideRows(ws, 17 + items.length + 2, 91);

  mergeAndSet(ws, 97, 7, 97, 11, `Cibinong, ${fmtTgl(d.tgl_bast)}`, { align: align('center') });
  mergeAndSet(ws, 98, 2, 98, 4, 'Pihak Ketiga', { align: align('center') });
  mergeAndSet(ws, 98, 7, 98, 11, 'Pejabat Pembuat Komitmen (PPK)', { align: align('center') });
  mergeAndSet(ws, 99, 2, 99, 4, safe(d.penyedia?.nama), { align: align('center') });
  mergeAndSet(ws, 104, 2, 104, 4, safe(d.penyedia?.nama_direktur), { font: font(true), align: align('center') });
  mergeAndSet(ws, 105, 2, 105, 4, d.penyedia?.jabatan_direktur || 'Direktur', { align: align('center') });
  mergeAndSet(ws, 104, 7, 104, 11, pejabat(d.ppk), { font: font(true), align: align('center') });
  mergeAndSet(ws, 105, 7, 105, 11, nip(d.ppk), { align: align('center') });
}

function addSheetBasthp(wb, d) {
  const ws = wb.addWorksheet('BASTHP');
  setupSheet(ws, {
    printArea: 'A2:S53',
    widths: [3.1, 8.4, 12.7, 12, 8.3, 6.9, 5.1, 4.9, 6.6, 13.1, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4, 8.4],
    rowHeights: { 11: 15.75, 16: 17.25, 18: 16.5, 23: 15, 25: 15.75, 27: 15.75 },
  });
  hideRows(ws, 7, 9);

  mergeAndSet(ws, 2, 1, 2, 8, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 12) });
  mergeAndSet(ws, 2, 10, 2, 10, 'Model Peng : 3', { align: align('right') });
  mergeAndSet(ws, 5, 1, 5, 10, 'BERITA ACARA SERAH TERIMA HASIL PEKERJAAN BARANG/JASA', { font: font(true), align: align('center') });
  mergeAndSet(ws, 6, 1, 6, 10, `Nomor : ${safe(d.no_basthp)}`, { align: align('center') });
  mergeAndSet(ws, 11, 1, 12, 10, `Pada hari ini tanggal ${fmtTgl(d.tgl_basthp)}, kami yang bertanda tangan di bawah ini:`, { align: align('left', 'top', true) });
  setCell(ws, 14, 3, 'Nama');
  setCell(ws, 14, 4, `: ${pejabat(d.pengurus_barang)}`);
  setCell(ws, 15, 3, 'NIP');
  setCell(ws, 15, 4, `: ${safe(d.pengurus_barang?.nip, '..................................')}`);
  setCell(ws, 16, 3, 'Jabatan');
  setCell(ws, 16, 4, ': Penyimpan/Pengurus Barang');
  mergeAndSet(ws, 18, 1, 23, 10, `Berdasarkan ketentuan pengadaan barang/jasa pemerintah, telah menerima hasil pekerjaan ${jenisBelanja(d)} untuk kegiatan ${kegiatan(d)} dari Pejabat Pemeriksa/Penerima Hasil Pekerjaan dengan nilai sebesar Rp ${fmtRupiah(d.total_nilai)},- (${terbilang(d.total_nilai)}).`, { align: align('left', 'top', true) });
  mergeAndSet(ws, 25, 1, 26, 10, 'Demikian Berita Acara dibuat dalam rangkap 3 (tiga) untuk dapat dipergunakan sebagaimana mestinya.', { align: align('left', 'top', true) });

  mergeAndSet(ws, 28, 3, 28, 5, 'Yang Menyerahkan,', { align: align('center') });
  mergeAndSet(ws, 28, 9, 28, 10, 'Yang Menerima,', { align: align('center') });
  mergeAndSet(ws, 29, 3, 29, 5, 'Panitia Penerima/Pemeriksa Hasil Pekerjaan', { align: align('center') });
  mergeAndSet(ws, 29, 9, 29, 10, 'Pengurus Barang', { align: align('center') });
  const pemeriksa = d.pemeriksa || [];
  [0, 1, 2].forEach((idx) => {
    const row = 31 + idx * 4;
    const p = pemeriksa[idx];
    setCell(ws, row, 1, `${idx + 1}.`);
    setCell(ws, row, 2, safe(p?.user?.name, '..................................'));
    setCell(ws, row + 1, 2, `NIP. ${safe(p?.user?.nip, '..................................')}`);
    setCell(ws, row + 2, 2, idx === 0 ? 'Ketua' : 'Anggota');
    setCell(ws, row + 2, 4, '................');
  });
  mergeAndSet(ws, 34, 9, 34, 10, pejabat(d.pengurus_barang), { font: font(true), align: align('center') });
  mergeAndSet(ws, 35, 9, 35, 10, nip(d.pengurus_barang), { align: align('center') });
  mergeAndSet(ws, 44, 1, 44, 10, 'Mengetahui / Menyetujui :');
  mergeAndSet(ws, 45, 1, 45, 10, 'Pejabat Pelaksana Teknis Kegiatan');
  mergeAndSet(ws, 50, 1, 50, 10, pejabat(d.pptk), { font: font(true), align: align('center') });
  mergeAndSet(ws, 51, 1, 51, 10, nip(d.pptk), { align: align('center') });
}

function addSheetBend35(wb, d) {
  const ws = wb.addWorksheet('Bend 35');
  setupSheet(ws, {
    printArea: 'B1:K45',
    widths: [2, 7, 17.6, 17.9, 14.1, 7.4, 7.4, 7.7, 19.3, 9.9, 2.9],
    rowHeights: { 1: 15, 2: 15, 3: 15, 4: 10, 5: 18, 6: 12.75, 7: 15, 8: 15, 9: 15, 10: 6.75, 11: 18, 12: 18, 13: 3 },
    printTitlesRow: '11:12',
  });

  mergeAndSet(ws, 1, 2, 1, 5, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 12) });
  mergeAndSet(ws, 1, 9, 1, 10, 'Model : Bend 35', { align: align('right') });
  mergeAndSet(ws, 2, 2, 2, 6, 'PERINTAH PENERIMAAN / PENGELUARAN', { font: font(true), align: align('center') });
  mergeAndSet(ws, 3, 2, 3, 5, 'DAERAH / UNIT DPMD', { align: align('center') });
  mergeAndSet(ws, 5, 2, 5, 10, 'PERINTAH PENERIMAAN / PENGELUARAN', { font: font(true, 12), align: align('center') });
  mergeAndSet(ws, 7, 2, 7, 10, 'Kepada Bendaharawan Umum Barang pada Gudang : DPMD Kab. Bogor');
  mergeAndSet(ws, 8, 2, 8, 10, `diperintah untuk menerima / mengeluarkan dari / kepada : ${safe(d.penyedia?.nama)}`);
  mergeAndSet(ws, 9, 2, 9, 10, 'barang sebagai berikut :');

  mergeAndSet(ws, 11, 2, 12, 2, 'Nomor');
  mergeAndSet(ws, 11, 3, 12, 5, 'Nama dan Kode Barang');
  mergeAndSet(ws, 11, 6, 11, 9, 'Banyaknya');
  mergeAndSet(ws, 11, 10, 12, 10, 'Ket');
  setCell(ws, 12, 6, 'Satuan');
  setCell(ws, 12, 7, 'Angka');
  setCell(ws, 12, 8, 'Huruf');
  headerRange(ws, 11, 2, 12, 10);

  const items = d.items || [];
  borderRange(ws, 17, 2, 31, 10);
  items.slice(0, 15).forEach((item, index) => {
    const row = 17 + index;
    setCell(ws, row, 2, index + 1, { align: align('center'), size: 10 });
    mergeAndSet(ws, row, 3, row, 5, item.nama_barang, { size: 10 });
    setCell(ws, row, 6, item.satuan, { align: align('center'), size: 10 });
    setCell(ws, row, 7, num(item.qty), { align: align('center'), size: 10 });
    mergeAndSet(ws, row, 8, row, 9, qtyTerbilang(item.qty), { size: 10 });
  });

  mergeAndSet(ws, 34, 6, 34, 10, `Cibinong, .............................. ${d.tahun_anggaran || ''}`, { align: align('center') });
  mergeAndSet(ws, 35, 6, 35, 10, 'A.n. Ordonatur/Kuasa Pengguna Barang', { align: align('center') });
  mergeAndSet(ws, 36, 6, 36, 10, 'Atasan Langsung Pengurus Barang', { align: align('center') });
  mergeAndSet(ws, 43, 6, 43, 10, pejabat(d.atasan_pengurus_barang), { font: font(true), align: align('center') });
  mergeAndSet(ws, 44, 6, 44, 10, safe(d.atasan_pengurus_barang?.jabatan, 'Pembina'), { align: align('center') });
  mergeAndSet(ws, 45, 6, 45, 10, nip(d.atasan_pengurus_barang), { align: align('center') });
}

function addSheetBend29(wb, d) {
  const ws = wb.addWorksheet('Bend 29');
  setupSheet(ws, {
    printArea: 'B1:M54',
    widths: [10.1, 15.4, 10.7, 21.6, 4.3, 9.6, 8.9, 7.1, 6.3, 6, 12, 13.9, 2.9],
    rowHeights: { 1: 13.5, 2: 19.5, 3: 7.5, 4: 15, 5: 15, 6: 15, 7: 3, 8: 12.75, 9: 12.75, 10: 12.75, 13: 4.5 },
    printTitlesRow: '8:12',
  });

  mergeAndSet(ws, 1, 2, 1, 4, 'PEMERINTAH KABUPATEN BOGOR', { font: font(true, 12) });
  mergeAndSet(ws, 1, 9, 1, 12, 'Model : Bend 29', { align: align('right') });
  mergeAndSet(ws, 2, 2, 2, 4, 'UNIT : DPMD');
  mergeAndSet(ws, 2, 9, 2, 12, 'No :', { align: align('right') });
  setCell(ws, 4, 4, 'GUDANG');
  setCell(ws, 4, 5, ':');
  mergeAndSet(ws, 4, 6, 4, 8, 'DPMD');
  setCell(ws, 5, 4, 'BUKTI BARANG DARI');
  setCell(ws, 5, 5, ':');
  mergeAndSet(ws, 5, 6, 5, 8, 'DPMD');
  setCell(ws, 6, 4, 'KEPADA UNIT/UNIT');
  setCell(ws, 6, 5, ':');
  mergeAndSet(ws, 6, 6, 6, 7, safe(d.bidang?.nama, '..................................'));

  mergeAndSet(ws, 8, 2, 11, 2, 'Tanggal\nPenyerahan\nmenurut\npermintaan');
  mergeAndSet(ws, 8, 3, 11, 3, 'Barang\nditerima\ndari\nGudang');
  mergeAndSet(ws, 8, 4, 11, 6, 'Nama dan\nKode\nBarang');
  mergeAndSet(ws, 8, 7, 11, 7, 'Satuan');
  mergeAndSet(ws, 8, 8, 8, 10, 'Jumlah Barang');
  setCell(ws, 9, 9, 'Huruf');
  setCell(ws, 10, 8, 'Angka');
  mergeAndSet(ws, 8, 11, 11, 11, 'Harga Satuan');
  mergeAndSet(ws, 8, 12, 11, 12, 'Jumlah Harga');
  headerRange(ws, 8, 2, 12, 12);
  ['1', '2', '3', '', '', '', '4', '5', '6', '', '7'].forEach((value, index) => {
    setCell(ws, 12, index + 2, value, { align: align('center'), size: 9, border: thinBorder, fill: headerFill });
  });

  const items = d.items || [];
  borderRange(ws, 15, 2, 34, 12);
  items.slice(0, 19).forEach((item, index) => {
    const row = 15 + index;
    mergeAndSet(ws, row, 4, row, 6, item.nama_barang, { size: 10 });
    setCell(ws, row, 7, item.satuan, { align: align('center'), size: 10 });
    setCell(ws, row, 8, num(item.qty), { align: align('center'), size: 10 });
    mergeAndSet(ws, row, 9, row, 10, qtyTerbilang(item.qty), { size: 10 });
    setCell(ws, row, 11, num(item.harga_satuan), { align: align('right'), size: 10, numFmt: '#,##0' });
    setCell(ws, row, 12, num(item.total), { align: align('right'), size: 10, numFmt: '#,##0' });
  });
  setCell(ws, 34, 12, num(d.total_nilai), { font: font(true, 10), align: align('right'), numFmt: '#,##0' });
  setCell(ws, 35, 3, 'Terbilang :');
  mergeAndSet(ws, 35, 4, 35, 11, terbilang(d.total_nilai));

  setCell(ws, 38, 2, 'Daerah/Unit .........................................');
  mergeAndSet(ws, 38, 7, 38, 12, `Cibinong, ............................ ${d.tahun_anggaran || ''}`, { align: align('center') });
  setCell(ws, 39, 2, '............... Tgl ................');
  mergeAndSet(ws, 39, 7, 39, 12, 'Pengurus Barang', { align: align('center') });
  setCell(ws, 40, 2, 'Yang menerima,');
  setCell(ws, 42, 2, 'Tanda Tangan');
  setCell(ws, 42, 3, ': ................................');
  setCell(ws, 43, 2, 'Nama');
  setCell(ws, 43, 3, ': ................................');
  setCell(ws, 44, 2, 'NIP');
  setCell(ws, 44, 3, ': ................................');
  setCell(ws, 45, 2, 'Pangkat/Gol.');
  setCell(ws, 45, 3, ': ................................');

  setCell(ws, 42, 7, 'Tanda Tangan');
  setCell(ws, 42, 9, ': ................................');
  setCell(ws, 43, 7, 'Nama');
  setCell(ws, 43, 9, `: ${pejabat(d.pengurus_barang)}`);
  setCell(ws, 44, 7, 'NIP');
  setCell(ws, 44, 9, `: ${safe(d.pengurus_barang?.nip, '................................')}`);
  setCell(ws, 45, 7, 'Pangkat/Gol.');
  setCell(ws, 45, 9, `: ${safe(d.pengurus_barang?.pangkat, '')}`);

  mergeAndSet(ws, 48, 2, 48, 12, 'MENGETAHUI :', { font: font(true), align: align('center') });
  mergeAndSet(ws, 49, 2, 49, 12, 'AN. ORDONATUR / KUASA PENGGUNA BARANG', { font: font(true), align: align('center') });
  setCell(ws, 51, 4, 'Tanda Tangan');
  setCell(ws, 51, 5, ':');
  setCell(ws, 52, 4, 'Nama');
  setCell(ws, 52, 5, ':');
  mergeAndSet(ws, 52, 6, 52, 9, pejabat(d.atasan_pengurus_barang), { font: font(true) });
  setCell(ws, 53, 4, 'NIP');
  setCell(ws, 53, 5, ':');
  mergeAndSet(ws, 53, 6, 53, 9, safe(d.atasan_pengurus_barang?.nip, ''));
  setCell(ws, 54, 4, 'Jabatan');
  setCell(ws, 54, 5, ':');
  mergeAndSet(ws, 54, 6, 54, 9, safe(d.atasan_pengurus_barang?.jabatan, ''));
}

async function generateAtkExcel(pencairan) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DPMD Kabupaten Bogor';
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  addSheetPesanan(wb, pencairan);
  addSheetFaktur(wb, pencairan);
  addSheetKwitansi(wb, pencairan);
  addSheetBAPemeriksaan(wb, pencairan);
  addSheetLampPemeriksaan(wb, pencairan);
  addSheetBast(wb, pencairan);
  addSheetLampiranBast(wb, pencairan);
  addSheetBasthp(wb, pencairan);
  addSheetBend35(wb, pencairan);
  addSheetBend29(wb, pencairan);

  return wb;
}

module.exports = { generateAtkExcel };
