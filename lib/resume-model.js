// Editable resume model: parse rich text -> {name, headline, contact, sections[]}, render HTML/TXT, tailoring helpers.
// Rich text = plain lines + **bold**, *italic*, [label](url). A tab separates left/right columns ("Title<TAB>Aug 2025 – Present").
import { escapeHtml, BULLET_RE, tokenize, stem } from './text.js';
import { findSkillOccurrences, findSkills } from './matcher.js';
import { SKILL_BY_NAME } from './skills.js';
import { stripRich } from './resume-parser.js';

/* ---------------- Section headings ---------------- */

const KIND_WORDS = [
  ['summary', ['summary', 'profile', 'objective', 'overview', 'about']],
  ['experience', ['experience', 'employment', 'internship', 'internships', 'history']],
  ['skills', ['skills', 'competencies', 'technologies', 'stack', 'expertise', 'toolkit', 'tools']],
  ['education', ['education', 'academic', 'academics', 'qualifications']],
  ['projects', ['projects', 'project', 'portfolio', 'open source']],
  ['certifications', ['certifications', 'certification', 'certificates', 'licenses', 'courses', 'training']],
  ['awards', ['awards', 'achievements', 'honors', 'honours', 'accomplishments']],
  ['other', ['publications', 'languages', 'interests', 'hobbies', 'volunteer', 'volunteering', 'leadership', 'activities', 'extracurricular', 'references', 'information', 'responsibility', 'research']],
];
const VOCAB = new Set([...KIND_WORDS.flatMap(([, w]) => w.flatMap(x => x.split(' '))), 'professional', 'work', 'technical', 'key', 'relevant', 'personal', 'selected', 'other', 'additional', 'core', 'career',
  'and', '&', 'of', 'positions', 'side', 'notable', 'featured', 'me', 'my', 'tech', 'open', 'source', 'skill', 'executive', 'areas', 'soft', 'hard', 'summary', 'certified', 'extra', 'curricular', 'co-curricular']);

export function headingKind(line) {
  const t = stripRich(line).trim().replace(/[:\s]+$/, '');
  if (!t || t.length > 45 || BULLET_RE.test(line.replace(/^\*\*|^\*/, '')) && /^\s*[-•]/.test(line) || /[@\d,|.]/.test(t)) return null;
  const words = t.toLowerCase().split(/\s+/);
  if (words.length > 5 || !words.every(w => VOCAB.has(w))) return null;
  let best = null, at = Infinity;
  const lower = ` ${words.join(' ')} `;
  for (const [kind, kws] of KIND_WORDS) for (const k of kws) { const i = lower.indexOf(` ${k} `); if (i >= 0 && i < at) { at = i; best = kind; } }
  return best;
}

let uid = 0;
const newId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

export function parseResumeModel(text = '', meta = {}) {
  const lines = text.split('\n');
  const first = lines.findIndex(l => headingKind(l));
  const headerLines = (first < 0 ? lines.slice(0, 4) : lines.slice(0, first)).map(l => l.trim()).filter(Boolean);
  const isContact = l => /@|https?:|www\.|linkedin|github|\+?\d[\d\s().-]{7,}|\]\(/.test(l);
  const plain0 = headerLines.length ? stripRich(headerLines[0]) : '';
  const name = headerLines.length && !isContact(headerLines[0]) && plain0.length <= 60 ? (headerLines.shift(), plain0) : '';
  let headline = '';
  if (headerLines.length && !isContact(headerLines[0]) && stripRich(headerLines[0]).length <= 120) headline = headerLines.shift();
  const contact = headerLines.join(' | ').split(/\s*(?:\||•|·|◆|⋄|\t)\s*/).filter(Boolean).join(' | ');
  const sections = [];
  if (first >= 0) {
    let cur = null;
    for (const l of lines.slice(first)) {
      const k = headingKind(l);
      if (k) { cur = { id: newId(), title: titleCase(stripRich(l).trim().replace(/[:\s]+$/, '')), kind: k, body: '' }; sections.push(cur); continue; }
      cur.body += (cur.body ? '\n' : '') + l;
    }
    sections.forEach(s => (s.body = s.body.replace(/^\n+|\n+$/g, '')));
  } else {
    sections.push({ id: newId(), title: 'Experience', kind: 'experience', body: lines.slice(headerLines.length + (name ? 1 : 0) + (headline ? 1 : 0)).join('\n').trim() });
  }
  return { name, headline, contact, sections, template: meta.serif ? 'latex' : 'classic', pages: meta.pages === 2 ? 2 : 1, pageSize: meta.pageSize || 'Letter' };
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/\b(And|Of)\b/g, w => w.toLowerCase());
}

