/**
 * Mesin SOC (Security Operations Center) Manajemen Server.
 *
 * Tiap 30 detik: event keamanan & login baru dikorelasikan menjadi INSIDEN
 * (aturan di socAturan.js), insiden lama yang sepi ditutup otomatis, lalu SATU
 * pekerjaan AI (analisis / penutup) dijalankan di latar belakang. AI tidak
 * pernah menahan siklus korelasi dan SOC tidak pernah mengambil tindakan yang
 * merusak (blokir IP hanya atas perintah superadmin).
 */

const logger = require('../utils/logger');
const store = require('./serverStore.service');
const geo = require('./serverGeo.service');
const security = require('./serverSecurity.service');
const aturan = require('./socAturan');
const analis = require('./socAnalis.service');
const { EVENT_TYPES } = require('../config/serverManagement');
const { selang } = require('../config/dialek');

const SIKLUS_MS = 30 * 1000;
const JENDELA_TEMPEL_JAM = 6;
const JEDA_PUSH_MS = 30 * 60 * 1000;
const STATUS_TERBUKA = ['baru', 'ditangani'];
const STATUS_TUTUP = ['selesai', 'positif_palsu'];
const STATUS_SEMUA = [...STATUS_TERBUKA, ...STATUS_TUTUP];
const TIPE_BERBAHAYA = ['brute_force', 'honeypot', 'auto_blocked', 'sql_injection', 'command_injection'];

let berjalan = false;
let aiSibuk = false;
let aiSedang = null; // kode insiden yang sedang dikerjakan AI
let aiTerakhir = null;
const aiGagal = new Map(); // id → jumlah gagal pembuatan dokumentasi
const aiJeda = new Map(); // id → waktu gagal analisis (jeda 5 menit)
const aiDiminta = new Set(); // id insiden yang dimintai analisis manual
const pushTerakhir = new Map(); // id insiden → waktu push terakhir

/* ------------------------------------------------------------- utilitas -- */

const galat = (pesan, status) => Object.assign(new Error(pesan), { status });
const tglWib = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d).replace(/-/g, '');
const jamWib = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(d));
const placeholder = (n) => Array(n).fill('?').join(',');
const kecil = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
// LAN DPMD memakai 172.168.x.x (bukan RFC1918, jadi tidak dikenali geo.privat): proxy Nginx = 172.168.20.23.
const internal = (ip) => geo.privat(ip) || /^172\.168\./.test(ip || '');
const cfgSoc = () => store.getConfigSync().soc || {};

const ambilKursor = async (kunci) => {
  const [b] = await store.query('SELECT nilai FROM soc_kursor WHERE kunci = ?', kunci);
  return b ? b.nilai : null;
};
const simpanKursor = (kunci, nilai) => store.execute(
  `INSERT INTO soc_kursor (kunci, nilai, updated_at) VALUES (?, ?, NOW())
   ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, updated_at = NOW()`,
  kunci, String(nilai),
);

const catat = (insidenId, oleh, jenis, isi) => store.execute(
  'INSERT INTO soc_insiden_log (insiden_id, oleh, jenis, isi) VALUES (?, ?, ?, ?)',
  insidenId, oleh, jenis, String(isi),
);

/* ---------------------------------------------------------------- push -- */

const kirimNotif = (ins, ringkas) => {
  const terakhir = pushTerakhir.get(ins.id);
  if (terakhir && Date.now() - terakhir < JEDA_PUSH_MS) return;
  pushTerakhir.set(ins.id, Date.now());
  // Dimuat saat dipakai supaya berkas ini tidak menarik rantai notifikasi saat dimuat.
  require('./serverNotify.service').kirimPush({ title: `SOC: ${ins.severity} — ${ins.judul}`, body: `${ins.kode} — ${ringkas}` })
    .catch((e) => logger.warn(`[SOC] Push gagal: ${e.message}`));
};

/* ------------------------------------------------------ buka / tempel -- */

const cariTerbuka = async (kunci) => {
  const [b] = await store.query(
    `SELECT * FROM soc_insiden WHERE kunci = ? AND status IN ('baru','ditangani')
        AND terakhir_at > NOW() - ${selang(JENDELA_TEMPEL_JAM, 'HOUR')} ORDER BY id DESC LIMIT 1`,
    kunci,
  );
  return b || null;
};

