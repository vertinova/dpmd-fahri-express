// Matching logic is pure; stub the prisma-laden base controller so the module loads under Jest.
jest.mock('../base.controller', () => ({ prisma: {} }));

const { _internals } = require('../rtrwComparison.controller');
const { normalizeName, isSimilarName, compareItems, isKetuaRtRw, nikErrorSebab, buildBpjsUnmappableList } = _internals;

const db = (nama, nik, extra = {}) => ({ source: 'db', nama, normalized: normalizeName(nama), nik, ...extra });
const add = (nama, extra = {}) => ({ source: 'add', nama, normalized: normalizeName(nama), totalNilai: 0, details: [], ...extra });
const bpjs = (nama, nik, extra = {}) => ({ source: 'bpjs', nama, normalized: normalizeName(nama), nik, totalUpah: 0, details: [], ...extra });

const statusOf = (items, frag) => items.find((i) => i.nama.includes(frag));

describe('normalizeName', () => {
  it('strips trailing degree titles and commas', () => {
    expect(normalizeName('KARTOLI, SE')).toBe('KARTOLI');
    expect(normalizeName('BUDI SANTOSO, ST')).toBe('BUDI SANTOSO');
    expect(normalizeName('H. AHMAD, S.Pd')).toBe('AHMAD');
  });
});

describe('isKetuaRtRw', () => {
  it('accepts ketua RT/RW in any capitalisation or spacing', () => {
    ['KETUA RT', 'Ketua RW', 'ketua rt', '  KETUA  RW '].forEach((j) => expect(isKetuaRtRw(j)).toBe(true));
  });
  it('accepts the long spelling stored in the database', () => {
    ['KETUA RUKUN TANGGA', 'KETUA RUKUN WARGA', 'Ketua Rukun Warga'].forEach((j) => expect(isKetuaRtRw(j)).toBe(true));
  });
  it('rejects pengurus lain dan nilai kosong', () => {
    ['SEKRETARIS RT', 'BENDAHARA RW', 'SEKSI PEMBANGUNAN', 'KETUA RT 01', '', null, undefined]
      .forEach((j) => expect(isKetuaRtRw(j)).toBe(false));
  });
});

describe('isSimilarName', () => {
  it('treats one-token spelling variants as the same person', () => {
    expect(isSimilarName('NOVA ROHIB NURDIN', 'NOVA ROHIB NOERDIN')).toBe(true);
    expect(isSimilarName('NOVA ROHIB NURDIN', 'NOVA ROHIB NURDIEN')).toBe(true);
    expect(isSimilarName('IRHOTBA MARJUANGS', 'IRHOTBA MARJUANG S')).toBe(true);
  });
  it('does not merge clearly different people', () => {
    expect(isSimilarName('SITI AMINAH', 'SITI AISYAH')).toBe(false);
    expect(isSimilarName('AHMAD FAUZI', 'DEDI MULYANA')).toBe(false);
  });
});

describe('compareItems three-source merge', () => {
  const opts = { enableFuzzy: true };

  it('reunites a name split only by a degree title (KARTOLI)', () => {
    const items = compareItems([db('KARTOLI, SE', '111')], [add('KARTOLI')], [bpjs('KARTOLI', '111')], opts);
    expect(statusOf(items, 'KARTOLI').status).toBe('all_three');
  });

  it('reunites short-vs-full DB name via BPJS+ADD (GUNTUR)', () => {
    const items = compareItems(
      [db('GUNTUR KURNIAWAN', '222')],
      [add('GUNTUR KURNIAWAN YOGIANTO')],
      [bpjs('GUNTUR KURNIAWAN YOGIANTO', '222')],
      opts,
    );
    expect(statusOf(items, 'GUNTUR').status).toBe('all_three');
  });

  it('reunites spelling variants with different NIK and flags nikMismatch (NOVA)', () => {
    const items = compareItems(
      [db('NOVA ROHIB NURDIEN', '010')],
      [add('NOVA ROHIB NURDIN')],
      [bpjs('NOVA ROHIB NOERDIN', '012')],
      opts,
    );
    const nova = statusOf(items, 'NOVA');
    expect(nova.status).toBe('all_three');
    expect(nova.nikMismatch).toBe(true);
  });

  it('keeps genuinely different people in the same desa separate', () => {
    const items = compareItems(
      [db('AHMAD FAUZI', 'A1')],
      [add('DEDI MULYANA')],
      [bpjs('SITI NURBAYA', 'B1')],
      opts,
    );
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.status.startsWith('only_'))).toBe(true);
  });
});

