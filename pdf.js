'use strict';
/* ===========================================================================
   pdf.js — a tiny PDF writer.

   Only what we need: one image per page, JPEG passed straight through as a
   DCTDecode XObject (no re-encoding, no dependency). Page size is given in
   points so a drawing exports at a predictable physical size.
   =========================================================================== */

function esc(s) { return String(s).replace(/([\\()])/g, '\\$1'); }

/**
 * @param {Array<{jpeg: Buffer, pxW: number, pxH: number, ptW: number, ptH: number, title?: string}>} pages
 * @returns {Buffer}
 */
function build(pages) {
  const chunks = [];
  const offsets = [0];          // object 0 is the free-list head
  let length = 0;

  const push = (buf) => {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'binary');
    chunks.push(b);
    length += b.length;
  };
  const obj = (num, body) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
    push(body);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // Object numbering: 1 catalog, 2 pages tree, then 3 objects per page.
  const pageIds = pages.map((_, i) => 3 + i * 3);      // page dict
  const contentIds = pages.map((_, i) => 4 + i * 3);   // content stream
  const imageIds = pages.map((_, i) => 5 + i * 3);     // image xobject

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map(n => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pages.forEach((p, i) => {
    const W = Math.max(1, Math.round(p.ptW));
    const H = Math.max(1, Math.round(p.ptH));

    obj(pageIds[i],
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /XObject << /Im0 ${imageIds[i]} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
      `/Contents ${contentIds[i]} 0 R >>`);

    // draw the image to fill the whole page
    const stream = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
    obj(contentIds[i], `<< /Length ${stream.length} >>\nstream\n${stream}endstream`);

    offsets[imageIds[i]] = length;
    push(`${imageIds[i]} 0 obj\n`);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} ` +
         `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
         `/Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push('\nendstream\nendobj\n');
  });

  const maxObj = 2 + pages.length * 3;
  const xrefAt = length;
  push(`xref\n0 ${maxObj + 1}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i <= maxObj; i++) {
    push(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

module.exports = { build, esc };