const buatInsiden = async (hasil, { ip, userId, at }) => {
  const tgl = tglWib(new Date());
  const [{ n }] = await store.query(
    'SELECT COALESCE(MAX(CAST(SUBSTRING(kode FROM 14) AS INT)), 0) AS n FROM soc_insiden WHERE kode LIKE ?',
    `INS-${tgl}-%`,
  );
  const kode = `INS-${tgl}-${String(Number(n) + 1).padStart(3, '0')}`;
  const [baris] = await store.query(
    `INSERT INTO soc_insiden (kode, judul, kategori, severity, kunci, ip_address, user_id, pertama_at, terakhir_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    kode, hasil.judul.slice(0, 255), hasil.kategori, hasil.severity, hasil.kunci, ip || null, userId || null, at, at,
  );
  await catat(baris.id, 'sistem', 'dibuat', `Insiden dibuka otomatis: ${hasil.judul} (tingkat ${hasil.severity}).`);
  return baris;
};

/** Konteks satu siklus: cache insiden terbuka per kunci + tumpukan penempelan. */
const siklusBaru = () => ({ terbuka: new Map(), tumpuk: new Map() });

/**
 * Terapkan hasil penilaian pada satu event/login: buka insiden baru, atau
 * tempelkan ke insiden terbuka berkunci sama (naikkan tingkat bila lebih berat).
 */
const terapkan = async (sk, hasil, kunci, info) => {
  let ins = sk.terbuka.get(kunci);
  if (ins === undefined) {
    ins = await cariTerbuka(kunci);
    sk.terbuka.set(kunci, ins);
  }
  if (!ins) {
    if (!hasil?.buka) return;
    ins = await buatInsiden(hasil, info);
    sk.terbuka.set(kunci, ins);
    if (aturan.bandingSeverity(ins.severity, 'high') >= 0) kirimNotif(ins, hasil.judul);
  } else if (hasil?.buka && aturan.bandingSeverity(hasil.severity, ins.severity) > 0) {
    const lama = ins.severity;
    await store.execute('UPDATE soc_insiden SET severity = ?, updated_at = NOW() WHERE id = ?', hasil.severity, ins.id);
    ins.severity = hasil.severity;
    await catat(ins.id, 'sistem', 'eskalasi', `Tingkat naik dari ${lama} ke ${hasil.severity}: ${hasil.judul}`);
    if (aturan.bandingSeverity(hasil.severity, 'high') >= 0) kirimNotif(ins, hasil.judul);
  }

  // sumber null = pemicu tanpa baris bukti (perubahan peran superadmin).
  const masuk = info.sumber ? await store.execute(
    'INSERT INTO soc_insiden_event (insiden_id, sumber, ref_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    ins.id, info.sumber, info.refId,
  ) : 1;
  if (!masuk) return;
  const t = sk.tumpuk.get(ins.id) || { n: 0, at: info.at, tipe: new Map() };
  t.n += 1;
  if (info.at > t.at) t.at = info.at;
  t.tipe.set(info.tipe, (t.tipe.get(info.tipe) || 0) + 1);
  sk.tumpuk.set(ins.id, t);
};

/** Tulis jumlah event & SATU log 'event' per insiden untuk siklus ini. */
const selesaikanSiklus = async (sk) => {
  for (const [id, t] of sk.tumpuk) {
    await store.execute(
      'UPDATE soc_insiden SET jumlah_event = jumlah_event + ?, terakhir_at = GREATEST(terakhir_at, ?), updated_at = NOW() WHERE id = ?',
      t.n, t.at, id,
    );
    const tipe = [...t.tipe].map(([k, v]) => `${k} ×${v}`).join(', ');
    await catat(id, 'sistem', 'event', `${t.n} event baru (tipe: ${tipe})`);
  }
};

/* ------------------------------------------------------------ korelasi -- */

const korelasiEvent = async (cfg, sk) => {
  const kursor = await ambilKursor('event_id');
  if (kursor === null) {
    const [{ m }] = await store.query('SELECT COALESCE(MAX(id), 0) AS m FROM server_security_events');
    await simpanKursor('event_id', m);
    return;
  }
  const events = await store.query(
    `SELECT id, ip_address, event_type, severity, source, path, detail, blocked, created_at
       FROM server_security_events WHERE id > ? ORDER BY id LIMIT 2000`,
    Number(kursor),
  );
  if (!events.length) return;

  // Event medium IP-IP ini dalam jendela 30 menit (satu query per potongan IP).
  const medium = new Map(); // ip → [{id, at}]
  const ipMedium = [...new Set(events.filter((e) => e.severity === 'medium').map((e) => e.ip_address))];
  if (ipMedium.length) {
    const dari = new Date(Math.min(...events.map((e) => new Date(e.created_at).getTime())) - 30 * 60000);
    for (const potong of kecil(ipMedium, 500)) {
      const baris = await store.query(
        `SELECT id, ip_address, created_at FROM server_security_events
          WHERE severity = 'medium' AND created_at >= ? AND ip_address IN (${placeholder(potong.length)})`,
        dari, ...potong,
      );
      for (const b of baris) {
        const l = medium.get(b.ip_address) || [];
        l.push({ id: b.id, at: new Date(b.created_at).getTime() });
        medium.set(b.ip_address, l);
      }
    }
  }

  const ipKantor = new Set(cfg.ip_kantor || []);
  for (const e of events) {
    const at = new Date(e.created_at);
    const ctx = {
      ipKantor,
      ipPrivat: internal,
      hitungMedium: (ip) => (medium.get(ip) || []).filter((x) => x.id <= e.id && x.at >= at.getTime() - 30 * 60000).length,
    };
    const hasil = aturan.nilaiEvent(e, ctx);
    const kunci = aturan.kunciEvent(e);
    await terapkan(sk, hasil, kunci, {
      sumber: 'keamanan', refId: e.id, at, tipe: e.event_type,
      ip: kunci.startsWith('ip:') ? e.ip_address : null,
    });
  }
  await simpanKursor('event_id', events[events.length - 1].id);
};

const korelasiLogin = async (cfg, sk) => {
  const kursor = await ambilKursor('login_id');
  if (kursor === null) {
    const [{ m }] = await store.query('SELECT COALESCE(MAX(id), 0) AS m FROM login_histories');
    await simpanKursor('login_id', m);
    return;
  }
  const logins = await store.query(
    'SELECT id, user_id, ip_address, status, created_at FROM login_histories WHERE id > ? ORDER BY id LIMIT 500',
    Number(kursor),
  );
  if (!logins.length) return;

  const ipKantor = new Set(cfg.ip_kantor || []);
  for (const l of logins) {
    if (String(l.status).toLowerCase() !== 'success' || !l.ip_address) continue;
    const at = new Date(l.created_at || Date.now());
    const [user] = await store.query('SELECT name, role FROM users WHERE id = ?', l.user_id);
    if (!user) continue;
    const [pernah] = await store.query(
      `SELECT 1 AS ada FROM login_histories WHERE user_id = ? AND ip_address = ? AND status = 'success' AND id < ? AND created_at >= ? LIMIT 1`,
      l.user_id, l.ip_address, l.id, new Date(at.getTime() - 90 * 86400000),
    );
    const g = geo.dariCache(l.ip_address);
    if (!g) geo.antre(l.ip_address);
    // IP kantor/internal dipakai bersama: event berbahaya di sana bukan tanda akun disalahgunakan.
    let berbahaya = false;
    if (!internal(l.ip_address) && !ipKantor.has(l.ip_address)) {
      const [b] = await store.query(
        `SELECT 1 AS ada FROM server_security_events
          WHERE ip_address = ? AND created_at >= ? AND created_at <= ?
            AND (event_type IN (${placeholder(TIPE_BERBAHAYA.length)}) OR blocked = TRUE) LIMIT 1`,
        l.ip_address, new Date(at.getTime() - 86400000), at, ...TIPE_BERBAHAYA,
      );
      berbahaya = !!b;
    }
    const hasil = aturan.nilaiLogin(l, {
      peran: String(user.role).toLowerCase(),
      ipPernahDipakai: !!pernah,
      negara: g?.cc || null,
      ipBerbahaya: berbahaya,
      jamWib: jamWib(at),
      jamSepiMulai: cfg.jam_sepi_mulai,
      jamSepiSelesai: cfg.jam_sepi_selesai,
    });
    if (!hasil) continue;
    hasil.judul = `${hasil.judul}: ${user.name}`;
    await terapkan(sk, hasil, hasil.kunci, { sumber: 'login', refId: l.id, at, tipe: 'login_sukses', ip: l.ip_address, userId: l.user_id });
  }
  await simpanKursor('login_id', logins[logins.length - 1].id);
};

const korelasi2fa = async (cfg, sk) => {
  const baris = await store.query(
    `SELECT id, ip_address, detail, created_at FROM server_security_events
      WHERE event_type = 'login_failed' AND created_at >= NOW() - ${selang(15, 'MINUTE')} AND detail LIKE '%kode 2FA salah%'
      ORDER BY id`,
  );
  const perEmail = new Map();
  for (const b of baris) {
    const email = aturan.emailDariDetail(b.detail);
    if (!email) continue;
    perEmail.set(email, [...(perEmail.get(email) || []), b]);
  }
  for (const [email, daftar] of perEmail) {
    const hasil = aturan.nilai2fa(daftar);
    if (!hasil) continue;
    const [u] = await store.query('SELECT id FROM users WHERE email = ?', email);
    const terakhir = daftar[daftar.length - 1];
    for (const b of daftar) {
      await terapkan(sk, hasil, hasil.kunci, {
        sumber: 'keamanan', refId: b.id, at: new Date(b.created_at), tipe: 'login_failed',
        ip: terakhir.ip_address, userId: u?.id || null,
      });
    }
  }
};

const periksaSuperadmin = async (cfg, sk) => {
  const baris = await store.query("SELECT id, name, email FROM users WHERE role = 'superadmin' AND is_active = TRUE");
  const baru = new Set(baris.map((b) => String(b.id)));
  const simpan = await ambilKursor('superadmin_ids');
  await simpanKursor('superadmin_ids', JSON.stringify([...baru]));
  if (simpan === null) return;
  const { tambah, hapus } = aturan.perubahanSuperadmin(new Set(JSON.parse(simpan)), baru);
  const sekarang = new Date();
  for (const id of tambah) {
    const b = baris.find((x) => String(x.id) === id);
    await terapkan(sk, { buka: true, kunci: `peran:${id}`, kategori: 'akun', severity: 'critical', judul: `Akun superadmin baru: ${b.name} (${b.email})` },
      `peran:${id}`, { sumber: null, at: sekarang, tipe: 'superadmin_baru', userId: id });
  }
  for (const id of hapus) {
    const [b] = await store.query('SELECT name, email FROM users WHERE id = ?', id);
    const nama = b ? `${b.name} (${b.email})` : `id ${id}`;
    await terapkan(sk, { buka: true, kunci: `peran:${id}`, kategori: 'akun', severity: 'medium', judul: `Akun superadmin dicabut/nonaktif: ${nama}` },
      `peran:${id}`, { sumber: null, at: sekarang, tipe: 'superadmin_dicabut', userId: id });
  }
};

/** Jumlah login sukses yang terkait insiden (tertempel, atau dari IP penyerang yang publik). */
const loginTerkait = async (ins) => {
  const [{ n }] = await store.query("SELECT COUNT(*) AS n FROM soc_insiden_event WHERE insiden_id = ? AND sumber = 'login'", ins.id);
  let total = Number(n);
  const ip = ins.ip_address;
  if (ip && String(ins.kunci).startsWith('ip:') && !internal(ip) && !(cfgSoc().ip_kantor || []).includes(ip)) {
    const [{ m }] = await store.query(
      "SELECT COUNT(*) AS m FROM login_histories WHERE ip_address = ? AND status = 'success' AND created_at >= ?",
      ip, new Date(ins.pertama_at),
    );
    total += Number(m);
  }
  return total;
};

const tutupOtomatis = async (cfg) => {
  const jam = Math.max(1, Math.floor(Number(cfg.tutup_otomatis_jam)) || 24);
  const kandidat = await store.query(
    `SELECT * FROM soc_insiden WHERE status = 'baru' AND severity IN ('low','medium','high') AND kategori <> 'akun'
        AND terakhir_at < NOW() - ${selang(jam, 'HOUR')}`,
  );
  for (const ins of kandidat) {
    if (await loginTerkait(ins)) continue;
    await store.execute(
      `UPDATE soc_insiden SET status = 'selesai', selesai_at = NOW(), ditutup_oleh = 'sistem', catatan_tutup = ?, updated_at = NOW() WHERE id = ?`,
      `Ditutup otomatis: tidak ada aktivitas ${jam} jam; seluruh permintaan berbahaya ditolak/diblokir aplikasi.`, ins.id,
    );
    await catat(ins.id, 'sistem', 'status', `Status diubah: baru → selesai (ditutup otomatis, tidak ada aktivitas ${jam} jam).`);
  }
};

/* ------------------------------------------------------------------ AI -- */

const ambilInsiden = async (id) => {
  const [b] = await store.query('SELECT * FROM soc_insiden WHERE id = ?', Number(id));
  if (!b) throw galat('Insiden tidak ditemukan', 404);
  return b;
};

const kumpulkanFakta = async (ins) => {
  const log = await store.query('SELECT id, at, oleh, jenis, isi FROM soc_insiden_log WHERE insiden_id = ? ORDER BY at, id', ins.id);
  const perTipe = await store.query(
    `SELECT e.event_type AS tipe, COUNT(*) AS n,
            SUM(CASE WHEN e.blocked OR e.event_type = 'blocked_request' THEN 1 ELSE 0 END) AS ditolak
       FROM soc_insiden_event se JOIN server_security_events e ON e.id = se.ref_id
      WHERE se.insiden_id = ? AND se.sumber = 'keamanan' GROUP BY e.event_type ORDER BY n DESC`,
    ins.id,
  );
  const paths = await store.query(
    `SELECT e.path, COUNT(*) AS n FROM soc_insiden_event se JOIN server_security_events e ON e.id = se.ref_id
      WHERE se.insiden_id = ? AND se.sumber = 'keamanan' AND e.path IS NOT NULL GROUP BY e.path ORDER BY n DESC LIMIT 10`,
    ins.id,
  );
  const uas = await store.query(
    `SELECT e.user_agent, COUNT(*) AS n FROM soc_insiden_event se JOIN server_security_events e ON e.id = se.ref_id
      WHERE se.insiden_id = ? AND se.sumber = 'keamanan' AND e.user_agent IS NOT NULL GROUP BY e.user_agent ORDER BY n DESC LIMIT 5`,
    ins.id,
  );
  const [{ n: nLogin }] = await store.query("SELECT COUNT(*) AS n FROM soc_insiden_event WHERE insiden_id = ? AND sumber = 'login'", ins.id);
  const [akun] = ins.user_id ? await store.query('SELECT name, role FROM users WHERE id = ?', ins.user_id) : [];
  const tipe = perTipe.map((t) => ({ tipe: t.tipe, label: EVENT_TYPES[t.tipe]?.label || t.tipe, n: Number(t.n), ditolak: Number(t.ditolak) }));
  if (Number(nLogin)) tipe.push({ tipe: 'login_sukses', label: 'Login berhasil', n: Number(nLogin), ditolak: 0 });
  const fakta = analis.susunFakta({
    insiden: ins,
    log,
    geo: ins.ip_address ? geo.dariCache(ins.ip_address) : null,
    akun: akun ? { nama: akun.name, peran: akun.role } : null,
    ringkasEvent: {
      perTipe: tipe,
      paths: paths.map((p) => p.path),
      userAgents: uas.map((u) => u.user_agent),
      ditolak: tipe.reduce((t, x) => t + x.ditolak, 0),
      ipDiblokir: ins.ip_address ? !!security.isBlocked(ins.ip_address) : false,
      loginSukses: await loginTerkait(ins),
    },
  });
  return { fakta, log };
};

const buatDokumentasi = async (ins, { aiPenutup = null, draf = false } = {}) => {
  const { fakta, log } = await kumpulkanFakta(ins);
  return analis.susunDokumentasi({ insiden: ins, fakta, log, aiPenutup, analisisAi: ins.analisis_ai, draf });
};

const kerjakanDokumentasi = async (ins) => {
  let aiPenutup = null;
  let catatanAi = '';
  if (analis.tersedia() && (aiGagal.get(ins.id) || 0) < 3) {
    aiSedang = ins.kode;
    try {
      const { fakta } = await kumpulkanFakta(ins);
      aiPenutup = await analis.penutup(fakta, ins.catatan_tutup);
    } catch (error) {
      aiGagal.set(ins.id, (aiGagal.get(ins.id) || 0) + 1);
      logger.warn(`[SOC] Penutup AI ${ins.kode} gagal (${aiGagal.get(ins.id)}x): ${error.message}`);
      if (aiGagal.get(ins.id) < 3) return;
      catatanAi = ' Bagian AI dilewati karena gagal 3 kali.';
    }
  } else if (!analis.tersedia()) {
    catatanAi = ' AI lokal tidak tersedia; bagian AI dilewati.';
  }
  const markdown = await buatDokumentasi(ins, { aiPenutup });
  // Jangan menimpa bila status insiden berubah (dibuka kembali) selama AI bekerja.
  const ok = await store.execute(
    `UPDATE soc_insiden SET dokumentasi = ?, dokumentasi_at = NOW() WHERE id = ? AND dokumentasi IS NULL AND status IN ('selesai','positif_palsu')`,
    markdown, ins.id,
  );
  if (ok) await catat(ins.id, 'AI Gema', 'dokumentasi', `Dokumentasi insiden disusun.${catatanAi}`);
  aiGagal.delete(ins.id);
};

const kerjakanAnalisis = async (ins) => {
  aiSedang = ins.kode;
  try {
    const { fakta } = await kumpulkanFakta(ins);
    const teks = await analis.analisis(fakta);
    await store.execute(
      'UPDATE soc_insiden SET analisis_ai = ?, analisis_ai_at = NOW(), analisis_jumlah_event = ? WHERE id = ?',
      teks, ins.jumlah_event, ins.id,
    );
    await catat(ins.id, 'AI Gema', 'analisis', `Analisis diperbarui (${ins.jumlah_event} event).`);
    aiJeda.delete(ins.id);
    aiTerakhir = new Date();
  } catch (error) {
    aiJeda.set(ins.id, Date.now());
    logger.warn(`[SOC] Analisis AI ${ins.kode} gagal: ${error.message}`);
  }
};

const pekerjaanAi = async () => {
  // 1. Insiden tertutup belum berdokumentasi (selalu disusun, dengan atau tanpa AI).
  const [tutup] = await store.query(
    `SELECT * FROM soc_insiden WHERE status IN ('selesai','positif_palsu') AND dokumentasi IS NULL ORDER BY selesai_at LIMIT 1`,
  );
  if (tutup) return kerjakanDokumentasi(tutup);
  if (!analis.tersedia()) return null;

  // 2. Analisis: permintaan manual dulu, lalu insiden terbuka yang belum/kadaluarsa.
  for (const id of aiDiminta) {
    aiDiminta.delete(id);
    const [ins] = await store.query('SELECT * FROM soc_insiden WHERE id = ?', id);
    if (ins) return kerjakanAnalisis(ins);
  }
  const kandidat = await store.query(
    `SELECT * FROM soc_insiden WHERE status IN ('baru','ditangani') AND severity IN ('medium','high','critical')
        AND (analisis_ai IS NULL OR analisis_ai_at IS NULL
             OR (jumlah_event >= 2 * analisis_jumlah_event AND analisis_ai_at < NOW() - ${selang(30, 'MINUTE')}))
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, id LIMIT 10`,
  );
  const ins = kandidat.find((k) => !aiJeda.has(k.id) || Date.now() - aiJeda.get(k.id) > 5 * 60000);
  return ins ? kerjakanAnalisis(ins) : null;
};

/** Jalankan satu pekerjaan AI di latar belakang; tidak ditunggu siklus. */
const jalankanAi = () => {
  if (aiSibuk) return;
  aiSibuk = true;
  pekerjaanAi()
    .catch((e) => logger.warn(`[SOC] Antrean AI: ${e.message}`))
    .finally(() => { aiSibuk = false; aiSedang = null; });
};

/* --------------------------------------------------------------- siklus -- */

const siklus = async () => {
  if (berjalan) return;
  berjalan = true;
  try {
    const cfg = cfgSoc();
    if (cfg.aktif === false) return;
    const sk = siklusBaru();
    for (const [nama, langkah] of [['event', korelasiEvent], ['login', korelasiLogin], ['2fa', korelasi2fa], ['superadmin', periksaSuperadmin]]) {
      try { await langkah(cfg, sk); } catch (e) { logger.warn(`[SOC] Korelasi ${nama} gagal: ${e.message}`); }
    }
    try { await selesaikanSiklus(sk); } catch (e) { logger.warn(`[SOC] Menyimpan siklus gagal: ${e.message}`); }
    try { await tutupOtomatis(cfg); } catch (e) { logger.warn(`[SOC] Tutup otomatis gagal: ${e.message}`); }
    jalankanAi();
  } catch (e) {
    logger.warn(`[SOC] Siklus gagal: ${e.message}`);
  } finally {
    berjalan = false;
  }
};

const start = () => {
  setTimeout(siklus, 20 * 1000).unref();
  setInterval(siklus, SIKLUS_MS).unref();
};

/* ------------------------------------------------------- untuk controller -- */

const ringkasan = async () => {
  const [a] = await store.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('baru','ditangani')) AS terbuka,
            COUNT(*) FILTER (WHERE status = 'baru') AS baru,
            COUNT(*) FILTER (WHERE status = 'ditangani') AS ditangani,
            COUNT(*) FILTER (WHERE status IN ('baru','ditangani') AND severity = 'critical') AS kritis_terbuka,
            COUNT(*) FILTER (WHERE status IN ('selesai','positif_palsu') AND selesai_at >= NOW() - ${selang(30, 'DAY')}) AS selesai_30h
       FROM soc_insiden`,
  );
  const [m] = await store.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (selesai_at - created_at))) / 60 AS mttr FROM soc_insiden
      WHERE selesai_at >= NOW() - ${selang(30, 'DAY')} AND ditutup_oleh IS NOT NULL AND ditutup_oleh <> 'sistem'`,
  );
  const [d] = await store.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (created_at - pertama_at))) AS mttd FROM soc_insiden WHERE created_at >= NOW() - ${selang(30, 'DAY')}`,
  );
  const perKategori = await store.query(
    "SELECT kategori, COUNT(*) AS n FROM soc_insiden WHERE status IN ('baru','ditangani') GROUP BY kategori ORDER BY n DESC",
  );
  const [q1] = await store.query("SELECT COUNT(*) AS n FROM soc_insiden WHERE status IN ('selesai','positif_palsu') AND dokumentasi IS NULL");
  const [q2] = await store.query(
    `SELECT COUNT(*) AS n FROM soc_insiden WHERE status IN ('baru','ditangani') AND severity IN ('medium','high','critical')
        AND (analisis_ai IS NULL OR analisis_ai_at IS NULL)`,
  );
  return {
    terbuka: Number(a.terbuka),
    baru: Number(a.baru),
    ditangani: Number(a.ditangani),
    kritis_terbuka: Number(a.kritis_terbuka),
    selesai_30h: Number(a.selesai_30h),
    mttr_menit: m.mttr === null ? null : Math.round(Number(m.mttr)),
    mttd_detik: d.mttd === null ? null : Math.round(Number(d.mttd)),
    per_kategori: perKategori.map((k) => ({ kategori: k.kategori, n: Number(k.n) })),
    ai: {
      tersedia: analis.tersedia(),
      sedang: aiSedang,
      antrean: Number(q1.n) + (analis.tersedia() ? Number(q2.n) : 0),
      terakhir_at: aiTerakhir,
    },
  };
};

