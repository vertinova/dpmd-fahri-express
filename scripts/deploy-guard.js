#!/usr/bin/env node
/**
 * Jaring pengaman deploy — dijalankan cron, menutup lubang webhook yang meleset.
 *
 * KENAPA ADA. GitHub mengirim webhook push SEKALI dan tidak pernah mencoba ulang:
 * pesan kegagalannya berbunyi "giving up after 1 attempt(s)". Pada 2026-10-05
 * delivery untuk commit 2bbcc52 gagal dengan "Client.Timeout exceeded while
 * awaiting headers" — paketnya bahkan tidak sampai ke nginx (tidak ada jejak di
 * access log), sementara konfigurasi webhooknya sendiri sudah benar dan
 * servernya membalas dalam 0,1 detik saat diuji dari internet. Penyebabnya ada
 * di lapisan jaringan di depan server, yang sesekali menjatuhkan koneksi.
 *
 * Akibatnya backend diam-diam tertinggal dari origin/main tanpa ada yang tahu,
 * sampai seseorang kebetulan memeriksa. Skrip ini yang memeriksa, tiap beberapa
 * menit.
 *
 * KENAPA MEMICU WEBHOOK, BUKAN MENJALANKAN DEPLOY SENDIRI. Daftar perintah
 * deploy ada sebelas langkah dan hidup di REPOS pada webhook-handler.js —
 * npm install, prisma generate, auto-migrate, seed, nginx reload, pm2. Menyalin
 * daftar itu ke sini berarti membuat salinan kedua yang pasti menyimpang pada
 * perubahan berikutnya, dan salinan yang menyimpang justru berbahaya: ia akan
 * "berhasil" sambil melewatkan langkah. Jadi skrip ini hanya mengetuk handler
 * lewat 127.0.0.1 dengan payload push tiruan, dan handler yang mengerjakan
 * sisanya — lengkap dengan lock, antrean, dan log yang sama seperti push asli.
 *
 * Secretnya pun DIBACA dari webhook-handler.js, bukan ditulis ulang di sini,
 * supaya mengganti secret cukup di satu tempat.
 *
 * AMAN DIJALANKAN BERULANG. Kalau tidak ada yang tertinggal, skrip keluar tanpa
 * melakukan apa pun. Kalau deploy sedang berjalan, handler membalas "skipped"
 * karena deployLock-nya masih dipegang.
 */

// Pemasangan (sekali saja, di CT 100) — satu baris di crontab root, tiap 5 menit.
// Contohnya ditulis sebagai komentar baris, bukan di dalam blok di atas, karena
// penanda menit cron mengandung bintang-garis-miring yang akan menutup komentar
// blok lebih awal dan membuat berkas ini gagal di-parse:
//
//   */5 * * * * /path/ke/node /var/www/backend/scripts/deploy-guard.js >> /var/log/deploy-guard.log 2>&1

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');

const REPO_DIR = process.env.GUARD_REPO_DIR || '/var/www/backend';
const REPO_NAME = process.env.GUARD_REPO_NAME || 'dpmd-fahri-express';
const BRANCH = process.env.GUARD_BRANCH || 'main';
const HANDLER = process.env.GUARD_HANDLER || '/var/www/webhook/webhook-handler.js';
const PORT = Number(process.env.GUARD_PORT || 9000);
// Path absolut, sama seperti yang dipakai REPOS di webhook-handler.js: cron
// berjalan dengan PATH yang nyaris kosong, jadi "git" saja tidak akan ketemu.
// Bisa ditimpa lewat env supaya skripnya dapat diuji di luar server.
const GIT = process.env.GUARD_GIT || '/usr/bin/git';

const catat = (pesan) => console.log(`[${new Date().toISOString()}] ${pesan}`);

/**
 * Jalankan git dan kembalikan stdout yang sudah dirapikan.
 *
 * stderr sengaja DITANGKAP, bukan diwariskan. Bawaan execFileSync meneruskan
 * stderr anak ke stderr induk, dan `git fetch` menulis "From https://..." ke
 * sana pada setiap pemanggilan — lewat cron tiap 5 menit itu 288 baris per hari
 * di log, yang justru mengubur baris yang benar-benar perlu dibaca. Kalau git
 * gagal, pesannya tetap sampai: execFileSync melempar dan stderr-nya ikut di
 * dalam error.message.
 */
