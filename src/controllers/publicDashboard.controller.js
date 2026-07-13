const prisma = require('../config/prisma');
const externalApiService = require('../services/externalApiProxy.service');
const sipandaService = require('../services/sipanda.service');
const crypto = require('crypto');

const CORE_DASHBOARD_API_KEY_ENV = 'CORE_DASHBOARD_API_KEY';

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

// ── SIPANDA — dipakai HANYA oleh endpoint terpisah /api/public/sipanda ────────
// Core dashboard TIDAK memakai SIPANDA maupun data keuangan desa (KKD).
// Ringkas baris SIPANDA (granular per-desa per-tahap) untuk SATU sumber_dana:
// total, rekap per kecamatan, dan (opsional) record per desa.
// PENTING: `anggaran` SIPANDA berformat "220190608.00" (ada desimal) — gunakan
// toNumber, JANGAN toCurrencyNumber yang membuang titik desimal (nilai jadi 100x).
const aggregateSipandaSumber = (rows, sumberDana, includeRecords = true) => {
  const perDesa = new Map();      // desaKey -> { kecamatan, desa, realisasi }
  const perKecamatan = new Map(); // kecamatan -> { total_realisasi, desaSet }
  let totalRealisasi = 0;

  rows.forEach((row) => {
    if (row.sumber_dana !== sumberDana) return;
    const anggaran = toNumber(row.anggaran);
    const kecamatan = row.kecamatan || 'Lainnya';
    const desaKey = row.id_desa || `${kecamatan}|${row.desa || ''}`;

    const desaEntry = perDesa.get(desaKey) || { kecamatan, desa: row.desa || null, realisasi: 0 };
    desaEntry.realisasi += anggaran;
    perDesa.set(desaKey, desaEntry);

    const kecEntry = perKecamatan.get(kecamatan) || { total_realisasi: 0, desaSet: new Set() };
    kecEntry.total_realisasi += anggaran;
    kecEntry.desaSet.add(desaKey);
    perKecamatan.set(kecamatan, kecEntry);

    totalRealisasi += anggaran;
  });

  const by_kecamatan = Array.from(perKecamatan.entries())
    .map(([kecamatan, v]) => ({
      kecamatan,
      total_realisasi: v.total_realisasi,
      total_desa: v.desaSet.size
    }))
    .sort((a, b) => b.total_realisasi - a.total_realisasi);

  const result = {
    total_realisasi: totalRealisasi,
    total_desa: perDesa.size,
    by_kecamatan
  };

  if (includeRecords) {
    let nomor = 0;
    result.records = Array.from(perDesa.values())
      .sort((a, b) => b.realisasi - a.realisasi)
      .map((entry) => ({
        nomor: (nomor += 1),
        kecamatan: entry.kecamatan,
        desa: entry.desa,
        realisasi: entry.realisasi,
        realisasi_label: `Rp ${Math.round(entry.realisasi).toLocaleString('id-ID')}`
      }));
  }

  return result;
};

// Sumber dana yang tersedia di SIPANDA (untuk endpoint /api/public/sipanda).
const SIPANDA_SUMBER = [
  { key: 'add', sumber: 'ADD', label: 'Alokasi Dana Desa (ADD)' },
  { key: 'dd_reguler', sumber: 'DD REGULER', label: 'Dana Desa (DD Reguler)' },
  { key: 'bhprd', sumber: 'BHPRD', label: 'Bagi Hasil Pajak & Retribusi Daerah' },
  { key: 'bankeu_infras_desa', sumber: 'BANKEU INFRAS DESA', label: 'Bankeu Infrastruktur Desa' },
  { key: 'bp', sumber: 'BP', label: 'Bantuan Provinsi' }
];

const buildDashboardCards = (summary) => ([
  {
    key: 'bumdes',
    label: 'BUMDes',
    value: summary.total_bumdes,
    format: 'number',
    data_path: 'data.summary.total_bumdes'
  },
  {
    key: 'aparatur_desa',
    label: 'Aparatur Desa',
    value: summary.total_aparatur,
    format: 'number',
    data_path: 'data.summary.total_aparatur'
  },
  {
    key: 'bankeu_perubahan',
    label: 'Bankeu Perubahan',
    value: summary.total_bankeu_perubahan_proposal,
    format: 'number',
    data_path: 'data.summary.total_bankeu_perubahan_proposal',
    // Total nominal anggaran usulan (scope sama: proposal yang sudah masuk DPMD)
    value_anggaran: summary.total_bankeu_perubahan_anggaran,
    format_anggaran: 'currency_idr',
    anggaran_data_path: 'data.summary.total_bankeu_perubahan_anggaran'
  }
]);

const buildDashboardModules = (modules) => ([
  {
    key: 'bumdes',
    label: 'BUMDes',
    description: 'Rekap jumlah, status, aset, omzet, laba, dan tenaga kerja BUMDes.',
    data_path: 'data.modules.bumdes',
    data: modules.bumdes
  },
  {
    key: 'aparatur_desa',
    label: 'Aparatur Desa',
    description: 'Total aparatur gabungan lokal dan external beserta detailnya.',
    data_path: 'data.modules.aparatur_desa',
    data: modules.aparatur_desa
  },
  {
    key: 'bankeu_perubahan',
    label: 'Bankeu Perubahan',
    description: 'Rekap proposal dan status pengajuan bantuan keuangan perubahan.',
    data_path: 'data.modules.bankeu_perubahan',
    data: modules.bankeu_perubahan
  }
]);

const safeCount = async (model, args = {}) => {
  try {
    return await prisma[model].count(args);
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to count ${model}:`, error.message);
    return 0;
  }
};

const safeAggregate = async (model, args = {}) => {
  try {
    return await prisma[model].aggregate(args);
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to aggregate ${model}:`, error.message);
    return {};
  }
};

