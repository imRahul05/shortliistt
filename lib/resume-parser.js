// Local resume file parsing: PDF (pdf.js), DOCX (native zip + DecompressionStream), TXT/MD.
import { normalizeText, BULLET_RE } from './text.js';

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(chrome.runtime.getURL('lib/pdfjs/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs');
  return pdfjs;
}

export async function extractPdfText(buf) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Group items into visual lines by y coordinate, then sort by x.
    const items = tc.items.filter(i => 'str' in i && i.str !== '').map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 10 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.35));
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    const out = [];
    let prevY = null, prevH = 10;
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      let s = '', endX = null;
      for (const it of l.items) {
        if (endX !== null) {
          const gap = it.x - endX;
          if (gap > it.h * 2.5) s += '   ';
          else if (gap > it.h * 0.15 && !s.endsWith(' ') && !it.s.startsWith(' ')) s += ' ';
        }
        s += it.s; endX = it.x + it.w;
      }
      if (prevY !== null && prevY - l.y > prevH * 2.1) out.push('');
      out.push(s.replace(/\s+$/, ''));
      prevY = l.y; prevH = l.items[0].h || 10;
    }
    pages.push(out.join('\n'));
  }
  return pages.join('\n\n');
}

/* ---------------- DOCX ---------------- */

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzipEntry(buf, wanted) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid DOCX (zip) file');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
    if (name === wanted) {
      const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
      const data = u8.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
      const raw = method === 0 ? data : await inflateRaw(data);
      return new TextDecoder().decode(raw);
    }
    off += 46 + nlen + xlen + clen;
  }
  throw new Error(`${wanted} not found in DOCX`);
}

export async function extractDocxText(buf) {
  const xml = await unzipEntry(buf, 'word/document.xml');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const lines = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let s = '';
    const walk = node => {
      for (const c of node.childNodes) {
        if (c.namespaceURI !== W) { if (c.childNodes?.length) walk(c); continue; }
        if (c.localName === 't') s += c.textContent;
        else if (c.localName === 'tab') s += '   ';
        else if (c.localName === 'br' || c.localName === 'cr') s += '\n';
        else if (c.localName !== 'pPr' && c.localName !== 'rPr') walk(c);
      }
    };
    walk(p);
    const isList = p.getElementsByTagNameNS(W, 'numPr').length > 0;
    lines.push(isList && s.trim() ? '• ' + s.trim() : s);
  }
  return lines.join('\n');
}

/* ---------------- Entry ---------------- */

export async function extractResumeFile(file) {
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  let text;
  if (name.endsWith('.pdf') || file.type === 'application/pdf') text = await extractPdfText(buf);
  else if (name.endsWith('.docx')) text = await extractDocxText(buf);
  else if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save as .docx or PDF.');
  else text = new TextDecoder().decode(buf);
  return cleanResumeText(text);
}

/** Normalise bullets and re-join lines that a PDF wrapped. */
export function cleanResumeText(raw) {
  const lines = normalizeText(raw).split('\n').map(l => l.replace(/\s+$/, ''));
  const out = [];
  for (let line of lines) {
    const t = line.trim();
    if (!t) { out.push(''); continue; }
    if (/^[•●▪◦○■□▸►▶➢➤✓✔✦★·]$/.test(t)) { out.push('- '); continue; } // lone bullet glyph
    if (BULLET_RE.test(line) && !/^-{2,}/.test(t)) line = '- ' + line.replace(BULLET_RE, '');
    else line = t;
    const prev = out[out.length - 1];
    if (prev === '- ') { out[out.length - 1] = '- ' + line.replace(/^- /, ''); continue; }
    const isBullet = line.startsWith('- ');
    const prevIsBullet = prev?.startsWith('- ');
    const looksHeader = /((19|20)\d{2})|\||@|^[A-Z][A-Z &/]{2,}$/.test(line);
    if (prev && prevIsBullet && !isBullet && !looksHeader && (/^[a-z(&,%]/.test(line) || /(,|\b(?:and|or|of|the|to|for|with|in|on|by|a|an)|[&\-–/])$/i.test(prev)) && line.length < 140 && !/:$/.test(line)) {
      out[out.length - 1] = prev + ' ' + line; continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