export function modelToText(m) {
  const parts = [m.name, m.headline, m.contact].filter(Boolean).map(stripRich);
  for (const s of m.sections) parts.push('', s.title.toUpperCase(), stripRich(s.body));
  return parts.join('\n').trim();
}

export function modelSections(m) {
  return m.sections.map(s => ({ kind: s.kind, title: s.title, body: stripRich(s.body) }));
}

/* ---------------- Rendering ---------------- */

const DATE_TAIL = /^(.*?)[\s,|·•–—-]*((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*['’]?)?(?:\d{1,2}[\/.-])?(?:19|20)?\d{2}(?:[\/.-]\d{1,2})?(?:\s*(?:-|–|—|to)\s*(?:present|current|now|ongoing|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*['’]?)?(?:\d{1,2}[\/.-])?(?:19|20)?\d{2}))?)\s*$/i;
const LINK_TAIL = /^(.*?)\s*((?:\[[^\]\n]+\]\([^)\s]+\)\s*(?:[|·•,]\s*)?)+)$/;
export const SKILL_LINE = /^(\s*(?:\*\*)?[^:*\n]{2,40}:(?:\*\*)?\s*)(.+)$/;
const LINK_RE = /\[([^\]\n]+)\]\(((?:https?:|mailto:|tel:)[^)\s]+)\)/g;

const safeUrl = u => (/^(https?:|mailto:|tel:)/i.test(u) ? u : 'https://' + u);

function emph(h) {
  return h.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<b><i>$1</i></b>').replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/(^|[^\w*])\*([^*\n]+?)\*(?![\w*])/g, '$1<i>$2</i>');
}

/** Rich line -> HTML (links, bold, italic, bare URLs/emails). `hl` = optional highlighter regex. */
export function inline(s, hl) {
  const links = [];
  let t = String(s).replace(LINK_RE, (m, label, url) => { links.push([label, url]); return `\u0000${links.length - 1}\u0000`; });
  let h = emph(escapeHtml(t));
  h = h.replace(/(?<![\w/@])((?:https?:\/\/|www\.)[^\s<]+|(?:github|linkedin|gitlab)\.com\/[\w\-./%]+|[\w.+-]+@[\w-]+\.[\w.]+)/g, u => `<a href="${escapeHtml(u.includes('@') && !u.includes('/') ? 'mailto:' + u : safeUrl(u))}">${u}</a>`);
  h = h.replace(/\u0000(\d+)\u0000/g, (m, i) => { const [label, url] = links[+i]; return `<a href="${escapeHtml(url)}">${emph(escapeHtml(label))}</a>`; });
  if (hl) h = h.replace(/(^|>)([^<]+)/g, (m, a, txt) => a + txt.replace(hl, '<mark>$&</mark>'));
  return h;
}

