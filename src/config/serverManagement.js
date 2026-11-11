/**
 * Konfigurasi Manajemen Server (superadmin).
 *
 * Nilai di DEFAULT_CONFIG hanyalah bawaan: superadmin mengubahnya dari halaman
 * Manajemen Server dan hasilnya disimpan di app_settings dengan kunci
 * CONFIG_KEY. Yang tersimpan di-merge di atas bawaan, jadi kunci baru yang
 * ditambahkan di sini kelak otomatis punya nilai walau belum pernah disimpan.
 */

const path = require('path');

const CONFIG_KEY = 'server_management_config';

const BACKEND_ROOT = path.join(__dirname, '../..');

const DEFAULT_CONFIG = {
  alerts: {
    cpu_percent: 85,
    memory_percent: 90,
    disk_percent: 85,
    event_loop_ms: 200,
    error_rate_percent: 5,
    // Kirim push notification ke semua superadmin saat peringatan baru muncul.
    push_notification: true,
  },
  storage: {
    // Kuota total berkas unggahan (storage/ + private/) dalam GB. 0 = tanpa batas.
    quota_gb: 0,
    // Persen kuota yang memicu peringatan.
    warn_percent: 80,
    // Tolak unggahan baru bila kuota penuh.
    enforce: true,
    // Batas ukuran satu request unggahan (MB). 0 = ikuti batas tiap fitur.
    max_upload_mb: 0,
    // Umur berkas sisa di storage/uploads/temp yang boleh dibersihkan (jam).
    temp_max_age_hours: 24,
  },
  security: {
    // Deteksi pola serangan (SQL injection, XSS, path traversal, pemindai).
    detection: true,
    // Mode WAF: tolak langsung request anonim yang berpola serangan serius.
    waf_mode: true,
    // Blokir otomatis IP yang skor ancamannya melewati ambang.
    auto_block: true,
    auto_block_score: 30,
    auto_block_window_minutes: 10,
    auto_block_duration_minutes: 60,
    // IP yang tidak akan pernah diblokir (kantor, server sendiri, dsb).
    whitelist: ['127.0.0.1', '::1'],
    // Lama penyimpanan jejak serangan (hari).
    retention_days: 30,
    // Baca log nginx & SSH di server untuk mendeteksi serangan di luar aplikasi.
    scan_system_logs: true,
    // Cari lokasi (negara/kota/ISP) IP publik lewat ip-api.com untuk peta
    // ancaman dan blokir negara. Mati = globe kosong, blokir negara tidak jalan.
    geo_lookup: true,
    // Kode negara ISO (mis. "CN", "RU") yang request anonimnya ditolak.
    // Pengguna yang sudah login tetap boleh masuk. "ID" tidak boleh diisi.
    blocked_countries: [],
    // Honeypot: IP anonim yang menyentuh jalur jebakan (HONEYPOT_PATTERN)
    // langsung diblokir tanpa menunggu skor terkumpul.
    honeypot: true,
    honeypot_block_minutes: 1440,
  },
  // Monitor uptime: [{ name, url }]. Kosong = daftar bawaan (lihat
  // serverApps.service.js → defaultMonitors).
  monitors: [],
  notifications: {
    // Id akun TAMBAHAN (selain semua superadmin) penerima push notification server. Maks 50.
    push_users: [],
    // Level terendah yang dikirim: 'warning' atau 'critical'.
    push_min_level: 'warning',
    // Kirim laporan ringkas harian lewat push.
    daily_report: false,
    // Jam kirim laporan harian (WIB, 0-23).
    daily_report_hour: 7,
  },
};

/**
 * IP tepercaya bawaan — tidak pernah diblokir, dan sengaja TIDAK ikut
 * `security.whitelist` yang bisa disunting dari UI.
 *
 * 103.51.103.197 adalah NAT kantor DPMD: seluruh pegawai keluar lewat satu IP.
 * Satu kantor yang salah ketik sandi belasan kali dan berbagi satu jatah rate
 * limit terbaca persis seperti brute force. Pada 2026-10-19 auto-block
 * mengunci seisi kantor (464 request ditolak dalam 4 menit), termasuk
 * superadmin yang hendak membuka blokirnya sendiri.
 *
 * Tambahan lewat env SERVER_GUARD_TRUSTED_IPS (dipisah koma, boleh pola `*`).
 */
