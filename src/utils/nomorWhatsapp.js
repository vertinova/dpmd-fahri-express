/** Nomor HP/WA → 62xxxxxxxxxx (format wa.me); null bila tidak masuk akal. */
const nomorWhatsapp = (v) => {
	let d = String(v || '').replace(/[^\d]/g, '');
	if (!d) return null;
	if (d.startsWith('0')) d = `62${d.slice(1)}`;
	else if (d.startsWith('8')) d = `62${d}`;
	return /^62\d{8,13}$/.test(d) ? d : null;
};

module.exports = { nomorWhatsapp };