const git = (...argumen) =>
	execFileSync(GIT, ['-C', REPO_DIR, ...argumen], {
		encoding: 'utf8',
		timeout: 120000,
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();

/**
 * Ambil secret dari webhook-handler.js.
 *
 * Dibaca, bukan disalin: kalau suatu saat secretnya diganti di sana, skrip ini
 * ikut tanpa perlu disentuh. Kalau polanya tidak ketemu — misalnya secretnya
 * dipindah ke env — skrip berhenti dengan pesan jelas alih-alih mengirim
 * signature karangan yang akan ditolak 401 tanpa petunjuk apa pun.
 */
const ambilSecret = () => {
	const isi = fs.readFileSync(HANDLER, 'utf8');
	const cocok = isi.match(/const\s+SECRET\s*=\s*['"]([^'"]+)['"]/);
	if (!cocok) {
		throw new Error(
			`SECRET tidak ditemukan di ${HANDLER}. Kalau sudah dipindah ke environment, ` +
				'sesuaikan ambilSecret() di skrip ini.',
		);
	}
	return cocok[1];
};

/** Ketuk handler di localhost dengan payload push tiruan. */
const picuDeploy = (secret, sha) =>
	new Promise((selesai, gagal) => {
		// Bentuknya hanya memuat yang benar-benar dibaca handleWebhook: nama repo,
		// ref, dan pusher untuk baris lognya. Menyusun tiruan payload GitHub utuh
		// tidak ada gunanya dan justru menyesatkan pembaca berikutnya.
		const payload = JSON.stringify({
			ref: `refs/heads/${BRANCH}`,
			repository: { name: REPO_NAME },
			pusher: { name: 'deploy-guard (cron)' },
			head_commit: { id: sha },
		});

		const signature =
			'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

		const req = http.request(
			{
				host: '127.0.0.1',
				port: PORT,
				path: '/webhook',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload),
					'X-GitHub-Event': 'push',
					'X-Hub-Signature-256': signature,
				},
				timeout: 20000,
			},
			(res) => {
				let body = '';
				res.on('data', (c) => (body += c));
				res.on('end', () => selesai({ status: res.statusCode, body: body.slice(0, 200) }));
			},
		);

		req.on('timeout', () => {
			req.destroy(new Error('handler tidak membalas dalam 20 detik'));
		});
		req.on('error', gagal);
		req.write(payload);
		req.end();
	});

(async () => {
	try {
		git('fetch', '--quiet', 'origin', BRANCH);

		const tertinggal = Number(git('rev-list', '--count', `HEAD..origin/${BRANCH}`));
		if (!Number.isFinite(tertinggal)) {
			throw new Error('tidak bisa membaca jumlah commit yang tertinggal');
		}

		if (tertinggal === 0) {
			// Sengaja tidak mencatat apa pun saat sehat. Cron tiap 5 menit berarti
			// 288 baris per hari; log yang penuh baris "tidak ada apa-apa" justru
			// menyembunyikan baris yang penting.
			process.exit(0);
		}

		const sha = git('rev-parse', '--short', `origin/${BRANCH}`);
		catat(
			`${REPO_NAME} tertinggal ${tertinggal} commit dari origin/${BRANCH} (terbaru ${sha}) — ` +
				'webhook tampaknya meleset, memicu deploy lewat handler lokal',
		);

		const hasil = await picuDeploy(ambilSecret(), sha);
		catat(`handler membalas ${hasil.status}: ${hasil.body}`);

		// Handler membalas 200 lalu men-deploy secara asinkron, jadi status 200 di
		// sini berarti "diterima dan diantrekan", BUKAN "deploy sudah selesai".
		// Hasil akhirnya ada di /var/www/webhook/webhook.log.
		process.exit(hasil.status === 200 ? 0 : 1);
	} catch (error) {
		catat(`GAGAL: ${error.message}`);
		process.exit(1);
	}
})();