export function buildHighlighter(terms) {
  const uniq = [...new Set(terms.filter(t => t && t.length > 1))].sort((a, b) => b.length - a.length);
  if (!uniq.length) return null;
  const esc = s => escapeHtml(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])(?:${uniq.map(esc).join('|')})(?![A-Za-z0-9])`, 'gi');
}

/** Split an entry line into [left, right] (right = dates or links). */
export function splitEntry(line) {
  const tab = line.match(/^(.*?)(?:\t+|\s{3,})(.+)$/);
  if (tab && tab[1].trim()) return [tab[1].trim(), tab[2].trim()];
  const lt = line.match(LINK_TAIL);
  if (lt && lt[1].trim() && stripRich(lt[1]).length > 3) return [lt[1].replace(/[\s|·•,–—-]+$/, ''), lt[2].trim()];
  const dt = line.match(DATE_TAIL);
  if (dt && dt[1].trim() && /\d{2}/.test(dt[2])) return [dt[1].trim(), dt[2].trim()];
  return [line, ''];
}

export function renderBody(sec, hl) {
  const lines = sec.body.split('\n');
  let html = '', inList = false, afterBreak = true;
  const close = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { close(); afterBreak = true; continue; }
    if (/^[-•]\s+/.test(line) || /^\*\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^[-•*]\s+/, ''), hl)}</li>`; afterBreak = true; continue;
    }
    close();
    if (sec.kind === 'skills') {
      const m = line.match(SKILL_LINE);
      html += m ? `<p class="skill-line"><b>${inline(stripRich(m[1]).trim().replace(/:$/, ''), null)}:</b> ${inline(m[2], hl)}</p>` : `<p class="skill-line">${inline(line, hl)}</p>`;
    } else if (sec.kind === 'summary') {
      html += `<p>${inline(line, hl)}</p>`;
    } else {
      const [left, right] = splitEntry(line);
      const styled = /\*/.test(left); // source already says what is bold/italic
      const cls = afterBreak ? (styled ? 'entry entry-head rich' : 'entry entry-head') : (styled ? 'entry entry-sub rich' : 'entry entry-sub');
      html += `<div class="${cls}"><span class="l">${inline(left, hl)}</span>${right ? `<span class="r">${inline(right, null)}</span>` : ''}</div>`;
      afterBreak = false;
    }
  }
  close();
  return html;
}

export function renderResumeHTML(m, { highlight = null, scale = 1 } = {}) {
  const sep = m.template === 'latex' ? '<span class="sep">|</span>' : '<span class="sep">•</span>';
  const contact = (m.contact || '').split(/\s*\|\s*/).filter(Boolean).map(c => `<span>${inline(c, null)}</span>`).join(sep);
  let html = `<div class="resume tpl-${m.template || 'classic'}" style="--s:${scale}"><header>`;
  if (m.name) html += `<h1>${escapeHtml(stripRich(m.name))}</h1>`;
  if (m.headline) html += `<div class="headline">${inline(m.headline, highlight)}</div>`;
  if (contact) html += `<div class="contact">${contact}</div>`;
  html += '</header>';
  for (const s of m.sections) if (s.body.trim()) html += `<section data-id="${s.id}" class="k-${s.kind}"><h2>${escapeHtml(s.title)}</h2>${renderBody(s, highlight)}</section>`;
  return html + '</div>';
}

export const RESUME_FONTS = (base = '../lib/fonts/') => `
@font-face{font-family:"CMU Serif";src:url("${base}cmu-serif-500-roman.woff2") format("woff2");font-weight:400 500;font-style:normal}
@font-face{font-family:"CMU Serif";src:url("${base}cmu-serif-500-italic.woff2") format("woff2");font-weight:400 500;font-style:italic}
@font-face{font-family:"CMU Serif";src:url("${base}cmu-serif-700-roman.woff2") format("woff2");font-weight:600 800;font-style:normal}
@font-face{font-family:"CMU Serif";src:url("${base}cmu-serif-700-italic.woff2") format("woff2");font-weight:600 800;font-style:italic}`;