describe('applyCrossDesaNikFallback (generalisasi Tangkil + NIK Invalid)', () => {
  const { applyCrossDesaNikFallback } = _internals;
  const desaByKode = new Map([
    ['D1', { nama: 'Desa Satu', kecamatans: { nama: 'Kec A' } }],
    ['D2', { nama: 'Desa Dua', kecamatans: { nama: 'Kec A' } }],
    ['D3', { nama: 'Desa Tiga', kecamatans: { nama: 'Kec B' } }],
  ]);
  const dbItem = (nik, desaKode, nama, extra = {}) => ({
    source: 'db', nik, desaKode, nama, normalized: normalizeName(nama), namaLengkap: nama,
    desaNama: desaByKode.get(desaKode)?.nama || '', kecamatanNama: desaByKode.get(desaKode)?.kecamatans?.nama || '', ...extra,
  });
  const bpjsItem = (nik, desaKode, nama, tglLahir = '') => ({
    source: 'bpjs', nik, desaKode, nama, normalized: normalizeName(nama),
    details: [{ nik, tglLahir, idPegawai: desaKode }],
  });

  it('reassign ketika NIK ada di DB desa lain (nama mirip, unik)', () => {
    const { reassigned, stats } = applyCrossDesaNikFallback(
      [bpjsItem('111', 'D1', 'BUDI SANTOSO')], [dbItem('111', 'D2', 'BUDI SANTOSO')], desaByKode);
    expect(reassigned[0].desaKode).toBe('D2');
    expect(reassigned[0].bpjsDesaConfirmedByNik).toBe(true);
    expect(reassigned[0].bpjsOriginalDesaKode).toBe('D1');
    expect(reassigned[0].details[0].idPegawai).toBe('D2');
    expect(stats.confirmed).toBe(1);
  });

  it('TIDAK reassign bila NIK juga ada di DB desa yang sama', () => {
    const { reassigned, stats } = applyCrossDesaNikFallback(
      [bpjsItem('111', 'D1', 'BUDI')], [dbItem('111', 'D1', 'BUDI'), dbItem('111', 'D2', 'BUDI')], desaByKode);
    expect(reassigned[0].desaKode).toBe('D1');
    expect(reassigned[0].bpjsDesaConfirmedByNik).toBeUndefined();
    expect(stats.confirmed).toBe(0);
  });

  it('NIK Invalid: NIK cocok penuh di >1 desa (banyak_desa)', () => {
    const { reassigned, stats } = applyCrossDesaNikFallback(
      [bpjsItem('111', 'D1', 'BUDI SANTOSO')],
      [dbItem('111', 'D2', 'BUDI SANTOSO'), dbItem('111', 'D3', 'BUDI SANTOSO')], desaByKode);
    expect(reassigned[0].bpjsNikInvalid).toBe(true);
    expect(reassigned[0].bpjsNikInvalidSebab).toBe('banyak_desa');
    expect(reassigned[0].desaKode).toBe('D1'); // tidak dipindah
    expect(stats.nikInvalidBanyakDesa).toBe(1);
  });

  it('NIK Invalid: NIK ada di DB desa lain tapi nama berbeda (nama_berbeda)', () => {
    const { reassigned, stats } = applyCrossDesaNikFallback(
      [bpjsItem('111', 'D1', 'BUDI SANTOSO')], [dbItem('111', 'D2', 'SITI AMINAH')], desaByKode);
    expect(reassigned[0].bpjsNikInvalid).toBe(true);
    expect(reassigned[0].bpjsNikInvalidSebab).toBe('nama_berbeda');
    expect(stats.nikInvalidNama).toBe(1);
  });

  it('NIK Invalid: nama mirip tapi tanggal lahir bentrok (tgl_lahir_beda)', () => {
    const { reassigned, stats } = applyCrossDesaNikFallback(
      [bpjsItem('111', 'D1', 'BUDI SANTOSO', '1980-01-01')],
      [dbItem('111', 'D2', 'BUDI SANTOSO', { tglLahir: '1990-09-09' })], desaByKode);
    expect(reassigned[0].bpjsNikInvalid).toBe(true);
    expect(reassigned[0].bpjsNikInvalidSebab).toBe('tgl_lahir_beda');
    expect(stats.nikInvalidTgl).toBe(1);
  });

  it('tgl lahir cocok mendisambiguasi 2 desa -> reassign ke yang cocok', () => {
    const { reassigned, stats } = applyCrossDesaNikFallback(
      [bpjsItem('111', 'D1', 'BUDI SANTOSO', '1980-01-01')],
      [dbItem('111', 'D2', 'BUDI SANTOSO', { tglLahir: '1980-01-01' }),
        dbItem('111', 'D3', 'BUDI SANTOSO', { tglLahir: '1990-09-09' })], desaByKode);
    expect(reassigned[0].desaKode).toBe('D2');
    expect(stats.confirmed).toBe(1);
  });

  it('lewat apa adanya bila NIK tak ada di DB manapun', () => {
    const { reassigned } = applyCrossDesaNikFallback(
      [bpjsItem('999', 'D1', 'BUDI')], [dbItem('111', 'D2', 'BUDI')], desaByKode);
    expect(reassigned[0].desaKode).toBe('D1');
    expect(reassigned[0].bpjsNikInvalid).toBeUndefined();
  });

  it('item Tangkil-confirmed dilewati (tidak diproses ulang)', () => {
    const t = { ...bpjsItem('111', 'D2', 'BUDI'), bpjsTangkilDbConfirmed: true };
    const { reassigned, stats } = applyCrossDesaNikFallback([t], [dbItem('111', 'D3', 'BUDI')], desaByKode);
    expect(reassigned[0]).toBe(t);
    expect(stats.confirmed).toBe(0);
  });
});

