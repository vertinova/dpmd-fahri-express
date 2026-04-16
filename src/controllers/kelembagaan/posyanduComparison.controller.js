/**
 * Posyandu Comparison Controller
 * Compares posyandu data from database, posyandugema.xlsx, and posyanduadd.xlsx
 */

const path = require('path');
const XLSX = require('xlsx');
const { prisma } = require('./base.controller');

class PosyanduComparisonController {
  /**
   * GET /api/kelembagaan/posyandu-comparison
   * Returns comparison data between database, gema, and add excel files
   */
  async getComparison(req, res) {
    try {
      // 1. Get all desa with kecamatan from database
      const allDesa = await prisma.desas.findMany({
        select: {
          id: true,
          kode: true,
          nama: true,
          kecamatans: {
            select: {
              id: true,
              kode: true,
              nama: true,
            },
          },
        },
        orderBy: [
          { kecamatans: { nama: 'asc' } },
          { nama: 'asc' },
        ],
      });

      // 2. Get all posyandu from database
      const allPosyandu = await prisma.posyandus.findMany({
        select: {
          id: true,
          nama: true,
          desa_id: true,
          status_kelembagaan: true,
        },
        orderBy: { nama: 'asc' },
      });

      // 3. Parse posyandugema.xlsx
      const gemaPath = path.join(__dirname, '..', '..', '..', 'data', 'posyandugema.xlsx');
      const gemaWorkbook = XLSX.readFile(gemaPath);
      const gemaRaw = XLSX.utils.sheet_to_json(gemaWorkbook.Sheets['Sheet1'], { header: 1 });

      // Data starts from row index 4 (NO, KECAMATAN, DESA, POSYADU)
      const gemaData = [];
      for (let i = 4; i < gemaRaw.length; i++) {
        const row = gemaRaw[i];
        if (row && row[1] && row[2] && row[3]) {
          gemaData.push({
            kecamatan: String(row[1]).trim().toUpperCase(),
            desa: String(row[2]).trim().toUpperCase(),
            posyandu: String(row[3]).trim().toUpperCase(),
          });
        }
      }

      // 4. Parse posyanduadd.xlsx
      const addPath = path.join(__dirname, '..', '..', '..', 'data', 'posyanduadd.xlsx');
      const addWorkbook = XLSX.readFile(addPath);
      const addRaw = XLSX.utils.sheet_to_json(addWorkbook.Sheets['Sheet1']);

      // Helper to convert Excel serial date to YYYY-MM-DD string
      const excelDateToStr = (serial) => {
        if (!serial || typeof serial !== 'number') return String(serial || '');
        const utcDays = Math.floor(serial - 25569);
        const d = new Date(utcDays * 86400000);
        return d.toISOString().slice(0, 10);
      };

      // Get unique desa-posyandu pairs, keep detail records per posyandu
      const addDataMap = new Map();
      addRaw.forEach((row) => {
        if (row.Nm_Desa && row.Nm_Penerima) {
          const desa = String(row.Nm_Desa).trim().toUpperCase();
          let posyandu = String(row.Nm_Penerima).trim().toUpperCase();
          // Remove "POSYANDU " prefix if present
          posyandu = posyandu.replace(/^POSYANDU\s+/, '');
          const detail = {
            noSpp: row.No_SPP || '',
            tglBukti: excelDateToStr(row.Tgl_Bukti),
            keterangan: row.Keterangan || '',
            nilai: row[' Nilai'] || 0,
          };
          const key = `${desa}|${posyandu}`;
          if (!addDataMap.has(key)) {
            addDataMap.set(key, {
              desa,
              posyandu,
              kodeDesa: row.Kd_Desa || '',
              nilai: detail.nilai,
              details: [detail],
            });
          } else {
            const existing = addDataMap.get(key);
            existing.nilai += detail.nilai;
            existing.details.push(detail);
          }
        }
      });
      const addData = Array.from(addDataMap.values());

      // 5. Build comparison per desa
      // Normalize name for matching: remove spaces, "KELURAHAN " prefix
      const normalizeDesa = (name) => {
        let n = name.toUpperCase().trim();
        n = n.replace(/^KELURAHAN\s+/, '');
        n = n.replace(/\s+/g, '');
        return n;
      };

      // Known desa name aliases (normalized Gema name -> normalized DB name)
      const desaAliases = {
        'CADASGAMPAR': 'CADASNGAMPAR',
        'CIARUTENUDIK': 'CIARUTEUNUDIK',
        'CIARUTENILIR': 'CIARUTEUNILIR',
        'CIHIDEUNGILIR': 'CIHIDEUNGHILIR',
        'KLAPANUNGGL': 'KLAPANUNGGAL',
        'TEGALEGA': 'TEGALLEGA',
        'KALONG1': 'KALONGI',
        'KALONG2': 'KALONGII',
        'PANGKALANJAYA': 'PANGKALJAYA',
        'CIBENTENG': 'CIBANTENG',       // Ciampea
        'CIMULUNG': 'CIMULANG',         // Ranca Bungur
        'KARANGASAMBARAT': 'KARANGASEMBARAT',
        'WARAGAJAYA': 'WARGAJAYA',      // Sukamakmur
        'PEMAGARSARI': 'PAMEGARSARI',   // Parung
        'PANGASINAN': 'PENGASINAN',     // Gunung Sindur
        'RANGASJAJAR': 'RENGASJAJAR',   // Cigudeg
        'CIPAYUNGDATAR': 'CIPAYUNG',    // Megamendung
        'PUTUTNUTUG': 'PUTATNUTUG',     // Ciseeng
        'SUKAMAJAYA': 'SUKMAJAYA',      // Tajurhalang
      };

      // Index database posyandu by desa_id
      const dbPosyanduByDesa = {};
      allPosyandu.forEach((p) => {
        if (!dbPosyanduByDesa[p.desa_id]) dbPosyanduByDesa[p.desa_id] = [];
        dbPosyanduByDesa[p.desa_id].push(p);
      });

      // Build composite key (kecamatan+desa normalized) -> DB desa mapping
      // This handles duplicate desa names across different kecamatan (e.g. NAGRAK in Gunung Putri & Sukaraja)
      const dbDesaByComposite = {};  // "KECNORM|DESANORM" -> desa
      const dbDesaByDesa = {};       // "DESANORM" -> [desa, ...] (fallback for non-ambiguous)
      allDesa.forEach((d) => {
        const desaNorm = normalizeDesa(d.nama);
        const kecNorm = normalizeDesa(d.kecamatans.nama);
        dbDesaByComposite[`${kecNorm}|${desaNorm}`] = d;
        if (!dbDesaByDesa[desaNorm]) dbDesaByDesa[desaNorm] = [];
        dbDesaByDesa[desaNorm].push(d);
      });

      // Resolve a desa from Gema/ADD name (+optional kecamatan) to a DB desa
      const resolveDbDesa = (desaName, kecName) => {
        let desaNorm = normalizeDesa(desaName);
        if (desaAliases[desaNorm]) desaNorm = desaAliases[desaNorm];

        // Try composite key first (kecamatan + desa)
        if (kecName) {
          const kecNorm = normalizeDesa(kecName);
          const composite = `${kecNorm}|${desaNorm}`;
          if (dbDesaByComposite[composite]) return dbDesaByComposite[composite];
        }

        // Fallback: match by desa name only (works if name is unique)
        const candidates = dbDesaByDesa[desaNorm];
        if (candidates && candidates.length === 1) return candidates[0];

        return null;
      };

      // Index gema by DB desa id (using kecamatan+desa composite match)
      const gemaByDesaId = {};
      gemaData.forEach((g) => {
        const dbDesa = resolveDbDesa(g.desa, g.kecamatan);
        if (dbDesa) {
          const id = dbDesa.id.toString();
          if (!gemaByDesaId[id]) gemaByDesaId[id] = [];
          gemaByDesaId[id].push(g);
        }
      });

      // For ADD, extract kecamatan code from Kd_Desa (e.g. "04.2005." -> kec code "04")
      // Build kecamatan code -> kecamatan name mapping from DB
      const kecByCode = {};
      allDesa.forEach((d) => {
        // DB kode format: "32.01.XX.YYYY" where XX is kecamatan code
        const parts = d.kecamatans.kode ? d.kecamatans.kode.split('.') : [];
        if (parts.length >= 3) {
          kecByCode[parts[2]] = d.kecamatans.nama;
        }
      });

      // Index add by DB desa id
      const addByDesaId = {};
      addData.forEach((a) => {
        // Try to extract kecamatan from Kd_Desa (format: "XX.YYYY.")
        let kecName = null;
        if (a.kodeDesa) {
          const kecCode = String(a.kodeDesa).split('.')[0];
          if (kecCode && kecByCode[kecCode]) kecName = kecByCode[kecCode];
        }
        const dbDesa = resolveDbDesa(a.desa, kecName);
        if (dbDesa) {
          const id = dbDesa.id.toString();
          if (!addByDesaId[id]) addByDesaId[id] = [];
          addByDesaId[id].push(a);
        }
      });

      // Roman numeral to arabic number mapping
      const romanToArabic = (str) => {
        const romanMap = {
          'XVIII': '18', 'XVII': '17', 'XVI': '16', 'XV': '15', 'XIV': '14',
          'XIII': '13', 'XII': '12', 'XI': '11', 'X': '10',
          'IX': '9', 'VIII': '8', 'VII': '7', 'VI': '6', 'V': '5',
          'IV': '4', 'III': '3', 'II': '2', 'I': '1',
        };
        // Replace roman numerals at word boundaries (match longest first)
        return str.replace(/\b(XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, (match) => {
          return romanMap[match] || match;
        });
      };

      // Helper to normalize posyandu name for matching
      const normalize = (name) => {
        let n = name.toUpperCase();
        // Remove "POSYANDU " prefix
        n = n.replace(/^POSYANDU\s+/, '');
        // Remove "DESA <NAMA>" suffix (e.g., "MELATI I DESA CIJAYANTI" -> "MELATI I")
        n = n.replace(/\s+DESA\s+[A-Z\s]+$/, '');
        // Convert roman numerals to arabic numbers
        n = romanToArabic(n);
        // Normalize whitespace
        n = n.replace(/\s+/g, ' ').trim();
        return n;
      };

      // Levenshtein distance for fuzzy matching
      const levenshtein = (a, b) => {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
              ? dp[i - 1][j - 1]
              : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
          }
        }
        return dp[m][n];
      };

      // Check if two normalized names are fuzzy-similar
      // Numbers/suffixes must match exactly, only the base name is fuzzy compared
      const isFuzzyMatch = (a, b) => {
        if (a === b) return true;
        // Split into base name and trailing number/letter suffix
        // Handles: "MELATI 1", "MELATI 1A", "AGUNG A", "AGUNG B"
        const splitNameNum = (s) => {
          const match = s.match(/^(.+?)\s+(\d+\s*[A-Z]?|[A-Z])$/);
          if (match) return { base: match[1].trim(), suffix: match[2].trim() };
          return { base: s, suffix: '' };
        };
        const pa = splitNameNum(a);
        const pb = splitNameNum(b);
        // If both have numeric suffixes, they must be the same
        if (pa.suffix && pb.suffix && pa.suffix !== pb.suffix) return false;
        // If one has a suffix and the other doesn't, don't fuzzy match
        if ((pa.suffix && !pb.suffix) || (!pa.suffix && pb.suffix)) return false;
        // Fuzzy compare the base names
        const base1 = pa.suffix ? pa.base : a;
        const base2 = pb.suffix ? pb.base : b;
        const maxLen = Math.max(base1.length, base2.length);
        if (maxLen === 0) return true;
        const dist = levenshtein(base1, base2);
        const threshold = maxLen >= 4 ? 2 : 1;
        return dist <= threshold;
      };

      // Find fuzzy match from a set of normalized names
      const findFuzzyMatch = (name, candidates) => {
        for (const c of candidates) {
          if (isFuzzyMatch(name, c)) return c;
        }
        return null;
      };

      const comparison = allDesa.map((desa) => {
        const desaIdStr = desa.id.toString();
        const dbList = (dbPosyanduByDesa[desa.id] || []).map((p) => ({
          id: p.id,
          nama: p.nama,
          normalized: normalize(p.nama),
          status: p.status_kelembagaan,
        }));
        const gemaList = (gemaByDesaId[desaIdStr] || []).map((g) => ({
          nama: g.posyandu,
          normalized: normalize(g.posyandu),
          kecamatan: g.kecamatan,
        }));
        const addList = (addByDesaId[desaIdStr] || []).map((a) => ({
          nama: a.posyandu,
          normalized: normalize(a.posyandu),
          nilai: a.nilai,
          details: a.details || [],
        }));

        // --- Fuzzy matching: merge across different sources only ---
        // Build a unified name map: canonical normalized name -> { gema, add, db items }
        const canonMap = new Map(); // canonical -> { gemaItems, addItems, dbItems }

        const getOrCreate = (key) => {
          if (!canonMap.has(key)) {
            canonMap.set(key, { gemaItems: [], addItems: [], dbItems: [] });
          }
          return canonMap.get(key);
        };

        // Find fuzzy match only against keys that have items from a different source
        const findFuzzyFromOtherSource = (name, source) => {
          for (const [key, entry] of canonMap.entries()) {
            if (!isFuzzyMatch(name, key)) continue;
            // Only match if the existing key has data from a DIFFERENT source
            if (source === 'gema' && (entry.addItems.length > 0 || entry.dbItems.length > 0)) return key;
            if (source === 'add' && (entry.gemaItems.length > 0 || entry.dbItems.length > 0)) return key;
            if (source === 'db' && (entry.gemaItems.length > 0 || entry.addItems.length > 0)) return key;
          }
          return null;
        };

        // Add gema items (exact normalized)
        gemaList.forEach((g) => {
          getOrCreate(g.normalized).gemaItems.push(g);
        });

        // Add add items: try exact match first, then fuzzy match to keys from other sources
        // Only fuzzy-merge if the target key doesn't already have items from the same source
        addList.forEach((a) => {
          if (canonMap.has(a.normalized)) {
            canonMap.get(a.normalized).addItems.push(a);
          } else {
            const fuzzyKey = findFuzzyFromOtherSource(a.normalized, 'add');
            if (fuzzyKey && canonMap.get(fuzzyKey).addItems.length === 0) {
              canonMap.get(fuzzyKey).addItems.push(a);
            } else {
              getOrCreate(a.normalized).addItems.push(a);
            }
          }
        });

        // Add db items: try exact match first, then fuzzy match to keys from other sources
        // Only fuzzy-merge if the target key doesn't already have items from the same source
        dbList.forEach((d) => {
          if (canonMap.has(d.normalized)) {
            canonMap.get(d.normalized).dbItems.push(d);
          } else {
            const fuzzyKey = findFuzzyFromOtherSource(d.normalized, 'db');
            if (fuzzyKey && canonMap.get(fuzzyKey).dbItems.length === 0) {
              canonMap.get(fuzzyKey).dbItems.push(d);
            } else {
              getOrCreate(d.normalized).dbItems.push(d);
            }
          }
        });

        // Build items from canonMap
        const items = [];
        canonMap.forEach((entry, key) => {
          const hasGema = entry.gemaItems.length > 0;
          const hasAdd = entry.addItems.length > 0;
          const hasDb = entry.dbItems.length > 0;

          // Collect all distinct original names for display
          const allOrigNames = new Set();
          entry.gemaItems.forEach((g) => allOrigNames.add(g.nama));
          entry.addItems.forEach((a) => allOrigNames.add(a.nama));
          entry.dbItems.forEach((d) => allOrigNames.add(d.nama));
          const displayName = Array.from(allOrigNames).join(' / ');
          const isFuzzy = allOrigNames.size > 1;

          let status;
          if (hasGema && hasAdd) {
            status = 'matched';
          } else if (hasGema && !hasAdd) {
            status = 'only_gema';
          } else if (!hasGema && hasAdd) {
            status = 'only_add';
          } else {
            status = 'only_db';
          }

          const dbItem = entry.dbItems[0] || null;
          const addItem = entry.addItems[0] || null;
          const totalNilai = entry.addItems.reduce((sum, a) => sum + (a.nilai || 0), 0);

          // Collect all ADD detail records (termin) for this posyandu
          const addDetails = entry.addItems.flatMap((a) => a.details || []);

          // Collect per-source original names
          const dbNames = [...new Set(entry.dbItems.map((d) => d.nama))];
          const gemaNames = [...new Set(entry.gemaItems.map((g) => g.nama))];
          const addNames = [...new Set(entry.addItems.map((a) => a.nama))];

          items.push({
            nama: displayName,
            normalized: key,
            dbNama: dbNames,
            gemaNama: gemaNames,
            addNama: addNames,
            inGema: hasGema,
            inAdd: hasAdd,
            inDb: hasDb,
            status,
            isFuzzy,
            dbId: dbItem?.id || null,
            dbStatus: dbItem?.status || null,
            addNilai: totalNilai,
            addDetails: addDetails.length > 0 ? addDetails : [],
          });
        });

        // Sort: matched first, then only_gema, then only_add, then only_db
        const statusOrder = { matched: 0, only_gema: 1, only_add: 2, only_db: 3 };
        items.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.nama.localeCompare(b.nama));

        return {
          desaId: desa.id.toString(),
          desaNama: desa.nama,
          desaKode: desa.kode,
          kecamatanNama: desa.kecamatans.nama,
          kecamatanId: desa.kecamatans.id.toString(),
          totalDb: dbList.length,
          totalGema: gemaList.length,
          totalAdd: addList.length,
          matched: items.filter((i) => i.status === 'matched').length,
          fuzzyMatched: items.filter((i) => i.status === 'matched' && i.isFuzzy).length,
          onlyGema: items.filter((i) => i.status === 'only_gema').length,
          onlyAdd: items.filter((i) => i.status === 'only_add').length,
          onlyDb: items.filter((i) => i.status === 'only_db').length,
          items,
        };
      });

