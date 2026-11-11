const { EVENT_TYPES } = require('../serverManagement');

describe('EVENT_TYPES penjelasan', () => {
  test.each(Object.entries(EVENT_TYPES))('%s punya apa/tujuan/dampak/mitigasi', (_k, e) => {
    for (const f of ['apa', 'tujuan', 'dampak', 'mitigasi']) {
      expect(typeof e[f]).toBe('string');
      expect(e[f].trim()).not.toBe('');
    }
  });

  test('label honeypot', () => {
    expect(EVENT_TYPES.honeypot.label).toBe('Terjebak Honeypot');
  });
});
