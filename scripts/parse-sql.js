const fs = require('fs');

const sqlDumpPath = 'C:\\laragon\\www\\dpmd\\Babakan Madang\\backup_dpmd_2026-04-09T03-39-17.sql';
const sql = fs.readFileSync(sqlDumpPath, 'utf8');

// Parse kecamatans
const kecMatch = sql.match(/INSERT INTO `kecamatans` VALUES \((.+?)\);/);
const kecamatans = {};
if (kecMatch) {
  const rows = kecMatch[1].split('),(');
  for (const row of rows) {
    const parts = row.replace(/['"]/g, '').split(',');
    // ID is parts[0], name is parts[2]
    kecamatans[parts[0]] = parts[2];
  }
}

// target kecamatan
let babakanMadangId = null;
for (const [id, name] of Object.entries(kecamatans)) {
    if (name && name.toUpperCase().includes('BABAKAN MADANG')) {
        babakanMadangId = id;
        break;
    }
}

console.log(`Babakan Madang Kecamatan ID: ${babakanMadangId}`);

// Parse desas
const desaMatch = sql.match(/INSERT INTO `desas` VALUES \((.+?)\);/);
const desas = [];
if (desaMatch) {
  const rows = desaMatch[1].split('),(');
  for (const row of rows) {
    const parts = row.replace(/['"]/g, '').split(',');
    // parts[0]: id, parts[1]: kecamatan_id, parts[3]: nama
    if (parts[1] === babakanMadangId) {
        desas.push({ id: parts[0], nama: parts[3] });
    }
  }
}

console.log('Desas in Babakan Madang:');
console.table(desas);