const S = v => `calc(${v} * var(--s))`;
export const RESUME_CSS = `
.resume{--s:1;font-family:"Calibri","Carlito","Segoe UI",Arial,sans-serif;color:#111;font-size:${S('10.5pt')};line-height:1.3}
.resume header{text-align:center;margin-bottom:${S('6pt')}}
.resume h1{font-size:${S('21pt')};margin:0;letter-spacing:.3px;font-weight:700;line-height:1.15}
.resume .headline{font-size:${S('11pt')};color:#333;margin-top:${S('2pt')}}
.resume .contact{font-size:${S('9.5pt')};color:#222;margin-top:${S('3pt')}}
.resume .contact .sep{margin:0 ${S('6pt')};color:#777}
.resume a{color:inherit;text-decoration:none}
.resume h2{font-size:${S('11pt')};text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #222;padding-bottom:1pt;margin:${S('9pt')} 0 ${S('4pt')}}
.resume p{margin:0 0 ${S('2.5pt')}}
.resume ul{margin:${S('1pt')} 0 ${S('3pt')};padding-left:${S('15pt')}}
.resume li{margin:0 0 ${S('1.2pt')}}
.resume .entry{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.resume .entry .l{min-width:0}
.resume .entry .r{white-space:nowrap;font-weight:400;font-style:normal;color:#222;flex:none}
.resume .entry-head{font-weight:700;margin-top:${S('3.5pt')}}
.resume .entry-head.rich{font-weight:400}
.resume .entry-sub{font-style:italic;color:#222}
.resume .entry-sub.rich{font-style:normal}
.resume mark{background:#fff1a8;color:inherit;padding:0 1px;border-radius:2px}

/* LaTeX look (CMU Serif, like the classic "Jake's resume" template) */
.resume.tpl-latex{font-family:"CMU Serif","Latin Modern Roman","Computer Modern",Georgia,serif;font-size:${S('10.6pt')};line-height:1.22;color:#000}
.resume.tpl-latex h1{font-variant:small-caps;font-weight:400;font-size:${S('25pt')};letter-spacing:.5px}
.resume.tpl-latex .contact{font-size:${S('10pt')};color:#000}
.resume.tpl-latex .contact a,.resume.tpl-latex .entry .r a,.resume.tpl-latex li a,.resume.tpl-latex p a,.resume.tpl-latex .l a{text-decoration:underline;text-underline-offset:2px}
.resume.tpl-latex .contact .sep{margin:0 ${S('4pt')};color:#000}
.resume.tpl-latex h2{text-transform:none;letter-spacing:0;font-size:${S('12.5pt')};font-weight:700;border-bottom:.8px solid #000;padding-bottom:0;margin:${S('8pt')} 0 ${S('4pt')}}
.resume.tpl-latex section>:not(h2){margin-left:${S('9pt')}}
.resume.tpl-latex ul{padding-left:${S('13pt')};margin:${S('0.5pt')} 0 ${S('2pt')} ${S('9pt')}}
.resume.tpl-latex li{margin:0;padding-left:${S('1pt')}}
.resume.tpl-latex li::marker{font-size:.8em}
.resume.tpl-latex .entry-head{margin-top:${S('2.5pt')}}
.resume.tpl-latex .entry .r{color:#000}
.resume.tpl-latex .skill-line{margin:0}

.resume.tpl-modern{font-family:"Inter","Segoe UI",Roboto,Arial,sans-serif}
.resume.tpl-modern header{text-align:left;border-left:4px solid #1f3a8a;padding-left:10pt}
.resume.tpl-modern h1{color:#10214f}
.resume.tpl-modern h2{color:#1f3a8a;border-bottom:1.5px solid #cfd8ee}
.resume.tpl-compact{font-size:${S('9.6pt')};line-height:1.22}
.resume.tpl-compact h1{font-size:${S('17pt')}}
.resume.tpl-compact h2{margin:${S('6pt')} 0 ${S('2.5pt')};font-size:${S('10pt')}}
`;

/* ---------------- Tailoring helpers (deterministic) ---------------- */

const skillNamesIn = text => new Set(findSkillOccurrences(text).map(o => o.name));

