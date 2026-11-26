// Editable resume model: parse text -> {name, headline, contact, sections[]}, render HTML/TXT/DOCX, tailoring helpers.
import { escapeHtml, BULLET_RE, tokenize, stem } from './text.js';
import { findSkillOccurrences, findSkills } from './matcher.js';
import { SKILL_BY_NAME } from './skills.js';

const HEADINGS = [
  ['summary', /^(professional |career |executive |profile )?(summary|profile|objective|about( me)?|overview)$|^career objective$|^summary of qualifications$/],
  ['experience', /(experience|employment|work history|career history|internships?)$/],
  ['skills', /(skills|competencies|technologies|tech stack|expertise|tools)( (&|and) (tools|technologies|expertise))?$/],
  ['education', /^(education|academic|academics|academic background|qualifications)( (&|and) (certifications|training))?$/],
  ['projects', /projects?$|^open source( contributions)?$|^portfolio$/],
  ['certifications', /^(certifications?|certificates|licenses?( (&|and) certifications)?|courses|training|courses (&|and) certifications)$/],
  ['awards', /^(awards|achievements|honors|honours|accomplishments|awards (&|and) (achievements|honors))$/],
  ['other', /^(publications|languages|interests|hobbies|volunteer(ing)?( experience)?|leadership|activities|extracurricular( activities)?|references|additional information|positions of responsibility)$/],
];

export function headingKind(line) {
  const t = line.trim().replace(/[:\s]+$/, '');
  if (!t || t.length > 45 || BULLET_RE.test(line) || /[@\d,|]/.test(t)) return null;
  if (t.split(/\s+/).length > 5) return null;
  const l = t.toLowerCase().replace(/\s+/g, ' ');
  for (const [kind, re] of HEADINGS) if (re.test(l)) return kind;
  return null;
}

let uid = 0;
const newId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

export function parseResumeModel(text = '') {
  const lines = text.split('\n');
  const first = lines.findIndex(l => headingKind(l));
  const headerLines = (first < 0 ? lines.slice(0, 4) : lines.slice(0, first)).map(l => l.trim()).filter(Boolean);
  const isContact = l => /@|https?:|www\.|linkedin|github|\+?\d[\d\s().-]{7,}/.test(l);
  const name = headerLines.length && !isContact(headerLines[0]) && headerLines[0].length <= 60 ? headerLines.shift() : '';
  let headline = '';
  if (headerLines.length && !isContact(headerLines[0]) && headerLines[0].length <= 120) headline = headerLines.shift();
  const contact = headerLines.join(' | ').split(/\s*(?:\||•|·|◆|⋄|\s{3,})\s*/).filter(Boolean).join(' | ');
  const sections = [];
  if (first >= 0) {
    let cur = null;
    for (const l of lines.slice(first)) {
      const k = headingKind(l);
      if (k) { cur = { id: newId(), title: titleCase(l.trim().replace(/[:\s]+$/, '')), kind: k, body: '' }; sections.push(cur); continue; }
      cur.body += (cur.body ? '\n' : '') + l;
    }
    sections.forEach(s => (s.body = s.body.replace(/^\n+|\n+$/g, '')));
  } else {
    sections.push({ id: newId(), title: 'Experience', kind: 'experience', body: lines.slice(headerLines.length + (name ? 1 : 0) + (headline ? 1 : 0)).join('\n').trim() });
  }
  return { name, headline, contact, sections, template: 'classic' };
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/\b(And|Of|&)\b/g, w => w.toLowerCase());
}

export function modelToText(m) {
  const parts = [m.name, m.headline, m.contact].filter(Boolean);
  for (const s of m.sections) parts.push('', s.title.toUpperCase(), s.body.replace(/\*\*/g, ''));
  return parts.join('\n').trim();
}

export function modelSections(m) {
  return m.sections.map(s => ({ kind: s.kind, title: s.title, body: s.body }));
}

/* ---------------- Rendering ---------------- */

const DATE_TAIL = /^(.*?)[\s,|·•–—-]*((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?(?:\d{1,2}[\/.-])?(?:19|20)\d{2}(?:\s*(?:-|–|—|to)\s*(?:present|current|now|ongoing|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?(?:\d{1,2}[\/.-])?(?:19|20)\d{2}))?)\s*$/i;

function inline(s, hl) {
  let h = escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  h = h.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, u => `<a href="${u.startsWith('http') ? u : 'https://' + u}">${u}</a>`);
  if (hl) h = h.replace(/(^|>)([^<]+)/g, (m, a, txt) => a + txt.replace(hl, '<mark>$&</mark>'));
  return h;
}

