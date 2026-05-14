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

const aggregateFinanceFiles = (fileNames) => {
  const rows = fileNames.flatMap(readPublicJsonRows);
  const statusMap = new Map();
  const desaSet = new Set();

  let totalRealisasi = 0;

  rows.forEach((row) => {
    const realisasi = toCurrencyNumber(row.Realisasi ?? row.realisasi ?? row.total_realisasi ?? row.nilai);
    const status = row.sts || row.status || 'Tidak Diketahui';
    const desaKey = `${row.kecamatan || ''}|${row.desa || row.nama_desa || ''}`;

    totalRealisasi += realisasi;
    if (desaKey.trim() !== '|') desaSet.add(desaKey);

    const current = statusMap.get(status) || { status, total: 0, total_realisasi: 0 };
    current.total += 1;
    current.total_realisasi += realisasi;
    statusMap.set(status, current);
  });

  return {
    total_records: rows.length,
    total_desa: desaSet.size,
    total_realisasi: totalRealisasi,
    by_status: Array.from(statusMap.values()).sort((a, b) => b.total - a.total)
  };
};

const buildKeuanganDesaStats = () => {
  const add = aggregateFinanceFiles(['add2025.json']);
  const danaDesa = aggregateFinanceFiles(['dd2025.json']);
  const bhprd = aggregateFinanceFiles(['bhprd2025.json']);
  const bankeuPublik = aggregateFinanceFiles(['bankeu2025.json']);
  const insentifDd = aggregateFinanceFiles(['insentif-dd.json']);

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
          <p class="subtitle">Akses data agregat DPMD Kabupaten Bogor dengan API key resmi.</p>
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
            <p class="subtitle">Masukkan API key untuk melihat ringkasan dan JSON respons realtime.</p>
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
console.log(result.data.summary);
console.log(result.data.modules);</pre>
              </div>
            </div>
            <ul class="fields">
              <li><code>data.summary</code> contains the main aggregate numbers for quick display.</li>
              <li><code>data.modules.profil_desa</code>, <code>data.modules.keuangan_desa</code>, <code>data.modules.aparatur_desa</code>, and <code>data.modules.produk_hukum</code> contain the Core Dashboard detail modules.</li>
              <li><code>data.modules</code> also includes wilayah, BUMDes, kelembagaan, bankeu, and perjadin data.</li>
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
        const response = await fetch(window.location.pathname, {
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

const buildPublicDashboardPayload = async () => {
  const now = new Date();
  const keuanganDesaStats = buildKeuanganDesaStats();

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
    kegiatanTotal,
    kegiatanUpcoming30Days,
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
    safeCount('kegiatan'),
    safeCount('kegiatan', {
      where: {
        tanggal_mulai: {
          gte: now,
          lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        }
      }
    }),
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
    externalApiService.fetchDashboardStats()
      .then((data) => ({ success: true, data }))
      .catch((error) => ({ success: false, error: error.message }))
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

  return {
    meta: {
      generated_at: now.toISOString(),
      timezone: 'Asia/Jakarta',
      version: '1.0',
      access: 'protected_api_key',
      auth_required: true,
      realtime: true,
      cache: 'no-store'
    },
    endpoints: {
      canonical: '/api/public/core-dashboard',
      alias: '/api/public/dashboard'
    },
    summary: {
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
      total_bankeu_proposal: bankeuProposalTotal,
      total_kegiatan: kegiatanTotal
    },
    modules: {
      wilayah: {
        total_kecamatan: totalKecamatan,
        total_desa: totalDesa,
        total_kelurahan: totalKelurahan
      },
      aparatur_desa: {
        source: externalAparatur.available ? 'external_dapur_desa' : 'local_database',
        external_available: externalAparatur.available,
        local_total_aktif: totalAparaturLokal,
        external_total: totalAparaturExternal,
        kepala_desa: externalAparatur.kepala_desa,
        perangkat_desa: externalAparatur.perangkat_desa,
        bpd: externalAparatur.bpd
      },
      bumdes: {
        total: totalBumdes,
        aktif: bumdesAktif,
        tidak_aktif: Math.max(totalBumdes - bumdesAktif, 0),
        total_aset: toNumber(bumdesFinancials._sum?.NilaiAset),
        total_omzet_2024: toNumber(bumdesFinancials._sum?.Omset2024),
        total_laba_2024: toNumber(bumdesFinancials._sum?.Laba2024),
        total_tenaga_kerja: toNumber(bumdesFinancials._sum?.TotalTenagaKerja)
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
        lembaga_lainnya: totalLembagaLainnya
      },
      bankeu: {
        total_proposal: bankeuProposalTotal,
        submitted_to_kecamatan: bankeuSubmittedKecamatan,
        submitted_to_dpmd: bankeuSubmittedDpmd,
        approved_by_dpmd: bankeuApprovedDpmd,
        total_anggaran_usulan: toNumber(bankeuFinancials._sum?.anggaran_usulan)
      },
      keuangan_desa: keuanganDesaStats,
      produk_hukum: {
        total: totalProdukHukum,
        by_jenis: produkHukumByJenis.map((item) => ({
          jenis: item.singkatan_jenis || 'Tidak Diketahui',
          total: toNumber(item._count?._all)
        }))
      },
      profil_desa: {
        total_terisi: totalProfilDesa,
        total_desa: totalDesa,
        persentase_terisi: totalDesa > 0 ? Number(((totalProfilDesa / totalDesa) * 100).toFixed(2)) : 0
      },
      perjadin: {
        total_kegiatan: kegiatanTotal,
        upcoming_30_days: kegiatanUpcoming30Days
      }
    },
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

    const data = await buildPublicDashboardPayload();

    res.status(200).json({
      success: true,
      message: 'Data Core Dashboard publik berhasil diambil',
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
