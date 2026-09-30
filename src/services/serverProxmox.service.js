/**
 * Integrasi Proxmox VE untuk Manajemen Server.
 *
 * Seluruh aplikasi (super-apps/DPMD, simpaskor, Gate, asta-desa, posyandu,
 * postgres-db, k8s-app, …) berjalan sebagai container LXC/VM di satu host
 * Proxmox. Lewat API Proxmox halaman superadmin bisa memantau semuanya,
 * menyalakan/mematikan, serta mengatur jatah disk, RAM, dan CPU tiap aplikasi
 * — setara panel VPS di penyedia hosting.
 *
 * Konfigurasi lewat .env (JANGAN pakai sandi root — pakai API token):
 *   PROXMOX_URL=https://172.168.20.20:8006
 *   PROXMOX_TOKEN_ID=panel@pve!dpmd
 *   PROXMOX_TOKEN_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   PROXMOX_VERIFY_TLS=false        (sertifikat bawaan Proxmox self-signed)
 *   PROXMOX_SELF_VMID=100           (container tempat backend ini berjalan)
 *   PROXMOX_PROTECTED_VMIDS=102     (tidak boleh dimatikan dari panel, mis. Gate)
 */

const https = require('https');
const http = require('http');
const logger = require('../utils/logger');
const alerts = require('./serverAlerts.service');

const cfg = () => ({
  url: (process.env.PROXMOX_URL || '').replace(/\/+$/, ''),
  tokenId: process.env.PROXMOX_TOKEN_ID || '',
  secret: process.env.PROXMOX_TOKEN_SECRET || '',
  verify: String(process.env.PROXMOX_VERIFY_TLS || 'false') === 'true',
  selfVmid: Number(process.env.PROXMOX_SELF_VMID) || null,
  protected: String(process.env.PROXMOX_PROTECTED_VMIDS || '')
    .split(',').map((s) => Number(s.trim())).filter(Boolean),
});

const isConfigured = () => {
  const c = cfg();
  return !!(c.url && c.tokenId && c.secret);
};

const agenTls = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const agenTlsKetat = new https.Agent({ rejectUnauthorized: true, keepAlive: true });

/** Panggil API Proxmox. `body` dikirim sebagai form-urlencoded. */
const panggil = (method, jalur, body = null, { timeout = 15000 } = {}) => new Promise((resolve, reject) => {
  const c = cfg();
  if (!isConfigured()) {
    reject(Object.assign(new Error('Proxmox belum dikonfigurasi (PROXMOX_URL/TOKEN di .env)'), { status: 503 }));
    return;
  }
  const u = new URL(`${c.url}/api2/json${jalur}`);
  const isi = body ? new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : null;
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request(u, {
    method,
    timeout,
    agent: u.protocol === 'https:' ? (c.verify ? agenTlsKetat : agenTls) : undefined,
    headers: {
      Authorization: `PVEAPIToken=${c.tokenId}=${c.secret}`,
      Accept: 'application/json',
      ...(isi ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(isi) } : {}),
    },
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { data += d; });
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(data); } catch { /* bukan JSON */ }
      if (res.statusCode >= 400) {
        const rinci = json?.errors ? ` — ${Object.values(json.errors).join('; ')}` : '';
        const pesan = res.statusCode === 401
          ? 'Token Proxmox ditolak (401). Periksa PROXMOX_TOKEN_ID/SECRET.'
          : res.statusCode === 403
            ? `Token Proxmox tidak punya izin untuk aksi ini (403)${rinci}`
            : `Proxmox ${res.statusCode}: ${res.statusMessage}${rinci}`;
        reject(Object.assign(new Error(pesan), { status: res.statusCode }));
        return;
      }
      resolve(json ? json.data : data);
    });
  });
  req.on('timeout', () => req.destroy(new Error('Proxmox tidak merespons (timeout)')));
  req.on('error', (e) => reject(Object.assign(new Error(`Tidak bisa terhubung ke Proxmox: ${e.message}`), { status: 502 })));
  if (isi) req.write(isi);
  req.end();
});

/* ─────────────────────────── Util ─────────────────────────── */

