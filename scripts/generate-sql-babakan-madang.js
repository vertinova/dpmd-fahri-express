const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const babakanMadangDir = path.resolve(__dirname, '../../Babakan Madang');
const reportDir = path.resolve(__dirname, '../logs');

const files = [
    { file: 'BABAKAN MADANG_BOJONG KONENG_BNBA.xlsx', desaId: 59 },
    { file: 'BABAKAN MADANG_CIJAYANTI_BNBA.xlsx', desaId: 51 },
    { file: 'BABAKAN MADANG_CIPAMBUAN_BNBA.xlsx', desaId: 55 },
    { file: 'BABAKAN MADANG_KARANG TENGAH_BNBA.xlsx', desaId: 54 },
    { file: 'BABAKAN MADANG_SUMUR BATU_BNBA.xlsx', desaId: 52 },
    { file: 'DATA LEMBAGA DESA SENTUL 2025.xlsx', desaId: 53 }
];

const scriptPath = path.resolve(__dirname, 'import-kelembagaan-workbook.js');

let masterSql = `
-- AUTO GENERATED SQL UNTUK IMPORT KECAMATAN BABAKAN MADANG
-- PENTING: ID desa dan kelembagaan digenerate unik. Pastikan tabel di truncate lebih dulu jika dibutuhkan, 
-- namun skrip ini menggunakan INSERT IGNORE agar tidak conflict.


`;

