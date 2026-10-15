/**
 * Pagar akses Asta Desa untuk akun dinas.
 *
 * Asta Desa memuat NIK dan nomor KK. Selain pegawai internal DPMD, hanya akun
 * `dinas_terkait` BAPPERIDA yang boleh membacanya — bukan verifikatornya, dan
 * bukan dinas lain.
 */

jest.mock('../../config/prisma', () => ({
	users: { findUnique: jest.fn(), update: jest.fn() },
	bidangs: { findUnique: jest.fn() },
	master_dinas: {
		findUnique: jest.fn(async ({ where }) => {
			const kode = { 6: 'BAPPERIDA', 4: 'DLH', 40: 'BPKAD' }[where.id];
			return kode ? { kode_dinas: kode } : null;
		}),
	},
}));

const { isDinasLihatAstaDesa } = require('../auth');

describe('isDinasLihatAstaDesa', () => {
	it('meloloskan dinas_terkait BAPPERIDA', async () => {
		await expect(isDinasLihatAstaDesa({ role: 'dinas_terkait', dinas_id: 6 })).resolves.toBe(true);
	});

	it('menolak verifikator_dinas BAPPERIDA', async () => {
		await expect(isDinasLihatAstaDesa({ role: 'verifikator_dinas', dinas_id: 6 })).resolves.toBe(false);
	});

	it('menolak dinas_terkait dinas lain', async () => {
		await expect(isDinasLihatAstaDesa({ role: 'dinas_terkait', dinas_id: 4 })).resolves.toBe(false);
		await expect(isDinasLihatAstaDesa({ role: 'dinas_terkait', dinas_id: 40 })).resolves.toBe(false);
	});

	it('menolak akun tanpa dinas', async () => {
		await expect(isDinasLihatAstaDesa({ role: 'dinas_terkait', dinas_id: null })).resolves.toBe(false);
		await expect(isDinasLihatAstaDesa(null)).resolves.toBe(false);
	});
});
