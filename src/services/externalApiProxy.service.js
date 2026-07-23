/**
 * External API Proxy Service
 * Handles authentication and data fetching from external DPMD API
 * Using Proxy Pattern - Backend acts as middleware/proxy
 * 
 * Pattern: Backend login ke API external, simpan JWT, lalu forward request
 */

const axios = require('axios');

// JWT Token cache
let apiJWT = null;
let jwtExpiry = null;

// Integrasi Dapur Desa dipensiunkan 23 Juli 2026 bersamaan migrasi domain.
// Host lama sudah mati DAN alamatnya (dpmd.bogorkab.go.id) kini dipakai aplikasi
// ini sendiri — default hardcoded lama membuat backend memanggil dirinya sendiri.
// Karena itu tidak ada fallback URL: integrasi mati selama env belum diisi.
// Menyalakan kembali = set EXTERNAL_DPMD_API_URL + USERNAME + PASSWORD, restart.
const EXTERNAL_API_BASE = process.env.EXTERNAL_DPMD_API_URL || '';
const EXTERNAL_API_USERNAME = process.env.EXTERNAL_DPMD_USERNAME;
const EXTERNAL_API_PASSWORD = process.env.EXTERNAL_DPMD_PASSWORD;

const DISABLED_MESSAGE =
	'Integrasi Dapur Desa dinonaktifkan. Set EXTERNAL_DPMD_API_URL, ' +
	'EXTERNAL_DPMD_USERNAME, dan EXTERNAL_DPMD_PASSWORD di .env untuk mengaktifkan.';

/**
 * Integrasi dianggap aktif hanya bila ketiga konfigurasi terisi.
 */
const isExternalApiEnabled = () =>
	Boolean(EXTERNAL_API_BASE && EXTERNAL_API_USERNAME && EXTERNAL_API_PASSWORD);

// Create axios instance for external API
const externalApi = axios.create({
	baseURL: EXTERNAL_API_BASE,
	timeout: 30000,
	headers: {
		'Content-Type': 'application/json',
		'Accept': 'application/json'
	}
});

/**
 * Login ke API external dan dapatkan JWT token
 * Token di-cache dan digunakan untuk request selanjutnya
 */
const getAPIToken = async () => {
	// Gerbang tunggal: semua fetch* melewati makeExternalRequest → getAPIToken,
	// jadi cukup di sini. Gagal cepat tanpa menyentuh jaringan, supaya pemanggil
	// (mis. core dashboard) tidak menunggu timeout 30 detik untuk host yang mati.
	if (!isExternalApiEnabled()) {
		throw new Error(DISABLED_MESSAGE);
	}

	// Return cached token jika masih valid
	if (apiJWT && jwtExpiry && jwtExpiry > Date.now()) {
		return apiJWT;
	}

	console.log('[ExternalAPI] Authenticating with DPMD API...');
	console.log('[ExternalAPI] Using credentials:', EXTERNAL_API_USERNAME ? 'provided' : 'missing');

	if (!EXTERNAL_API_USERNAME || !EXTERNAL_API_PASSWORD) {
		throw new Error('Parameter tidak lengkap - EXTERNAL_DPMD_USERNAME dan EXTERNAL_DPMD_PASSWORD harus diset di .env');
	}

	try {
		const response = await axios.post(`${EXTERNAL_API_BASE}/auth/login`, {
			email: EXTERNAL_API_USERNAME,
			password: EXTERNAL_API_PASSWORD
		});

		// Handle berbagai format response
		const data = response.data;
		apiJWT = data.access_token || data.token || data.data?.token || data.data?.access_token;
		
		// Set expiry (default 1 jam jika tidak ada)
		const expiresIn = data.expires_in || data.expiresIn || data.data?.expires_in || 3600;
		jwtExpiry = Date.now() + (expiresIn * 1000);

		console.log('[ExternalAPI] Authentication successful, token expires in', expiresIn, 'seconds');
		return apiJWT;
	} catch (error) {
		console.error('[ExternalAPI] Authentication failed:', error.response?.data || error.message);
		throw new Error(`Authentication failed: ${error.response?.data?.message || error.message}`);
	}
};

/**
 * Check if token is valid and not expired
 */
const isTokenValid = () => {
	if (!apiJWT) return false;
	if (!jwtExpiry) return true;
	// Buffer 5 menit sebelum expire
	return Date.now() < (jwtExpiry - 5 * 60 * 1000);
};

/**
 * Helper: Remove dots from district/village code
 * Database: "32.01.01" → API: "320101"
 */
const formatDistrictCode = (code) => {
	if (!code) return '';
	return code.replace(/\./g, '');
};

/**
 * Make authenticated request to external API
 */
