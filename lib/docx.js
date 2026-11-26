// Minimal DOCX writer (no dependencies): builds an ATS-friendly Word file from the resume model.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameB = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nameB.length, true);
    chunks.push(new Uint8Array(lh.buffer), nameB, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nameB.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function runs(text, { size = 21, bold = false, italic = false, color = null } = {}) {
  return text.split(/(\*\*.+?\*\*)/).filter(Boolean).map(part => {
    const b = bold || /^\*\*.+\*\*$/.test(part);
    const t = part.replace(/^\*\*|\*\*$/g, '');
    return `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${b ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  }).join('');
}
const para = (inner, ppr = '') => `<w:p><w:pPr><w:spacing w:before="0" w:after="40"/>${ppr}</w:pPr>${inner}</w:p>`;

const DATE_TAIL = /^(.*?)[\s,|·•–—-]*((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?(?:\d{1,2}[\/.-])?(?:19|20)\d{2}(?:\s*(?:-|–|—|to)\s*(?:present|current|now|ongoing|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?(?:\d{1,2}[\/.-])?(?:19|20)\d{2}))?)\s*$/i;

export function modelToDocx(m) {
  const body = [];
  if (m.name) body.push(para(runs(m.name, { size: 36, bold: true }), '<w:jc w:val="center"/>'));
  if (m.headline) body.push(para(runs(m.headline, { size: 22 }), '<w:jc w:val="center"/>'));
  if (m.contact) body.push(para(runs(m.contact.split(/\s*\|\s*/).join('  •  '), { size: 19 }), '<w:jc w:val="center"/><w:spacing w:after="120"/>'));
  for (const s of m.sections) {
    if (!s.body.trim()) continue;
    body.push(para(runs(s.title.toUpperCase(), { size: 22, bold: true }), '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="222222"/></w:pBdr><w:spacing w:before="200" w:after="80"/>'));
    let afterBreak = true;
    for (const raw of s.body.split('\n')) {
      const line = raw.trim();
      if (!line) { afterBreak = true; continue; }
      if (/^[-•*]\s+/.test(line)) {
        body.push(para(runs('•\t' + line.replace(/^[-•*]\s+/, '')), '<w:tabs><w:tab w:val="left" w:pos="270"/></w:tabs><w:ind w:left="270" w:hanging="270"/>'));
        afterBreak = true; continue;
      }
      if (s.kind === 'skills') {
        const mm = line.match(/^([^:]{2,40}):\s*(.+)$/);
        body.push(para(mm ? runs(mm[1] + ': ', { bold: true }) + runs(mm[2]) : runs(line)));
      } else if (s.kind === 'summary') {
        body.push(para(runs(line)));
      } else {
        const sp = line.match(/^(.*?)\s{3,}(.+)$/) || line.match(DATE_TAIL);
        const left = sp && sp[1].trim() ? sp[1].trim() : line, right = sp && sp[1].trim() ? sp[2].trim() : '';
        const st = afterBreak ? { bold: true } : { italic: true };
        body.push(para(runs(left, st) + (right ? `<w:r><w:tab/></w:r>${runs(right)}` : ''), `<w:tabs><w:tab w:val="right" w:pos="10460"/></w:tabs>${afterBreak ? '<w:spacing w:before="80" w:after="20"/>' : ''}`));
        afterBreak = false;
      }
    }
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', doc],
  ]);
}
