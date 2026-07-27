/**
 * Migration Runner for DPMD Express Backend
 * 
 * Menjalankan semua file SQL migration di folder /migrations secara berurutan.
 * 
 * Usage:
 *   npm run db:migrate              - Jalankan semua migration
 *   node scripts/run-migrations.js  - Jalankan semua migration
 *   node scripts/run-migrations.js --file 20260219_xxx.sql  - Jalankan satu file saja
 * 
 * Migration files harus dalam format: YYYYMMDD_nama_migration.sql
 * File dijalankan secara alfabet (chronological by date prefix).
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Parse DATABASE_URL or use individual DB_* env vars
function getDbConfig() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]*)@([^:]+):(\d+)\/(.+)/);
    if (match) {
      const [, user, password, host, port, database] = match;
      return {
        host,
        port: parseInt(port),
        user,
        password: decodeURIComponent(password),
        // Buang query string: DATABASE_URL produksi memakai
        // "mysql://.../dpmd?connection_limit=20", dan tanpa pemotongan ini nama
        // database ikut membawa "?connection_limit=20" sehingga koneksi gagal
        // dengan ER_BAD_DB_ERROR "Unknown database 'dpmd?connection_limit=20'".
        database: database.split('?')[0],
      };
    }
  }

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dpmd',
  };
}

async function runMigrations() {
  const dbConfig = getDbConfig();
  const connection = await mysql.createConnection({
    ...dbConfig,
    multipleStatements: true,
  });

  try {
    console.log(`🔗 Connected to database: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}\n`);

    // Check for --file argument (single file mode)
    const fileArg = process.argv.find(arg => arg.startsWith('--file'));
    const singleFile = fileArg ? process.argv[process.argv.indexOf(fileArg) + 1] : null;

    const migrationsDir = path.join(__dirname, '..', 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      console.error('❌ Folder migrations/ tidak ditemukan!');
      process.exit(1);
    }

    let files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (singleFile) {
      files = files.filter(f => f === singleFile || f.includes(singleFile));
      if (files.length === 0) {
        console.error(`❌ File migration tidak ditemukan: ${singleFile}`);
        process.exit(1);
      }
    }

    console.log(`📋 Total migration files: ${files.length}\n`);

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8').trim();

      if (!sql) {
        console.log(`⏭️  SKIP (empty): ${file}`);
        skipped++;
        continue;
      }

      try {
        await connection.query(sql);
        console.log(`✅ ${file}`);
        success++;
      } catch (error) {
        // Jika error karena table/column sudah ada, anggap skip (bukan error fatal)
        if (
          error.code === 'ER_TABLE_EXISTS_ERROR' ||
          error.code === 'ER_DUP_FIELDNAME' ||
          error.code === 'ER_DUP_KEYNAME' ||
          error.code === 'ER_FK_DUP_NAME' ||
          error.code === 'ER_DUP_ENTRY'
        ) {
          console.log(`⏭️  SKIP (already exists): ${file}`);
          skipped++;
        } else {
          console.error(`❌ FAIL: ${file}`);
          console.error(`   Error: ${error.message}\n`);
          failed++;
        }
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Migration Summary:`);
    console.log(`   ✅ Success: ${success}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Failed:  ${failed}`);
    console.log('='.repeat(50));

    if (failed > 0) {
      console.log('\n⚠️  Ada migration yang gagal. Cek error di atas.');
      process.exit(1);
    } else {
      console.log('\n🎉 Semua migration selesai!');
    }
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigrations();