describe('nikErrorSebab', () => {
  it('menerima tanggal lahir berupa Date (Prisma @db.Date) apa adanya', () => {
    const { nikErrorInfo } = require('../../../utils/nikAnomali');
    expect(nikErrorSebab(' 3201031505800001 ', new Date('1980-05-15T00:00:00.000Z'))).toBe('');
    expect(nikErrorSebab('3201031505800001', new Date('1980-05-16T00:00:00.000Z'))).toBe('tgl_lahir');
    expect(nikErrorInfo('3201031505800001', '1980-05-15')).toBeNull();
    expect(nikErrorInfo('', '')).toEqual({ sebab: 'kosong', label: 'NIK Kosong' });
  });

  it('menerima NIK 16 digit yang DDMMYY-nya cocok tanggal lahir', () => {
    expect(nikErrorSebab('3201031505800001', '1980-05-15')).toBe('');
    expect(nikErrorSebab('3201035505800001', '1980-05-15')).toBe(''); // wanita: tanggal + 40
    expect(nikErrorSebab('32.01.03.150580.0001', '1980-05-15')).toBe(''); // pemisah diabaikan
    expect(nikErrorSebab('3201031505800001', '')).toBe(''); // tanpa tgl lahir, cek tanggal dilewati
  });

  it('menandai NIK kosong dan panjang yang salah', () => {
    expect(nikErrorSebab('', '1980-05-15')).toBe('kosong');
    expect(nikErrorSebab('-', '1980-05-15')).toBe('kosong');
    expect(nikErrorSebab('320103150580001', '1980-05-15')).toBe('digit_kurang');
    expect(nikErrorSebab('32010315058000011', '1980-05-15')).toBe('digit_lebih');
  });

  it('menandai enam angka nol di belakang dan tanggal lahir tak sesuai', () => {
    expect(nikErrorSebab('3201031505000000', '1980-05-15')).toBe('nol_belakang');
    expect(nikErrorSebab('3201031605800001', '1980-05-15')).toBe('tgl_lahir'); // tanggal beda
    expect(nikErrorSebab('3201031506800001', '1980-05-15')).toBe('tgl_lahir'); // bulan beda
    expect(nikErrorSebab('3201031505810001', '1980-05-15')).toBe('tgl_lahir'); // tahun beda
  });

  it('membedakan tanggal & bulan yang tertukar dari tanggal lahir yang memang beda', () => {
    // Kasus nyata: NIK 10-09-93, database mencatat 9 Oktober 1993.
    expect(nikErrorSebab('3201011009930001', '1993-10-09')).toBe('tgl_lahir_tertukar');
    expect(nikErrorSebab('3201050305760005', '1976-03-05')).toBe('tgl_lahir_tertukar');
    // Perempuan (tanggal + 40) yang tertukar juga ketahuan.
    expect(nikErrorSebab('3201015009930001', '1993-10-09')).toBe('tgl_lahir_tertukar');
    // Tanggal = bulan -> tidak mungkin tertukar, dan memang cocok.
    expect(nikErrorSebab('3201010909930001', '1993-09-09')).toBe('');
    // Tahun beda tetap 'tgl_lahir' walau tanggal/bulannya bertukar.
    expect(nikErrorSebab('3201011009940001', '1993-10-09')).toBe('tgl_lahir');
    // Bulan mustahil (17) berarti NIK-nya yang salah ketik, bukan tanggal lahir yang terbalik.
    expect(nikErrorSebab('3201060617430001', '1943-06-17')).toBe('tgl_lahir');
  });
});

