const prisma = require('../config/prisma');
const externalApiService = require('../services/externalApiProxy.service');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CORE_DASHBOARD_API_KEY_ENV = 'CORE_DASHBOARD_API_KEY';

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toCurrencyNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const normalized = String(value).replace(/[^\d-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

const readPublicJsonRows = (fileName) => {
  try {
    const filePath = path.join(__dirname, '../../public', fileName);
    if (!fs.existsSync(filePath)) return [];

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.data)) return parsed.data;
    return [];
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to read ${fileName}:`, error.message);
    return [];
  }
};

const aggregateFinanceFiles = (fileNames, includeRecords = true) => {
  const rows = fileNames.flatMap(readPublicJsonRows);
  const statusMap = new Map();
  const desaSet = new Set();
  const records = [];

  let totalRealisasi = 0;

  rows.forEach((row, index) => {
    const realisasi = toCurrencyNumber(row.Realisasi ?? row.realisasi ?? row.total_realisasi ?? row.nilai);
    const status = row.sts || row.status || 'Tidak Diketahui';
    const desaKey = `${row.kecamatan || ''}|${row.desa || row.nama_desa || ''}`;

    totalRealisasi += realisasi;
    if (desaKey.trim() !== '|') desaSet.add(desaKey);
    if (includeRecords) {
      records.push({
        nomor: index + 1,
        kecamatan: row.kecamatan || null,
        desa: row.desa || row.nama_desa || null,
        status,
        realisasi,
        realisasi_label: row.Realisasi || row.realisasi || row.total_realisasi || row.nilai || null,
        raw_status: row.sts || row.status || null
      });
    }

    const current = statusMap.get(status) || { status, total: 0, total_realisasi: 0 };
    current.total += 1;
    current.total_realisasi += realisasi;
    statusMap.set(status, current);
  });

  const result = {
    total_records: rows.length,
    total_desa: desaSet.size,
    total_realisasi: totalRealisasi,
    by_status: Array.from(statusMap.values()).sort((a, b) => b.total - a.total)
  };

  if (includeRecords) result.records = records;
  return result;
};

const buildKeuanganDesaStats = (options = {}) => {
  const includeRecords = options.includeRecords !== false;
  const add = aggregateFinanceFiles(['add2025.json'], includeRecords);
  const danaDesa = aggregateFinanceFiles(['dd2025.json'], includeRecords);
  const bhprd = aggregateFinanceFiles(['bhprd2025.json'], includeRecords);
  const bankeuPublik = aggregateFinanceFiles(['bankeu2025.json'], includeRecords);
  const insentifDd = aggregateFinanceFiles(['insentif-dd.json'], includeRecords);

  const categories = {
    add,
    dana_desa: danaDesa,
    bhprd,
    bankeu: bankeuPublik,
    insentif_dd: insentifDd
  };

  const totalRealisasi = Object.values(categories).reduce(
    (total, category) => total + category.total_realisasi,
    0
  );
  const totalRecords = Object.values(categories).reduce(
    (total, category) => total + category.total_records,
    0
  );

  return {
    total_realisasi: totalRealisasi,
    total_records: totalRecords,
    tahun: 2025,
    categories
  };
};

const buildDashboardCards = (summary) => ([
  {
    key: 'kecamatan',
    label: 'Kecamatan',
    value: summary.total_kecamatan,
    format: 'number',
    data_path: 'data.summary.total_kecamatan'
  },
  {
    key: 'desa',
    label: 'Desa',
    value: summary.total_desa,
    format: 'number',
    data_path: 'data.summary.total_desa'
  },
  {
    key: 'kelurahan',
    label: 'Kelurahan',
    value: summary.total_kelurahan,
    format: 'number',
    data_path: 'data.summary.total_kelurahan'
  },
  {
    key: 'profil_desa',
    label: 'Profil Desa Terisi',
    value: summary.total_profil_desa,
    format: 'number',
    data_path: 'data.summary.total_profil_desa'
  },
  {
    key: 'aparatur_desa',
    label: 'Aparatur Desa',
    value: summary.total_aparatur_external || summary.total_aparatur_lokal,
    format: 'number',
    data_path: 'data.modules.aparatur_desa.external_total'
  },
  {
    key: 'produk_hukum',
    label: 'Produk Hukum',
    value: summary.total_produk_hukum,
    format: 'number',
    data_path: 'data.summary.total_produk_hukum'
  },
  {
    key: 'keuangan_desa',
    label: 'Keuangan Desa',
    value: summary.total_keuangan_desa_realisasi,
    format: 'currency_idr',
    data_path: 'data.summary.total_keuangan_desa_realisasi'
  },
  {
    key: 'bumdes',
    label: 'BUMDes',
    value: summary.total_bumdes,
    format: 'number',
    data_path: 'data.summary.total_bumdes'
  },
  {
    key: 'kelembagaan',
    label: 'Kelembagaan',
    value: summary.total_kelembagaan,
    format: 'number',
    data_path: 'data.summary.total_kelembagaan'
  },
  {
    key: 'bankeu',
    label: 'Bankeu Proposal',
    value: summary.total_bankeu_proposal,
    format: 'number',
    data_path: 'data.summary.total_bankeu_proposal'
  }
]);

const buildDashboardModules = (modules) => ([
  {
    key: 'wilayah',
    label: 'Wilayah',
    description: 'Jumlah kecamatan, desa, dan kelurahan.',
    data_path: 'data.modules.wilayah',
    data: modules.wilayah
  },
  {
    key: 'profil_desa',
    label: 'Profil Desa',
    description: 'Status keterisian profil desa dan persentase kelengkapan.',
    data_path: 'data.modules.profil_desa',
    data: modules.profil_desa
  },
  {
    key: 'keuangan_desa',
    label: 'Keuangan Desa',
    description: 'Rekap realisasi ADD, Dana Desa, BHPRD, Bankeu, dan Insentif DD.',
    data_path: 'data.modules.keuangan_desa',
    data: modules.keuangan_desa
  },
  {
    key: 'aparatur_desa',
    label: 'Aparatur Desa',
    description: 'Rekap aparatur desa, kepala desa, perangkat desa, dan BPD.',
    data_path: 'data.modules.aparatur_desa',
    data: modules.aparatur_desa
  },
  {
    key: 'produk_hukum',
    label: 'Produk Hukum',
    description: 'Rekap produk hukum desa berdasarkan jenis.',
    data_path: 'data.modules.produk_hukum',
    data: modules.produk_hukum
  },
  {
    key: 'bumdes',
    label: 'BUMDes',
    description: 'Rekap jumlah, status, aset, omzet, laba, dan tenaga kerja BUMDes.',
    data_path: 'data.modules.bumdes',
    data: modules.bumdes
  },
  {
    key: 'kelembagaan',
    label: 'Kelembagaan',
    description: 'Rekap RT, RW, LPM, PKK, Posyandu, Karang Taruna, Satlinmas, dan lembaga lainnya.',
    data_path: 'data.modules.kelembagaan',
    data: modules.kelembagaan
  },
  {
    key: 'bankeu',
    label: 'Bantuan Keuangan',
    description: 'Rekap proposal dan status pengajuan bantuan keuangan.',
    data_path: 'data.modules.bankeu',
    data: modules.bankeu
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

const safeGroupBy = async (model, args = {}) => {
  try {
    return await prisma[model].groupBy(args);
  } catch (error) {
    console.warn(`[PublicDashboard] Failed to group ${model}:`, error.message);
    return [];
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
                <h4>Production Endpoint</h4>
                <pre class="sample">GET https://dpmdbogorkab.id/api/public/core-dashboard</pre>
              </div>
              <div class="guide-item">
                <h4>Fast Preview</h4>
                <pre class="sample">GET https://dpmdbogorkab.id/api/public/core-dashboard?view=preview</pre>
              </div>
              <div class="guide-item">
                <h4>Required Header</h4>
                <pre class="sample">x-api-key: YOUR_API_KEY</pre>
              </div>
              <div class="guide-item">
                <h4>cURL Request</h4>
                <pre class="sample">curl -H "x-api-key: YOUR_API_KEY" https://dpmdbogorkab.id/api/public/core-dashboard</pre>
              </div>
              <div class="guide-item">
                <h4>JavaScript Fetch</h4>
                <pre class="sample">const response = await fetch("https://dpmdbogorkab.id/api/public/core-dashboard", {
  headers: {
    "x-api-key": "YOUR_API_KEY",
    "Accept": "application/json"
  }
});

const result = await response.json();
console.log(result.data.dashboard.cards);
console.log(result.data.dashboard.modules);
console.log(result.data.summary);
console.log(result.data.modules);</pre>
              </div>
            </div>
            <ul class="fields">
              <li><code>data.dashboard.cards</code> contains display-ready cards matching the Core Dashboard summary.</li>
              <li><code>data.dashboard.modules</code> contains display-ready module blocks and their detail paths.</li>
              <li><code>data.modules.profil_desa</code>, <code>data.modules.keuangan_desa</code>, <code>data.modules.aparatur_desa</code>, and <code>data.modules.produk_hukum</code> contain detailed Core Dashboard records.</li>
              <li>File and photo fields are returned as structured objects with <code>path</code>, <code>url</code>, and <code>download_url</code>.</li>
              <li><code>?view=preview</code> returns a lightweight response for documentation and quick browser checks.</li>
              <li><code>data.summary</code> contains the main aggregate numbers for quick display.</li>
              <li><code>data.modules</code> also includes wilayah, BUMDes, kelembagaan, and bankeu data. Perjalanan dinas is excluded from this public payload.</li>
              <li><code>data.meta.generated_at</code> indicates when the data was freshly generated by the API.</li>
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
    const jsonOutput = document.getElementById('jsonOutput');
    const formatter = new Intl.NumberFormat('id-ID');
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

    const renderCard = (label, value, type) => {
      const card = document.createElement('div');
      card.className = 'card';
      appendText(card, label);
      const strong = document.createElement('strong');
      strong.textContent = formatCardValue(value, type);
      card.appendChild(strong);
      cards.appendChild(card);
    };

    const renderData = (payload) => {
      const data = payload.data || {};
      const summary = data.summary || {};

      meta.innerHTML = '';
      cards.innerHTML = '';
      jsonOutput.textContent = JSON.stringify(payload, null, 2);

      appendText(meta, 'Generated: ' + (data.meta?.generated_at || '-'));
      appendText(meta, 'Realtime: ' + (data.meta?.realtime ? 'Ya' : 'Tidak'));
      appendText(meta, 'Cache: ' + (data.meta?.cache || '-'));

      renderCard('Kecamatan', summary.total_kecamatan);
      renderCard('Desa', summary.total_desa);
      renderCard('Kelurahan', summary.total_kelurahan);
      renderCard('Profil Desa Terisi', summary.total_profil_desa);
      renderCard('Aparatur Desa', summary.total_aparatur_external || summary.total_aparatur_lokal);
      renderCard('Produk Hukum', summary.total_produk_hukum);
      renderCard('Keuangan Desa', summary.total_keuangan_desa_realisasi, 'currency');
      renderCard('BUMDes', summary.total_bumdes);
      renderCard('Kelembagaan', summary.total_kelembagaan);
      renderCard('Bankeu Proposal', summary.total_bankeu_proposal);

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

      submitButton.disabled = true;
      submitButton.textContent = 'Memuat...';
      setMessage('', '');

      try {
        const previewUrl = new URL(window.location.href);
        previewUrl.searchParams.set('view', 'preview');

        const response = await fetch(previewUrl.pathname + previewUrl.search, {
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

const PROFILE_COMPLETION_FIELDS = [
  'klasifikasi_desa',
  'status_desa',
  'tipologi_desa',
  'jumlah_penduduk',
  'luas_wilayah',
  'alamat_kantor',
  'no_telp',
  'email'
];

const PROFILE_SIGNAL_FIELDS = [
  ...PROFILE_COMPLETION_FIELDS,
  'sejarah_desa',
  'demografi',
  'potensi_desa',
  'instagram_url',
  'youtube_url',
  'foto_kantor_desa_path',
  'latitude',
  'longitude'
];

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

const calculateProfileCompletion = (profile) => {
  const filled = PROFILE_COMPLETION_FIELDS.filter((field) => isFilled(profile?.[field])).length;
  const total = PROFILE_COMPLETION_FIELDS.length;

  return {
    filled,
    total,
    percentage: total > 0 ? Math.round((filled / total) * 100) : 0
  };
};

const hasAnyProfileContent = (profile) => PROFILE_SIGNAL_FIELDS.some((field) => isFilled(profile?.[field]));

const getProfileCompletionStatus = (profile, completion) => {
  if (!hasAnyProfileContent(profile)) {
    return { key: 'belum_diisi', label: 'Belum diisi' };
  }

  if (completion.percentage >= 75) {
    return { key: 'lengkap', label: 'Lengkap' };
  }

  return { key: 'perlu_dilengkapi', label: 'Perlu dilengkapi' };
};

const serializeProfileRecord = (desa, baseUrl) => {
  const profile = desa.profil_desas;
  const completion = calculateProfileCompletion(profile);
  const completionStatus = getProfileCompletionStatus(profile, completion);
  const latitude = profile?.latitude === null || profile?.latitude === undefined ? null : toNumber(profile.latitude);
  const longitude = profile?.longitude === null || profile?.longitude === undefined ? null : toNumber(profile.longitude);
  const hasCoordinates = latitude !== null && longitude !== null;
  const officePhoto = buildFileReference(profile?.foto_kantor_desa_path, baseUrl, { folder: 'profil_desa' });

  return {
    ...buildLocation(desa),
    profil_id: toId(profile?.id),
    profil_tersimpan: Boolean(profile),
    profil_terisi: hasAnyProfileContent(profile),
    klasifikasi_desa: profile?.klasifikasi_desa || null,
    klasifikasi_desa_label: formatLabel(profile?.klasifikasi_desa),
    status_desa: profile?.status_desa || null,
    status_desa_label: formatLabel(profile?.status_desa),
    tipologi_desa: profile?.tipologi_desa || null,
    tipologi_desa_label: formatLabel(profile?.tipologi_desa),
    jumlah_penduduk: profile?.jumlah_penduduk || null,
    luas_wilayah: profile?.luas_wilayah || null,
    alamat_kantor: profile?.alamat_kantor || null,
    no_telp: profile?.no_telp || null,
    email: profile?.email || null,
    instagram_url: profile?.instagram_url || null,
    youtube_url: profile?.youtube_url || null,
    radius_ke_kecamatan: profile?.radius_ke_kecamatan || null,
    latitude,
    longitude,
    maps_url: hasCoordinates ? `https://www.google.com/maps?q=${latitude},${longitude}` : null,
    sejarah_desa: profile?.sejarah_desa || null,
    demografi: profile?.demografi || null,
    potensi_desa: profile?.potensi_desa || null,
    foto_kantor_desa_path: profile?.foto_kantor_desa_path || null,
    foto_kantor_desa: officePhoto,
    created_at: toIso(profile?.created_at),
    updated_at: toIso(profile?.updated_at),
    completion: {
      ...completion,
      status_key: completionStatus.key,
      status_label: completionStatus.label
    },
    flags: {
      has_contact: isFilled(profile?.no_telp) || isFilled(profile?.email),
      has_coordinates: hasCoordinates,
      has_office_photo: Boolean(officePhoto),
      has_social_media: isFilled(profile?.instagram_url) || isFilled(profile?.youtube_url),
      has_narratives: ['sejarah_desa', 'demografi', 'potensi_desa'].every((field) => isFilled(profile?.[field]))
    }
  };
};

