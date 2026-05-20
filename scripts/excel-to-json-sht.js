'use strict';

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data/anggaran');

function convertFile(filePath, tahun) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });

  // First row is header
  const headers = rawRows[0];
  const items = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const uraian = String(row[4] || '').trim();
    if (!uraian) continue;

    items.push({
      id: Number(row[2]) || i,
      kode_kelompok: String(row[0] || '').trim(),
      kelompok: String(row[1] || '').trim(),
      kode_barang: String(row[3] || '').trim(),
      uraian: uraian,
      spesifikasi: String(row[5] || '').trim(),
      satuan: String(row[6] || '').trim(),
      harga_satuan: Number(row[7]) || 0,
      kode_rekening: String(row[8] || '').trim(),
    });
  }

  return { tahun, total: items.length, items };
}

const sshFile = path.join(DATA_DIR, 'export_excel_ssh_Kab. Bogor.xlsx');
const sbuFile = path.join(DATA_DIR, 'export_excel_sbu_Kab. Bogor.xlsx');

console.log('Converting SSH...');
const ssh = convertFile(sshFile, 2026);
console.log(`SSH: ${ssh.total} items`);

console.log('Converting SBU...');
const sbu = convertFile(sbuFile, 2026);
console.log(`SBU: ${sbu.total} items`);

fs.writeFileSync(path.join(DATA_DIR, 'ssh_2026.json'), JSON.stringify(ssh));
fs.writeFileSync(path.join(DATA_DIR, 'sbu_2026.json'), JSON.stringify(sbu));

console.log('Done: ssh_2026.json & sbu_2026.json written.');