const daftar = async ({ status = 'terbuka', severity, q, halaman = 1 } = {}) => {
  const where = [];
  const param = [];
  if (status === 'terbuka') where.push("i.status IN ('baru','ditangani')");
  else if (STATUS_SEMUA.includes(status)) { where.push('i.status = ?'); param.push(status); }
  if (['low', 'medium', 'high', 'critical'].includes(severity)) { where.push('i.severity = ?'); param.push(severity); }
  if (q) {
    where.push('(i.kode ILIKE ? OR i.judul ILIKE ? OR i.ip_address ILIKE ?)');
    param.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const hal = Math.max(1, Number(halaman) || 1);
  const items = await store.query(
    `SELECT i.id, i.kode, i.judul, i.kategori, i.severity, i.status, i.ip_address, i.user_id, u.name AS user_nama,
            i.jumlah_event, i.pertama_at, i.terakhir_at,
            (i.analisis_ai IS NOT NULL) AS ada_analisis, (i.dokumentasi IS NOT NULL) AS ada_dokumentasi
       FROM soc_insiden i LEFT JOIN users u ON u.id = i.user_id ${w}
      ORDER BY CASE WHEN i.status IN ('baru','ditangani') THEN 0 ELSE 1 END,
               CASE i.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
               i.terakhir_at DESC
      LIMIT 30 OFFSET ?`,
    ...param, (hal - 1) * 30,
  );
  const [{ n }] = await store.query(`SELECT COUNT(*) AS n FROM soc_insiden i ${w}`, ...param);
  return {
    items: items.map((r) => ({ ...r, ada_analisis: !!r.ada_analisis, ada_dokumentasi: !!r.ada_dokumentasi })),
    total: Number(n),
  };
};

const detail = async (id) => {
  const ins = await ambilInsiden(id);
  const [u] = ins.user_id ? await store.query('SELECT name FROM users WHERE id = ?', ins.user_id) : [];
  const log = await store.query('SELECT id, at, oleh, jenis, isi FROM soc_insiden_log WHERE insiden_id = ? ORDER BY at, id', ins.id);
  const ev = await store.query(
    `SELECT e.id, e.created_at AS at, e.event_type, e.severity, e.path, e.detail, e.blocked, e.ip_address AS ip
       FROM soc_insiden_event se JOIN server_security_events e ON e.id = se.ref_id
      WHERE se.insiden_id = ? AND se.sumber = 'keamanan' ORDER BY e.id DESC LIMIT 200`,
    ins.id,
  );
  const lg = await store.query(
    `SELECT l.id, l.created_at AS at, l.ip_address AS ip FROM soc_insiden_event se JOIN login_histories l ON l.id = se.ref_id
      WHERE se.insiden_id = ? AND se.sumber = 'login' ORDER BY l.id DESC LIMIT 200`,
    ins.id,
  );
  const event = [
    ...ev.map((e) => ({
      sumber: 'keamanan', id: e.id, at: e.at, tipe: e.event_type, label: EVENT_TYPES[e.event_type]?.label || e.event_type,
      severity: e.severity, path: e.path, detail: e.detail, blocked: !!e.blocked, ip: e.ip,
    })),
    ...lg.map((l) => ({
      sumber: 'login', id: l.id, at: l.at, tipe: 'login_sukses', label: 'Login berhasil', severity: 'low', path: null, detail: null, blocked: false, ip: l.ip,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 200);
  return {
    insiden: { ...ins, user_nama: u?.name || null, negara: ins.ip_address ? geo.dariCache(ins.ip_address)?.cc || null : null },
    log,
    event,
  };
};

const ubahStatus = async (id, status, catatan, pelaku) => {
  if (!STATUS_SEMUA.includes(status)) throw galat('Status tidak valid', 400);
  const ins = await ambilInsiden(id);
  const tutup = STATUS_TUTUP.includes(status);
  const catatanBersih = String(catatan || '').trim();
  if (tutup && catatanBersih.length < 5) throw galat('Catatan penutup minimal 5 karakter', 400);

  const set = ['status = ?', 'updated_at = NOW()'];
  const param = [status];
  if (status === 'ditangani' && !ins.ditangani_at) set.push('ditangani_at = NOW()');
  if (tutup) {
    set.push('selesai_at = NOW()', 'ditutup_oleh = ?', 'catatan_tutup = ?', 'dokumentasi = NULL', 'dokumentasi_at = NULL');
    param.push(pelaku, catatanBersih);
  } else {
    set.push('selesai_at = NULL', 'ditutup_oleh = NULL', 'catatan_tutup = NULL', 'dokumentasi = NULL', 'dokumentasi_at = NULL');
  }
  await store.execute(`UPDATE soc_insiden SET ${set.join(', ')} WHERE id = ?`, ...param, ins.id);
  aiGagal.delete(ins.id);
  await catat(ins.id, pelaku, 'status', `Status diubah: ${ins.status} → ${status}${catatanBersih ? `. Catatan: ${catatanBersih}` : ''}`);
  return detail(ins.id);
};

const tambahCatatan = async (id, isi, pelaku) => {
  const teks = String(isi || '').trim();
  if (!teks || teks.length > 2000) throw galat('Catatan 1–2000 karakter', 400);
  const ins = await ambilInsiden(id);
  await catat(ins.id, pelaku, 'catatan', teks);
  await store.execute('UPDATE soc_insiden SET updated_at = NOW() WHERE id = ?', ins.id);
  return detail(ins.id);
};

const tindakan = async (id, { aksi, menit = null } = {}, pelaku) => {
  const ins = await ambilInsiden(id);
  if (!ins.ip_address) throw galat('Insiden ini tidak memiliki IP', 400);
  if (internal(ins.ip_address)) throw galat('IP internal tidak boleh diblokir dari SOC', 400);
  let isi;
  if (aksi === 'blokir_ip') {
    await security.blockIp({ ip: ins.ip_address, reason: `SOC ${ins.kode}: ${ins.judul}`, minutes: menit || null, auto: false, by: pelaku });
    isi = `IP ${ins.ip_address} diblokir ${menit ? `${menit} menit` : 'permanen'} oleh ${pelaku}`;
  } else if (aksi === 'buka_blokir') {
    await security.unblockIp(ins.ip_address);
    isi = `Blokir IP ${ins.ip_address} dibuka oleh ${pelaku}`;
  } else {
    throw galat('Aksi tidak dikenal', 400);
  }
  await catat(ins.id, pelaku, 'tindakan', isi);
  return { ...(await detail(ins.id)), pesan: isi };
};

const mintaAnalisis = async (id) => {
  const ins = await ambilInsiden(id);
  await store.execute('UPDATE soc_insiden SET analisis_ai_at = NULL WHERE id = ?', ins.id);
  aiDiminta.add(ins.id);
  return { antre: analis.tersedia() };
};

const ambilDokumentasi = async (id) => {
  const ins = await ambilInsiden(id);
  if (ins.dokumentasi) return { markdown: ins.dokumentasi, draf: false };
  const tutup = STATUS_TUTUP.includes(ins.status);
  // Tidak disimpan: antrean AI akan menggantikannya dengan versi berisi ringkasan AI.
  return { markdown: await buatDokumentasi(ins, { draf: !tutup }), draf: !tutup };
};

module.exports = { start, siklus, ringkasan, daftar, detail, ubahStatus, tambahCatatan, tindakan, mintaAnalisis, ambilDokumentasi };
