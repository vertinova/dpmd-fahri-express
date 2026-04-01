/**
 * Seed script to populate pegawai data from "data pegawai.csv"
 * Updates: nip, jabatan, status_kepegawaian, pangkat, golongan
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient({ log: [] });

// Parse status from CSV column 4
function parseStatus(raw) {
  if (!raw) return { status: null, pangkat: null, golongan: null };
  
  const s = raw.trim();
  
  // Direct matches - use Prisma enum keys (underscored)
  if (s === 'PPPK' || s === 'PPPK ') return { status: 'PPPK', pangkat: null, golongan: null };
  if (s.startsWith('PPPK Paruh Waktu') || s === 'PP Paruh Waktu') return { status: 'PPPK_Paruh_Waktu', pangkat: null, golongan: null };
  if (s === 'Tenaga Alih Daya') return { status: 'Tenaga_Alih_Daya', pangkat: null, golongan: null };
  if (s === 'Petugas Keamanan' || s === 'Tenaga Keamanan') return { status: 'Tenaga_Keamanan', pangkat: null, golongan: null };
  if (s === 'Tenaga Kebersihan') return { status: 'Tenaga_Kebersihan', pangkat: null, golongan: null };
  
  // PNS with pangkat/golongan format: "Pembina Utama Muda, IV/c" or "Penata Tingkat I, III/d"
  const pnsMatch = s.match(/^(.+?),?\s+(I{1,3}V?\/[a-d])$/i);
  if (pnsMatch) {
    return { 
      status: 'PNS', 
      pangkat: pnsMatch[1].replace(/,\s*$/, '').trim(), 
      golongan: pnsMatch[2].trim() 
    };
  }
  
  // Fallback: if contains roman numeral golongan pattern, it's PNS
  const golMatch = s.match(/(I{1,3}V?\/[a-d])/i);
  if (golMatch) {
    const pangkat = s.replace(golMatch[0], '').replace(/,\s*$/, '').trim();
    return { status: 'PNS', pangkat: pangkat || null, golongan: golMatch[1] };
  }
  
  // Unknown
  console.log('  ⚠️  Unknown status:', JSON.stringify(s));
  return { status: null, pangkat: null, golongan: null };
}

// Normalize name for matching
function normalizeName(name) {
  return name
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function main() {
  // Read CSV
  const csvPath = path.join(__dirname, '../../data pegawai.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');
  
  // Parse CSV entries - format: NO;NAMA;NIP;STATUS PEGAWAI;JABATAN;;
  const employees = [];
  for (const line of lines) {
    const cols = line.split(';');
    const no = cols[0]?.trim();
    const nama = cols[1]?.trim();
    const nip = cols[2]?.trim();
    const statusRaw = cols[3]?.trim();
    const jabatan = cols[4]?.trim();
    
    // Skip non-data rows (headers, empty, section headers)
    if (!no || !nama || isNaN(parseInt(no))) continue;
    if (no === 'NO' || no === '1' && nama === '2') continue; // header rows
    
    employees.push({
      no: parseInt(no),
      nama,
      nip: nip && nip !== '-' && nip !== '' ? nip : null,
      statusRaw,
      jabatan: jabatan || null,
      ...parseStatus(statusRaw)
    });
  }
  
  console.log(`📋 Parsed ${employees.length} employees from CSV\n`);

  // Get all pegawai from DB
  const allPegawai = await prisma.pegawai.findMany({
    select: { id_pegawai: true, nama_pegawai: true, id_bidang: true }
  });

  // Build normalized name map
  const pegawaiMap = new Map();
  for (const p of allPegawai) {
    pegawaiMap.set(normalizeName(p.nama_pegawai), p);
  }

  let updated = 0;
  let notFound = 0;

  for (const emp of employees) {
    const normalizedCsv = normalizeName(emp.nama);
    let pegawai = pegawaiMap.get(normalizedCsv);
    
    // Try partial match if exact doesn't work
    if (!pegawai) {
      // Try matching by last major name parts
      for (const [key, val] of pegawaiMap) {
        if (key.includes(normalizedCsv) || normalizedCsv.includes(key)) {
          pegawai = val;
          break;
        }
      }
    }

    if (!pegawai) {
      console.log(`❌ Not found: #${emp.no} ${emp.nama}`);
      notFound++;
      continue;
    }

    // Build update data
    const updateData = {};
    if (emp.status) updateData.status_kepegawaian = emp.status;
    if (emp.nip) updateData.nip = emp.nip;
    if (emp.jabatan) updateData.jabatan = emp.jabatan;
    if (emp.pangkat) updateData.pangkat = emp.pangkat;
    if (emp.golongan) updateData.golongan = emp.golongan;

    if (Object.keys(updateData).length > 0) {
      await prisma.pegawai.update({
        where: { id_pegawai: pegawai.id_pegawai },
        data: updateData
      });
      console.log(`✅ #${emp.no} ${emp.nama} → ${emp.status || 'no status'} | ${emp.jabatan || ''}`);
      updated++;
    }
  }

  console.log(`\n📊 Results: ${updated} updated, ${notFound} not found`);

  // Also update users.status_kepegawaian field by syncing from pegawai
  // The login response reads from pegawai.status_kepegawaian, so this is sufficient
  
  // Verify
  const withStatus = await prisma.pegawai.count({ where: { status_kepegawaian: { not: null } } });
  console.log(`\n✅ Pegawai with status_kepegawaian: ${withStatus}`);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
