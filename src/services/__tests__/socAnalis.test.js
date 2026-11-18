// socAnalis memuat serverStore (Prisma) hanya untuk konfigurasi; tiruan supaya tes tanpa DB.
jest.mock('../serverStore.service', () => ({ getConfigSync: () => ({ soc: { ai_aktif: true } }) }));

const { susunFakta, susunDokumentasi, pisahPenutup, PROMPT_SISTEM } = require('../socAnalis.service');

const insiden = {
  kode: 'INS-20261118-001', judul: 'SQL Injection dari 8.8.8.8', kategori: 'serangan_web', severity: 'critical', status: 'selesai',
  ip_address: '8.8.8.8', jumlah_event: 7, pertama_at: new Date('2026-11-18T14:00:00Z'), terakhir_at: new Date('2026-11-18T14:10:00Z'),
  created_at: new Date('2026-11-18T14:01:00Z'), selesai_at: new Date('2026-11-18T15:01:00Z'), ditutup_oleh: 'Admin', catatan_tutup: 'IP sudah diblokir',
};

describe('susunFakta', () => {
  test('membatasi contoh path (5, unik, 120 karakter) dan user agent (2)', () => {
    const paths = ['/a', '/a', ...Array.from({ length: 10 }, (_, i) => `/p${i}`), `/${'x'.repeat(300)}`];
    const fakta = susunFakta({
      insiden,
      ringkasEvent: { perTipe: [{ tipe: 'sql_injection', label: 'SQL Injection', n: 7, ditolak: 7 }], paths, userAgents: ['u1', 'u2', 'u3'], ditolak: 7, ipDiblokir: true },
      log: [{ jenis: 'tindakan', isi: 'IP diblokir' }, { jenis: 'catatan', isi: 'abaikan' }],
      geo: { cc: 'US', country: 'United States' },
      akun: { nama: 'Budi', peran: 'pegawai' },
    });
    expect(fakta.contoh_path).toHaveLength(5);
    expect(new Set(fakta.contoh_path).size).toBe(5);
    expect(fakta.contoh_user_agent).toEqual(['u1', 'u2']);
    expect(susunFakta({ insiden, ringkasEvent: { paths: [`/${'x'.repeat(300)}`] } }).contoh_path[0]).toHaveLength(120);
    expect(fakta.tindakan).toEqual({ manual: ['IP diblokir'], permintaan_ditolak: 7, ip_sedang_diblokir: true });
    expect(fakta.negara).toBe('United States');
    expect(fakta.akun).toEqual({ nama: 'Budi', peran: 'pegawai' });
    expect(susunFakta({ insiden }).akun).toBeUndefined();
  });
});

describe('susunDokumentasi', () => {
  const fakta = susunFakta({
    insiden,
    ringkasEvent: { perTipe: [{ tipe: 'sql_injection', label: 'SQL Injection', n: 7, ditolak: 7 }], paths: ['/api/x?id=1 OR 1=1'], ditolak: 7 },
  });
  const log = [{ at: new Date('2026-11-18T14:01:00Z'), oleh: 'sistem', jenis: 'dibuat', isi: 'Dibuka' }];

  test('memuat semua judul bagian dan fallback AI', () => {
    const md = susunDokumentasi({ insiden, fakta, log });
    for (const j of ['# Laporan Insiden INS-20261118-001', '## Ringkasan eksekutif (AI)', '## Kronologi', '## Bukti',
      '## Tindakan yang sudah dilakukan', '## Analisis (AI)', '## Pelajaran & pencegahan (AI)', '## Catatan penutup']) {
      expect(md).toContain(j);
    }
    expect(md).toContain('_Analisis AI belum tersedia._');
    expect(md).toContain('21.01 WIB'); // 14:01 UTC = 21.01 WIB
    expect(md).toContain('7 permintaan ditolak otomatis oleh aplikasi');
    expect(md).toContain('IP sudah diblokir');
    expect(md.trim().endsWith('perlu ditinjau manusia._')).toBe(true);
  });

  test('tanpa tindakan manual', () => {
    expect(susunDokumentasi({ insiden, fakta, log })).toContain('Tidak ada tindakan manual; serangan ditangani otomatis.');
  });

  test('bagian AI penutup dipisah pada judul Pelajaran', () => {
    const ai = '## Ringkasan eksekutif\nSerangan ditolak.\n## Pelajaran & pencegahan\n- Perbarui WAF';
    expect(pisahPenutup(ai)).toEqual({ ringkasan: 'Serangan ditolak.', pelajaran: '- Perbarui WAF' });
    const md = susunDokumentasi({ insiden, fakta, log, aiPenutup: ai, analisisAi: '## Penilaian\nSerius' });
    expect(md).toContain('Serangan ditolak.');
    expect(md).toContain('- Perbarui WAF');
    expect(md).toContain('## Penilaian\nSerius');
    expect(md).not.toContain('_Analisis AI belum tersedia._');
  });

  test('tanpa judul Pelajaran seluruh teks masuk Ringkasan eksekutif', () => {
    expect(pisahPenutup('Hanya satu paragraf.')).toEqual({ ringkasan: 'Hanya satu paragraf.', pelajaran: null });
  });
});

test('prompt sistem statis memuat aturan mutlak', () => {
  expect(PROMPT_SISTEM).toContain('Aturan mutlak:');
});