const IP_TEPERCAYA = [
  '103.51.103.197',
  ...String(process.env.SERVER_GUARD_TRUSTED_IPS || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean),
];

/** Bobot skor ancaman per tingkat keparahan. */
const SEVERITY_SCORE = { low: 1, medium: 3, high: 8, critical: 15 };

/** Penjelasan mitigasi WAF yang sama untuk semua serangan berpola (injeksi/traversal). */
const MITIGASI_WAF = 'Permintaan anonim dengan pola ini langsung ditolak 403 oleh WAF dan skor ancaman IP naik tinggi; bila berulang, IP diblokir otomatis. Bila pelakunya pengguna yang sedang login, permintaan hanya dicatat (tidak ditolak).';

/**
 * Jenis kejadian keamanan. Label & penjelasan ikut dikirim ke frontend supaya
 * superadmin yang bukan orang keamanan tetap paham artinya.
 * Field: apa (definisi), tujuan (maksud penyerang), dampak, mitigasi (yang
 * benar-benar dilakukan sistem), saran (opsional).
 */
const EVENT_TYPES = {
  sql_injection: {
    label: 'SQL Injection', severity: 'critical', info: 'Upaya menyisipkan perintah SQL untuk membaca/merusak database.',
    apa: 'Penyerang menyisipkan potongan perintah database (mis. \' OR 1=1 --, UNION SELECT) ke alamat atau isian formulir.',
    tujuan: 'Membaca, mengubah, atau menghapus isi database tanpa izin — misalnya data pengguna dan sandi.',
    dampak: 'Bila berhasil, isi database bisa bocor atau rusak. Query aplikasi memakai parameter sehingga sisipan semacam ini biasanya tidak dieksekusi.',
    mitigasi: MITIGASI_WAF,
    saran: 'Bila pelakunya akun yang sedang login, periksa akun tersebut di tab Log.',
  },
  xss: {
    label: 'Cross-Site Scripting (XSS)', severity: 'high', info: 'Upaya menyisipkan skrip berbahaya ke halaman.',
    apa: 'Penyerang menyisipkan kode JavaScript (mis. <script>) ke isian atau alamat agar ikut tampil di halaman pengguna lain.',
    tujuan: 'Mencuri sesi/token login pengguna lain atau menampilkan konten palsu.',
    dampak: 'Bila tersimpan dan tampil, akun pengguna yang membuka halaman itu bisa diambil alih.',
    mitigasi: MITIGASI_WAF,
    saran: 'Bila pelakunya akun login, periksa data yang ia simpan.',
  },
  path_traversal: {
    label: 'Path Traversal', severity: 'critical', info: 'Upaya membaca berkas sistem di luar folder aplikasi (mis. /etc/passwd).',
    apa: 'Memakai ../ atau alamat berkas sistem (mis. /etc/passwd) untuk keluar dari folder aplikasi.',
    tujuan: 'Membaca berkas sistem atau konfigurasi server.',
    dampak: 'Bila berhasil, berkas sensitif server bisa terbaca.',
    mitigasi: MITIGASI_WAF,
  },
  command_injection: {
    label: 'Command Injection', severity: 'critical', info: 'Upaya menjalankan perintah shell di server.',
    apa: 'Menyisipkan perintah shell (mis. ; cat, | wget, $(...)) ke isian.',
    tujuan: 'Menjalankan perintah di server — memasang malware, penambang kripto, atau pintu belakang.',
    dampak: 'Paling berbahaya: server bisa diambil alih bila berhasil.',
    mitigasi: MITIGASI_WAF,
    saran: 'Bila ada kejadian dari akun login, segera periksa akun tersebut.',
  },
  scanner: {
    label: 'Pemindaian Celah', severity: 'medium', info: 'Bot mencari berkas sensitif/CMS umum (.env, wp-admin, phpmyadmin).',
    apa: 'Bot menelusuri banyak alamat umum (wp-admin, backup.zip, config.php) untuk mencari celah atau berkas yang tertinggal.',
    tujuan: 'Memetakan teknologi server dan menemukan pintu masuk yang lemah sebelum menyerang.',
    dampak: 'Biasanya hanya berbuah 404. Berbahaya bila ada berkas cadangan/konfigurasi yang benar-benar tertinggal di folder publik.',
    mitigasi: 'Dicatat dan menambah skor ancaman IP; bila skor mencapai 30 dalam 10 menit, IP diblokir otomatis 60 menit.',
    saran: 'Pastikan tidak ada berkas cadangan atau konfigurasi di folder publik.',
  },
  bad_bot: {
    label: 'Alat Peretasan', severity: 'high', info: 'User-Agent milik alat serang otomatis (sqlmap, nikto, nmap, dll).',
    apa: 'User-Agent milik alat serang otomatis seperti sqlmap, nikto, nmap, atau masscan.',
    tujuan: 'Memindai celah secara otomatis dan cepat.',
    dampak: 'Tanda kuat sedang ada upaya serangan terarah.',
    mitigasi: 'Permintaan anonim ditolak 403 oleh WAF dan skor IP naik; bila berulang, IP diblokir otomatis.',
  },
  login_failed: {
    label: 'Login Gagal', severity: 'low', info: 'Percobaan masuk dengan email/sandi salah.',
    apa: 'Percobaan masuk dengan email atau sandi yang salah.',
    tujuan: 'Bisa sekadar salah ketik; bila banyak dari satu IP, menandakan tebakan sandi.',
    dampak: 'Tidak ada, selama sandi tidak tertebak.',
    mitigasi: 'Dicatat dan menambah sedikit skor; kegagalan beruntun menjadi Brute Force dan memicu blokir otomatis.',
    saran: 'Bila akun tertentu sering gagal, minta pemiliknya mengganti sandi.',
  },
  brute_force: {
    label: 'Brute Force Login', severity: 'high', info: 'Banyak login gagal beruntun dari satu IP — menebak sandi.',
    apa: 'Banyak login gagal beruntun dari satu IP.',
    tujuan: 'Menebak sandi dengan mencoba banyak kombinasi.',
    dampak: 'Akun dengan sandi lemah bisa diambil alih.',
    mitigasi: 'Skor IP naik tinggi sehingga IP diblokir otomatis.',
    saran: 'Pastikan akun yang diincar memakai sandi kuat.',
  },
  rate_limit: {
    label: 'Banjir Request', severity: 'medium', info: 'IP melewati batas jumlah request (indikasi DoS/scraping).',
    apa: 'Satu IP mengirim permintaan melebihi batas wajar dalam waktu singkat.',
    tujuan: 'Membanjiri server (DoS) atau menyedot data (scraping).',
    dampak: 'Server bisa melambat bagi pengguna lain.',
    mitigasi: 'Permintaan yang melewati batas dijawab 429 dan skor IP naik; bila berlanjut, IP diblokir otomatis.',
  },
  auth_flood: {
    label: 'Akses Tanpa Izin Beruntun', severity: 'medium', info: 'Banyak request ditolak 401/403 dalam waktu singkat.',
    apa: 'Banyak permintaan ditolak 401/403 dari IP yang tidak login.',
    tujuan: 'Mencoba-coba membuka data atau endpoint yang butuh login.',
    dampak: 'Tidak ada selama penolakan berlaku.',
    mitigasi: 'Dicatat dan menambah skor; bila berlanjut, IP diblokir otomatis.',
  },
  not_found_flood: {
    label: 'Banjir 404', severity: 'medium', info: 'Banyak request ke alamat yang tidak ada — ciri pemindaian direktori.',
    apa: 'Banyak permintaan ke alamat yang tidak ada.',
    tujuan: 'Menebak folder atau berkas tersembunyi (directory brute force).',
    dampak: 'Biasanya tidak ada; berbahaya bila menemukan berkas yang tertinggal.',
    mitigasi: 'Dicatat dan menambah skor; bila berlanjut, IP diblokir otomatis.',
  },
  blocked_request: {
    label: 'Request Diblokir', severity: 'low', info: 'Request dari IP yang sedang diblokir.',
    apa: 'Permintaan dari IP yang sedang ada di daftar blokir.',
    tujuan: 'Penyerang yang sudah diblokir mencoba lagi.',
    dampak: 'Tidak ada.',
    mitigasi: 'Ditolak 403 sebelum menyentuh aplikasi (dicatat paling banyak sekali per menit per IP).',
  },
  auto_blocked: {
    label: 'IP Diblokir Otomatis', severity: 'high', info: 'Skor ancaman IP melewati ambang, sistem memblokirnya.',
    apa: 'Sistem memblokir IP karena skor ancamannya melewati ambang.',
    tujuan: '—',
    dampak: 'Tidak ada; ini adalah tindakan perlindungan.',
    mitigasi: 'IP diblokir otomatis; semua permintaan ke API ditolak 403 sampai masa blokir habis.',
    saran: 'Bila ternyata IP kantor atau mitra, buka blokir dan masukkan ke daftar tepercaya.',
  },
  ssh_failed: {
    label: 'SSH Login Gagal', severity: 'medium', info: 'Percobaan masuk SSH ke server gagal (dari /var/log/auth.log).',
    apa: 'Percobaan login SSH ke server yang gagal (dari /var/log/auth.log).',
    tujuan: 'Menebak sandi akun server untuk mengambil alih mesin.',
    dampak: 'Bila tertebak, seluruh server bisa dikuasai.',
    mitigasi: 'Hanya dicatat: SSH berada di luar jangkauan aplikasi sehingga tidak bisa diblokir dari sini.',
    saran: 'Pakai login SSH dengan kunci (matikan login sandi) dan pasang fail2ban/ufw; perintahnya tersedia di Pengaturan.',
  },
  nginx_attack: {
    label: 'Serangan di Nginx', severity: 'medium', info: 'Pola serangan terdeteksi di log akses nginx.',
    apa: 'Pola serangan terlihat di log akses nginx — permintaan ke halaman/berkas statis yang tidak melewati aplikasi.',
    tujuan: 'Sama dengan jenis serangan yang tertulis di detail.',
    dampak: 'Halaman statis tidak berisi data rahasia; risikonya kecil.',
    mitigasi: 'Hanya dicatat: halaman statis dilayani nginx langsung, di luar jangkauan blokir aplikasi. Bila polanya honeypot, IP tetap dimasukkan daftar blokir sehingga permintaannya ke API ditolak.',
    saran: 'Untuk menolaknya di nginx juga, pasang aturan deny/geo-block di nginx (perintahnya tersedia di Pengaturan).',
  },
  upload_rejected: {
    label: 'Unggahan Ditolak', severity: 'low', info: 'Unggahan ditolak karena kuota/ukuran storage.',
    apa: 'Unggahan berkas ditolak karena kuota atau ukuran storage.',
    tujuan: 'Biasanya bukan serangan; bisa juga upaya memenuhi disk.',
    dampak: 'Tidak ada.',
    mitigasi: 'Unggahan ditolak sebelum berkas disimpan.',
    saran: 'Periksa tab Storage bila sering terjadi.',
  },
  geo_blocked: {
    label: 'Diblokir (Negara)', severity: 'low', info: 'Request anonim dari negara yang sedang diblokir.',
    apa: 'Permintaan anonim dari negara yang sedang Anda blokir.',
    tujuan: '—',
    dampak: 'Tidak ada.',
    mitigasi: 'Ditolak 403 di API. Permintaan pertama dari IP yang lokasinya belum diketahui bisa lolos sampai lokasinya selesai dicari, dan halaman statis di nginx tidak ikut terblokir.',
  },
  honeypot: {
    label: 'Terjebak Honeypot', severity: 'critical', info: 'Meminta alamat jebakan yang tidak pernah dipakai pengguna sah — pasti pemindai otomatis. Langsung diblokir.',
    apa: 'Honeypot adalah alamat jebakan yang sengaja dipantau, misalnya /.env, /.git/config, /wp-login.php, /phpmyadmin. Alamat-alamat ini tidak ada di aplikasi DPMD, jadi pengguna sah tidak pernah membukanya — yang memintanya pasti pemindai otomatis.',
    tujuan: 'Mencari berkas rahasia yang tidak sengaja terbuka (kunci database, sandi, token API di .env), repositori kode, atau panel admin CMS yang bisa dibobol.',
    dampak: 'Tidak ada data yang bocor: berkas yang diminta tidak ada di folder web, jadi permintaan dijawab 404 (tidak ditemukan). Penyerang tidak "masuk" ke server.',
    mitigasi: 'Permintaan dijawab 404, lalu IP langsung diblokir otomatis 24 jam (1.440 menit) sehingga semua permintaan berikutnya ke API ditolak 403.',
    saran: 'Tidak perlu tindakan. Bila IP yang sama kembali setelah blokir habis, pertimbangkan blokir permanen.',
  },
};