const timingSafeEquals = (actual, expected) => {
  if (!actual || !expected) return false;

  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));

  if (actualBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const isUnsafeConfiguredApiKey = (apiKey) => {
  if (!apiKey || apiKey.length < 32) return true;

  const normalized = apiKey.toLowerCase();
  return (
    normalized.includes('change-this') ||
    normalized.includes('change_to') ||
    normalized.includes('replace-with') ||
    normalized.includes('replace_with') ||
    normalized.includes('your_api') ||
    normalized.includes('password') ||
    normalized.includes('secret')
  );
};

const getRequestApiKey = (req) => {
  const authorization = req.get('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return (
    req.get('x-api-key') ||
    req.get('x-core-dashboard-key') ||
    (bearerMatch ? bearerMatch[1] : '')
  );
};

const wantsBrowserDashboardPage = (req) => {
  const acceptHeader = req.get('accept') || '';
  return req.method === 'GET' && acceptHeader.includes('text/html') && !getRequestApiKey(req);
};

const sendCoreDashboardPage = (res) => {
  res.status(200).type('html').send(`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Core Dashboard API - DPMD Kabupaten Bogor</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --text: #152033;
      --muted: #667085;
      --line: #d9e2ef;
      --brand: #0f766e;
      --brand-dark: #115e59;
      --danger: #b42318;
      --success: #067647;
      --code: #111827;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }

    .shell {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 0 28px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border-radius: 8px;
      background: var(--brand);
      color: #ffffff;
      font-weight: 800;
      letter-spacing: 0;
    }

    h1,
    p {
      margin: 0;
    }

    h1 {
      font-size: clamp(22px, 4vw, 34px);
      letter-spacing: 0;
      line-height: 1.15;
    }

    .subtitle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.55;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 380px) 1fr;
      gap: 20px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
    }

    .auth {
      padding: 22px;
      position: sticky;
      top: 24px;
    }

    .auth h2,
    .results h2 {
      margin: 0 0 8px;
      font-size: 18px;
      letter-spacing: 0;
    }

    label {
      display: block;
      margin: 22px 0 8px;
      color: #344054;
      font-size: 14px;
      font-weight: 700;
    }

    .input-wrap {
      display: flex;
      align-items: stretch;
      border: 1px solid #b8c4d4;
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
    }

    input {
      flex: 1;
      min-width: 0;
      border: 0;
      padding: 13px 14px;
      font-size: 15px;
      outline: none;
      color: var(--text);
    }

    .toggle {
      border: 0;
      border-left: 1px solid var(--line);
      background: #f8fafc;
      color: var(--muted);
      width: 48px;
      cursor: pointer;
      font-size: 16px;
    }

    .mode-toggle {
      display: grid;
      gap: 8px;
    }

    .mode-option {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid #b8c4d4;
      border-radius: 8px;
      background: #ffffff;
      cursor: pointer;
      margin: 0;
      font-weight: normal;
      transition: border-color 0.15s, background 0.15s;
    }

    .mode-option:hover {
      border-color: var(--brand);
      background: #f8fafc;
    }

    .mode-option input[type="radio"] {
      margin-top: 3px;
      accent-color: var(--brand);
    }

    .mode-option span {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .mode-option strong {
      color: var(--text);
      font-size: 14px;
      font-weight: 700;
    }

    .mode-option small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .mode-option:has(input:checked) {
      border-color: var(--brand);
      background: #ecfdf3;
    }

    .primary {
      width: 100%;
      border: 0;
      margin-top: 16px;
      padding: 13px 16px;
      border-radius: 8px;
      background: var(--brand);
      color: #ffffff;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
    }

    .primary:hover {
      background: var(--brand-dark);
    }

    .primary:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .hint {
      margin-top: 14px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    .endpoint {
      margin-top: 18px;
      padding: 12px;
      border-radius: 8px;
      background: #f8fafc;
      border: 1px solid var(--line);
      color: #344054;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      overflow-x: auto;
    }

    .results {
      padding: 22px;
      min-height: 420px;
    }

    .state {
      display: grid;
      min-height: 220px;
      place-items: center;
      text-align: center;
      color: var(--muted);
      border: 1px dashed #c6d3e1;
      border-radius: 8px;
      background: #fbfcfe;
      padding: 28px;
    }

    .message {
      display: none;
      margin: 0 0 16px;
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.45;
    }

    .message.error {
      display: block;
      background: #fef3f2;
      color: var(--danger);
      border: 1px solid #fecdca;
    }

    .message.success {
      display: block;
      background: #ecfdf3;
      color: var(--success);
      border: 1px solid #abefc6;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 14px 0 18px;
      color: var(--muted);
      font-size: 13px;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #ffffff;
    }

    .card span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .card strong {
      display: block;
      margin-top: 8px;
      color: var(--text);
      font-size: 25px;
      line-height: 1;
      letter-spacing: 0;
    }

    .guide {
      margin: 18px 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      overflow: hidden;
    }

    .guide h3 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0;
    }

    .guide p {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    .guide-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 18px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
    }

    .guide-head p {
      margin-top: 6px;
    }

    .method-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 52px;
      height: 30px;
      border-radius: 999px;
      background: #ecfdf3;
      color: var(--success);
      font-size: 12px;
      font-weight: 900;
      border: 1px solid #abefc6;
    }

    .guide-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 16px 18px 0;
    }

    .guide-item {
      min-width: 0;
      border: 1px solid #e4eaf2;
      border-radius: 8px;
      background: #fbfcfe;
      overflow: hidden;
    }

    .guide-item h4 {
      margin: 0;
      padding: 10px 12px;
      border-bottom: 1px solid #e4eaf2;
      color: #344054;
      font-size: 13px;
      letter-spacing: 0;
      background: #ffffff;
    }

    .sample {
      margin: 0;
      max-height: none;
      white-space: pre-wrap;
      word-break: break-word;
      border-radius: 0;
      background: #111827;
    }

    .fields {
      display: grid;
      gap: 8px;
      margin: 16px 18px 18px;
      padding: 14px;
      list-style: none;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
      border: 1px solid #e4eaf2;
      border-radius: 8px;
      background: #fbfcfe;
    }

    .fields code {
      color: #344054;
      font-weight: 800;
    }

    pre {
      margin: 0;
      padding: 16px;
      border-radius: 8px;
      background: var(--code);
      color: #e5e7eb;
      overflow: auto;
      max-height: 520px;
      font-size: 12px;
      line-height: 1.6;
    }

    .hidden {
      display: none;
    }

    @media (max-width: 820px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .auth {
        position: static;
      }

      .cards {
        grid-template-columns: 1fr;
      }

      .guide-grid {
        grid-template-columns: 1fr;
      }

      .guide-head {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true">D</div>
        <div>
          <h1>Core Dashboard API</h1>
          <p class="subtitle">Akses data agregat dan detail Core Dashboard DPMD Kabupaten Bogor dengan API key resmi.</p>
        </div>
      </div>
      <div class="badge">Protected API</div>
    </header>

    <section class="layout">
      <form id="authForm" class="panel auth">
        <h2>Masukkan API Key</h2>
        <p class="subtitle">Key tidak disimpan di server oleh halaman ini. Browser hanya mengirimnya sebagai header <strong>x-api-key</strong>.</p>

        <label for="apiKey">API key</label>
        <div class="input-wrap">
          <input id="apiKey" name="apiKey" type="password" autocomplete="off" placeholder="Tempel API key di sini" required>
          <button class="toggle" type="button" id="toggleKey" aria-label="Tampilkan API key">o</button>
        </div>

        <label>Mode pengambilan data</label>
        <div class="mode-toggle" role="radiogroup" aria-label="Mode pengambilan data">
          <label class="mode-option">
            <input type="radio" name="mode" value="full" checked>
            <span>
              <strong>Full Detail</strong>
              <small>Semua records lengkap (lebih berat, butuh beberapa detik)</small>
            </span>
          </label>
          <label class="mode-option">
            <input type="radio" name="mode" value="preview">
            <span>
              <strong>Preview / Ringkasan</strong>
              <small>Hanya angka rekap (cepat, records kosong)</small>
            </span>
          </label>
        </div>

        <button class="primary" type="submit" id="submitButton">Lihat Data</button>

        <p class="hint">Untuk integrasi aplikasi, gunakan endpoint yang sama dengan header <strong>x-api-key</strong> atau <strong>Authorization: Bearer</strong>.</p>
        <div class="endpoint">GET /api/public/core-dashboard</div>
      </form>

      <section class="panel results">
        <div id="message" class="message"></div>
        <div id="emptyState" class="state">
          <div>
            <h2>Data belum dibuka</h2>
            <p class="subtitle">Masukkan API key untuk melihat ringkasan cepat dan panduan integrasi.</p>
          </div>
        </div>

        <div id="dataView" class="hidden">
          <h2>Ringkasan Core Dashboard</h2>
          <div id="meta" class="meta"></div>
          <div id="cards" class="cards"></div>

          <h3 style="margin: 22px 0 10px; font-size: 16px; letter-spacing: 0;">Jumlah record detail per modul</h3>
          <p class="subtitle" style="margin-bottom: 12px; font-size: 13px;">Angka 0 saat mode <strong>Full Detail</strong> berarti detail builder gagal di server (cek log). Saat mode <strong>Preview</strong>, semuanya 0 — itu memang perilaku normal.</p>
          <div id="moduleCounts" class="cards"></div>

          <div class="guide">
            <div class="guide-head">
              <div>
                <h3>How to Get API</h3>
                <p>Use this endpoint from a trusted backend service. Do not expose the API key inside public frontend code.</p>
              </div>
              <span class="method-pill">GET</span>
            </div>
            <div class="guide-grid">
              <div class="guide-item">
                <h4>Full Detail (default) — records lengkap</h4>
                <pre class="sample">GET https://dpmdbogorkab.id/api/public/core-dashboard</pre>
              </div>
              <div class="guide-item">
                <h4>Preview — hanya summary, cepat</h4>
                <pre class="sample">GET https://dpmdbogorkab.id/api/public/core-dashboard?view=preview</pre>
              </div>
              <div class="guide-item">
                <h4>Required Header</h4>
                <pre class="sample">x-api-key: YOUR_API_KEY</pre>
              </div>
              <div class="guide-item">
                <h4>cURL — ambil semua detail</h4>
                <pre class="sample">curl -H "x-api-key: YOUR_API_KEY" \
  https://dpmdbogorkab.id/api/public/core-dashboard \
  -o core-dashboard.json</pre>
              </div>
              <div class="guide-item">
                <h4>JavaScript Fetch — ambil semua detail</h4>
                <pre class="sample">const response = await fetch(
  "https://dpmdbogorkab.id/api/public/core-dashboard",
  {
    headers: {
      "x-api-key": "YOUR_API_KEY",
      "Accept": "application/json"
    }
  }
);

const { data } = await response.json();

// Verifikasi mode + record count
console.log(data.meta.mode);                              // "full"
console.log(data.modules.aparatur_desa.records.length);   // ribuan
console.log(data.modules.bumdes.records.length);          // 400+
console.log(data.modules.bankeu_perubahan.records.length);// proposal perubahan</pre>
              </div>
              <div class="guide-item">
                <h4>Cara baca: ringkasan vs detail</h4>
                <pre class="sample">data.summary                  → 4 angka rekap utama
data.modules.X                → detail per modul (records)

Modul yang tersedia:
  bumdes, aparatur_desa,
  bankeu_perubahan</pre>
              </div>
            </div>
            <ul class="fields">
              <li><strong>Default = Full Detail.</strong> Hanya jika query berisi <code>?view=preview</code>, <code>?view=summary</code>, atau <code>?detail=preview</code> maka response hanya ringkasan.</li>
              <li><code>data.meta.mode</code> akan bernilai <code>"full"</code> atau <code>"preview"</code> — selalu cek field ini untuk memastikan apa yang Anda terima.</li>
              <li><code>data.summary</code> = 3 angka rekap (total BUMDes, total aparatur gabungan, total proposal bankeu perubahan) untuk tampilan cepat.</li>
              <li><code>data.modules.bumdes.records</code>, <code>data.modules.aparatur_desa.records</code>, <code>data.modules.bankeu_perubahan.records</code> — detail lengkap per record.</li>
              <li>Field file/foto berupa objek terstruktur dengan <code>path</code>, <code>url</code>, dan <code>download_url</code>.</li>
              <li>Halaman web ini memanggil endpoint sesuai mode yang Anda pilih di sebelah kiri — sebelumnya selalu preview. Untuk integrasi aplikasi, panggil endpoint dari backend (jangan dari frontend publik karena API key akan terekspos).</li>
              <li>Perjalanan dinas <strong>tidak</strong> termasuk di payload publik ini.</li>
            </ul>
          </div>
          <pre id="jsonOutput"></pre>
        </div>
      </section>
    </section>
  </main>

  <script>
    const form = document.getElementById('authForm');
    const apiKey = document.getElementById('apiKey');
    const toggleKey = document.getElementById('toggleKey');
    const submitButton = document.getElementById('submitButton');
    const message = document.getElementById('message');
    const emptyState = document.getElementById('emptyState');
    const dataView = document.getElementById('dataView');
    const meta = document.getElementById('meta');
    const cards = document.getElementById('cards');
    const moduleCounts = document.getElementById('moduleCounts');
    const jsonOutput = document.getElementById('jsonOutput');
    const formatter = new Intl.NumberFormat('id-ID');
    const fullCurrencyFormatter = new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    });
    const compactCurrencyFormatter = new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      notation: 'compact',
      maximumFractionDigits: 1
    });

    const setMessage = (text, type) => {
      message.textContent = text || '';
      message.className = text ? 'message ' + type : 'message';
    };

    const appendText = (parent, text, className) => {
      const element = document.createElement('span');
      if (className) element.className = className;
      element.textContent = text;
      parent.appendChild(element);
      return element;
    };

    const formatCardValue = (value, type) => {
      if (type === 'currency') return compactCurrencyFormatter.format(Number(value || 0));
      if (type === 'percent') return Number(value || 0).toLocaleString('id-ID') + '%';
      return formatter.format(Number(value || 0));
    };

    const renderCard = (label, value, type, subtitle) => {
      const card = document.createElement('div');
      card.className = 'card';
      appendText(card, label);
      const strong = document.createElement('strong');
      strong.textContent = formatCardValue(value, type);
      card.appendChild(strong);
      if (subtitle) {
        const note = document.createElement('span');
        note.style.cssText = 'margin-top:8px;text-transform:none;font-weight:600;color:#0f766e;';
        note.textContent = subtitle;
        card.appendChild(note);
      }
      cards.appendChild(card);
    };

    const renderModuleCount = (label, value) => {
      const card = document.createElement('div');
      card.className = 'card';
      appendText(card, label);
      const strong = document.createElement('strong');
      strong.textContent = formatter.format(Number(value || 0));
      card.appendChild(strong);
      moduleCounts.appendChild(card);
    };

    const countOrZero = (value) => {
      if (Array.isArray(value)) return value.length;
      if (typeof value === 'number') return value;
      return 0;
    };

    const renderData = (payload) => {
      const data = payload.data || {};
      const summary = data.summary || {};
      const modules = data.modules || {};

      meta.innerHTML = '';
      cards.innerHTML = '';
      moduleCounts.innerHTML = '';
      jsonOutput.textContent = JSON.stringify(payload, null, 2);

      const mode = data.meta?.mode || '-';
      const modeBadge = mode === 'full' ? 'Mode: FULL DETAIL' : (mode === 'preview' ? 'Mode: PREVIEW (records kosong)' : 'Mode: ' + mode);
      appendText(meta, modeBadge);
      appendText(meta, 'Generated: ' + (data.meta?.generated_at || '-'));
      appendText(meta, 'Realtime: ' + (data.meta?.realtime ? 'Ya' : 'Tidak'));
      appendText(meta, 'Cache: ' + (data.meta?.cache || '-'));

      renderCard('BUMDes', summary.total_bumdes);
      renderCard('Aparatur Desa', summary.total_aparatur);
      renderCard('Bankeu Perubahan', summary.total_bankeu_perubahan_proposal, undefined,
        'Anggaran: ' + fullCurrencyFormatter.format(Number(summary.total_bankeu_perubahan_anggaran || 0)));

      renderModuleCount('BUMDes', countOrZero(modules.bumdes?.records));
      renderModuleCount('Aparatur Desa', countOrZero(modules.aparatur_desa?.records));
      renderModuleCount('Bankeu Perubahan', countOrZero(modules.bankeu_perubahan?.records));

      emptyState.classList.add('hidden');
      dataView.classList.remove('hidden');
      setMessage(payload.message || 'Data berhasil diambil.', 'success');
    };

    toggleKey.addEventListener('click', () => {
      apiKey.type = apiKey.type === 'password' ? 'text' : 'password';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const key = apiKey.value.trim();

      if (!key) {
        setMessage('API key wajib diisi.', 'error');
        return;
      }

      const selectedMode = (document.querySelector('input[name="mode"]:checked')?.value) || 'full';

      submitButton.disabled = true;
      submitButton.textContent = selectedMode === 'full' ? 'Memuat detail lengkap...' : 'Memuat...';
      setMessage('', '');

      try {
        const requestUrl = new URL(window.location.href);
        requestUrl.searchParams.delete('view');
        requestUrl.searchParams.delete('mode');
        requestUrl.searchParams.delete('detail');
        if (selectedMode === 'preview') {
          requestUrl.searchParams.set('view', 'preview');
        }

        const response = await fetch(requestUrl.pathname + requestUrl.search, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'x-api-key': key
          }
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || 'Gagal membuka data.');
        }

        renderData(payload);
      } catch (error) {
        dataView.classList.add('hidden');
        emptyState.classList.remove('hidden');
        setMessage(error.message || 'Gagal membuka data.', 'error');
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Lihat Data';
      }
    });
  </script>
</body>
</html>`);
};

const validateCoreDashboardAccess = (req, res) => {
  const configuredApiKey = process.env[CORE_DASHBOARD_API_KEY_ENV];

  if (isUnsafeConfiguredApiKey(configuredApiKey)) {
    console.error(`[PublicDashboard] ${CORE_DASHBOARD_API_KEY_ENV} is not configured with a safe value`);
    res.status(503).json({
      success: false,
      message: 'Core Dashboard API belum dikonfigurasi'
    });
    return false;
  }

  if (!timingSafeEquals(getRequestApiKey(req), configuredApiKey)) {
    res.set('WWW-Authenticate', 'Bearer realm="CoreDashboard"');
    res.status(401).json({
      success: false,
      message: 'API key tidak valid'
    });
    return false;
  }

  return true;
};

const normalizeExternalDashboard = (externalDashboard) => {
  const emptyGroup = {
    total: 0,
    gender: [],
    pendidikan: [],
    usia: []
  };

  if (!externalDashboard || typeof externalDashboard !== 'object') {
    return {
      available: false,
      kepala_desa: emptyGroup,
      perangkat_desa: emptyGroup,
      bpd: emptyGroup
    };
  }

  const sumChart = (items) => Array.isArray(items)
    ? items.reduce((total, item) => total + toNumber(Array.isArray(item.y) ? item.y[0] : item.y), 0)
    : 0;

  return {
    available: true,
    kepala_desa: {
      total: sumChart(externalDashboard.kepala_desa_gender),
      gender: externalDashboard.kepala_desa_gender || [],
      pendidikan: externalDashboard.kepala_desa_pendidikan || [],
      usia: externalDashboard.kepala_desa_usia || []
    },
    perangkat_desa: {
      total: sumChart(externalDashboard.perangkat_desa_gender),
      gender: externalDashboard.perangkat_desa_gender || [],
      pendidikan: externalDashboard.perangkat_desa_pendidikan || [],
      usia: externalDashboard.perangkat_desa_usia || []
    },
    bpd: {
      total: sumChart(externalDashboard.bpd_gender),
      gender: externalDashboard.bpd_gender || [],
      pendidikan: externalDashboard.bpd_pendidikan || [],
      usia: externalDashboard.bpd_usia || []
    }
  };
};

const isFilled = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const toId = (value) => (value === null || value === undefined ? null : String(value));

const toIso = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const formatLabel = (value) => {
  if (!isFilled(value)) return 'Belum diisi';
  return String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
};

const countBy = (items, getKey, fallback = 'Tidak Diketahui') => {
  const map = new Map();

  items.forEach((item) => {
    const key = getKey(item) || fallback;
    const current = map.get(key) || { key, label: formatLabel(key), total: 0 };
    current.total += 1;
    map.set(key, current);
  });

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
};

const getRequestBaseUrl = (req) => {
  const configuredBaseUrl = process.env.BASE_URL || process.env.APP_URL || process.env.PUBLIC_APP_URL;
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, '');

  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host') || 'dpmdbogorkab.id';

  return `${protocol}://${host}`.replace(/\/+$/, '');
};