export function reorderSkills(m, jobSkillNames) {
  const want = new Set(jobSkillNames);
  const score = t => [...skillNamesIn(t)].filter(n => want.has(n)).length;
  for (const s of m.sections.filter(x => x.kind === 'skills')) {
    const lines = s.body.split('\n').map(line => {
      const mm = line.match(SKILL_LINE) || [null, '', line];
      const items = mm[2].split(/\s*,\s*/);
      if (items.length < 2) return line;
      const ranked = items.map((it, i) => ({ it, i, s: score(it) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.it);
      return mm[1] + ranked.join(', ');
    });
    const withIdx = lines.map((l, i) => ({ l, i, s: l.trim() ? score(l) : -1 }));
    if (!lines.some(l => !l.trim())) withIdx.sort((a, b) => b.s - a.s || a.i - b.i);
    s.body = withIdx.map(x => x.l).join('\n');
  }
  return m;
}

const CAT_LABELS = {
  Languages: /language|programming/i, Frontend: /front|web|ui/i, Backend: /back|server|api|framework/i, Databases: /data ?bases?|db|storage/i,
  Cloud: /cloud|devops|infra/i, DevOps: /devops|cloud|infra|ci/i, 'Data & AI': /data|ml|ai|machine/i, Mobile: /mobile/i, Testing: /test|qa/i,
  Tools: /tools|other|platform/i, Architecture: /concept|architecture|practice|other/i, Practices: /practice|method|other/i, 'Soft skills': /soft|other/i,
};

export function addSkills(m, names) {
  let sec = m.sections.find(s => s.kind === 'skills');
  if (!sec) { sec = { id: newId(), title: 'Skills', kind: 'skills', body: '' }; m.sections.splice(Math.min(1, m.sections.length), 0, sec); }
  const lines = sec.body ? sec.body.split('\n') : [];
  const have = skillNamesIn(sec.body);
  for (const n of names) {
    if (have.has(n)) continue;
    const cat = SKILL_BY_NAME.get(n)?.cat;
    const re = CAT_LABELS[cat];
    let idx = re ? lines.findIndex(l => { const lab = l.match(SKILL_LINE); return lab && re.test(stripRich(lab[1])); }) : -1;
    if (idx < 0) idx = lines.findIndex(l => /^\s*(?:[-•]\s*)?(?:\*\*)?additional:/i.test(l));
    if (idx < 0) {
      const labeled = lines.some(l => SKILL_LINE.test(l));
      if (labeled || !lines.length) { lines.push(lines.some(l => /\*\*[^*]+:\*\*/.test(l)) ? '**Additional:** ' + n : 'Additional: ' + n); }
      else lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*$/, '') + ', ' + n;
    } else lines[idx] = lines[idx].replace(/[,\s]*$/, '') + ', ' + n;
    have.add(n);
  }
  sec.body = lines.join('\n');
  return m;
}

export function prioritizeBullets(m, jobA) {
  const kw = new Set(jobA.keywords.map(k => k.stem));
  const weightOf = n => jobA.skills.get(n)?.weight || 0;
  const rel = b0 => { const b = stripRich(b0); return [...skillNamesIn(b)].reduce((a, n) => a + weightOf(n), 0) + tokenize(b).map(stem).filter(s => kw.has(s)).length * 0.5 + (/\d/.test(b) ? 0.3 : 0); };
  for (const s of m.sections.filter(x => x.kind === 'experience' || x.kind === 'projects')) {
    const lines = s.body.split('\n');
    const out = []; let group = [];
    const flush = () => { out.push(...group.map((b, i) => ({ b, i, r: rel(b) })).sort((a, b) => b.r - a.r || a.i - b.i).map(x => x.b)); group = []; };
    for (const l of lines) { if (/^\s*[-•*]\s+/.test(l)) group.push(l); else { flush(); out.push(l); } }
    flush();
    s.body = out.join('\n');
  }
  return m;
}

export function templateSummary({ profile = {}, match, jobA, model }) {
  const matched = match.skills.filter(s => s.status === 'matched' && !s.generic).map(s => s.name);
  const top = matched.slice(0, 4), more = matched.slice(4, 7);
  const title = profile.targetTitle || stripRich(model.headline || '').split(/[|,•]/)[0]?.trim() || jobA.title || 'Software Engineer';
  const yrs = match.years.candidate ? `${Math.floor(match.years.candidate)}+ years of experience` : 'hands-on experience';
  let s = `${title} with ${yrs}`;
  if (top.length) s += ` building production software with ${listJoin(top)}`;
  s += '.';
  if (more.length) s += ` Also experienced with ${listJoin(more)}.`;
  const soft = match.skills.filter(x => x.status === 'matched' && x.generic).map(x => x.name.toLowerCase()).slice(0, 2);
  if (soft.length) s += ` Known for ${listJoin(soft)}.`;
  if (jobA.company || jobA.title) s += ` Excited to bring this experience to ${jobA.company || 'the team'}${jobA.title ? ` as ${/^[aeiou]/i.test(jobA.title) ? 'an' : 'a'} ${jobA.title}` : ''}.`;
  return s;
}
const listJoin = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

export function setSummary(m, text) {
  let sec = m.sections.find(s => s.kind === 'summary');
  if (!sec) { sec = { id: newId(), title: 'Summary', kind: 'summary', body: '' }; m.sections.unshift(sec); }
  sec.body = text;
  return m;
}

export function newSection(kind = 'other', title = 'New Section') {
  return { id: newId(), title, kind, body: '' };
}

export { findSkills };
