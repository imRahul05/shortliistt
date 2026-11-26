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

const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
import { splitEntry, SKILL_LINE } from './resume-model.js';
import { stripRich } from './resume-parser.js';

/** Rich text -> [{t, b, i, link}] segments. */
export function richSegments(text, base = {}) {
  const out = [];
  const LINK = /\[([^\]\n]+)\]\(((?:https?:|mailto:|tel:)[^)\s]+)\)/g;
  let last = 0, m;
  const styled = (t, link) => {
    // ***bi***, **b**, *i*
    const re = /\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|(^|[^\w*])\*([^*\n]+?)\*(?![\w*])/g;
    let p = 0, r;
    while ((r = re.exec(t))) {
      const pre = r[3] !== undefined ? r[3] : '';
      const start = r.index + pre.length;
      if (r.index + pre.length > p) out.push({ ...base, t: t.slice(p, start), link });
      if (r[1] !== undefined) out.push({ ...base, t: r[1], b: true, i: true, link });
      else if (r[2] !== undefined) out.push({ ...base, t: r[2], b: true, link });
      else out.push({ ...base, t: r[4], i: true, link });
      p = r.index + r[0].length;
    }
    if (p < t.length) out.push({ ...base, t: t.slice(p), link });
  };
  while ((m = LINK.exec(text))) { if (m.index > last) styled(text.slice(last, m.index), null); styled(m[1], m[2]); last = m.index + m[0].length; }
  if (last < text.length) styled(text.slice(last), null);
  return out.filter(s => s.t);
}

function makeWriter(font) {
  const rels = [];
  const rel = url => { let i = rels.indexOf(url); if (i < 0) { rels.push(url); i = rels.length - 1; } return `rIdL${i + 1}`; };
  const run = (t, { size = 21, b = false, i = false, caps = false, color = null, u = false } = {}) =>
    `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}${caps ? '<w:smallCaps/>' : ''}${u ? '<w:u w:val="single"/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/></w:rPr>` +
    t.split('\t').map((p, k) => (k ? '<w:tab/>' : '') + (p ? `<w:t xml:space="preserve">${x(p)}</w:t>` : '')).join('') + '</w:r>';
  const runs = (text, opt = {}) => richSegments(text).map(sg => {
    const r = run(sg.t, { ...opt, b: opt.b || sg.b, i: opt.i || sg.i, u: !!sg.link || opt.u, color: sg.link ? '1F3A8A' : opt.color });
    return sg.link ? `<w:hyperlink r:id="${rel(sg.link)}" w:history="1">${r}</w:hyperlink>` : r;
  }).join('');
  return { rels, run, runs };
}
const para = (inner, ppr = '') => `<w:p><w:pPr><w:spacing w:before="0" w:after="30"/>${ppr}</w:pPr>${inner}</w:p>`;

function pack(bodyXml, rels, pageSize) {
  const [w, h] = pageSize === 'A4' ? [11906, 16838] : [12240, 15840];
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"/><w:pgMar w:top="648" w:right="720" w:bottom="648" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((u, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${x(u)}" TargetMode="External"/>`).join('')}</Relationships>`;
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', docRels],
    ['word/document.xml', doc],
  ]);
}

const fontFor = tpl => (tpl === 'latex' || tpl === 'serif' ? 'Cambria' : 'Calibri');

function headerXml(m, W, center = true) {
  const jc = center ? '<w:jc w:val="center"/>' : '';
  const out = [];
  if (m.name) out.push(para(W.run(stripRich(m.name), { size: m.template === 'latex' ? 44 : 36, b: m.template !== 'latex', caps: m.template === 'latex' }), jc));
  if (m.headline) out.push(para(W.runs(m.headline, { size: 22 }), jc));
  if (m.contact) {
    const parts = m.contact.split(/\s*\|\s*/).filter(Boolean);
    out.push(para(parts.map((c, k) => (k ? W.run(m.template === 'latex' ? '  |  ' : '  •  ', { size: 19 }) : '') + W.runs(c, { size: 19 })).join(''), jc + '<w:spacing w:after="100"/>'));
  }
  return out;
}

export function modelToDocx(m) {
  const W = makeWriter(fontFor(m.template));
  const right = m.pageSize === 'A4' ? 10466 : 10800;
  const body = headerXml(m, W);
  for (const s of m.sections) {
    if (!s.body.trim()) continue;
    body.push(para(W.run(m.template === 'latex' ? s.title : s.title.toUpperCase(), { size: 23, b: true }), '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="160" w:after="60"/>'));
    let afterBreak = true;
    for (const raw of s.body.split('\n')) {
      const line = raw.trim();
      if (!line) { afterBreak = true; continue; }
      if (/^[-•]\s+/.test(line) || /^\*\s+/.test(line)) {
        body.push(para(W.run('•\t', { size: 21 }) + W.runs(line.replace(/^[-•*]\s+/, '')), '<w:tabs><w:tab w:val="left" w:pos="450"/></w:tabs><w:ind w:left="450" w:hanging="230"/>'));
        afterBreak = true; continue;
      }
      if (s.kind === 'skills') {
        const mm = line.match(SKILL_LINE);
        body.push(para(mm ? W.run(stripRich(mm[1]).trim().replace(/:$/, '') + ': ', { b: true }) + W.runs(mm[2]) : W.runs(line), '<w:ind w:left="180"/>'));
      } else if (s.kind === 'summary') {
        body.push(para(W.runs(line)));
      } else {
        const [left, rt] = splitEntry(line);
        const styled = /\*/.test(left);
        const st = styled ? {} : afterBreak ? { b: true } : { i: true };
        body.push(para(W.runs(left, st) + (rt ? '<w:r><w:tab/></w:r>' + W.runs(rt) : ''), `<w:tabs><w:tab w:val="right" w:pos="${right}"/></w:tabs><w:ind w:left="180"/>${afterBreak ? '<w:spacing w:before="70" w:after="10"/>' : ''}`));
        afterBreak = false;
      }
    }
  }
  return pack(body.join(''), W.rels, m.pageSize);
}

/** Cover letter DOCX: same header as the resume, then date, recipient and body paragraphs. */
export function letterToDocx(m, letter) {
  const W = makeWriter(fontFor(m.template));
  const body = headerXml(m, W);
  body.push(para('', '<w:spacing w:after="120"/>'));
  for (const block of [letter.date, letter.recipient].filter(Boolean)) {
    for (const l of block.split('\n')) body.push(para(W.runs(l)));
    body.push(para(''));
  }
  for (const p of (letter.body || '').split(/\n{2,}/)) body.push(para(p.split('\n').map(l => W.runs(l)).join('<w:r><w:br/></w:r>'), '<w:spacing w:after="160"/>'));
  return pack(body.join(''), W.rels, m.pageSize);
}