function escape(str) {
    if (!str) return 'NULL';
    if (typeof str === 'string') {
        const escaped = str.replace(/'/g, "''").replace(/\\/g, "\\\\");
        return `'${escaped}'`;
    }
    return str;
}

function formatDate(raw) {
    if (!raw) return 'NULL';
    try {
        const d = new Date(raw);
        if (isNaN(d.valueOf())) return 'NULL';
        return `'${d.toISOString().slice(0, 10)}'`;
    } catch {
        return 'NULL';
    }
}

for (const { file, desaId } of files) {
    const filePath = path.join(babakanMadangDir, file);
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
    }
    
    const reportPath = path.join(reportDir, `report_desa_${desaId}.json`);
    
    console.log(`Processing ${file} (Desa ID ${desaId})...`);
    
    try {
        execSync(`node "${scriptPath}" --workbook "${filePath}" --desa-id ${desaId} --mode plan --report-file "${reportPath}"`, { stdio: 'inherit' });
    } catch (err) {
        console.error(`Error processing ${file}:`, err.message);
        continue;
    }
    
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const plan = report.fullPlan;
    
    let sql = `\n-- =========================================\n-- DESA ID ${desaId}: ${file}\n-- =========================================\n\n`;
    
    const resolvedIds = {
        rw: {},
        rt: {},
        singleton: {},
        posyandu: {}
    };

    // 1. RW
    sql += `-- =============== RWS ===============\n`;
    for (const rw of plan.rwPlans) {
        const id = uuidv4();
        resolvedIds.rw[rw.number] = id;
        sql += `INSERT IGNORE INTO \`rws\` (\`id\`, \`desa_id\`, \`nomor\`, \`alamat\`, \`status_kelembagaan\`, \`status_verifikasi\`, \`created_at\`, \`updated_at\`) VALUES ('${id}', ${desaId}, ${escape(rw.number)}, ${escape(rw.address)}, 'aktif', 'unverified', NOW(), NOW());\n`;
    }

    // 2. RT
    sql += `\n-- =============== RTS ===============\n`;
    for (const rt of plan.rtPlans) {
        const id = uuidv4();
        if (!resolvedIds.rt[rt.rwNumber]) resolvedIds.rt[rt.rwNumber] = {};
        resolvedIds.rt[rt.rwNumber][rt.number] = id;
        
        const rwId = resolvedIds.rw[rt.rwNumber] || 'NULL';
        sql += `INSERT IGNORE INTO \`rts\` (\`id\`, \`rw_id\`, \`desa_id\`, \`nomor\`, \`alamat\`, \`status_kelembagaan\`, \`status_verifikasi\`, \`created_at\`, \`updated_at\`) VALUES ('${id}', '${rwId}', ${desaId}, ${escape(rt.number)}, ${escape(rt.address)}, 'aktif', 'unverified', NOW(), NOW());\n`;
    }

    // 3. Singleton (LPM, Karang Taruna, dll)
    sql += `\n-- =============== SINGLETONS ===============\n`;
    for (const s of plan.singletonPlans) {
        const id = uuidv4();
        resolvedIds.singleton[s.table] = id;
        sql += `INSERT IGNORE INTO \`${s.table}\` (\`id\`, \`desa_id\`, \`nama\`, \`alamat\`, \`status_kelembagaan\`, \`status_verifikasi\`, \`created_at\`, \`updated_at\`) VALUES ('${id}', ${desaId}, ${escape(s.name)}, ${escape(s.address)}, 'aktif', 'unverified', NOW(), NOW());\n`;
    }

    // 4. Posyandu
    sql += `\n-- =============== POSYANDUS ===============\n`;
    for (const p of plan.posyanduPlans) {
        const id = uuidv4();
        resolvedIds.posyandu[p.key] = id;
        sql += `INSERT IGNORE INTO \`posyandus\` (\`id\`, \`desa_id\`, \`nama\`, \`alamat\`, \`status_kelembagaan\`, \`status_verifikasi\`, \`created_at\`, \`updated_at\`) VALUES ('${id}', ${desaId}, ${escape(p.name)}, ${escape(p.address)}, 'aktif', 'unverified', NOW(), NOW());\n`;
    }

    // 5. Pengurus
    sql += `\n-- =============== PENGURUS ===============\n`;
    for (const p of plan.pengurusPlans) {
        let parentId = null;
        if (p.parentRef.kind === 'rw') {
             parentId = resolvedIds.rw[p.parentRef.number];
        } else if (p.parentRef.kind === 'rt') {
             parentId = resolvedIds.rt[p.parentRef.rwNumber]?.[p.parentRef.number];
        } else if (p.parentRef.kind === 'singleton') {
             parentId = resolvedIds.singleton[p.parentRef.table];
        } else if (p.parentRef.kind === 'posyandu') {
             parentId = resolvedIds.posyandu[p.parentRef.key];
        }

        if (!parentId) {
            console.warn(`[Desa ${desaId}] Missing parent ID for pengurus: ${p.namaLengkap} - Ref: ${JSON.stringify(p.parentRef)}`);
            continue;
        }

        const eid = uuidv4();
        sql += `INSERT IGNORE INTO \`pengurus\` (\`id\`, \`desa_id\`, \`pengurusable_type\`, \`pengurusable_id\`, \`nama_lengkap\`, \`jabatan\`, \`nik\`, \`jenis_kelamin\`, \`tempat_lahir\`, \`tanggal_lahir\`, \`status_perkawinan\`, \`alamat\`, \`pendidikan\`, \`no_telepon\`, \`tanggal_akhir_jabatan\`, \`status_jabatan\`, \`status_verifikasi\`, \`created_at\`, \`updated_at\`) VALUES ('${eid}', ${desaId}, '${p.pengurusableType}', '${parentId}', ${escape(p.namaLengkap)}, ${escape(p.jabatan)}, ${escape(p.nik)}, ${escape(p.jenisKelamin)}, ${escape(p.tempatLahir)}, ${formatDate(p.tanggalLahir)}, ${escape(p.statusPerkawinan)}, ${escape(p.alamat)}, ${escape(p.pendidikan)}, ${escape(p.noTelepon)}, ${formatDate(p.tanggalAkhirJabatan)}, 'aktif', 'unverified', NOW(), NOW());\n`;
    }

    masterSql += sql;
}

const outFile = path.resolve(__dirname, '../import_babakan_madang.sql');
fs.writeFileSync(outFile, masterSql);
console.log(`\nSuccessfully generated: ${outFile}`);