const buildProfilDesaDetail = async (baseUrl) => {
  const desaRows = await prisma.desas.findMany({
    where: { status_pemerintahan: 'desa' },
    select: {
      ...desaLocationSelect,
      profil_desas: {
        select: {
          id: true,
          klasifikasi_desa: true,
          status_desa: true,
          tipologi_desa: true,
          jumlah_penduduk: true,
          sejarah_desa: true,
          demografi: true,
          potensi_desa: true,
          no_telp: true,
          email: true,
          instagram_url: true,
          youtube_url: true,
          luas_wilayah: true,
          alamat_kantor: true,
          radius_ke_kecamatan: true,
          foto_kantor_desa_path: true,
          latitude: true,
          longitude: true,
          created_at: true,
          updated_at: true
        }
      }
    },
    orderBy: { nama: 'asc' }
  });

  const records = desaRows.map((desa) => serializeProfileRecord(desa, baseUrl));
  const totalTerisi = records.filter((record) => record.profil_terisi).length;
  const totalLengkap = records.filter((record) => record.completion.status_key === 'lengkap').length;
  const totalBelumDiisi = records.filter((record) => record.completion.status_key === 'belum_diisi').length;

  return {
    total_terisi: totalTerisi,
    total_desa: records.length,
    total_lengkap: totalLengkap,
    total_perlu_dilengkapi: records.length - totalLengkap - totalBelumDiisi,
    total_belum_diisi: totalBelumDiisi,
    persentase_terisi: records.length > 0 ? Number(((totalTerisi / records.length) * 100).toFixed(2)) : 0,
    by_completion_status: countBy(records, (record) => record.completion.status_key),
    by_kecamatan: countBy(records, (record) => record.kecamatan?.nama),
    records
  };
};

