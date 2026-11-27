// Structured profile importers — deterministic, no AI.
//  • GitHub: public REST API (no key, no sign-in), opt-in.
//  • LinkedIn: the official "Get a copy of your data" export (ZIP or CSV files), parsed locally.
import { findSkills } from './matcher.js';
import { unzipEntry } from './resume-parser.js';
import { MONTHS } from './text.js';

/* ------------------------------------------------------------------ */
/* Shared                                                               */
/* ------------------------------------------------------------------ */

/** "Aug 2025", "2025-08", "08/2025", "2025" -> months since year 0 (or null). */
export function parseMonth(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] != null) return +m[2] * 12 + MONTHS[m[1].slice(0, 3).toLowerCase()];
  m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/); if (m) return +m[1] * 12 + (+m[2] - 1);
  m = t.match(/^(\d{1,2})\/(\d{4})$/); if (m) return +m[2] * 12 + (+m[1] - 1);
  m = t.match(/^(\d{4})$/); if (m) return +m[1] * 12;
  return null;
}
export const fmtYM = v => (v == null ? '' : `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][v % 12]} ${Math.floor(v / 12)}`);

/** Total years of work from positions, overlapping periods counted once. */
export function yearsFromWork(work = []) {
  const now = new Date(); const nowM = now.getFullYear() * 12 + now.getMonth();
  const iv = work.map(w => [parseMonth(w.start), w.end ? parseMonth(w.end) : nowM]).filter(([s, e]) => s != null && e != null && e >= s).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const x of iv) { const l = merged[merged.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else merged.push([...x]); }
  return Math.round((merged.reduce((a, [s, e]) => a + (e - s + 1), 0) / 12) * 10) / 10;
}

const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Merge lists without duplicates (by a key function). */
export function mergeList(existing = [], incoming = [], k) {
  const seen = new Set(existing.map(k));
  return [...existing, ...incoming.filter(x => { const kk = k(x); if (!kk || seen.has(kk)) return false; seen.add(kk); return true; })];
}
export const KEYS = {
  work: w => key(`${w.company}|${w.title}|${w.start}`),
  education: e => key(`${e.school}|${e.degree}`),
  projects: p => key(p.url || p.name),
  certifications: c => key(c.name),
  skills: s => key(s),
};

/* ------------------------------------------------------------------ */
/* GitHub                                                               */
/* ------------------------------------------------------------------ */

