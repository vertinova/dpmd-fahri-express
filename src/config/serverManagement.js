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
  },
  // Monitor uptime: [{ name, url }]. Kosong = daftar bawaan (lihat
  // serverApps.service.js → defaultMonitors).
  monitors: [],
};

/** Bobot skor ancaman per tingkat keparahan. */
const SEVERITY_SCORE = { low: 1, medium: 3, high: 8, critical: 15 };

/**
 * Jenis kejadian keamanan. Label & penjelasan ikut dikirim ke frontend supaya
 * superadmin yang bukan orang keamanan tetap paham artinya.
 */
const EVENT_TYPES = {
  sql_injection: { label: 'SQL Injection', severity: 'critical', info: 'Upaya menyisipkan perintah SQL untuk membaca/merusak database.' },
  xss: { label: 'Cross-Site Scripting (XSS)', severity: 'high', info: 'Upaya menyisipkan skrip berbahaya ke halaman.' },
  path_traversal: { label: 'Path Traversal', severity: 'critical', info: 'Upaya membaca berkas sistem di luar folder aplikasi (mis. /etc/passwd).' },
  command_injection: { label: 'Command Injection', severity: 'critical', info: 'Upaya menjalankan perintah shell di server.' },
  scanner: { label: 'Pemindaian Celah', severity: 'medium', info: 'Bot mencari berkas sensitif/CMS umum (.env, wp-admin, phpmyadmin).' },
  bad_bot: { label: 'Alat Peretasan', severity: 'high', info: 'User-Agent milik alat serang otomatis (sqlmap, nikto, nmap, dll).' },
  login_failed: { label: 'Login Gagal', severity: 'low', info: 'Percobaan masuk dengan email/sandi salah.' },
  brute_force: { label: 'Brute Force Login', severity: 'high', info: 'Banyak login gagal beruntun dari satu IP — menebak sandi.' },
  rate_limit: { label: 'Banjir Request', severity: 'medium', info: 'IP melewati batas jumlah request (indikasi DoS/scraping).' },
  auth_flood: { label: 'Akses Tanpa Izin Beruntun', severity: 'medium', info: 'Banyak request ditolak 401/403 dalam waktu singkat.' },
  not_found_flood: { label: 'Banjir 404', severity: 'medium', info: 'Banyak request ke alamat yang tidak ada — ciri pemindaian direktori.' },
  blocked_request: { label: 'Request Diblokir', severity: 'low', info: 'Request dari IP yang sedang diblokir.' },
  auto_blocked: { label: 'IP Diblokir Otomatis', severity: 'high', info: 'Skor ancaman IP melewati ambang, sistem memblokirnya.' },
  ssh_failed: { label: 'SSH Login Gagal', severity: 'medium', info: 'Percobaan masuk SSH ke server gagal (dari /var/log/auth.log).' },
  nginx_attack: { label: 'Serangan di Nginx', severity: 'medium', info: 'Pola serangan terdeteksi di log akses nginx.' },
  upload_rejected: { label: 'Unggahan Ditolak', severity: 'low', info: 'Unggahan ditolak karena kuota/ukuran storage.' },
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

module.exports = {
  CONFIG_KEY,
  BACKEND_ROOT,
  DEFAULT_CONFIG,
  SEVERITY_SCORE,
  EVENT_TYPES,
  DETECTION_RULES,
  BAD_USER_AGENTS,
  FLOOD_THRESHOLDS,
  STORAGE_FOLDERS,
  CLEANUP_TARGETS,
  LOG_FILES,
  SYSTEM_LOGS,
  SYSTEM_SERVICES,
};
