// Local resume file parsing: PDF (pdf.js), DOCX (native zip + DecompressionStream), TXT/MD.
// Output is "rich text": plain lines with light markdown — **bold**, *italic*, [label](url) — so the
// Studio can reproduce the original formatting and hyperlinks. `stripRich()` gives plain text for matching.
import { normalizeText, BULLET_RE } from './text.js';

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  const base = globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL('lib/pdfjs/') : new URL('./pdfjs/', import.meta.url).href;
  pdfjs = await import(base + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  return pdfjs;
}

/* ------------------------------------------------------------------ */
/* Rich-text helpers                                                    */
/* ------------------------------------------------------------------ */

export function stripRich(s = '') {
  return s
    .replace(/\[([^\]\n]+)\]\(((?:https?:|mailto:|tel:)[^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+?)\*(?![\w*])/g, '$1$2');
}

/** Wrap a run of text in markdown for its style, keeping surrounding spaces outside the markers. */
function styleRun(t, { bold, italic, link }) {
  const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
  let core = m[2];
  if (!core) return t;
  if (link) {
    const lp = core.match(/^[(\["'“]*/)[0], rp = core.match(/[)\]"'”.,;:]*$/)[0];
    const label = core.slice(lp.length, core.length - rp.length).replace(/[[\]]/g, '');
    core = label ? `${lp}[${label}](${link})${rp}` : core;
  }
  if (bold && italic) core = `***${core}***`;
  else if (bold) core = `**${core}**`;
  else if (italic) core = `*${core}*`;
  return m[1] + core + m[3];
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

const BULLET_GLYPH = /^[•●▪◦○■□▸►▶➢➤✓✔✦★·\-–*]$/;

function fontStyle(page, id, cache) {
  if (cache.has(id)) return cache.get(id);
  let name = '', bold = false, italic = false;
  try {
    const f = page.commonObjs.get(id);
    name = f?.name || f?.loadedName || '';
    bold = !!(f?.bold || f?.black);
    italic = !!f?.italic;
  } catch { /* font not resolved */ }
  const n = name.replace(/^[A-Z]{6}\+/, '');
  bold ||= /bold|black|heavy|semibold|demi|\bcmbx|cmb\d|-bd|_bd|bx\d/i.test(n);
  italic ||= /italic|oblique|cmti|cmsl|slant|-it\b|_it\b|-ita/i.test(n);
  const serif = /^cm|lmroman|times|garamond|georgia|serif|charter|palatino|book|minion|cambria/i.test(n) && !/sans|helvet|arial/i.test(n);
  const s = { bold, italic, serif, name: n };
  cache.set(id, s);
  return s;
}

export async function extractPdfRich(buf) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
  const out = [];
  const fontNames = new Set();
  let serifHits = 0, fontHits = 0, pageSize = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    if (!pageSize) { const [, , w, h] = page.view; pageSize = { w, h, name: Math.abs(w - 595) < 8 ? 'A4' : 'Letter' }; }
    try { await page.getOperatorList(); } catch { /* fonts unresolved: fall back to name heuristics */ }
    const tc = await page.getTextContent();
    const links = (await page.getAnnotations().catch(() => [])).filter(a => a.subtype === 'Link' && (a.url || a.unsafeUrl)).map(a => ({ url: a.url || a.unsafeUrl, r: a.rect }));
    const cache = new Map();
    const items = [];
    for (const i of tc.items) {
      if (!('str' in i) || i.str === '') continue;
      const st = fontStyle(page, i.fontName, cache);
      fontNames.add(st.name); fontHits++; if (st.serif) serifHits++;
      const x = i.transform[4], y = i.transform[5], w = i.width, h = Math.abs(i.transform[3]) || i.height || 10;
      const cy = y + h * 0.35;
      const base = { y, h, bold: st.bold, italic: st.italic };
      // A link may cover only part of a text item (e.g. "– AICTE (View Certificate)"): split by estimated char positions.
      const hit = links.find(l => cy >= l.r[1] - 2 && cy <= l.r[3] + 2 && l.r[2] > x + 0.5 && l.r[0] < x + w - 0.5);
      if (!hit || !i.str.trim()) { items.push({ ...base, s: i.str, x, w, link: null }); continue; }
      const n = i.str.length, cw = w / Math.max(1, n);
      let a = Math.max(0, Math.round((hit.r[0] - x) / cw)), b = Math.min(n, Math.round((hit.r[2] - x) / cw));
      while (a > 0 && /\S/.test(i.str[a - 1]) && /\S/.test(i.str[a])) a--;
      while (b < n && /\S/.test(i.str[b]) && /\S/.test(i.str[b - 1])) b++;
      if (a <= 1 && b >= n - 1) { items.push({ ...base, s: i.str, x, w, link: hit.url }); continue; }
      const part = (s0, s1, link) => { if (s1 > s0) items.push({ ...base, s: i.str.slice(s0, s1), x: x + s0 * cw, w: (s1 - s0) * cw, link }); };
      part(0, a, null); part(a, b, hit.url); part(b, n, null);
    }

    // Group into visual lines.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.4));
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);

    // Build each line's rich text and geometry.
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      const vis = l.items.filter(i => i.s.trim());
      if (!vis.length) { l.skip = true; continue; }
      l.h = Math.max(...vis.map(i => i.h));
      l.x = vis[0].x;
      l.isBullet = BULLET_GLYPH.test(vis[0].s.trim()) && vis.length > 1;
      const body = l.isBullet ? l.items.slice(l.items.indexOf(vis[0]) + 1) : l.items;
      const bodyVis = body.filter(i => i.s.trim());
      l.textX = bodyVis[0]?.x ?? l.x;
      l.right = Math.max(...vis.map(i => i.x + i.w));
      l.first = bodyVis[0]; l.last = bodyVis[bodyVis.length - 1];
      // runs
      let rich = '', endX = null, run = null, bigGap = false;
      const flush = () => { if (run) { rich += styleRun(run.t, run); run = null; } };
      for (const it of body) {
        let sep = '';
        if (!it.s.trim() && it.w > it.h * 1.3) { flush(); rich = rich.replace(/\s+$/, '') + '\t'; bigGap = true; endX = it.x + it.w; continue; } // wide space = column gap
        if (endX !== null) {
          const gap = it.x - endX;
          if (gap > it.h * 1.5) { sep = '\t'; bigGap = true; }
          else if (gap > it.h * 0.12 && !/\s$/.test(run?.t ?? rich) && !/^\s/.test(it.s)) sep = ' ';
        }
        const blank = !it.s.trim();
        const same = run && (blank || (run.bold === it.bold && run.italic === it.italic && run.link === it.link));
        if (sep === '\t') { flush(); rich = rich.replace(/\s+$/, '') + sep; }
        else if (sep) { if (run) run.t += sep; else rich += sep; }
        if (same) run.t += it.s;
        else if (blank && !run) rich += it.s;
        else { flush(); run = { t: it.s, bold: it.bold, italic: it.italic, link: it.link }; }
        if (!blank || endX === null) endX = it.x + it.w;
      }
      flush();
      l.rich = rich.replace(/\s+$/, '').replace(/^\s+/, '').replace(/ *\t */g, '\t');
      l.bigGap = bigGap;
    }
    const real = lines.filter(l => !l.skip);
    const minX = Math.min(...real.map(l => l.x)), maxRight = Math.max(...real.map(l => l.right));
    const wrapEdge = maxRight - (maxRight - minX) * 0.16;

    // Join wrapped lines back together using geometry: a continuation starts at the previous
    // line's text indent, the previous line ran to (nearly) the right edge, and fonts match.
    const joined = [];
    let prev = null;
    for (const l of real) {
      const gap = prev ? prev.y - l.y : 0;
      const contX = prev ? (prev.isBullet || prev.cont ? prev.textX : prev.x) : 0;
      const isCont = prev && !l.isBullet && !prev.bigGap && !l.bigGap
        && gap < Math.max(prev.h, l.h) * 1.75
        && Math.abs(l.x - contX) <= 2.5
        && prev.right >= wrapEdge
        && (prev.last?.bold === l.first?.bold && prev.last?.italic === l.first?.italic);
      if (isCont) {
        const last = joined[joined.length - 1];
        last.text = mergeRich(last.text, l.rich);
        l.cont = true; l.textX = contX; l.isBullet = prev.isBullet;
      } else {
        if (prev && gap > Math.max(prev.h, l.h) * 2.1) joined.push({ text: '' });
        joined.push({ text: (l.isBullet ? '• ' : '') + l.rich });
      }
      prev = l;
    }
    out.push(joined.map(j => j.text).join('\n'));
  }
  const rich = out.join('\n\n');
  return { rich, pages: doc.numPages, pageSize, serif: fontHits ? serifHits / fontHits > 0.5 : false, fonts: [...fontNames] };
}

/** Join two rich lines; fuse adjacent identical style markers ("**a**" + "**b**" -> "**a b**"). */
function mergeRich(a, b) {
  const s = a.replace(/-$/, '\u0000') + ' ' + b;
  return s.replace(/\u0000 /, '-').replace(/(\*\*\*|\*\*|\*) \1(?=\S)/g, ' ');
}

export async function extractPdfText(buf) { return stripRich((await extractPdfRich(buf)).rich); }

/* ------------------------------------------------------------------ */
/* DOCX                                                                 */
/* ------------------------------------------------------------------ */

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

export async function extractDocxRich(buf) {
  const xml = await unzipEntry(buf, 'word/document.xml');
  const rels = new Map();
  try {
    const r = new DOMParser().parseFromString(await unzipEntry(buf, 'word/_rels/document.xml.rels'), 'application/xml');
    for (const el of r.getElementsByTagName('Relationship')) if (/hyperlink/.test(el.getAttribute('Type'))) rels.set(el.getAttribute('Id'), el.getAttribute('Target'));
  } catch { /* no rels */ }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const on = el => el && el.getAttributeNS(W, 'val') !== '0' && el.getAttributeNS(W, 'val') !== 'false';
  const lines = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let s = '';
    const runOf = (r, link) => {
      const rPr = r.getElementsByTagNameNS(W, 'rPr')[0];
      const bold = on(rPr?.getElementsByTagNameNS(W, 'b')[0]), italic = on(rPr?.getElementsByTagNameNS(W, 'i')[0]);
      let t = '';
      for (const c of r.childNodes) {
        if (c.localName === 't') t += c.textContent;
        else if (c.localName === 'tab') t += '\t';
        else if (c.localName === 'br' || c.localName === 'cr') t += '\n';
      }
      return { t, bold, italic, link };
    };
    const runs = [];
    for (const c of p.childNodes) {
      if (c.localName === 'r') runs.push(runOf(c, null));
      else if (c.localName === 'hyperlink') {
        const url = rels.get(c.getAttributeNS(R, 'id')) || null;
        for (const r of c.getElementsByTagNameNS(W, 'r')) runs.push(runOf(r, url));
      }
    }
    // merge consecutive same-style runs, then style them
    const merged = [];
    for (const r of runs) { const l = merged[merged.length - 1]; if (l && l.bold === r.bold && l.italic === r.italic && l.link === r.link) l.t += r.t; else merged.push({ ...r }); }
    s = merged.map(r => styleRun(r.t, r)).join('');
    const isList = p.getElementsByTagNameNS(W, 'numPr').length > 0;
    lines.push(isList && s.trim() ? '• ' + s.trim() : s);
  }
  return { rich: lines.join('\n'), pages: null, pageSize: null, serif: false };
}

export async function extractDocxText(buf) { return stripRich((await extractDocxRich(buf)).rich); }

/* ------------------------------------------------------------------ */
/* Entry                                                                */
/* ------------------------------------------------------------------ */

/** Returns { text (plain, for matching), rich (formatted, for the Studio), pages, pageSize, serif }. */
export async function extractResumeFile(file) {
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  let r;
  if (name.endsWith('.pdf') || file.type === 'application/pdf') r = await extractPdfRich(buf);
  else if (name.endsWith('.docx')) r = await extractDocxRich(buf);
  else if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save as .docx or PDF.');
  else r = { rich: new TextDecoder().decode(buf), pages: null, pageSize: null, serif: false };
  const rich = normalizeRich(r.rich, { join: !name.endsWith('.pdf') });
  return { ...r, rich, text: stripRich(rich) };
}

/** Normalise bullets to "- ". For non-PDF sources also re-join lines that look wrapped. */
export function normalizeRich(raw, { join = true } = {}) {
  const lines = normalizeText(raw, { keepDashes: true }).split('\n').map(l => l.replace(/\s+$/, ''));
  const out = [];
  for (let line of lines) {
    const t = line.trim();
    if (!t) { out.push(''); continue; }
    if (/^[•●▪◦○■□▸►▶➢➤✓✔✦★·]$/.test(t)) { out.push('- '); continue; }
    const isB = BULLET_RE.test(line) && !/^-{2,}/.test(t) && !/^\*\*|^\*[^*\s]/.test(t);
    line = isB ? '- ' + line.replace(BULLET_RE, '') : t;
    const prev = out[out.length - 1];
    if (prev === '- ') { out[out.length - 1] = '- ' + line.replace(/^- /, ''); continue; }
    if (join) {
      const prevIsBullet = prev?.startsWith('- ');
      const plain = stripRich(line);
      const looksHeader = /((19|20)\d{2})|\||@|^[A-Z][A-Z &/]{2,}$/.test(plain);
      if (prev && prevIsBullet && !line.startsWith('- ') && !looksHeader && (/^[a-z(&,%]/.test(plain) || /(,|\b(?:and|or|of|the|to|for|with|in|on|by|a|an)|[&\-–/])$/i.test(stripRich(prev))) && plain.length < 140 && !/:$/.test(plain)) {
        out[out.length - 1] = prev + ' ' + line; continue;
      }
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Backwards-compatible: plain text cleanup used for pasted/edited resume text. */
export function cleanResumeText(raw) { return normalizeRich(raw, { join: true }); }