/**
 * Jalur jebakan. Tidak ada satu pun yang ada di aplikasi ini (Node + React),
 * jadi yang memintanya pasti alat pemindai yang mencari rahasia/CMS/shell.
 * Sengaja lebih sempit dari aturan `scanner` supaya salah tangkap nyaris nol.
 */
const HONEYPOT_PATTERN = /(\/\.env(\.\w+)?($|\?|\/))|(\/\.git\/(config|HEAD))|(\/wp-login\.php)|(\/xmlrpc\.php)|(\/phpmyadmin)|(\/\.aws\/credentials)|(\/vendor\/phpunit\/)|(\/(shell|cmd|c99|r57|wso)\.php)|(\/boaform)|(\/HNAP1)|(\/cgi-bin\/(luci|\.%2e))|(\/\.ssh\/id_rsa)|(\/etc\/passwd)/i;

/**
 * Lokasi server di globe (titik tujuan garis serangan). Bawaan: Kantor DPMD
 * Kabupaten Bogor, Cibinong. Bisa diganti lewat env SERVER_GEO_LAT/LON.
 */
const SERVER_LOCATION = {
  label: process.env.SERVER_GEO_LABEL || 'DPMD Kab. Bogor',
  lat: Number(process.env.SERVER_GEO_LAT) || -6.4815,
  lon: Number(process.env.SERVER_GEO_LON) || 106.854,
};

