/**
 * Ingest peringatan Wazuh untuk SOC. Base path: /api/soc/ingest
 *
 * Tanpa JWT (sensor Wazuh bukan pengguna), tapi dijaga token bersama di header
 * `x-soc-token` (env SOC_INGEST_TOKEN). Token kosong = endpoint mati (404).
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const security = require('../services/serverSecurity.service');

const levelKeSeverity = (l) => (l >= 12 ? 'critical' : l >= 10 ? 'high' : l >= 7 ? 'medium' : 'low');

const tokenSama = (diberi) => {
  const a = Buffer.from(String(diberi || ''));
  const b = Buffer.from(process.env.SOC_INGEST_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

router.post('/', (req, res) => {
  if (!process.env.SOC_INGEST_TOKEN) return res.status(404).json({ success: false, message: 'Not found' });
  if (!tokenSama(req.headers['x-soc-token'])) return res.status(401).json({ success: false, message: 'Token tidak valid' });

  const daftar = Array.isArray(req.body) ? req.body : [req.body];
  if (daftar.length > 200) return res.status(400).json({ success: false, message: 'Maksimal 200 peringatan per permintaan' });

  let diterima = 0;
  for (const alert of daftar) {
    if (!alert || typeof alert !== 'object') continue;
    // source 'wazuh' (bukan 'app'): recordEvent tidak menghitungnya ke skor/autoblock.
    security.recordEvent({
      ip: alert.data?.srcip || '0.0.0.0',
      type: 'wazuh_alert',
      severity: levelKeSeverity(Number(alert.rule?.level) || 0),
      source: 'wazuh',
      path: null,
      detail: `${alert.agent?.name || '?'}: [${alert.rule?.id}] ${alert.rule?.description}`.slice(0, 1000),
    });
    diterima += 1;
  }
  res.json({ success: true, diterima });
});

module.exports = router;
