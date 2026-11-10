const { tahunPenyaluran, namaBerkasPenyaluran } = require('../berkasPenyaluranBankeu');

describe('berkasPenyaluranBankeu', () => {
  test.each([undefined, 'abc', 2024, '2026.5', '../x', 2101])('%p → 2025 & nama lama', (v) => {
    const t = tahunPenyaluran(v);
    expect(t).toBe(2025);
    expect(namaBerkasPenyaluran(1, t)).toBe('bankeu-tahap1.json');
  });

  test.each([2026, '2026'])('%p → berkas 2026', (v) => {
    expect(namaBerkasPenyaluran(1, tahunPenyaluran(v))).toBe('bankeu-tahap1-2026.json');
  });
});
