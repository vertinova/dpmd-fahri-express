// Penyaring teks tamu Jelajah (nama & chat) dan pembaca IP klien. Fungsi murni supaya
// mudah diuji; dipakai jelajah.socket.js.

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

// Samakan ejaan akal-akalan: "4NJ1IING" → "anjing", "k.o.n.t.o.l" → "kontol".
function normalKata(kata) {
  return String(kata)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// Cocok di bagian mana pun dari kata. Hanya kata yang tidak terkandung di kata wajar.
const KATA_KERAS = [
  'anjing', 'bangsat', 'bajingan', 'kontol', 'ngentot', 'ngentod', 'jancok', 'jancuk', 'goblok', 'goblog',
  'pukimak', 'cukimai', 'brengsek', 'keparat', 'bedebah', 'kampret', 'lonte', 'memek', 'jembut', 'fuck',
].map(normalKata);

// Harus cocok seluruh kata (boleh berakhiran). "babi" ada di "babinsa", "perek" di "perekam".
const KATA_TEPAT = new Set([
  'babi', 'asu', 'tolol', 'anjir', 'bego', 'idiot', 'dongo', 'kehed', 'belegug', 'borokokok', 'sundal', 'pelacur',
  'perek', 'peler', 'titit', 'tempik', 'pepek', 'ngewe', 'coli', 'bangke', 'pantek', 'anjg', 'ajg', 'asw', 'bgst',
  'bngst', 'kntl', 'gblk', 'gblg', 'shit', 'bitch', 'pussy', 'asshole', 'bastard',
].map(normalKata));
const AKHIRAN = /(nya|lah|lu|loh|kau|mu|in|an|kan|deh|sih)$/;

function kasar(kata) {
  const n = normalKata(kata);
  if (!n) return false;
  return KATA_KERAS.some((k) => n.includes(k)) || KATA_TEPAT.has(n) || KATA_TEPAT.has(n.replace(AKHIRAN, ''));
}

// `teks` sudah dirapikan spasinya. Huruf yang dieja terpisah ("k o n t o l") dicek sebagai satu kata.
function sensor(teks) {
  const kata = teks.split(' ');
  for (let i = 0; i < kata.length; ) {
    if ([...kata[i]].length === 1) {
      let j = i;
      while (j < kata.length && [...kata[j]].length === 1) j++;
      if (j - i >= 3 && kasar(kata.slice(i, j).join(''))) kata.fill('*', i, j);
      i = j;
    } else {
      if (kasar(kata[i])) kata[i] = '*'.repeat(kata[i].length);
      i++;
    }
  }
  return kata.join(' ');
}

const JABATAN = new Set([
  'bupati', 'wabup', 'gubernur', 'wagub', 'presiden', 'wapres', 'menteri', 'walikota', 'camat', 'sekcam', 'lurah',
  'kades', 'kadis', 'sekdis', 'sekda', 'sekdes', 'kepaladesa', 'kepaladinas', 'admin', 'administrator', 'moderator',
  'dpmd', 'pemda', 'pemkab', 'sistem', 'system',
].map(normalKata));

// Bentuk baku nama orang untuk dibandingkan: tanpa gelar di depan maupun di belakang koma.
function kunciNama(nama) {
  return String(nama)
    .split(',')[0]
    .toLowerCase()
    .replace(/\b(prof|drs|dra|dr|ir|hj|kh|h)\b\.?/g, ' ')
    .replace(/[^\p{L} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Nama tamu tidak terverifikasi, jadi jabatan dan nama pegawai tidak boleh dipakai:
// di situs pemerintah ucapan tamu bisa terbaca sebagai ucapan pejabatnya.
function namaTerlarang(nama, pegawai = new Set()) {
  const kata = String(nama).split(/\s+/).filter(Boolean);
  const normal = kata.map(normalKata);
  if (kata.some(kasar) || kasar(kata.join(''))) return true;
  if (normal.some((k) => JABATAN.has(k)) || JABATAN.has(normal.join(''))) return true;
  return pegawai.has(kunciNama(nama));
}

// Cermin `app.set('trust proxy', 2)` di server.js (NPM → Nginx → Express): nilai paling kiri
// bisa dikarang klien, yang bisa dipercaya adalah yang ditambahkan proxy pertama.
function ipKlien(xff, alamat) {
  const bagian = typeof xff === 'string' ? xff.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return bagian.at(-2) ?? bagian[0] ?? alamat ?? 'tak-dikenal';
}

module.exports = { sensor, kasar, namaTerlarang, kunciNama, ipKlien };