describe('buildBpjsUnmappableList — saran kodefikasi', () => {
  // Record database minimal: yang dipakai petunjuk() hanya nik, normalized, desa, tgl lahir.
  const rec = (nama, nik, desaKode, desaNama, tglLahir = '') => ({
    nama, normalized: normalizeName(nama), nik, desaKode, desaNama, tglLahir,
  });
  // Peserta BPJS berkode desa yang tidak dikenal database.
  const bpjsKodeAsing = (nama, nik, tglLahir = '') => ({
    desaKode: '32.01.99.9999',
    nama,
    nik,
    details: [{ idPegawai: '32.01.99.9999', nik, namaLengkap: nama, tglLahir, kpj: '', kodeTk: '', upah: 0, blth: '' }],
  });
  const desaByKode = new Map([['32.01.01.2001', { kode: '32.01.01.2001' }]]);
  const saran = (rows) => rows.map((r) => ({ kode: r.petunjukKode, dasar: r.petunjukDasar, label: r.petunjukLabel }));

  it('menyarankan kode desa dari NIK yang ada di database', () => {
    const db = [rec('BUDI', '3201011505800001', '32.01.02.2002', 'Cibadak')];
    const rows = buildBpjsUnmappableList([], [bpjsKodeAsing('BUDI', '3201011505800001')], desaByKode, db);
    expect(saran(rows)).toEqual([{ kode: '32.01.02.2002', dasar: 'nik', label: '32.01.02.2002 Cibadak' }]);
  });

  it('jatuh ke nama bila NIK tidak ada di database', () => {
    const db = [rec('SITI AMINAH', '3201011505800009', '32.01.03.2003', 'Singajaya')];
    const rows = buildBpjsUnmappableList([], [bpjsKodeAsing('SITI AMINAH', '3171041111700003')], desaByKode, db);
    expect(saran(rows)).toEqual([{ kode: '32.01.03.2003', dasar: 'nama', label: '32.01.03.2003 Singajaya' }]);
  });

  it('nama kembar antar desa disempitkan tanggal lahir', () => {
    const db = [
      rec('OMAN SULAEMAN', '3201011505800002', '32.01.04.2004', 'Pasirjaya', '1970-11-11'),
      rec('OMAN SULAEMAN', '3201011505800003', '32.01.05.2005', 'Sukamaju', '1965-01-02'),
    ];
    const rows = buildBpjsUnmappableList([], [bpjsKodeAsing('OMAN SULAEMAN', '', '1970-11-11')], desaByKode, db);
    expect(saran(rows)).toEqual([{ kode: '32.01.04.2004', dasar: 'nama_tgl', label: '32.01.04.2004 Pasirjaya' }]);
  });

  it('nama kembar tanpa pembeda tanggal lahir ditandai perlu verifikasi, tanpa kode', () => {
    const db = [
      rec('OMAN SULAEMAN', '3201011505800002', '32.01.04.2004', 'Pasirjaya'),
      rec('OMAN SULAEMAN', '3201011505800003', '32.01.05.2005', 'Sukamaju'),
    ];
    const rows = buildBpjsUnmappableList([], [bpjsKodeAsing('OMAN SULAEMAN', '')], desaByKode, db);
    expect(rows[0].petunjukKode).toBe('');
    expect(rows[0].petunjukDasar).toBe('ragu');
    expect(rows[0].petunjukLabel).toContain('2 desa');
  });

  it('NIK di lebih dari satu desa tidak disarankan walau namanya tunggal', () => {
    const db = [
      rec('BUDI', '3201011505800001', '32.01.04.2004', 'Pasirjaya'),
      rec('BUDI SANTOSO', '3201011505800001', '32.01.05.2005', 'Sukamaju'),
    ];
    const rows = buildBpjsUnmappableList([], [bpjsKodeAsing('BUDI', '3201011505800001')], desaByKode, db);
    expect(rows[0].petunjukKode).toBe('');
    expect(rows[0].petunjukLabel).toContain('NIK ada di 2 desa');
  });

  it('baris yang dibuang saat parsing (NAMA/ID kosong) tetap dapat saran via NIK', () => {
    const db = [rec('BUDI', '3201011505800001', '32.01.02.2002', 'Cibadak')];
    const raw = [{ sebab: 'id_kosong', barisExcel: 12, idPegawai: '', namaLengkap: 'BUDI', nik: '3201011505800001' }];
    const rows = buildBpjsUnmappableList(raw, [], desaByKode, db);
    expect(rows[0].sebabLabel).toBe('ID_PEGAWAI kosong');
    expect(saran(rows)).toEqual([{ kode: '32.01.02.2002', dasar: 'nik', label: '32.01.02.2002 Cibadak' }]);
  });

  it('peserta yang kodenya dikenal database tidak masuk daftar', () => {
    const terpetakan = { desaKode: '32.01.01.2001', nama: 'BUDI', nik: 'x', details: [{}] };
    expect(buildBpjsUnmappableList([], [terpetakan], desaByKode, [])).toEqual([]);
  });
});
