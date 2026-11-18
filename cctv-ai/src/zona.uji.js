const test = require('node:test');
const assert = require('node:assert');
const { dalamPoligon, dalamJamPantau, zonaOrang } = require('./zona');

const persegi = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];
// Huruf "U" (cekung): lubang tengah atas berada di luar.
const huruf = [[0, 0], [0.3, 0], [0.3, 0.6], [0.7, 0.6], [0.7, 0], [1, 0], [1, 1], [0, 1]];

test('titik dalam/luar persegi', () => {
	assert.strictEqual(dalamPoligon(0.5, 0.5, persegi), true);
	assert.strictEqual(dalamPoligon(0.1, 0.5, persegi), false);
	assert.strictEqual(dalamPoligon(0.5, 0.9, persegi), false);
});

test('poligon cekung', () => {
	assert.strictEqual(dalamPoligon(0.1, 0.3, huruf), true);
	assert.strictEqual(dalamPoligon(0.5, 0.3, huruf), false);
	assert.strictEqual(dalamPoligon(0.5, 0.8, huruf), true);
});

const wib = (jam, mnt = 0) => Date.UTC(2026, 10, 19, jam - 7, mnt);

test('jam pantau', () => {
	const malam = { mulai: '17:00', selesai: '07:00' };
	assert.strictEqual(dalamJamPantau(wib(23), malam), true);
	assert.strictEqual(dalamJamPantau(wib(3), malam), true);
	assert.strictEqual(dalamJamPantau(wib(12), malam), false);
	assert.strictEqual(dalamJamPantau(wib(7), malam), false);
	assert.strictEqual(dalamJamPantau(wib(12), null), true);
	const siang = { mulai: '08:00', selesai: '16:30' };
	assert.strictEqual(dalamJamPantau(wib(16, 29), siang), true);
	assert.strictEqual(dalamJamPantau(wib(16, 30), siang), false);
});

test('zonaOrang memakai titik kaki', () => {
	const zona = [{ nama: 'Gerbang', titik: persegi }];
	// bingkai 1000x500; kaki di (500, 300) -> (0.5, 0.6) di dalam
	assert.strictEqual(zonaOrang([450, 100, 100, 200], 1000, 500, zona), 'Gerbang');
	// kepala di dalam tetapi kaki (0.5, 0.9) di luar
	assert.strictEqual(zonaOrang([450, 200, 100, 250], 1000, 500, zona), null);
	assert.strictEqual(zonaOrang([450, 100, 100, 200], 1000, 500, []), null);
});
