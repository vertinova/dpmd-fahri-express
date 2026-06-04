/**
 * Flatten anotasi Kecamatan ke atas PDF proposal asli (pdf-lib).
 *
 * annotation_data (koordinat RELATIF 0..1, origin kiri-ATAS — konvensi web/canvas):
 * {
 *   pages: [
 *     {
 *       page: 1,
 *       items: [
 *         { type: 'highlight', rect: [x, y, w, h], color: '#ffeb3b' },
 *         { type: 'strike',    rect: [x, y, w, h], color: '#e53935' },
 *         { type: 'rect',      rect: [x, y, w, h], color: '#e53935' },
 *         { type: 'text',      pos: [x, y], value: 'catatan', color: '#1565c0', size: 12 },
 *         { type: 'ink',       path: [[x,y],[x,y],...], color: '#e53935', width: 2 }
 *       ],
 *       note: 'catatan untuk halaman ini'
 *     }
 *   ]
 * }
 *
 * Catatan: pdf-lib memakai origin kiri-BAWAH, jadi y dikonversi: pdfY = H - (yRel * H).
 */

const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function hexToRgb(hex, fallback = [0.9, 0.1, 0.1]) {
  if (!hex || typeof hex !== 'string') return rgb(...fallback);
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return rgb(...fallback);
  const int = parseInt(m[1], 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

/**
 * @param {string} originalPath  path absolut PDF asli proposal
 * @param {object} annotationData  struktur anotasi (lihat atas)
 * @param {string} outputPath  path absolut output PDF beranotasi
 * @returns {Promise<{pages:number}>}
 */
async function flattenAnnotations(originalPath, annotationData, outputPath) {
  const bytes = fs.readFileSync(originalPath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  const byPage = new Map();
  for (const p of (annotationData?.pages || [])) {
    byPage.set(Number(p.page), p);
  }

  for (let i = 0; i < pages.length; i++) {
    const pageData = byPage.get(i + 1);
    if (!pageData) continue;
    const page = pages[i];
    const { width: W, height: H } = page.getSize();

    for (const item of (pageData.items || [])) {
      try {
        if (item.type === 'highlight' && Array.isArray(item.rect)) {
          const [x, y, w, h] = item.rect;
          page.drawRectangle({
            x: x * W,
            y: H - (y + h) * H,
            width: w * W,
            height: h * H,
            color: hexToRgb(item.color, [1, 0.92, 0.23]),
            opacity: 0.35,
          });
        } else if (item.type === 'rect' && Array.isArray(item.rect)) {
          const [x, y, w, h] = item.rect;
          page.drawRectangle({
            x: x * W,
            y: H - (y + h) * H,
            width: w * W,
            height: h * H,
            borderColor: hexToRgb(item.color),
            borderWidth: item.width || 1.5,
            opacity: 0,
            borderOpacity: 1,
          });
        } else if (item.type === 'strike' && Array.isArray(item.rect)) {
          const [x, y, w, h] = item.rect;
          const yMid = H - (y + h / 2) * H;
          page.drawLine({
            start: { x: x * W, y: yMid },
            end: { x: (x + w) * W, y: yMid },
            thickness: item.width || 1.5,
            color: hexToRgb(item.color),
          });
        } else if (item.type === 'text' && Array.isArray(item.pos)) {
          const [x, y] = item.pos;
          const size = item.size || 11;
          page.drawText(String(item.value || ''), {
            x: x * W,
            y: H - y * H - size,
            size,
            font,
            color: hexToRgb(item.color, [0.08, 0.4, 0.75]),
            maxWidth: W - x * W - 10,
            lineHeight: size * 1.2,
          });
        } else if (item.type === 'ink' && Array.isArray(item.path) && item.path.length > 1) {
          const color = hexToRgb(item.color);
          const thickness = item.width || 2;
          for (let k = 0; k < item.path.length - 1; k++) {
            const [x1, y1] = item.path[k];
            const [x2, y2] = item.path[k + 1];
            page.drawLine({
              start: { x: x1 * W, y: H - y1 * H },
              end: { x: x2 * W, y: H - y2 * H },
              thickness,
              color,
            });
          }
        }
      } catch (e) {
        // lewati item yang rusak, jangan gagalkan seluruh dokumen
      }
    }

    // Catatan per halaman: kotak kecil di pojok kanan atas
    if (pageData.note) {
      const note = `Catatan: ${pageData.note}`;
      page.drawText(note, {
        x: 36,
        y: 24,
        size: 9,
        font: fontBold,
        color: rgb(0.85, 0.1, 0.1),
        maxWidth: W - 72,
        lineHeight: 11,
      });
    }
  }

  const out = await pdfDoc.save();
  fs.writeFileSync(outputPath, out);
  return { pages: pages.length };
}

module.exports = { flattenAnnotations };