export function githubUsername(input = '') {
  const t = input.trim().replace(/\/$/, '');
  const m = t.match(/github\.com\/([A-Za-z0-9-]{1,39})(?:[/?#]|$)/i);
  if (m) return m[1];
  return /^[A-Za-z0-9-]{1,39}$/.test(t) ? t : '';
}

// GitHub language names that differ from our skill names.
const LANG_ALIAS = { 'Jupyter Notebook': 'Jupyter', Shell: 'Shell Scripting', Vue: 'Vue.js', SCSS: 'Sass', Dockerfile: 'Docker', HCL: 'Terraform', 'C++': 'C++', 'C#': 'C#', Go: 'Go', R: 'R', C: 'C' };

/** Fetch a public GitHub profile and repos. `fetchImpl` is injectable for tests. */
export async function importGitHub(username, { fetchImpl = fetch } = {}) {
  const u = githubUsername(username);
  if (!u) throw new Error('Enter a GitHub username or profile URL.');
  const get = async path => {
    const r = await fetchImpl(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 404) throw new Error(`GitHub user “${u}” not found.`);
    if (r.status === 403 || r.status === 429) throw new Error('GitHub rate limit reached (60 requests/hour without sign-in). Try again later.');
    if (!r.ok) throw new Error(`GitHub returned ${r.status}.`);
    return r.json();
  };
  const user = await get(`/users/${u}`);
  const repos = (await get(`/users/${u}/repos?per_page=100&sort=pushed&type=owner`)).filter(r => !r.fork && !r.archived);

  // Languages: primary language of every repo, weighted by recency; topics too.
  const langCount = new Map();
  const topics = new Map();
  for (const r of repos) {
    if (r.language) langCount.set(r.language, (langCount.get(r.language) || 0) + 1);
    for (const t of r.topics || []) topics.set(t, (topics.get(t) || 0) + 1);
  }
  const languages = [...langCount].sort((a, b) => b[1] - a[1]).map(([name, repos]) => ({ name, repos }));

  // Map languages and topics onto the skill taxonomy (deterministic).
  const skillEvidence = new Map();
  const addSkill = (name, why) => { if (!skillEvidence.has(name)) skillEvidence.set(name, why); };
  for (const l of languages) {
    const mapped = [...findSkills(LANG_ALIAS[l.name] || l.name).keys()][0];
    if (mapped) addSkill(mapped, `${l.repos} repo${l.repos === 1 ? '' : 's'} in ${l.name}`);
  }
  for (const [t, n] of [...topics].sort((a, b) => b[1] - a[1])) {
    for (const s of findSkills(t.replace(/-/g, ' ')).keys()) addSkill(s, `topic “${t}”${n > 1 ? ` on ${n} repos` : ''}`);
  }
  for (const r of repos.slice(0, 40)) for (const s of findSkills(`${r.description || ''}`).keys()) addSkill(s, `mentioned in ${r.name}`);

  // Projects: rank by stars, then recent activity; keep the best 12.
  const projects = repos
    .map(r => ({ name: r.name, url: r.html_url, homepage: r.homepage || '', description: r.description || '', language: r.language || '', stars: r.stargazers_count || 0, topics: r.topics || [], updated: r.pushed_at }))
    .sort((a, b) => b.stars - a.stars || (b.updated || '').localeCompare(a.updated || ''))
    .slice(0, 12);

  return {
    source: 'github', username: u,
    profile: {
      name: user.name || '', location: user.location || '', company: (user.company || '').replace(/^@/, ''),
      portfolio: user.blog ? (/^https?:/.test(user.blog) ? user.blog : 'https://' + user.blog) : '', github: user.html_url, headline: user.bio || '',
    },
    skills: [...skillEvidence].map(([name, why]) => ({ name, why })),
    languages, projects,
    stats: { repos: repos.length, followers: user.followers || 0 },
  };
}

/* ------------------------------------------------------------------ */
/* LinkedIn data export (CSV)                                           */
/* ------------------------------------------------------------------ */

/** RFC 4180-ish CSV parser (quotes, escaped quotes, newlines inside quotes). */
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/** Rows -> objects, finding the header row (LinkedIn sometimes puts notes above it). */
function table(text, mustHave) {
  const rows = parseCSV(text);
  const h = rows.findIndex(r => mustHave.every(col => r.some(x => x.trim().toLowerCase() === col.toLowerCase())));
  if (h < 0) return [];
  const head = rows[h].map(x => x.trim());
  return rows.slice(h + 1).map(r => Object.fromEntries(head.map((k, i) => [k, (r[i] || '').trim()])));
}

const FILES = {
  positions: /(^|\/)positions\.csv$/i,
  education: /(^|\/)education\.csv$/i,
  skills: /(^|\/)skills\.csv$/i,
  certifications: /(^|\/)certifications\.csv$/i,
  profile: /(^|\/)profile\.csv$/i,
  email: /(^|\/)email addresses\.csv$/i,
  phone: /(^|\/)phonenumbers\.csv$/i,
};

/** List file names inside a ZIP (central directory). */
export function zipNames(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That file is not a ZIP archive.');
  const names = []; let off = dv.getUint32(eocd + 16, true);
  for (let n = 0, count = dv.getUint16(eocd + 10, true); n < count; n++) {
    const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    names.push(new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen)));
    off += 46 + nlen + xlen + clen;
  }
  return names;
}

/** Accepts the export ZIP and/or individual CSV files. */
export async function importLinkedIn(files) {
  const texts = {};
  for (const f of files) {
    const buf = await f.arrayBuffer();
    if (/\.zip$/i.test(f.name) || new Uint8Array(buf.slice(0, 2)).join() === '80,75') {
      for (const name of zipNames(buf)) for (const [k, re] of Object.entries(FILES)) if (re.test(name) && !texts[k]) texts[k] = await unzipEntry(buf, name);
    } else {
      for (const [k, re] of Object.entries(FILES)) if (re.test(f.name)) texts[k] = new TextDecoder().decode(buf);
    }
  }
  if (!Object.keys(texts).length) throw new Error('No LinkedIn files found. Use the ZIP from LinkedIn → Settings → Data privacy → Get a copy of your data, or Positions.csv / Education.csv / Skills.csv.');

  const work = texts.positions ? table(texts.positions, ['Company Name', 'Title']).map(r => ({
    title: r['Title'], company: r['Company Name'], location: r['Location'] || '', description: r['Description'] || '',
    start: r['Started On'] || '', end: r['Finished On'] || '',
  })).filter(w => w.title || w.company) : [];
  const education = texts.education ? table(texts.education, ['School Name']).map(r => ({
    school: r['School Name'], degree: r['Degree Name'] || '', field: r['Field Of Study'] || '', start: r['Start Date'] || '', end: r['End Date'] || '', notes: r['Notes'] || '',
  })).filter(e => e.school) : [];
  const skills = texts.skills ? table(texts.skills, ['Name']).map(r => r['Name']).filter(Boolean) : [];
  const certifications = texts.certifications ? table(texts.certifications, ['Name']).map(r => ({
    name: r['Name'], authority: r['Authority'] || '', url: r['Url'] || '', date: r['Started On'] || '',
  })).filter(c => c.name) : [];
  const p = texts.profile ? table(texts.profile, ['First Name', 'Last Name'])[0] || {} : {};
  const email = texts.email ? (table(texts.email, ['Email Address']).find(r => /yes/i.test(r['Primary'] || '')) || table(texts.email, ['Email Address'])[0] || {})['Email Address'] || '' : '';
  const phone = texts.phone ? (table(texts.phone, ['Number'])[0] || {})['Number'] || '' : '';
  const websites = (p['Websites'] || '').match(/https?:\/\/[^\s,\]]+/g) || [];

  // Skills: LinkedIn names mapped onto the taxonomy where possible, otherwise kept as written.
  const mapped = skills.map(s => [...findSkills(s).keys()][0] || s);
  // Skills mentioned in position descriptions.
  for (const w of work) for (const s of findSkills(`${w.title} ${w.description}`).keys()) mapped.push(s);

  return {
    source: 'linkedin',
    profile: {
      name: [p['First Name'], p['Last Name']].filter(Boolean).join(' '), headline: p['Headline'] || '', summary: p['Summary'] || '',
      location: p['Geo Location'] || '', email, phone, portfolio: websites.find(u => !/linkedin|github/i.test(u)) || '',
      currentCompany: (work.find(w => !w.end) || {}).company || '', targetTitle: (work.find(w => !w.end) || {}).title || '',
    },
    work, education, certifications,
    skills: [...new Set(mapped)].map(name => ({ name, why: skills.includes(name) ? 'LinkedIn skills' : 'LinkedIn' })),
    years: yearsFromWork(work),
    files: Object.keys(texts),
  };
}