const makeExternalRequest = async (endpoint, options = {}) => {
	const token = await getAPIToken();
	
	const config = {
		method: options.method || 'GET',
		url: endpoint,
		headers: {
			'Authorization': `Bearer ${token}`,
			...options.headers
		},
		params: options.params,
		data: options.data
	};

	try {
		const response = await externalApi.request(config);
		return response;
	} catch (error) {
		// Jika 401 (unauthorized), clear token dan coba lagi sekali
		if (error.response?.status === 401) {
			console.log('[ExternalAPI] Token expired, re-authenticating...');
			apiJWT = null;
			jwtExpiry = null;
			
			const newToken = await getAPIToken();
			config.headers['Authorization'] = `Bearer ${newToken}`;
			
			return await externalApi.request(config);
		}
		throw error;
	}
};

/**
 * Fetch Aparatur Desa data from external API
 * Endpoint: GET /apparatus
 * 
 * Parameters:
 * - name: Pencarian nama (Partial Match)
 * - job_type: "BPD" / "Perangkat Desa"
 * - master_district_id: Kode wilayah Kecamatan (e.g. "32.01.01")
 * - master_village_id: Kode wilayah Desa (e.g. "32.01.01.2001")
 * - gender: "L" / "P"
 * - status_pns: "PNS" / "NON PNS"
 * - min_age / max_age: Filter rentang usia
 * - page: Halaman data
 * - limit: Jumlah per halaman
 */
const fetchAparaturDesa = async (params = {}) => {
	try {
		console.log('[ExternalAPI] Fetching apparatus with params:', params);
		
		const response = await makeExternalRequest('/apparatus', {
			method: 'GET',
			params: {
				name: params.name || '',
				job_type: params.job_type || '',
				master_district_id: formatDistrictCode(params.master_district_id),
				master_village_id: formatDistrictCode(params.master_village_id),
				gender: params.gender || '',
				status_pns: params.status_pns || '',
				min_age: params.min_age || '',
				max_age: params.max_age || '',
				page: params.page || 1,
				limit: params.limit || 10
			}
		});

		return response.data;
	} catch (error) {
		console.error('[ExternalAPI] Error fetching apparatus:', error.response?.data || error.message);
		throw error;
	}
};

/**
 * Fetch single Aparatur Desa by ID
 */
const fetchAparaturDesaById = async (id) => {
	try {
		const response = await makeExternalRequest(`/apparatus/${id}`, {
			method: 'GET'
		});

		return response.data;
	} catch (error) {
		console.error('[ExternalAPI] Error fetching apparatus by ID:', error.response?.data || error.message);
		throw error;
	}
};

/**
 * Fetch Aparatur Desa statistics
 */
const fetchAparaturDesaStats = async (params = {}) => {
	try {
		const response = await makeExternalRequest('/apparatus/stats', {
			method: 'GET',
			params: {
				master_district_id: formatDistrictCode(params.master_district_id)
			}
		});

		return response.data;
	} catch (error) {
		console.error('[ExternalAPI] Error fetching stats:', error.response?.data || error.message);
		// Return empty stats if endpoint doesn't exist
		return { success: true, data: {} };
	}
};

/**
 * Fetch list of kecamatan (districts) from external API
 */
const fetchKecamatanList = async () => {
	try {
		const response = await makeExternalRequest('/master-district', {
			method: 'GET'
		});

		return response.data;
	} catch (error) {
		console.error('[ExternalAPI] Error fetching districts:', error.response?.data || error.message);
		throw error;
	}
};

/**
 * Fetch list of desa (villages) by kecamatan from external API
 */
const fetchDesaByKecamatan = async (districtId) => {
	try {
		const response = await makeExternalRequest('/master-village', {
			method: 'GET',
			params: { master_district_id: formatDistrictCode(districtId) }
		});

		return response.data;
	} catch (error) {
		console.error('[ExternalAPI] Error fetching villages:', error.response?.data || error.message);
		throw error;
	}
};

/**
 * Clear token cache (untuk logout atau manual refresh)
 */
const clearTokenCache = () => {
	apiJWT = null;
	jwtExpiry = null;
	console.log('[ExternalAPI] Token cache cleared');
};

/**
 * Get token cache status (for debugging)
 */
const getTokenStatus = () => {
	return {
		enabled: isExternalApiEnabled(),
		hasToken: !!apiJWT,
		expiresAt: jwtExpiry ? new Date(jwtExpiry).toISOString() : null,
		expiresIn: jwtExpiry ? Math.max(0, Math.floor((jwtExpiry - Date.now()) / 1000)) : null,
		isValid: isTokenValid()
	};
};

/**
 * Fetch Dashboard Statistics from external API
 * GET /dashboard
 * Returns statistics for Kepala Desa, Perangkat Desa, and BPD
 */
const fetchDashboardStats = async () => {
	console.log('[ExternalAPI] Fetching dashboard stats...');
	
	try {
		const response = await makeExternalRequest('/dashboard');
		return response.data?.data || response.data;
	} catch (error) {
		console.error('[ExternalAPI] Dashboard stats error:', error.message);
		throw error;
	}
};

module.exports = {
	isExternalApiEnabled,
	getAPIToken,
	makeExternalRequest,
	fetchAparaturDesa,
	fetchAparaturDesaById,
	fetchAparaturDesaStats,
	fetchKecamatanList,
	fetchDesaByKecamatan,
	fetchDashboardStats,
	clearTokenCache,
	getTokenStatus
};