/** "local-lvm:vm-100-disk-0,size=200G" → { storage, volume, size_bytes } */
const uraiDisk = (teks) => {
  if (!teks || typeof teks !== 'string') return null;
  const [vol, ...opsi] = teks.split(',');
  const o = Object.fromEntries(opsi.map((x) => x.split('=')));
  const [storage, volume] = vol.includes(':') ? vol.split(':') : [null, vol];
  const m = String(o.size || '').match(/^(\d+(?:\.\d+)?)([KMGT]?)$/i);
  const kali = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return {
    raw: teks,
    storage,
    volume,
    size: o.size || null,
    size_bytes: m ? Math.round(Number(m[1]) * kali[m[2].toUpperCase()]) : null,
    mountpoint: o.mp || null,
  };
};

/** Ambil IP dari "name=eth0,bridge=vmbr0,ip=172.168.20.105/24,gw=…" */
const ipDariNet = (teks) => (String(teks || '').match(/ip=([\d.]+)/) || [])[1] || null;

const tipeValid = (t) => (t === 'lxc' || t === 'qemu' ? t : null);

/* ─────────────────────────── Baca ─────────────────────────── */

let cacheRingkasan = null;

const getOverview = async () => {
  const [nodes, resources] = await Promise.all([
    panggil('GET', '/nodes'),
    panggil('GET', '/cluster/resources'),
  ]);

  const detailNode = await Promise.all(nodes.map(async (n) => {
    let status = null;
    try { status = await panggil('GET', `/nodes/${n.node}/status`); } catch { /* izin Sys.Audit mungkin tidak ada */ }
    return {
      node: n.node,
      status: n.status,
      cpu: Math.round((n.cpu || 0) * 1000) / 10,
      maxcpu: n.maxcpu,
      mem: n.mem,
      maxmem: n.maxmem,
      disk: n.disk,
      maxdisk: n.maxdisk,
      uptime: n.uptime,
      loadavg: status?.loadavg || null,
      cpu_model: status?.cpuinfo?.model || null,
      sockets: status?.cpuinfo?.sockets || null,
      kernel: status?.kversion || null,
      pve_version: status?.pveversion || null,
      swap: status?.swap || null,
      rootfs: status?.rootfs || null,
      ksm: status?.ksm || null,
    };
  }));

  const c = cfg();
  const guests = resources
    .filter((r) => r.type === 'lxc' || r.type === 'qemu')
    .map((r) => ({
      vmid: r.vmid,
      name: r.name,
      type: r.type,
      node: r.node,
      status: r.status,
      template: !!r.template,
      tags: r.tags ? String(r.tags).split(/[;,]/).filter(Boolean) : [],
      cpu: Math.round((r.cpu || 0) * 1000) / 10,
      maxcpu: r.maxcpu,
      mem: r.mem,
      maxmem: r.maxmem,
      disk: r.disk,
      maxdisk: r.maxdisk,
      netin: r.netin,
      netout: r.netout,
      diskread: r.diskread,
      diskwrite: r.diskwrite,
      uptime: r.uptime,
      is_self: c.selfVmid === r.vmid,
      protected: c.protected.includes(r.vmid) || c.selfVmid === r.vmid,
    }))
    .sort((a, b) => a.vmid - b.vmid);

  const storages = resources
    .filter((r) => r.type === 'storage')
    .map((r) => ({
      storage: r.storage,
      node: r.node,
      status: r.status,
      plugintype: r.plugintype,
      content: r.content,
      disk: r.disk,
      maxdisk: r.maxdisk,
      shared: !!r.shared,
    }));

  // Peringatan per aplikasi: mati, RAM/disk hampir penuh.
  for (const g of guests) {
    if (g.template) continue;
    const kunci = `pve:${g.vmid}`;
    const pakaiMem = g.maxmem ? (g.mem / g.maxmem) * 100 : 0;
    const pakaiDisk = g.maxdisk && g.type === 'lxc' ? (g.disk / g.maxdisk) * 100 : 0;
    if (g.status !== 'running') {
      alerts.raise(`${kunci}:down`, { level: 'critical', kategori: 'proxmox', title: `Aplikasi ${g.name} mati`, message: `Container/VM ${g.vmid} (${g.name}) berstatus ${g.status}.` });
    } else {
      alerts.clear(`${kunci}:down`);
    }
    if (pakaiDisk >= 90) {
      alerts.raise(`${kunci}:disk`, { level: pakaiDisk >= 97 ? 'critical' : 'warning', kategori: 'proxmox', title: `Disk ${g.name} hampir penuh`, message: `Disk ${g.name} terpakai ${Math.round(pakaiDisk)}%. Tambah kapasitas dari tab Semua Aplikasi.` });
    } else {
      alerts.clear(`${kunci}:disk`);
    }
    if (pakaiMem >= 95) {
      alerts.raise(`${kunci}:mem`, { level: 'warning', kategori: 'proxmox', title: `RAM ${g.name} hampir penuh`, message: `RAM ${g.name} terpakai ${Math.round(pakaiMem)}%.` });
    } else {
      alerts.clear(`${kunci}:mem`);
    }
  }
  for (const s of storages) {
    const persen = s.maxdisk ? (s.disk / s.maxdisk) * 100 : 0;
    const kunci = `pve:storage:${s.storage}`;
    if (persen >= 85) {
      alerts.raise(kunci, { level: persen >= 95 ? 'critical' : 'warning', kategori: 'proxmox', title: `Storage ${s.storage} hampir penuh`, message: `Pool ${s.storage} di ${s.node} terpakai ${Math.round(persen)}%. Semua aplikasi di pool ini terancam tidak bisa menulis data.` });
    } else {
      alerts.clear(kunci);
    }
  }

  cacheRingkasan = { at: Date.now(), nodes: detailNode, guests, storages };
  return cacheRingkasan;
};