      // Collect Gema desa names that didn't match any DB desa
      const unmatchedGemaDesa = [];
      const gemaDesaSet = new Set();
      gemaData.forEach(g => gemaDesaSet.add(`${g.kecamatan}|${g.desa}`));
      gemaDesaSet.forEach((key) => {
        const [kec, desa] = key.split('|');
        if (!resolveDbDesa(desa, kec)) unmatchedGemaDesa.push(`${desa} (${kec})`);
      });

      // Collect ADD desa names that didn't match any DB desa
      const unmatchedAddDesa = [];
      const addDesaSet = new Set();
      addData.forEach(a => {
        let kecName = null;
        if (a.kodeDesa) {
          const kecCode = String(a.kodeDesa).split('.')[0];
          if (kecCode && kecByCode[kecCode]) kecName = kecByCode[kecCode];
        }
        addDesaSet.add(`${kecName || ''}|${a.desa}`);
      });
      addDesaSet.forEach((key) => {
        const [kec, desa] = key.split('|');
        if (!resolveDbDesa(desa, kec || null)) unmatchedAddDesa.push(kec ? `${desa} (${kec})` : desa);
      });

      // Count unique desa in Gema and ADD data
      const totalGemaDesaRaw = gemaDesaSet.size;
      const totalAddDesaRaw = addDesaSet.size;