const encodePublicPath = (value) => String(value)
  .split('/')
  .map((segment) => encodeURIComponent(segment))
  .join('/');

const buildFileReference = (filePath, baseUrl, options = {}) => {
  if (!isFilled(filePath)) return null;

  const rawPath = String(filePath).trim().replace(/\\/g, '/');
  if (/^https?:\/\//i.test(rawPath)) {
    return {
      path: rawPath,
      filename: rawPath.split('/').pop() || rawPath,
      url: rawPath,
      download_url: rawPath
    };
  }

  const root = options.root || 'uploads';
  const fallbackFolder = options.folder || null;
  let cleanPath = rawPath.replace(/^\/+/, '');

  if (cleanPath.startsWith('storage/uploads/')) {
    cleanPath = cleanPath.replace(/^storage\/uploads\//, '');
    const url = `${baseUrl}/uploads/${encodePublicPath(cleanPath)}`;
    return {
      path: `uploads/${cleanPath}`,
      filename: cleanPath.split('/').pop(),
      url,
      download_url: url
    };
  }

  if (cleanPath.startsWith('uploads/')) {
    cleanPath = cleanPath.replace(/^uploads\//, '');
    const url = `${baseUrl}/uploads/${encodePublicPath(cleanPath)}`;
    return {
      path: `uploads/${cleanPath}`,
      filename: cleanPath.split('/').pop(),
      url,
      download_url: url
    };
  }

  if (cleanPath.startsWith('storage/')) {
    const url = `${baseUrl}/${encodePublicPath(cleanPath)}`;
    return {
      path: cleanPath,
      filename: cleanPath.split('/').pop(),
      url,
      download_url: url
    };
  }

  if (fallbackFolder && !cleanPath.includes('/')) {
    cleanPath = `${fallbackFolder}/${cleanPath}`;
  }

  const publicPrefix = root === 'storage' ? 'storage' : 'uploads';
  const url = `${baseUrl}/${publicPrefix}/${encodePublicPath(cleanPath)}`;

  return {
    path: `${publicPrefix}/${cleanPath}`,
    filename: cleanPath.split('/').pop(),
    url,
    download_url: url
  };
};

const buildLocation = (desa) => ({
  desa_id: toId(desa?.id),
  kode_desa: desa?.kode || null,
  nama_desa: desa?.nama || null,
  status_pemerintahan: desa?.status_pemerintahan || null,
  kecamatan: desa?.kecamatans
    ? {
        id: toId(desa.kecamatans.id),
        kode: desa.kecamatans.kode || null,
        nama: desa.kecamatans.nama || null
      }
    : null
});

const productLawSelect = {
  id: true,
  uuid: true,
  judul: true,
  nomor: true,
  tahun: true,
  jenis: true,
  singkatan_jenis: true,
  status_peraturan: true,
  file: true
};

const desaLocationSelect = {
  id: true,
  kode: true,
  nama: true,
  status_pemerintahan: true,
  kecamatans: {
    select: {
      id: true,
      kode: true,
      nama: true
    }
  }
};

const serializeProductLawShort = (productLaw, baseUrl) => {
  if (!productLaw) return null;

  return {
    id: productLaw.id || null,
    uuid: productLaw.uuid || null,
    judul: productLaw.judul || null,
    nomor: productLaw.nomor || null,
    tahun: productLaw.tahun || null,
    jenis: productLaw.jenis || null,
    singkatan_jenis: productLaw.singkatan_jenis || null,
    status_peraturan: productLaw.status_peraturan || null,
    file: buildFileReference(productLaw.file, baseUrl, { folder: 'produk_hukum', root: 'storage' })
  };
};

const buildAparaturDesaDetail = async (baseUrl) => {
  const rows = await prisma.aparatur_desa.findMany({
    select: {
      id: true,
      desa_id: true,
      nama_lengkap: true,
      jabatan: true,
      nipd: true,
      niap: true,
      tempat_lahir: true,
      tanggal_lahir: true,
      jenis_kelamin: true,
      pendidikan_terakhir: true,
      agama: true,
      pangkat_golongan: true,
      tanggal_pengangkatan: true,
      nomor_sk_pengangkatan: true,
      tanggal_pemberhentian: true,
      nomor_sk_pemberhentian: true,
      keterangan: true,
      status: true,
      produk_hukum_id: true,
      bpjs_kesehatan_nomor: true,
      bpjs_ketenagakerjaan_nomor: true,
      file_bpjs_kesehatan: true,
      file_bpjs_ketenagakerjaan: true,
      file_pas_foto: true,
      file_ktp: true,
      file_kk: true,
      file_akta_kelahiran: true,
      file_ijazah_terakhir: true,
      created_at: true,
      updated_at: true,
      desas: { select: desaLocationSelect },
      produk_hukums: { select: productLawSelect }
    },
    orderBy: [
      { nama_lengkap: 'asc' }
    ]
  });

  const buildAparaturFile = (filePath) => buildFileReference(filePath, baseUrl, { folder: 'aparatur_desa_files' });
  const records = rows.map((row) => ({
    id: row.id,
    ...buildLocation(row.desas),
    nama_lengkap: row.nama_lengkap,
    jabatan: row.jabatan,
    nipd: row.nipd || null,
    niap: row.niap || null,
    tempat_lahir: row.tempat_lahir,
    tanggal_lahir: toIso(row.tanggal_lahir),
    jenis_kelamin: row.jenis_kelamin,
    pendidikan_terakhir: row.pendidikan_terakhir,
    agama: row.agama,
    pangkat_golongan: row.pangkat_golongan || null,
    tanggal_pengangkatan: toIso(row.tanggal_pengangkatan),
    nomor_sk_pengangkatan: row.nomor_sk_pengangkatan,
    tanggal_pemberhentian: toIso(row.tanggal_pemberhentian),
    nomor_sk_pemberhentian: row.nomor_sk_pemberhentian || null,
    keterangan: row.keterangan || null,
    status: row.status,
    produk_hukum_id: row.produk_hukum_id || null,
    produk_hukum: serializeProductLawShort(row.produk_hukums, baseUrl),
    bpjs_kesehatan_nomor: row.bpjs_kesehatan_nomor || null,
    bpjs_ketenagakerjaan_nomor: row.bpjs_ketenagakerjaan_nomor || null,
    files: {
      pas_foto: buildAparaturFile(row.file_pas_foto),
      ktp: buildAparaturFile(row.file_ktp),
      kk: buildAparaturFile(row.file_kk),
      akta_kelahiran: buildAparaturFile(row.file_akta_kelahiran),
      ijazah_terakhir: buildAparaturFile(row.file_ijazah_terakhir),
      bpjs_kesehatan: buildAparaturFile(row.file_bpjs_kesehatan),
      bpjs_ketenagakerjaan: buildAparaturFile(row.file_bpjs_ketenagakerjaan)
    },
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  }));

  const aktif = records.filter((record) => record.status === 'Aktif').length;

  return {
    total: records.length,
    aktif,
    tidak_aktif: records.length - aktif,
    desa_count: new Set(records.map((record) => record.desa_id).filter(Boolean)).size,
    by_jabatan: countBy(records, (record) => record.jabatan),
    by_pendidikan: countBy(records, (record) => record.pendidikan_terakhir),
    by_gender: countBy(records, (record) => record.jenis_kelamin),
    by_status: countBy(records, (record) => record.status),
    records
  };
};

const buildBumdesDetail = async (baseUrl) => {
  const rows = await prisma.bumdes.findMany({
    orderBy: { namabumdesa: 'asc' }
  });

  const buildBumdesStoredFile = (filePath, folder) => {
    if (!isFilled(filePath)) return null;

    const normalized = String(filePath).trim().replace(/\\/g, '/');
    const alreadyPublicPath =
      /^https?:\/\//i.test(normalized) ||
      normalized.startsWith('storage/') ||
      normalized.startsWith('uploads/') ||
      normalized.includes(`${folder}/`);

    if (alreadyPublicPath) {
      return buildFileReference(normalized, baseUrl, { folder });
    }

    const filename = normalized.split('/').pop();
    return buildFileReference(filename, baseUrl, { folder });
  };
  const buildFinancialFile = (filePath) => buildBumdesStoredFile(filePath, 'bumdes_laporan_keuangan');
  const buildLegalFile = (filePath) => buildBumdesStoredFile(filePath, 'bumdes_dokumen_badanhukum');

  const records = rows.map((row) => ({
    id: row.id,
    desa_id: row.desa_id || null,
    kode_desa: row.kode_desa || null,
    kecamatan: row.kecamatan || null,
    desa: row.desa || null,
    nama_bumdesa: row.namabumdesa,
    status: row.status,
    keterangan_tidak_aktif: row.keterangan_tidak_aktif || null,
    nib: row.NIB || null,
    lkpp: row.LKPP || null,
    npwp: row.NPWP || null,
    badan_hukum: row.badanhukum || null,
    pengurus: {
      penasihat: { nama: row.NamaPenasihat || null, jenis_kelamin: row.JenisKelaminPenasihat || null, hp: row.HPPenasihat || null },
      pengawas: { nama: row.NamaPengawas || null, jenis_kelamin: row.JenisKelaminPengawas || null, hp: row.HPPengawas || null },
      direktur: { nama: row.NamaDirektur || null, jenis_kelamin: row.JenisKelaminDirektur || null, hp: row.HPDirektur || null },
      sekretaris: { nama: row.NamaSekretaris || null, jenis_kelamin: row.JenisKelaminSekretaris || null, hp: row.HPSekretaris || null },
      bendahara: { nama: row.NamaBendahara || null, jenis_kelamin: row.JenisKelaminBendahara || null, hp: row.HPBendahara || null }
    },
    tahun_pendirian: row.TahunPendirian || null,
    alamat: row.AlamatBumdesa || null,
    email: row.Alamatemail || null,
    telepon: row.TelfonBumdes || null,
    total_tenaga_kerja: row.TotalTenagaKerja || 0,
    jenis_usaha: row.JenisUsaha || null,
    jenis_usaha_utama: row.JenisUsahaUtama || null,
    jenis_usaha_lainnya: row.JenisUsahaLainnya || null,
    keuangan: {
      omset_2023: toNumber(row.Omset2023),
      laba_2023: toNumber(row.Laba2023),
      omset_2024: toNumber(row.Omset2024),
      laba_2024: toNumber(row.Laba2024),
      penyertaan_modal_2019: toNumber(row.PenyertaanModal2019),
      penyertaan_modal_2020: toNumber(row.PenyertaanModal2020),
      penyertaan_modal_2021: toNumber(row.PenyertaanModal2021),
      penyertaan_modal_2022: toNumber(row.PenyertaanModal2022),
      penyertaan_modal_2023: toNumber(row.PenyertaanModal2023),
      penyertaan_modal_2024: toNumber(row.PenyertaanModal2024),
      sumber_lain: toNumber(row.SumberLain),
      nilai_aset: toNumber(row.NilaiAset),
      kontribusi_pades_2021: toNumber(row.KontribusiTerhadapPADes2021),
      kontribusi_pades_2022: toNumber(row.KontribusiTerhadapPADes2022),
      kontribusi_pades_2023: toNumber(row.KontribusiTerhadapPADes2023),
      kontribusi_pades_2024: toNumber(row.KontribusiTerhadapPADes2024)
    },
    aset: {
      jenis_aset: row.JenisAset || null,
      nilai_aset: toNumber(row.NilaiAset)
    },
    kerja_sama_pihak_ketiga: row.KerjasamaPihakKetiga || null,
    tahun_mulai_berakhir: row.TahunMulai_TahunBerakhir || null,
    ketapang_2024: row.Ketapang2024 || null,
    ketapang_2025: row.Ketapang2025 || null,
    bantuan_kementerian: row.BantuanKementrian || null,
    bantuan_laptop_shopee: row.BantuanLaptopShopee || null,
    nomor_perdes: row.NomorPerdes || null,
    desa_wisata: row.DesaWisata || null,
    produk_hukum_perdes_id: row.produk_hukum_perdes_id || null,
    produk_hukum_sk_bumdes_id: row.produk_hukum_sk_bumdes_id || null,
    files: {
      laporan_keuangan_2021: buildFinancialFile(row.LaporanKeuangan2021),
      laporan_keuangan_2022: buildFinancialFile(row.LaporanKeuangan2022),
      laporan_keuangan_2023: buildFinancialFile(row.LaporanKeuangan2023),
      laporan_keuangan_2024: buildFinancialFile(row.LaporanKeuangan2024),
      perdes: buildLegalFile(row.Perdes),
      profil_bumdesa: buildLegalFile(row.ProfilBUMDesa),
      berita_acara: buildLegalFile(row.BeritaAcara),
      anggaran_dasar: buildLegalFile(row.AnggaranDasar),
      anggaran_rumah_tangga: buildLegalFile(row.AnggaranRumahTangga),
      program_kerja: buildLegalFile(row.ProgramKerja),
      sk_bum_desa: buildLegalFile(row.SK_BUM_Desa)
    },
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  }));

  const aktif = records.filter((record) => record.status === 'aktif').length;

  return {
    total: records.length,
    aktif,
    tidak_aktif: Math.max(records.length - aktif, 0),
    total_aset: records.reduce((total, record) => total + record.keuangan.nilai_aset, 0),
    total_omzet_2024: records.reduce((total, record) => total + record.keuangan.omset_2024, 0),
    total_laba_2024: records.reduce((total, record) => total + record.keuangan.laba_2024, 0),
    total_tenaga_kerja: records.reduce((total, record) => total + record.total_tenaga_kerja, 0),
    by_status: countBy(records, (record) => record.status),
    by_kecamatan: countBy(records, (record) => record.kecamatan),
    records
  };
};

// "Sudah masuk DPMD" — disamakan dengan getStatistics SPKED, termasuk proposal
// yang dikembalikan DPMD (revision/rejected) yang submitted_to_dpmd-nya sudah
// di-reset FALSE tetapi pernah/sudah diverifikasi DPMD. Bukan hitungan global.
const BANKEU_PERUBAHAN_DPMD_WHERE = {
  OR: [
    { submitted_to_dpmd: true },
    { submitted_to_dpmd_at: { not: null } },
    { dpmd_verified_at: { not: null } }
  ]
};

const buildBankeuPerubahanDetail = async (baseUrl) => {
  const proposals = await prisma.bankeu_perubahan_proposals.findMany({
    where: BANKEU_PERUBAHAN_DPMD_WHERE,
    select: {
      id: true,
      desa_id: true,
      tahun_anggaran: true,
      jenis_kegiatan: true,
      kegiatan_id: true,
      kegiatan_nama: true,
      nama_kegiatan_spesifik: true,
      volume: true,
      lokasi: true,
      judul_proposal: true,
      deskripsi: true,
      file_proposal: true,
      file_size: true,
      anggaran_usulan: true,
      status: true,
      kecamatan_status: true,
      kecamatan_catatan: true,
      kecamatan_verified_at: true,
      dpmd_status: true,
      dpmd_catatan: true,
      dpmd_verified_at: true,
      submitted_to_kecamatan: true,
      submitted_at: true,
      submitted_to_dpmd: true,
      submitted_to_dpmd_at: true,
      catatan_verifikasi: true,
      verified_at: true,
      surat_pengantar: true,
      surat_permohonan: true,
      berita_acara_path: true,
      berita_acara_generated_at: true,
      created_at: true,
      updated_at: true,
      desas: { select: desaLocationSelect },
      bankeu_perubahan_proposal_kegiatan: {
        select: {
          bankeu_perubahan_master_kegiatan: {
            select: {
              id: true,
              kategori: true,
              nama_kegiatan: true
            }
          }
        }
      }
    },
    orderBy: [
      { tahun_anggaran: 'desc' },
      { created_at: 'desc' }
    ]
  });

  const buildBankeuFile = (filePath) => buildFileReference(filePath, baseUrl, { folder: 'bankeu_perubahan' });
  const records = proposals.map((proposal) => ({
    id: toId(proposal.id),
    ...buildLocation(proposal.desas),
    tahun_anggaran: proposal.tahun_anggaran,
    jenis_kegiatan: proposal.jenis_kegiatan || null,
    kegiatan_id: proposal.kegiatan_id || null,
    kegiatan_nama: proposal.kegiatan_nama || null,
    nama_kegiatan_spesifik: proposal.nama_kegiatan_spesifik || null,
    judul_proposal: proposal.judul_proposal,
    volume: proposal.volume || null,
    lokasi: proposal.lokasi || null,
    deskripsi: proposal.deskripsi || null,
    file_size: proposal.file_size || null,
    anggaran_usulan: toNumber(proposal.anggaran_usulan),
    status: proposal.status || null,
    kecamatan_status: proposal.kecamatan_status || null,
    kecamatan_verified_at: toIso(proposal.kecamatan_verified_at),
    kecamatan_catatan: proposal.kecamatan_catatan || null,
    dpmd_status: proposal.dpmd_status || null,
    dpmd_verified_at: toIso(proposal.dpmd_verified_at),
    dpmd_catatan: proposal.dpmd_catatan || null,
    submitted_to_kecamatan: Boolean(proposal.submitted_to_kecamatan),
    submitted_at: toIso(proposal.submitted_at),
    submitted_to_dpmd: Boolean(proposal.submitted_to_dpmd),
    submitted_to_dpmd_at: toIso(proposal.submitted_to_dpmd_at),
    catatan_verifikasi: proposal.catatan_verifikasi || null,
    verified_at: toIso(proposal.verified_at),
    berita_acara_generated_at: toIso(proposal.berita_acara_generated_at),
    kegiatan: proposal.bankeu_perubahan_proposal_kegiatan.map((item) => ({
      id: item.bankeu_perubahan_master_kegiatan.id,
      kategori: item.bankeu_perubahan_master_kegiatan.kategori,
      nama_kegiatan: item.bankeu_perubahan_master_kegiatan.nama_kegiatan
    })),
    files: {
      proposal: buildBankeuFile(proposal.file_proposal),
      surat_pengantar: buildBankeuFile(proposal.surat_pengantar),
      surat_permohonan: buildBankeuFile(proposal.surat_permohonan),
      berita_acara: buildBankeuFile(proposal.berita_acara_path)
    },
    created_at: toIso(proposal.created_at),
    updated_at: toIso(proposal.updated_at)
  }));

  return {
    // Scope: hanya proposal yang sudah masuk DPMD (submitted_to_dpmd = true).
    total_proposal: records.length,
    approved_by_dpmd: records.filter((record) => record.dpmd_status === 'approved').length,
    total_anggaran_usulan: records.reduce((total, record) => total + record.anggaran_usulan, 0),
    by_status: countBy(records, (record) => record.status),
    by_dpmd_status: countBy(records, (record) => record.dpmd_status),
    by_jenis_kegiatan: countBy(records, (record) => record.jenis_kegiatan),
    by_tahun_anggaran: countBy(records, (record) => record.tahun_anggaran),
    by_kecamatan: countBy(records, (record) => record.kecamatan?.nama),
    records
  };
};

const safeBuildModule = async (name, builder, fallback) => {
  try {
    return await builder();
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to build ${name}:`, error.message);
    return {
      ...fallback,
      available: false,
      error: error.message
    };
  }
};

const fetchExternalDashboardStatsWithTimeout = (timeoutMs) => Promise.race([
  externalApiService.fetchDashboardStats()
    .then((data) => ({ success: true, data }))
    .catch((error) => ({ success: false, error: error.message })),
  new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        success: false,
        error: `External dashboard timeout after ${timeoutMs}ms`
      });
    }, timeoutMs);
  })
]);

const isPreviewPayloadRequest = (req) => {
  const view = String(req.query?.view || req.query?.mode || '').toLowerCase();
  const detail = String(req.query?.detail || '').toLowerCase();
  return view === 'preview' || view === 'summary' || detail === 'preview' || detail === 'summary';
};

const buildPublicDashboardPayload = async (req) => {
  const now = new Date();
  const previewMode = isPreviewPayloadRequest(req);
  const baseUrl = getRequestBaseUrl(req);

  const [
    totalAparaturLokal,
    totalBumdes,
    bumdesAktif,
    bumdesFinancials,
    bankeuPerubahanTotal,
    bankeuPerubahanApprovedDpmd,
    bankeuPerubahanFinancials,
    externalDashboardResult
  ] = await Promise.all([
    safeCount('aparatur_desa', { where: { status: 'Aktif' } }),
    safeCount('bumdes'),
    safeCount('bumdes', { where: { status: 'aktif' } }),
    safeAggregate('bumdes', {
      _sum: {
        NilaiAset: true,
        Omset2024: true,
        Laba2024: true,
        TotalTenagaKerja: true
      }
    }),
    safeCount('bankeu_perubahan_proposals', { where: BANKEU_PERUBAHAN_DPMD_WHERE }),
    safeCount('bankeu_perubahan_proposals', { where: { dpmd_status: 'approved' } }),
    safeAggregate('bankeu_perubahan_proposals', {
      where: BANKEU_PERUBAHAN_DPMD_WHERE,
      _sum: {
        anggaran_usulan: true
      }
    }),
    fetchExternalDashboardStatsWithTimeout(previewMode ? 1200 : 3000)
  ]);

  const externalAparatur = normalizeExternalDashboard(
    externalDashboardResult.success ? externalDashboardResult.data : null
  );
  const totalAparaturExternal =
    externalAparatur.kepala_desa.total +
    externalAparatur.perangkat_desa.total +
    externalAparatur.bpd.total;
  const totalAparaturGabungan = totalAparaturLokal + totalAparaturExternal;

  const detailFallbacks = {
    aparatur_desa: {
      total: totalAparaturLokal,
      aktif: totalAparaturLokal,
      records: []
    },
    bumdes: {
      total: totalBumdes,
      aktif: bumdesAktif,
      tidak_aktif: Math.max(totalBumdes - bumdesAktif, 0),
      total_aset: toNumber(bumdesFinancials._sum?.NilaiAset),
      total_omzet_2024: toNumber(bumdesFinancials._sum?.Omset2024),
      total_laba_2024: toNumber(bumdesFinancials._sum?.Laba2024),
      total_tenaga_kerja: toNumber(bumdesFinancials._sum?.TotalTenagaKerja),
      records: []
    },
    bankeu_perubahan: {
      total_proposal: bankeuPerubahanTotal,
      approved_by_dpmd: bankeuPerubahanApprovedDpmd,
      total_anggaran_usulan: toNumber(bankeuPerubahanFinancials._sum?.anggaran_usulan),
      records: []
    }
  };

  const [
    aparaturDesaDetail,
    bumdesDetail,
    bankeuPerubahanDetail
  ] = previewMode
    ? [
        detailFallbacks.aparatur_desa,
        detailFallbacks.bumdes,
        detailFallbacks.bankeu_perubahan
      ]
    : await Promise.all([
        safeBuildModule('aparatur desa detail', () => buildAparaturDesaDetail(baseUrl), detailFallbacks.aparatur_desa),
        safeBuildModule('bumdes detail', () => buildBumdesDetail(baseUrl), detailFallbacks.bumdes),
        safeBuildModule('bankeu perubahan detail', () => buildBankeuPerubahanDetail(baseUrl), detailFallbacks.bankeu_perubahan)
      ]);

  const summary = {
    total_bumdes: totalBumdes,
    total_aparatur: totalAparaturGabungan,
    total_aparatur_lokal: totalAparaturLokal,
    total_aparatur_external: totalAparaturExternal,
    total_bankeu_perubahan_proposal: bankeuPerubahanTotal,
    total_bankeu_perubahan_anggaran: toNumber(bankeuPerubahanFinancials._sum?.anggaran_usulan)
  };

  const modules = {
    bumdes: {
      total: totalBumdes,
      aktif: bumdesAktif,
      tidak_aktif: Math.max(totalBumdes - bumdesAktif, 0),
      total_aset: toNumber(bumdesFinancials._sum?.NilaiAset),
      total_omzet_2024: toNumber(bumdesFinancials._sum?.Omset2024),
      total_laba_2024: toNumber(bumdesFinancials._sum?.Laba2024),
      total_tenaga_kerja: toNumber(bumdesFinancials._sum?.TotalTenagaKerja),
      ...bumdesDetail
    },
    aparatur_desa: {
      source: externalAparatur.available ? 'gabungan_lokal_external' : 'local_database',
      external_available: externalAparatur.available,
      total_gabungan: totalAparaturGabungan,
      local_total_aktif: totalAparaturLokal,
      external_total: totalAparaturExternal,
      kepala_desa: externalAparatur.kepala_desa,
      perangkat_desa: externalAparatur.perangkat_desa,
      bpd: externalAparatur.bpd,
      ...aparaturDesaDetail
    },
    bankeu_perubahan: {
      scope: 'masuk_dpmd',
      total_proposal: bankeuPerubahanTotal,
      approved_by_dpmd: bankeuPerubahanApprovedDpmd,
      total_anggaran_usulan: toNumber(bankeuPerubahanFinancials._sum?.anggaran_usulan),
      ...bankeuPerubahanDetail
    }
  };

  return {
    meta: {
      generated_at: now.toISOString(),
      timezone: 'Asia/Jakarta',
      version: '2.0',
      access: 'protected_api_key',
      auth_required: true,
      realtime: true,
      cache: 'no-store',
      mode: previewMode ? 'preview' : 'full',
      detail_records: !previewMode
    },
    endpoints: {
      canonical: '/api/public/core-dashboard',
      alias: '/api/public/dashboard',
      preview: '/api/public/core-dashboard?view=preview'
    },
    summary,
    dashboard: {
      cards: buildDashboardCards(summary),
      modules: buildDashboardModules(modules)
    },
    modules,
    sources: {
      local_database: true,
      external_dapur_desa: {
        available: externalDashboardResult.success,
        status: externalDashboardResult.success ? 'available' : 'unavailable'
      }
    }
  };
};

const getCoreDashboard = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (wantsBrowserDashboardPage(req)) {
      sendCoreDashboardPage(res);
      return;
    }

    if (!validateCoreDashboardAccess(req, res)) {
      return;
    }

    const data = await buildPublicDashboardPayload(req);

    res.status(200).json({
      success: true,
      message: data.meta?.mode === 'preview'
        ? 'Preview Core Dashboard berhasil diambil'
        : 'Data Core Dashboard publik berhasil diambil',
      data
    });
  } catch (error) {
    console.error('Error fetching public core dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data Core Dashboard publik',
      error: error.message
    });
  }
};

// ── Endpoint TERPISAH: data SIPANDA (penyaluran dana desa) ────────────────────
// GET /api/public/sipanda — auth API key sama dgn core dashboard.
// Berisi ADD, DD Reguler, BHPRD, Bankeu Infras Desa, BP: total + per kecamatan
// + (opsional) record per desa. Sengaja dipisah dari core dashboard.
const buildSipandaPayload = async (req) => {
  const now = new Date();
  const previewMode = isPreviewPayloadRequest(req);
  const tahun = Number(sipandaService.SIPANDA_TAHUN);

  const rows = await sipandaService.fetchSipandaRows({
    timeoutMs: previewMode ? 3000 : undefined
  });

  const sumber_dana = {};
  let totalRealisasi = 0;
  SIPANDA_SUMBER.forEach(({ key, sumber, label }) => {
    const agg = aggregateSipandaSumber(rows, sumber, !previewMode);
    totalRealisasi += agg.total_realisasi;
    sumber_dana[key] = { label, sumber_dana: sumber, ...agg };
  });

  return {
    meta: {
      generated_at: now.toISOString(),
      timezone: 'Asia/Jakarta',
      version: '1.0',
      access: 'protected_api_key',
      auth_required: true,
      realtime: true,
      cache: 'no-store',
      mode: previewMode ? 'preview' : 'full',
      source: 'sipanda',
      source_url: sipandaService.SIPANDA_BASE_URL
    },
    tahun,
    total_realisasi: totalRealisasi,
    sumber_dana
  };
};

const getSipandaDashboard = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (!validateCoreDashboardAccess(req, res)) {
      return;
    }

    const data = await buildSipandaPayload(req);

    res.status(200).json({
      success: true,
      message: 'Data SIPANDA (penyaluran dana desa) berhasil diambil',
      data
    });
  } catch (error) {
    console.error('Error fetching SIPANDA dashboard:', error);
    res.status(502).json({
      success: false,
      message: 'Gagal mengambil data SIPANDA',
      error: error.message
    });
  }
};

module.exports = {
  getCoreDashboard,
  getSipandaDashboard
};