export function buildHighlighter(terms) {
  const uniq = [...new Set(terms.filter(t => t && t.length > 1))].sort((a, b) => b.length - a.length);
  if (!uniq.length) return null;
  const esc = s => escapeHtml(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])(?:${uniq.map(esc).join('|')})(?![A-Za-z0-9])`, 'gi');
}

export function renderBody(sec, hl) {
  const lines = sec.body.split('\n');
  let html = '', inList = false, afterBreak = true;
  const close = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { close(); afterBreak = true; continue; }
    if (/^[-•*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^[-•*]\s+/, ''), hl)}</li>`; afterBreak = true; continue;
    }
    close();
    if (sec.kind === 'skills') {
      const m = line.match(/^([^:]{2,40}):\s*(.+)$/);
      html += m ? `<p class="skill-line"><b>${inline(m[1], null)}:</b> ${inline(m[2], hl)}</p>` : `<p class="skill-line">${inline(line, hl)}</p>`;
    } else if (sec.kind === 'summary') {
      html += `<p>${inline(line, hl)}</p>`;
    } else {
      const split = line.match(/^(.*?)\s{3,}(.+)$/) || line.match(DATE_TAIL);
      const left = split && split[1].trim() ? split[1].trim() : line;
      const right = split && split[1].trim() ? split[2].trim() : '';
      html += `<div class="entry ${afterBreak ? 'entry-head' : 'entry-sub'}"><span class="l">${inline(left, hl)}</span>${right ? `<span class="r">${inline(right, null)}</span>` : ''}</div>`;
      afterBreak = false;
    }
  }
  close();
  return html;
}

export function renderResumeHTML(m, { highlight = null } = {}) {
  const contact = (m.contact || '').split(/\s*\|\s*/).filter(Boolean).map(c => `<span>${inline(c, null)}</span>`).join('<span class="sep">•</span>');
  let html = `<div class="resume tpl-${m.template || 'classic'}"><header>`;
  if (m.name) html += `<h1>${escapeHtml(m.name)}</h1>`;
  if (m.headline) html += `<div class="headline">${inline(m.headline, highlight)}</div>`;
  if (contact) html += `<div class="contact">${contact}</div>`;
  html += '</header>';
  for (const s of m.sections) if (s.body.trim()) html += `<section data-id="${s.id}"><h2>${escapeHtml(s.title)}</h2>${renderBody(s, highlight)}</section>`;
  return html + '</div>';
}

export const RESUME_CSS = `
.resume{font-family:"Calibri","Carlito","Segoe UI",Arial,sans-serif;color:#111;font-size:10.5pt;line-height:1.35}
.resume header{text-align:center;margin-bottom:8pt}
.resume h1{font-size:21pt;margin:0;letter-spacing:.5px;font-weight:700}
.resume .headline{font-size:11pt;color:#333;margin-top:2pt}
.resume .contact{font-size:9.5pt;color:#333;margin-top:3pt}
.resume .contact .sep{margin:0 6px;color:#888}
.resume a{color:inherit;text-decoration:none}
.resume h2{font-size:11pt;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #222;padding-bottom:1pt;margin:10pt 0 4pt}
.resume p{margin:0 0 3pt}
.resume ul{margin:1pt 0 4pt;padding-left:15pt}
.resume li{margin:0 0 1.5pt}
.resume .entry{display:flex;justify-content:space-between;gap:12px}
.resume .entry-head{font-weight:700;margin-top:4pt}
.resume .entry-sub{font-style:italic;color:#333}
.resume .entry .r{white-space:nowrap;font-weight:400;font-style:normal;color:#333}
.resume mark{background:#fff1a8;color:inherit;padding:0 1px;border-radius:2px}
.resume.tpl-modern{font-family:"Inter","Segoe UI",Roboto,Arial,sans-serif}
.resume.tpl-modern header{text-align:left;border-left:4px solid #2557d6;padding-left:10pt}
.resume.tpl-modern h1{color:#16307a}
.resume.tpl-modern h2{color:#2557d6;border-bottom:1.5px solid #c9d6f5}
.resume.tpl-compact{font-size:9.5pt;line-height:1.25}
.resume.tpl-compact h1{font-size:17pt}
.resume.tpl-compact h2{margin:7pt 0 3pt;font-size:10pt}
.resume.tpl-serif{font-family:Georgia,"Times New Roman",serif}
.resume.tpl-serif h2{font-variant:small-caps;text-transform:none;font-size:12pt;letter-spacing:.5px}
`;

/* ---------------- Tailoring helpers (deterministic) ---------------- */

const skillNamesIn = text => new Set(findSkillOccurrences(text).map(o => o.name));

export function reorderSkills(m, jobSkillNames) {
  const want = new Set(jobSkillNames);
  const score = t => [...skillNamesIn(t)].filter(n => want.has(n)).length;
  for (const s of m.sections.filter(x => x.kind === 'skills')) {
    const lines = s.body.split('\n').map(line => {
      const mm = line.match(/^(\s*(?:[-•*]\s*)?[^:]{2,40}:\s*)(.+)$/) || [null, '', line];
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
    let idx = re ? lines.findIndex(l => { const lab = l.match(/^\s*(?:[-•*]\s*)?([^:]{2,40}):/); return lab && re.test(lab[1]); }) : -1;
    if (idx < 0) idx = lines.findIndex(l => /^\s*(?:[-•*]\s*)?additional:/i.test(l));
    if (idx < 0) {
      const labeled = lines.some(l => /^[^:]{2,40}:/.test(l.replace(/^\s*[-•*]\s*/, '')));
      if (labeled || !lines.length) { lines.push('Additional: ' + n); }
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
  const rel = b => [...skillNamesIn(b)].reduce((a, n) => a + weightOf(n), 0) + tokenize(b).map(stem).filter(s => kw.has(s)).length * 0.5 + (/\d/.test(b) ? 0.3 : 0);
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
  const title = profile.targetTitle || model.headline?.split(/[|,•]/)[0]?.trim() || jobA.title || 'Software Engineer';
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