const buildProdukHukumDetail = async (baseUrl) => {
  const rows = await prisma.produk_hukums.findMany({
    select: {
      ...productLawSelect,
      desa_id: true,
      tipe_dokumen: true,
      tempat_penetapan: true,
      tanggal_penetapan: true,
      sumber: true,
      subjek: true,
      keterangan_status: true,
      bahasa: true,
      bidang_hukum: true,
      created_at: true,
      updated_at: true,
      desas: { select: desaLocationSelect }
    },
    orderBy: [
      { tahun: 'desc' },
      { created_at: 'desc' }
    ]
  });

  const records = rows.map((row) => ({
    id: row.id,
    uuid: row.uuid || null,
    ...buildLocation(row.desas),
    tipe_dokumen: row.tipe_dokumen,
    judul: row.judul,
    nomor: row.nomor,
    tahun: row.tahun,
    jenis: row.jenis,
    singkatan_jenis: row.singkatan_jenis,
    tempat_penetapan: row.tempat_penetapan,
    tanggal_penetapan: toIso(row.tanggal_penetapan),
    sumber: row.sumber || null,
    subjek: row.subjek || null,
    status_peraturan: row.status_peraturan,
    keterangan_status: row.keterangan_status || null,
    bahasa: row.bahasa,
    bidang_hukum: row.bidang_hukum,
    file: buildFileReference(row.file, baseUrl, { folder: 'produk_hukum', root: 'storage' }),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  }));

  return {
    total: records.length,
    by_jenis: countBy(records, (record) => record.singkatan_jenis),
    by_status: countBy(records, (record) => record.status_peraturan),
    by_tahun: countBy(records, (record) => record.tahun),
    records
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

const serializeKelembagaanRecord = (row, type, baseUrl) => ({
  id: row.id,
  type,
  ...buildLocation(row.desas),
  nama: row.nama || null,
  nomor: row.nomor || null,
  rw_id: row.rw_id || null,
  nomor_rw: row.rws?.nomor || null,
  alamat: row.alamat || null,
  status_kelembagaan: row.status_kelembagaan || null,
  status_verifikasi: row.status_verifikasi || null,
  imported: Boolean(row.imported),
  jumlah_jiwa: row.jumlah_jiwa || null,
  jumlah_kk: row.jumlah_kk || null,
  produk_hukum_id: row.produk_hukum_id || null,
  produk_hukum: serializeProductLawShort(row.produk_hukums, baseUrl),
  produk_hukum_penonaktifan_id: row.produk_hukum_penonaktifan_id || null,
  catatan_verifikasi: row.catatan_verifikasi || null,
  verified_at: toIso(row.verified_at),
  verifikator_nama: row.verifikator_nama || null,
  nonaktif_at: toIso(row.nonaktif_at),
  created_at: toIso(row.created_at),
  updated_at: toIso(row.updated_at)
});

const buildKelembagaanDetail = async (baseUrl) => {
  const baseSelect = {
    id: true,
    desa_id: true,
    alamat: true,
    status_kelembagaan: true,
    status_verifikasi: true,
    imported: true,
    created_at: true,
    updated_at: true,
    produk_hukum_id: true,
    catatan_verifikasi: true,
    produk_hukum_penonaktifan_id: true,
    verified_at: true,
    verifikator_nama: true,
    desas: { select: desaLocationSelect },
    produk_hukums: { select: productLawSelect }
  };
  const namedSelect = {
    ...baseSelect,
    nama: true
  };
  const nonaktifSelect = {
    nonaktif_at: true
  };

  const [
    rwRows,
    rtRows,
    lpmRows,
    pkkRows,
    posyanduRows,
    karangTarunaRows,
    satlinmasRows,
    lembagaLainnyaRows
  ] = await Promise.all([
    prisma.rws.findMany({
      select: {
        ...baseSelect,
        ...nonaktifSelect,
        nomor: true
      }
    }),
    prisma.rts.findMany({
      select: {
        ...baseSelect,
        ...nonaktifSelect,
        nomor: true,
        rw_id: true,
        jumlah_jiwa: true,
        jumlah_kk: true,
        rws: { select: { id: true, nomor: true } }
      }
    }),
    prisma.lpms.findMany({ select: { ...namedSelect, ...nonaktifSelect } }),
    prisma.pkks.findMany({ select: { ...namedSelect, ...nonaktifSelect } }),
    prisma.posyandus.findMany({ select: { ...namedSelect, ...nonaktifSelect } }),
    prisma.karang_tarunas.findMany({ select: { ...namedSelect, ...nonaktifSelect } }),
    prisma.satlinmas.findMany({ select: namedSelect }),
    prisma.lembaga_lainnyas.findMany({ select: namedSelect })
  ]);

  const recordsByType = {
    rw: rwRows.map((row) => serializeKelembagaanRecord(row, 'rw', baseUrl)),
    rt: rtRows.map((row) => serializeKelembagaanRecord(row, 'rt', baseUrl)),
    lpm: lpmRows.map((row) => serializeKelembagaanRecord(row, 'lpm', baseUrl)),
    pkk: pkkRows.map((row) => serializeKelembagaanRecord(row, 'pkk', baseUrl)),
    posyandu: posyanduRows.map((row) => serializeKelembagaanRecord(row, 'posyandu', baseUrl)),
    karang_taruna: karangTarunaRows.map((row) => serializeKelembagaanRecord(row, 'karang_taruna', baseUrl)),
    satlinmas: satlinmasRows.map((row) => serializeKelembagaanRecord(row, 'satlinmas', baseUrl)),
    lembaga_lainnya: lembagaLainnyaRows.map((row) => serializeKelembagaanRecord(row, 'lembaga_lainnya', baseUrl))
  };
  const allRecords = Object.values(recordsByType).flat();

  return {
    total: allRecords.length,
    rw: recordsByType.rw.length,
    rt: recordsByType.rt.length,
    lpm: recordsByType.lpm.length,
    pkk: recordsByType.pkk.length,
    posyandu: recordsByType.posyandu.length,
    karang_taruna: recordsByType.karang_taruna.length,
    satlinmas: recordsByType.satlinmas.length,
    lembaga_lainnya: recordsByType.lembaga_lainnya.length,
    by_type: Object.entries(recordsByType).map(([key, records]) => ({
      key,
      label: formatLabel(key),
      total: records.length
    })),
    by_status_kelembagaan: countBy(allRecords, (record) => record.status_kelembagaan),
    by_status_verifikasi: countBy(allRecords, (record) => record.status_verifikasi),
    by_kecamatan: countBy(allRecords, (record) => record.kecamatan?.nama),
    records: recordsByType,
    all_records: allRecords
  };
};

const buildBankeuDetail = async (baseUrl) => {
  const proposals = await prisma.bankeu_proposals.findMany({
    select: {
      id: true,
      desa_id: true,
      tahun_anggaran: true,
      kegiatan_id: true,
      judul_proposal: true,
      nama_kegiatan_spesifik: true,
      volume: true,
      lokasi: true,
      deskripsi: true,
      file_proposal: true,
      surat_pengantar: true,
      surat_permohonan: true,
      dinas_reviewed_file: true,
      dinas_reviewed_at: true,
      file_size: true,
      anggaran_usulan: true,
      status: true,
      dinas_status: true,
      submitted_to_dinas_at: true,
      dinas_verified_at: true,
      dinas_catatan: true,
      kecamatan_status: true,
      kecamatan_verified_at: true,
      kecamatan_catatan: true,
      dpmd_status: true,
      dpmd_verified_at: true,
      dpmd_catatan: true,
      submitted_to_kecamatan: true,
      submitted_at: true,
      submitted_to_dpmd: true,
      submitted_to_dpmd_at: true,
      catatan_verifikasi: true,
      verified_at: true,
      berita_acara_path: true,
      berita_acara_generated_at: true,
      created_at: true,
      updated_at: true,
      desas: { select: desaLocationSelect },
      bankeu_proposal_kegiatan: {
        select: {
          bankeu_master_kegiatan: {
            select: {
              id: true,
              jenis_kegiatan: true,
              nama_kegiatan: true,
              dinas_terkait: true
            }
          }
        }
      },
      berita_acara_history: {
        select: {
          id: true,
          file_path: true,
          file_name: true,
          file_size: true,
          status: true,
          generated_at: true,
          created_at: true
        }
      }
    },
    orderBy: [
      { tahun_anggaran: 'desc' },
      { created_at: 'desc' }
    ]
  });

  const buildBankeuFile = (filePath) => buildFileReference(filePath, baseUrl, { folder: 'bankeu' });
  const records = proposals.map((proposal) => ({
    id: toId(proposal.id),
    ...buildLocation(proposal.desas),
    tahun_anggaran: proposal.tahun_anggaran,
    kegiatan_id: proposal.kegiatan_id || null,
    judul_proposal: proposal.judul_proposal,
    nama_kegiatan_spesifik: proposal.nama_kegiatan_spesifik || null,
    volume: proposal.volume || null,
    lokasi: proposal.lokasi || null,
    deskripsi: proposal.deskripsi || null,
    file_size: proposal.file_size || null,
    anggaran_usulan: toNumber(proposal.anggaran_usulan),
    status: proposal.status || null,
    dinas_status: proposal.dinas_status || null,
    submitted_to_dinas_at: toIso(proposal.submitted_to_dinas_at),
    dinas_verified_at: toIso(proposal.dinas_verified_at),
    dinas_reviewed_at: toIso(proposal.dinas_reviewed_at),
    dinas_catatan: proposal.dinas_catatan || null,
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
    kegiatan: proposal.bankeu_proposal_kegiatan.map((item) => ({
      id: item.bankeu_master_kegiatan.id,
      jenis_kegiatan: item.bankeu_master_kegiatan.jenis_kegiatan,
      nama_kegiatan: item.bankeu_master_kegiatan.nama_kegiatan,
      dinas_terkait: item.bankeu_master_kegiatan.dinas_terkait || null
    })),
    files: {
      proposal: buildBankeuFile(proposal.file_proposal),
      surat_pengantar: buildBankeuFile(proposal.surat_pengantar),
      surat_permohonan: buildBankeuFile(proposal.surat_permohonan),
      dinas_reviewed_file: buildBankeuFile(proposal.dinas_reviewed_file),
      berita_acara: buildBankeuFile(proposal.berita_acara_path),
      berita_acara_history: proposal.berita_acara_history.map((item) => ({
        id: toId(item.id),
        status: item.status,
        generated_at: toIso(item.generated_at),
        created_at: toIso(item.created_at),
        file_size: item.file_size || null,
        file: buildBankeuFile(item.file_path || item.file_name)
      }))
    },
    created_at: toIso(proposal.created_at),
    updated_at: toIso(proposal.updated_at)
  }));

  return {
    total_proposal: records.length,
    submitted_to_kecamatan: records.filter((record) => record.submitted_to_kecamatan).length,
    submitted_to_dpmd: records.filter((record) => record.submitted_to_dpmd).length,
    approved_by_dpmd: records.filter((record) => record.dpmd_status === 'approved').length,
    total_anggaran_usulan: records.reduce((total, record) => total + record.anggaran_usulan, 0),
    by_status: countBy(records, (record) => record.status),
    by_dinas_status: countBy(records, (record) => record.dinas_status),
    by_kecamatan_status: countBy(records, (record) => record.kecamatan_status),
    by_dpmd_status: countBy(records, (record) => record.dpmd_status),
    by_tahun_anggaran: countBy(records, (record) => record.tahun_anggaran),
    by_kecamatan: countBy(records, (record) => record.kecamatan?.nama),
    records
  };
};

const buildWilayahDetail = async () => {
  const kecamatanRows = await prisma.kecamatans.findMany({
    select: {
      id: true,
      kode: true,
      nama: true,
      alamat: true,
      logo_path: true,
      nama_camat: true,
      nip_camat: true,
      desas: {
        select: {
          id: true,
          kode: true,
          nama: true,
          status_pemerintahan: true
        },
        orderBy: { nama: 'asc' }
      }
    },
    orderBy: { nama: 'asc' }
  });

  const records = kecamatanRows.map((row) => ({
    id: toId(row.id),
    kode: row.kode,
    nama: row.nama,
    alamat: row.alamat || null,
    logo_path: row.logo_path || null,
    nama_camat: row.nama_camat || null,
    nip_camat: row.nip_camat || null,
    total_desa: row.desas.filter((desa) => desa.status_pemerintahan === 'desa').length,
    total_kelurahan: row.desas.filter((desa) => desa.status_pemerintahan === 'kelurahan').length,
    desas: row.desas.map((desa) => ({
      id: toId(desa.id),
      kode: desa.kode,
      nama: desa.nama,
      status_pemerintahan: desa.status_pemerintahan
    }))
  }));

  return {
    total_kecamatan: records.length,
    total_desa: records.reduce((total, row) => total + row.total_desa, 0),
    total_kelurahan: records.reduce((total, row) => total + row.total_kelurahan, 0),
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
  const keuanganDesaStats = buildKeuanganDesaStats({ includeRecords: !previewMode });

  const [
    totalKecamatan,
    totalDesa,
    totalKelurahan,
    totalPegawai,
    totalProfilDesa,
    totalProdukHukum,
    totalAparaturLokal,
    totalBumdes,
    bumdesAktif,
    bankeuProposalTotal,
    bankeuSubmittedKecamatan,
    bankeuSubmittedDpmd,
    bankeuApprovedDpmd,
    kelembagaanCounts,
    bumdesFinancials,
    bankeuFinancials,
    produkHukumByJenis,
    externalDashboardResult
  ] = await Promise.all([
    safeCount('kecamatans'),
    safeCount('desas', { where: { status_pemerintahan: 'desa' } }),
    safeCount('desas', { where: { status_pemerintahan: 'kelurahan' } }),
    safeCount('pegawai'),
    safeCount('profil_desas'),
    safeCount('produk_hukums'),
    safeCount('aparatur_desa', { where: { status: 'Aktif' } }),
    safeCount('bumdes'),
    safeCount('bumdes', { where: { status: 'aktif' } }),
    safeCount('bankeu_proposals'),
    safeCount('bankeu_proposals', { where: { submitted_to_kecamatan: true } }),
    safeCount('bankeu_proposals', { where: { submitted_to_dpmd: true } }),
    safeCount('bankeu_proposals', { where: { dpmd_status: 'approved' } }),
    Promise.all([
      safeCount('rws'),
      safeCount('rts'),
      safeCount('lpms'),
      safeCount('pkks'),
      safeCount('posyandus'),
      safeCount('karang_tarunas'),
      safeCount('satlinmas'),
      safeCount('lembaga_lainnyas')
    ]),
    safeAggregate('bumdes', {
      _sum: {
        NilaiAset: true,
        Omset2024: true,
        Laba2024: true,
        TotalTenagaKerja: true
      }
    }),
    safeAggregate('bankeu_proposals', {
      _sum: {
        anggaran_usulan: true
      }
    }),
    safeGroupBy('produk_hukums', {
      by: ['singkatan_jenis'],
      _count: { _all: true },
      orderBy: { _count: { singkatan_jenis: 'desc' } },
      take: 10
    }),
    fetchExternalDashboardStatsWithTimeout(previewMode ? 1200 : 3000)
  ]);

  const [
    totalRw,
    totalRt,
    totalLpm,
    totalPkk,
    totalPosyandu,
    totalKarangTaruna,
    totalSatlinmas,
    totalLembagaLainnya
  ] = kelembagaanCounts;

  const totalKelembagaan =
    totalRw +
    totalRt +
    totalLpm +
    totalPkk +
    totalPosyandu +
    totalKarangTaruna +
    totalSatlinmas +
    totalLembagaLainnya;

  const externalAparatur = normalizeExternalDashboard(
    externalDashboardResult.success ? externalDashboardResult.data : null
  );
  const totalAparaturExternal =
    externalAparatur.kepala_desa.total +
    externalAparatur.perangkat_desa.total +
    externalAparatur.bpd.total;

  const detailFallbacks = {
    wilayah: {
      total_kecamatan: totalKecamatan,
      total_desa: totalDesa,
      total_kelurahan: totalKelurahan,
      records: []
    },
    profil_desa: {
      total_terisi: totalProfilDesa,
      total_desa: totalDesa,
      records: []
    },
    produk_hukum: {
      total: totalProdukHukum,
      by_jenis: produkHukumByJenis.map((item) => ({
        jenis: item.singkatan_jenis || 'Tidak Diketahui',
        total: toNumber(item._count?._all)
      })),
      records: []
    },
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
    kelembagaan: {
      total: totalKelembagaan,
      rw: totalRw,
      rt: totalRt,
      lpm: totalLpm,
      pkk: totalPkk,
      posyandu: totalPosyandu,
      karang_taruna: totalKarangTaruna,
      satlinmas: totalSatlinmas,
      lembaga_lainnya: totalLembagaLainnya,
      records: {}
    },
    bankeu: {
      total_proposal: bankeuProposalTotal,
      submitted_to_kecamatan: bankeuSubmittedKecamatan,
      submitted_to_dpmd: bankeuSubmittedDpmd,
      approved_by_dpmd: bankeuApprovedDpmd,
      total_anggaran_usulan: toNumber(bankeuFinancials._sum?.anggaran_usulan),
      records: []
    }
  };

  const [
    wilayahDetail,
    profilDesaDetail,
    produkHukumDetail,
    aparaturDesaDetail,
    bumdesDetail,
    kelembagaanDetail,
    bankeuDetail
  ] = previewMode
    ? [
        detailFallbacks.wilayah,
        detailFallbacks.profil_desa,
        detailFallbacks.produk_hukum,
        detailFallbacks.aparatur_desa,
        detailFallbacks.bumdes,
        detailFallbacks.kelembagaan,
        detailFallbacks.bankeu
      ]
    : await Promise.all([
        safeBuildModule('wilayah detail', () => buildWilayahDetail(), detailFallbacks.wilayah),
        safeBuildModule('profil desa detail', () => buildProfilDesaDetail(baseUrl), detailFallbacks.profil_desa),
        safeBuildModule('produk hukum detail', () => buildProdukHukumDetail(baseUrl), detailFallbacks.produk_hukum),
        safeBuildModule('aparatur desa detail', () => buildAparaturDesaDetail(baseUrl), detailFallbacks.aparatur_desa),
        safeBuildModule('bumdes detail', () => buildBumdesDetail(baseUrl), detailFallbacks.bumdes),
        safeBuildModule('kelembagaan detail', () => buildKelembagaanDetail(baseUrl), detailFallbacks.kelembagaan),
        safeBuildModule('bankeu detail', () => buildBankeuDetail(baseUrl), detailFallbacks.bankeu)
      ]);

  const summary = {
    total_kecamatan: totalKecamatan,
    total_desa: totalDesa,
    total_kelurahan: totalKelurahan,
    total_pegawai: totalPegawai,
    total_bumdes: totalBumdes,
    total_aparatur_lokal: totalAparaturLokal,
    total_aparatur_external: totalAparaturExternal,
    total_kelembagaan: totalKelembagaan,
    total_produk_hukum: totalProdukHukum,
    total_profil_desa: totalProfilDesa,
    total_keuangan_desa_realisasi: keuanganDesaStats.total_realisasi,
    total_bankeu_proposal: bankeuProposalTotal
  };

  const modules = {
    wilayah: {
      total_kecamatan: totalKecamatan,
      total_desa: totalDesa,
      total_kelurahan: totalKelurahan,
      records: wilayahDetail.records || []
    },
    aparatur_desa: {
      source: externalAparatur.available ? 'external_dapur_desa' : 'local_database',
      external_available: externalAparatur.available,
      local_total_aktif: totalAparaturLokal,
      external_total: totalAparaturExternal,
      kepala_desa: externalAparatur.kepala_desa,
      perangkat_desa: externalAparatur.perangkat_desa,
      bpd: externalAparatur.bpd,
      ...aparaturDesaDetail
    },
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
    kelembagaan: {
      total: totalKelembagaan,
      rw: totalRw,
      rt: totalRt,
      lpm: totalLpm,
      pkk: totalPkk,
      posyandu: totalPosyandu,
      karang_taruna: totalKarangTaruna,
      satlinmas: totalSatlinmas,
      lembaga_lainnya: totalLembagaLainnya,
      ...kelembagaanDetail
    },
    bankeu: {
      total_proposal: bankeuProposalTotal,
      submitted_to_kecamatan: bankeuSubmittedKecamatan,
      submitted_to_dpmd: bankeuSubmittedDpmd,
      approved_by_dpmd: bankeuApprovedDpmd,
      total_anggaran_usulan: toNumber(bankeuFinancials._sum?.anggaran_usulan),
      ...bankeuDetail
    },
    keuangan_desa: keuanganDesaStats,
    produk_hukum: {
      total: totalProdukHukum,
      by_jenis: produkHukumByJenis.map((item) => ({
        jenis: item.singkatan_jenis || 'Tidak Diketahui',
        total: toNumber(item._count?._all)
      })),
      ...produkHukumDetail
    },
    profil_desa: {
      total_terisi: totalProfilDesa,
      total_desa: totalDesa,
      persentase_terisi: totalDesa > 0 ? Number(((totalProfilDesa / totalDesa) * 100).toFixed(2)) : 0,
      ...profilDesaDetail
    }
  };

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

module.exports = {
  getCoreDashboard
};