/**
 * Aturan deteksi. Diuji terhadap URL (sudah di-decode), dan untuk sebagian
 * aturan juga isi body. Sengaja konservatif: lebih baik melewatkan satu
 * serangan kreatif daripada memblokir pegawai yang mengetik "select" di
 * formulir.
 */
const DETECTION_RULES = [
  {
    type: 'sql_injection',
    body: true,
    pattern: /(\bunion\b[\s\S]{0,40}\bselect\b)|(\bselect\b[\s\S]{1,80}\bfrom\b[\s\S]{0,40}\binformation_schema\b)|(\b(sleep|benchmark|pg_sleep)\s*\(\s*\d)|('\s*(or|and)\s+'?\d+'?\s*=\s*'?\d+)|(;\s*(drop|truncate|alter)\s+table\b)|(\bload_file\s*\()|(\binto\s+(out|dump)file\b)|(\bwaitfor\s+delay\b)/i,
  },
  {
    type: 'xss',
    body: false, // body berita/informasi boleh berisi HTML
    pattern: /(<\s*script\b)|(javascript\s*:)|(\bon(error|load|mouseover|focus)\s*=)|(<\s*(iframe|svg|img)[^>]*\bon\w+\s*=)|(document\.cookie)/i,
  },
  {
    type: 'path_traversal',
    body: false,
    pattern: /(\.\.[\\/]){2,}|(\/etc\/(passwd|shadow|hosts))|(\\windows\\win\.ini)|(\/proc\/self\/environ)/i,
  },
  {
    type: 'command_injection',
    body: true,
    pattern: /([;|`]\s*(cat|wget|curl|bash|sh|nc|ncat|python|perl|chmod|rm)\s+[-/\w])|(\$\(\s*(cat|wget|curl|id|whoami|uname)\b)/i,
  },
  {
    type: 'scanner',
    body: false,
    pattern: /(\/\.env(\.|$|\/|\?))|(\/\.git\/)|(\/wp-(admin|login|content|includes))|(\/xmlrpc\.php)|(\/phpmyadmin)|(\/pma\/)|(\/cgi-bin\/)|(\/vendor\/phpunit)|(\/actuator(\/|$))|(\/boaform)|(\/HNAP1)|(\/\.aws\/)|(\/server-status)|(\/\.DS_Store)|(\/config\.php)|(\/shell\.php)|(\/admin\.php)|(\/setup\.cgi)|(\.(asp|aspx|jsp)(\?|$))/i,
  },
];

/** User-Agent alat serang otomatis. */
const BAD_USER_AGENTS = /(sqlmap|nikto|nmap|masscan|zgrab|nuclei|acunetix|wpscan|dirbuster|gobuster|ffuf|hydra|havij|netsparker|w3af|openvas|nessus|jaeles|feroxbuster|whatweb)/i;

/** Ambang banjir per IP dalam jendela 5 menit. */
const FLOOD_THRESHOLDS = {
  window_ms: 5 * 60 * 1000,
  unauthorized: 40, // 401/403
  not_found: 80, // 404
  login_failed: 6, // → brute_force
};

/** Folder berkas yang dihitung untuk storage aplikasi. */
const STORAGE_FOLDERS = [
  { key: 'storage', label: 'Storage (publik)', path: path.join(BACKEND_ROOT, 'storage') },
  { key: 'private', label: 'Private (Drive & formulir)', path: path.join(BACKEND_ROOT, 'private') },
  { key: 'public_backups', label: 'Backup lokal', path: path.join(BACKEND_ROOT, 'public/backups') },
  { key: 'logs', label: 'Log aplikasi', path: path.join(BACKEND_ROOT, 'logs') },
];

/** Target pembersihan yang boleh dijalankan dari UI. */
const CLEANUP_TARGETS = {
  temp: { label: 'Berkas sementara unggahan', path: path.join(BACKEND_ROOT, 'storage/uploads/temp') },
  hls: { label: 'Sisa siaran HLS video meeting', path: path.join(BACKEND_ROOT, 'storage/hls') },
  logs: { label: 'Log aplikasi (dikosongkan)', path: path.join(BACKEND_ROOT, 'logs') },
  backups: { label: 'Backup lokal lama', path: path.join(BACKEND_ROOT, 'public/backups') },
};

const LOG_FILES = {
  error: path.join(BACKEND_ROOT, 'logs/error.log'),
  combined: path.join(BACKEND_ROOT, 'logs/combined.log'),
};

/** Log sistem yang dipindai untuk serangan di luar aplikasi (Linux saja). */
const SYSTEM_LOGS = {
  nginx_access: '/var/log/nginx/access.log',
  nginx_error: '/var/log/nginx/error.log',
  auth: '/var/log/auth.log',
};

/** Layanan systemd yang dicek statusnya bila ada di server. */
const SYSTEM_SERVICES = [
  { unit: 'nginx', label: 'Nginx (web server)' },
  { unit: 'mysql', label: 'MySQL (database)' },
  { unit: 'mariadb', label: 'MariaDB (database)' },
  { unit: 'ssh', label: 'SSH (akses remote)' },
  { unit: 'cron', label: 'Cron (penjadwal)' },
  { unit: 'fail2ban', label: 'Fail2ban (anti brute-force)' },
  { unit: 'ufw', label: 'UFW (firewall)' },
  { unit: 'redis-server', label: 'Redis (cache)' },
  { unit: 'coturn', label: 'TURN server (video meeting)' },
];

/** Repo yang bisa di-deploy ulang / di-rollback dari panel. */
const DEPLOY_REPOS = [
  { key: 'dpmd-fahri-express', label: 'Backend', dir: process.env.DEPLOY_BACKEND_DIR || '/var/www/backend', proses: 'dpmd-backend' },
  { key: 'dpmd-frontend', label: 'Frontend', dir: process.env.DEPLOY_FRONTEND_DIR || '/var/www/frontend', proses: null },
];

/** Deskripsi jejak audit -> kategori jurnal tindakan (urutan penting). */
const KATEGORI_TINDAKAN = [
  [/^Membuka blokir/i, 'buka_blokir'],
  [/^Memblokir/i, 'blokir'],
  [/^(Deploy ulang|Rollback deploy)/i, 'deploy'],
  [/^(Snapshot|Rollback snapshot|Hapus snapshot|Backup|Hapus berkas backup)/i, 'backup'],
  [/^(Proxmox|Menambah disk|Mengubah sumber daya)/i, 'proxmox'],
  [/^(PM2|Memperbarui \d+ monitor)/i, 'aplikasi'],
  [/(pengaturan|konfigurasi|notifikasi)/i, 'konfigurasi'],
  [/^(Membersihkan|Menghapus seluruh jejak|Mereset)/i, 'pembersihan'],
];

const kategoriTindakan = (deskripsi) => (KATEGORI_TINDAKAN.find(([re]) => re.test(String(deskripsi || ''))) || [null, 'lainnya'])[1];

module.exports = {
  CONFIG_KEY,
  DEPLOY_REPOS,
  KATEGORI_TINDAKAN,
  kategoriTindakan,
  BACKEND_ROOT,
  DEFAULT_CONFIG,
  IP_TEPERCAYA,
  SEVERITY_SCORE,
  EVENT_TYPES,
  SERVER_LOCATION,
  HONEYPOT_PATTERN,
  DETECTION_RULES,
  BAD_USER_AGENTS,
  FLOOD_THRESHOLDS,
  STORAGE_FOLDERS,
  CLEANUP_TARGETS,
  LOG_FILES,
  SYSTEM_LOGS,
  SYSTEM_SERVICES,
};
