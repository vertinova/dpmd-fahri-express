const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function runMigration() {
	let connection;

	try {
		// Parse DATABASE_URL
		const dbUrl = process.env.DATABASE_URL;
		// Sandi boleh kosong — MySQL bawaan Laragon memang begitu, dan pola lama
		// yang menuntut minimal satu karakter membuat runner ini tidak pernah
		// jalan di lingkungan pengembangan.
		const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]*)@([^:]+):(\d+)\/(.+)/);

		if (!match) {
			throw new Error("Invalid DATABASE_URL format");
		}

		const [, user, password, host, port, database] = match;

		// Create connection
		connection = await mysql.createConnection({
			host,
			port: parseInt(port),
			user,
			password,
			database,
			multipleStatements: true,
		});

		console.log("✅ Connected to database");

		// Get migration file from command line argument or use default
		const migrationArg = process.argv[2];
		let migrationFile;

		if (migrationArg) {
			// If absolute path provided
			if (path.isAbsolute(migrationArg)) {
				migrationFile = migrationArg;
			} else {
				// If relative path or just filename
				migrationFile = migrationArg;
			}
		} else {
			// Default migration file
			migrationFile = path.join(
				__dirname,
				"migrations",
				"20241212_create_kelembagaan_activity_logs.sql",
			);
		}

		console.log(`📁 Migration file: ${migrationFile}`);

		// Check if file exists
		if (!fs.existsSync(migrationFile)) {
			throw new Error(`Migration file not found: ${migrationFile}`);
		}

		const sql = fs.readFileSync(migrationFile, "utf8");

		console.log("📝 Running migration...");

		// Execute migration
		await connection.query(sql);

		console.log("✅ Migration completed successfully");
	} catch (error) {
		console.error("❌ Migration failed:", error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

runMigration();
