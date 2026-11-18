/**
 * Geometri zona pantau: poligon per kamera (koordinat relatif 0..1) dan jam pantau (WIB).
 */

/** Ray casting: apakah titik (x, y) berada di dalam poligon `titik` ([[x, y], ...])? */
const dalamPoligon = (x, y, titik) => {
	let dalam = false;
	for (let i = 0, j = titik.length - 1; i < titik.length; j = i++) {
		const [xi, yi] = titik[i];
		const [xj, yj] = titik[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dalam = !dalam;
	}
	return dalam;
};

const menit = (hhmm) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
};

/** jamPantau null = 24 jam; mulai > selesai berarti melewati tengah malam. */
const dalamJamPantau = (kiniMs, jamPantau) => {
	if (!jamPantau) return true;
	const d = new Date(kiniMs + 7 * 3600e3);
	const m = d.getUTCHours() * 60 + d.getUTCMinutes();
	const mulai = menit(jamPantau.mulai);
	const selesai = menit(jamPantau.selesai);
	return mulai <= selesai ? m >= mulai && m < selesai : m >= mulai || m < selesai;
};

/** Nama zona pertama yang memuat titik kaki kotak [x, y, w, h] (piksel), atau null. */
const zonaOrang = (kotak, lebar, tinggi, zona) => {
	const [x, y, w, h] = kotak;
	const kx = (x + w / 2) / lebar;
	const ky = (y + h) / tinggi;
	const ada = (zona || []).find((z) => dalamPoligon(kx, ky, z.titik));
	return ada ? ada.nama : null;
};

module.exports = { dalamPoligon, dalamJamPantau, zonaOrang };