      // Desa in DB that have NO Gema data
      const desaWithoutGema = comparison
        .filter(d => d.totalGema === 0)
        .map(d => `${d.desaNama} (${d.kecamatanNama})`);

      // Desa in DB that have NO ADD data
      const desaWithoutAdd = comparison
        .filter(d => d.totalAdd === 0)
        .map(d => `${d.desaNama} (${d.kecamatanNama})`);

      // Summary stats
      const summary = {
        totalDesa: allDesa.length,
        totalDbPosyandu: allPosyandu.length,
        totalGemaPosyandu: gemaData.length,
        totalAddPosyandu: addData.length,
        totalGemaDesa: totalGemaDesaRaw,
        totalAddDesa: totalAddDesaRaw,
        totalGemaDesaMatched: totalGemaDesaRaw - unmatchedGemaDesa.length,
        totalAddDesaMatched: totalAddDesaRaw - unmatchedAddDesa.length,
        totalMatched: comparison.reduce((acc, d) => acc + d.matched, 0),
        totalFuzzyMatched: comparison.reduce((acc, d) => acc + d.fuzzyMatched, 0),
        totalOnlyGema: comparison.reduce((acc, d) => acc + d.onlyGema, 0),
        totalOnlyAdd: comparison.reduce((acc, d) => acc + d.onlyAdd, 0),
        totalOnlyDb: comparison.reduce((acc, d) => acc + d.onlyDb, 0),
        unmatchedGemaDesa,
        unmatchedAddDesa,
        desaWithoutGema,
        desaWithoutAdd,
      };

      res.json({
        success: true,
        data: {
          summary,
          comparison,
        },
      });
    } catch (error) {
      console.error('Error in posyandu comparison:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memproses perbandingan data posyandu',
        error: error.message,
      });
    }
  }
}

module.exports = new PosyanduComparisonController();