const cariGuest = async (vmid) => {
  const id = Number(vmid);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('VMID tidak valid'), { status: 400 });
  const ringkas = cacheRingkasan && Date.now() - cacheRingkasan.at < 30000 ? cacheRingkasan : await getOverview();
  const g = ringkas.guests.find((x) => x.vmid === id);
  if (!g) throw Object.assign(new Error(`Container/VM ${id} tidak ditemukan`), { status: 404 });
  return g;
};

const getGuest = async (vmid) => {
  const g = await cariGuest(vmid);
  const dasar = `/nodes/${g.node}/${g.type}/${g.vmid}`;
  const [config, current, snapshots, tugas] = await Promise.all([
    panggil('GET', `${dasar}/config`).catch(() => ({})),
    panggil('GET', `${dasar}/status/current`).catch(() => null),
    panggil('GET', `${dasar}/snapshot`).catch(() => []),
    panggil('GET', `/nodes/${g.node}/tasks?vmid=${g.vmid}&limit=15`).catch(() => []),
  ]);

  const disks = [];
  for (const [k, v] of Object.entries(config)) {
    if (/^(rootfs|mp\d+|scsi\d+|virtio\d+|sata\d+|ide\d+)$/.test(k) && typeof v === 'string' && !v.includes('media=cdrom')) {
      const d = uraiDisk(v);
      if (d) disks.push({ key: k, ...d });
    }
  }
  const jaringan = Object.entries(config)
    .filter(([k]) => /^net\d+$/.test(k))
    .map(([k, v]) => ({ key: k, raw: v, ip: ipDariNet(v), bridge: (String(v).match(/bridge=([^,]+)/) || [])[1] || null }));

  return {
    ...g,
    config: {
      hostname: config.hostname || config.name || g.name,
      ostype: config.ostype || null,
      cores: Number(config.cores) || null,
      sockets: Number(config.sockets) || null,
      cpulimit: config.cpulimit ? Number(config.cpulimit) : null,
      memory_mb: Number(config.memory) || null,
      swap_mb: config.swap !== undefined ? Number(config.swap) : null,
      onboot: config.onboot === 1 || config.onboot === '1',
      unprivileged: config.unprivileged === 1 || config.unprivileged === '1',
      description: config.description || null,
      features: config.features || null,
    },
    disks,
    network: jaringan,
    current: current ? {
      ha: current.ha?.state || null,
      pid: current.pid || null,
      swap: current.swap ?? null,
      maxswap: current.maxswap ?? null,
    } : null,
    snapshots: (Array.isArray(snapshots) ? snapshots : []).filter((s) => s.name !== 'current').map((s) => ({ name: s.name, description: s.description, time: s.snaptime ? new Date(s.snaptime * 1000) : null })),
    tasks: (Array.isArray(tugas) ? tugas : []).map((t) => ({ type: t.type, status: t.status, user: t.user, start: t.starttime ? new Date(t.starttime * 1000) : null, end: t.endtime ? new Date(t.endtime * 1000) : null, upid: t.upid })),
  };
};

