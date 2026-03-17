/**
 * auto-migrate.js
 * Menjalankan semua file SQL dari folder /migrations/ yang belum pernah dijalankan.
 * Menyimpan riwayat di tabel `_migration_history` agar tidak double-run.
 */

const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const MIGRATIONS_DIR = path.join(__dirname, "../migrations");

async function autoMigrate() {
	let connection;

	try {
		const dbUrl = process.env.DATABASE_URL;
		const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
		if (!match) throw new Error("Invalid DATABASE_URL format");

		const [, user, password, host, port, database] = match;

		connection = await mysql.createConnection({
			host,
			port: parseInt(port),
			user,
			password,
			database,
			multipleStatements: true,
		});

		console.log("✅ Connected to database");

		// Buat tabel tracking jika belum ada
		await connection.query(`
			CREATE TABLE IF NOT EXISTS \`_migration_history\` (
				\`id\` INT AUTO_INCREMENT PRIMARY KEY,
				\`filename\` VARCHAR(255) NOT NULL UNIQUE,
				\`ran_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Ambil daftar migration yang sudah dijalankan
		const [rows] = await connection.query(
			"SELECT filename FROM `_migration_history`"
		);
		const alreadyRan = new Set(rows.map((r) => r.filename));

		// Ambil semua file SQL dari folder migrations, urutkan ascending
		const files = fs
			.readdirSync(MIGRATIONS_DIR)
			.filter((f) => f.endsWith(".sql"))
			.sort();

		let ranCount = 0;

		for (const file of files) {
			if (alreadyRan.has(file)) {
				console.log(`⏭️  Skipped (already ran): ${file}`);
				continue;
			}

			const filePath = path.join(MIGRATIONS_DIR, file);
			const sql = fs.readFileSync(filePath, "utf8");

			console.log(`🔄 Running migration: ${file}`);

			try {
				await connection.query(sql);
				await connection.query(
					"INSERT INTO `_migration_history` (filename) VALUES (?)",
					[file]
				);
				console.log(`✅ Done: ${file}`);
				ranCount++;
			} catch (err) {
				console.error(`❌ Failed: ${file}`);
				console.error(err.message);
				process.exit(1);
			}
		}

		if (ranCount === 0) {
			console.log("✅ All migrations already up to date.");
		} else {
			console.log(`✅ Ran ${ranCount} new migration(s).`);
		}
	} catch (error) {
		console.error("❌ Auto-migrate failed:", error.message);
		process.exit(1);
	} finally {
		if (connection) await connection.end();
	}
}

autoMigrate();