const RRD_RANGE = { hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' };

const getRrd = async (vmid, timeframe = 'hour') => {
  const tf = RRD_RANGE[timeframe] || 'hour';
  let jalur;
  if (vmid === 'node') {
    const nodes = await panggil('GET', '/nodes');
    jalur = `/nodes/${nodes[0].node}/rrddata?timeframe=${tf}&cf=AVERAGE`;
  } else {
    const g = await cariGuest(vmid);
    jalur = `/nodes/${g.node}/${g.type}/${g.vmid}/rrddata?timeframe=${tf}&cf=AVERAGE`;
  }
  const data = await panggil('GET', jalur);
  return (data || []).filter((p) => p.time).map((p) => ({
    t: p.time * 1000,
    cpu: p.cpu !== undefined ? Math.round(p.cpu * 1000) / 10 : null,
    memory: p.maxmem ? Math.round((p.mem / p.maxmem) * 1000) / 10 : (p.memtotal ? Math.round((p.memused / p.memtotal) * 1000) / 10 : null),
    mem: p.mem ?? p.memused ?? null,
    disk: p.maxdisk ? Math.round((p.disk / p.maxdisk) * 1000) / 10 : (p.roottotal ? Math.round((p.rootused / p.roottotal) * 1000) / 10 : null),
    rx: p.netin !== undefined ? Math.round(p.netin) : null,
    tx: p.netout !== undefined ? Math.round(p.netout) : null,
    read: p.diskread !== undefined ? Math.round(p.diskread) : null,
    write: p.diskwrite !== undefined ? Math.round(p.diskwrite) : null,
    load: p.loadavg ?? null,
    iowait: p.iowait !== undefined ? Math.round(p.iowait * 1000) / 10 : null,
  }));
};

const getTasks = async () => {
  const nodes = await panggil('GET', '/nodes');
  const semua = await Promise.all(nodes.map((n) => panggil('GET', `/nodes/${n.node}/tasks?limit=40`).catch(() => [])));
  return semua.flat()
    .map((t) => ({ node: t.node, type: t.type, id: t.id, status: t.status, user: t.user, start: t.starttime ? new Date(t.starttime * 1000) : null, end: t.endtime ? new Date(t.endtime * 1000) : null }))
    .sort((a, b) => (b.start || 0) - (a.start || 0))
    .slice(0, 60);
};

/* ─────────────────────────── Aksi ─────────────────────────── */

const AKSI_DAYA = ['start', 'shutdown', 'reboot', 'stop'];

const powerAction = async (vmid, aksi) => {
  if (!AKSI_DAYA.includes(aksi)) throw Object.assign(new Error('Aksi tidak dikenal'), { status: 400 });
  const g = await cariGuest(vmid);
  if (g.protected && aksi !== 'start') {
    throw Object.assign(new Error(g.is_self
      ? 'Container ini menjalankan panel yang sedang Anda buka. Mematikan/me-reboot-nya dari sini akan memutus panel. Lakukan dari Proxmox langsung.'
      : `${g.name} ditandai terlindungi (PROXMOX_PROTECTED_VMIDS) sehingga tidak bisa dimatikan dari panel.`), { status: 400 });
  }
  const upid = await panggil('POST', `/nodes/${g.node}/${g.type}/${g.vmid}/status/${aksi}`, aksi === 'shutdown' ? { timeout: 120 } : null);
  cacheRingkasan = null;
  return { upid, guest: g };
};

const SATUAN = { G: 1024 ** 3, M: 1024 ** 2 };

/** Tambah kapasitas disk (Proxmox hanya mengizinkan membesar). */
const resizeDisk = async (vmid, diskKey, tambahGb) => {
  const g = await cariGuest(vmid);
  const tambah = Number(tambahGb);
  if (!Number.isFinite(tambah) || tambah < 1 || tambah > 2048) throw Object.assign(new Error('Tambahan disk harus 1–2048 GB'), { status: 400 });
  if (!/^(rootfs|mp\d+|scsi\d+|virtio\d+|sata\d+|ide\d+)$/.test(diskKey)) throw Object.assign(new Error('Disk tidak valid'), { status: 400 });

  // Pastikan pool penyimpanannya masih punya ruang.
  const detail = await getGuest(vmid);
  const disk = detail.disks.find((d) => d.key === diskKey);
  if (!disk) throw Object.assign(new Error(`Disk ${diskKey} tidak ditemukan`), { status: 404 });
  const pool = cacheRingkasan?.storages.find((s) => s.storage === disk.storage && s.node === g.node);
  if (pool && pool.maxdisk && pool.maxdisk - pool.disk < tambah * SATUAN.G) {
    throw Object.assign(new Error(`Ruang kosong di pool ${disk.storage} tidak cukup (sisa ${Math.floor((pool.maxdisk - pool.disk) / SATUAN.G)} GB).`), { status: 400 });
  }

  const hasil = await panggil('PUT', `/nodes/${g.node}/${g.type}/${g.vmid}/resize`, { disk: diskKey, size: `+${Math.round(tambah)}G` }, { timeout: 120000 });
  cacheRingkasan = null;
  return { upid: hasil, guest: g, disk: diskKey, added_gb: Math.round(tambah), old_size: disk.size };
};

/** Ubah jatah RAM/swap/CPU. */
const updateResources = async (vmid, { memory_mb, swap_mb, cores }) => {
  const g = await cariGuest(vmid);
  const body = {};
  if (memory_mb !== undefined && memory_mb !== null && memory_mb !== '') {
    const m = Number(memory_mb);
    if (!Number.isInteger(m) || m < 256 || m > 1024 * 1024) throw Object.assign(new Error('RAM harus 256 MB – 1 TB'), { status: 400 });
    body.memory = m;
  }
  if (g.type === 'lxc' && swap_mb !== undefined && swap_mb !== null && swap_mb !== '') {
    const s = Number(swap_mb);
    if (!Number.isInteger(s) || s < 0 || s > 1024 * 1024) throw Object.assign(new Error('Swap tidak valid'), { status: 400 });
    body.swap = s;
  }
  if (cores !== undefined && cores !== null && cores !== '') {
    const c = Number(cores);
    if (!Number.isInteger(c) || c < 1 || c > 512) throw Object.assign(new Error('Jumlah core harus 1–512'), { status: 400 });
    body.cores = c;
  }
  if (!Object.keys(body).length) throw Object.assign(new Error('Tidak ada perubahan'), { status: 400 });
  // LXC: PUT config berlaku langsung (hotplug). QEMU: POST config, sebagian butuh reboot.
  await panggil(g.type === 'lxc' ? 'PUT' : 'POST', `/nodes/${g.node}/${g.type}/${g.vmid}/config`, body);
  cacheRingkasan = null;
  return { guest: g, changes: body, needs_reboot: g.type === 'qemu' };
};

const testConnection = async () => {
  const v = await panggil('GET', '/version');
  return { version: v?.version, release: v?.release, repoid: v?.repoid };
};

let started = false;
const start = () => {
  if (started || !isConfigured()) return;
  started = true;
  // Dicek di latar supaya peringatan (aplikasi mati, disk penuh) muncul
  // walau halaman tidak sedang dibuka.
  const cek = () => getOverview().catch((e) => {
    alerts.raise('pve:api', { level: 'warning', kategori: 'proxmox', title: 'Proxmox tidak terjangkau', message: e.message });
  }).then((r) => { if (r) alerts.clear('pve:api'); });
  setTimeout(cek, 25000).unref();
  setInterval(cek, 2 * 60000).unref();
  logger.info('🖥️  Integrasi Proxmox aktif');
};

module.exports = {
  isConfigured,
  getConfigInfo: () => {
    const c = cfg();
    return { configured: isConfigured(), url: c.url || null, token_id: c.tokenId || null, verify_tls: c.verify, self_vmid: c.selfVmid, protected: c.protected };
  },
  testConnection,
  getOverview,
  getGuest,
  getRrd,
  getTasks,
  powerAction,
  resizeDisk,
  updateResources,
  start,
  uraiDisk,
};
