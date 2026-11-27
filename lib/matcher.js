// Deterministic (no-AI) job <-> resume matching engine.
import { MATCHERS, SKILL_BY_NAME } from './skills.js';
import { normalizeText, tokenize, stem, BULLET_RE, MONTHS } from './text.js';

/* ------------------------------------------------------------------ */
/* Skill detection                                                      */
/* ------------------------------------------------------------------ */

export function findSkillOccurrences(text) {
  const occ = [];
  if (!text) return occ;
  for (const m of MATCHERS) {
    for (const re of [m.ci, m.cs]) {
      if (!re) continue;
      re.lastIndex = 0;
      let r;
      while ((r = re.exec(text))) {
        occ.push({ name: m.skill.name, index: r.index, text: r[0] });
        if (!r[0].length) re.lastIndex++;
      }
    }
  }
  return occ;
}

export function findSkills(text) {
  const out = new Map();
  for (const o of findSkillOccurrences(text)) {
    const e = out.get(o.name) || { skill: SKILL_BY_NAME.get(o.name), count: 0, first: o.index };
    e.count++; e.first = Math.min(e.first, o.index);
    out.set(o.name, e);
  }
  return out;
}

/** Skills the candidate has: direct + implied (transitively). */
const splitList = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean);

/** Skills the candidate has: direct + implied (transitively).
 *  `profile` may be a string (legacy extraSkills) or {extraSkills, removedSkills, aiSkills}. */
export function candidateSkills(resumeText, profile = {}) {
  const p = typeof profile === 'string' ? { extraSkills: profile } : profile || {};
  const extra = [...splitList(p.extraSkills), ...splitList(p.aiSkills)];
  const direct = findSkills(`${resumeText}\n${extra.length ? 'Skills: ' + extra.join(', ') : ''}`);
  for (const r of splitList(p.removedSkills)) direct.delete(r);
  const implied = new Map();
  const queue = [...direct.keys()];
  while (queue.length) {
    const n = queue.shift();
    for (const imp of SKILL_BY_NAME.get(n)?.imp || []) {
      if (!direct.has(imp) && !implied.has(imp)) { implied.set(imp, n); queue.push(imp); }
    }
  }
  return { direct, implied };
}

/* ------------------------------------------------------------------ */
/* Job description structure                                            */
/* ------------------------------------------------------------------ */

const COMPANY_HEAD = /(about (?:us|the company|the team|our)|who we are|our (?:mission|story|values|culture)|benefits|perks|what we offer|we offer|compensation|salary|pay range|equal (?:opportunity|employment)|\beeo\b|diversity|why (?:join|work)|life at|how to apply|accommodation|privacy)/i;
const PREF_HEAD = /(nice[\s-]*to[\s-]*have|preferred|bonus|good[\s-]*to[\s-]*have|desir(?:ed|able)|plus(?:es)?\b|a plus|extra credit|ideally|it'?s a plus|added advantage|not required)/i;
const RESP_HEAD = /(responsibilit|what you'?ll (?:do|work on|be doing)|what you will do|the role|your role|role overview|day[\s-]*to[\s-]*day|duties|in this role|key tasks|your impact|the job|job description|what the job involves|you will:?$)/i;
const REQ_HEAD = /(requirement|qualification|must[\s-]*haves?|what you'?ll need|what you need|what we'?re looking for|what we look for|who you are|what you bring|about you|you have|you should have|you'?ll have|skills|experience|minimum|basic|required|mandatory|eligibility|tech stack|technologies|our stack)/i;

const PREF_LINE = /(nice[\s-]*to[\s-]*have|preferred|is a plus|a plus\b|bonus|good[\s-]*to[\s-]*have|familiarity with|exposure to|desirable|would be great|nice if|ideally|optional|not required|added advantage)/i;
const REQ_LINE = /(must|required|mandatory|strong|proficien|expert|solid|deep|hands[\s-]*on|extensive|advanced|\d+\+?\s*(?:years|yrs))/i;

export const TIER_WEIGHT = { title: 3, required: 3, responsibilities: 2, general: 2, preferred: 1, company: 0.5 };

function classifyHeading(raw) {
  const line = raw.trim();
  if (!line || line.length > 80 || BULLET_RE.test(raw)) return null;
  const l = line.replace(/[:\-–—\s]+$/, '');
  const words = l.split(/\s+/).length;
  const headingLike = /:\s*$/.test(line) || (words <= 8 && !/[.!?,;]$/.test(l)) || (l === l.toUpperCase() && /[A-Z]/.test(l) && words <= 8);
  if (!headingLike) return null;
  if (COMPANY_HEAD.test(l)) return 'company';
  if (PREF_HEAD.test(l)) return 'preferred';
  if (RESP_HEAD.test(l)) return 'responsibilities';
  if (REQ_HEAD.test(l)) return 'required';
  return null;
}

/** Split job text into lines with a tier for each line. */
export function sectionizeJob(text) {
  const lines = [];
  let pos = 0, current = 'general';
  for (const raw of text.split('\n')) {
    const start = pos; pos += raw.length + 1;
    const head = classifyHeading(raw);
    if (head) { current = head; lines.push({ start, end: pos, text: raw, tier: head, heading: true }); continue; }
    let tier = current;
    const inline = raw.match(/^\s*([^:]{3,45}):\s*(\S.*)$/);
    if (inline) { const h = classifyHeading(inline[1] + ':'); if (h) tier = h; }
    if (tier !== 'company') {
      if (PREF_LINE.test(raw)) tier = 'preferred';
      else if ((tier === 'general' || tier === 'responsibilities') && REQ_LINE.test(raw)) tier = 'required';
    }
    lines.push({ start, end: pos, text: raw, tier });
  }
  return lines;
}

function tierAt(lines, idx) {
  let lo = 0, hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx < lines[mid].start) hi = mid - 1; else if (idx >= lines[mid].end) lo = mid + 1; else return lines[mid].tier;
  }
  return 'general';
}

const YEARS_RES = [
  /(\d{1,2})(?:\.\d)?\s*\+?\s*(?:(?:-|to|–|or)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)'?s?\b[^.\n]{0,70}?(?:experience|exp\b|background|hands[\s-]*on|working|professional|industry|developing|building|engineering|programming|coding)/gi,
  /(?:experience|exp)\s*(?:of|:|-|–)?\s*(?:at\s+least|minimum(?:\s+of)?|min\.?)?\s*(\d{1,2})\s*\+?\s*(?:(?:-|to|–)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)/gi,
  /(?:at\s+least|minimum(?:\s+of)?|min\.?)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi,
];

function extractJobYears(text, lines) {
  const found = [];
  for (const re of YEARS_RES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) {
      const min = +m[1];
      if (min > 0 && min <= 20) found.push({ min, max: m[2] ? +m[2] : null, tier: tierAt(lines, m.index), snippet: m[0].trim().slice(0, 90) });
    }
  }
  const strict = found.filter(f => f.tier !== 'preferred' && f.tier !== 'company');
  const pool = strict.length ? strict : found.filter(f => f.tier !== 'company');
  if (!pool.length) return null;
  const best = pool.reduce((a, b) => (b.min > a.min ? b : a));
  return { ...best, preferredOnly: !strict.length };
}

const SENIORITY = [
  { re: /\b(intern|internship|trainee|apprentice)\b/i, level: 'intern', years: 0 },
  { re: /\b(junior|jr\.?|entry[\s-]*level|graduate|associate|new grad|fresher)\b/i, level: 'junior', years: 0 },
  { re: /\b(principal|distinguished|architect|director|head of|vp)\b/i, level: 'principal', years: 9 },
  { re: /\b(staff|lead|manager)\b/i, level: 'staff', years: 7 },
  { re: /\b(senior|sr\.?|sde\s*(?:ii|iii|3)|engineer\s*(?:iii|3))\b/i, level: 'senior', years: 5 },
  { re: /\b(mid[\s-]*level|sde\s*(?:ii|2)|engineer\s*(?:ii|2))\b/i, level: 'mid', years: 2 },
];
export function seniorityOf(title = '') {
  for (const s of SENIORITY) if (s.re.test(title)) return s;
  return null;
}

const DEGREE_LEVELS = [
  { level: 3, label: 'PhD', re: /\b(ph\.?\s?d|doctorate|doctoral)\b/i },
  { level: 2, label: "Master's", re: /\b(master'?s?|m\.\s?s\.|m\.?\s?tech|m\.?\s?sc|mba|m\.?\s?eng|mca|ms\s+(?:in|degree)|ms\/phd)\b/i },
  { level: 1, label: "Bachelor's", re: /\b(bachelor'?s?|b\.\s?s\.|b\.?\s?tech|b\.?\s?sc|b\.?\s?e\.?\b|b\.?\s?eng|bca|undergraduate degree|bs\/ms|bs\s+(?:in|degree)|ba\/bs|4[\s-]*year degree|college degree|university degree|degree in (?:computer|engineering|a related))\b/i },
];
function degreeLevel(text) {
  for (const d of DEGREE_LEVELS) if (d.re.test(text)) return d;
  return null;
}

/** Parse a job description once; reused for every resume edit. */
export function analyzeJob(job) {
  const text = normalizeText(job.description || '');
  const title = (job.title || '').trim();
  const lines = sectionizeJob(text);
  const skills = new Map();
  const add = (name, tier, n = 1) => {
    const e = skills.get(name) || { name, tierWeight: 0, tiers: new Set(), count: 0 };
    e.tierWeight = Math.max(e.tierWeight, TIER_WEIGHT[tier]); e.tiers.add(tier); e.count += n;
    skills.set(name, e);
  };
  for (const o of findSkillOccurrences(text)) add(o.name, tierAt(lines, o.index));
  for (const o of findSkillOccurrences(title)) add(o.name, 'title');

  for (const e of skills.values()) {
    const sk = SKILL_BY_NAME.get(e.name);
    e.cat = sk.cat; e.generic = !!sk.generic;
    e.importance = e.tierWeight >= 3 ? 'must' : e.tierWeight >= 2 ? 'important' : 'nice';
    e.weight = (e.tierWeight + Math.min(0.5 * (e.count - 1), 1)) * (e.generic ? 0.35 : 1);
  }

  const years = extractJobYears(text, lines);
  const sen = seniorityOf(title);
  const degree = degreeLevel(text.split('\n').filter((_, i) => lines[i]?.tier !== 'company').join('\n'));
  const degreeFlexible = /(or equivalent|equivalent (?:practical |work )?experience|or related experience|or similar experience)/i.test(text);

  // ATS keywords: frequent meaningful terms that are not already covered by skill detection.
  const skillWords = new Set();
  for (const n of skills.keys()) for (const a of SKILL_BY_NAME.get(n).aliases) a.split(/\s+/).forEach(w => skillWords.add(stem(w)));
  const freq = new Map();
  const bodyText = lines.filter(l => l.tier !== 'company').map(l => l.text).join('\n') + '\n' + title + '\n' + title;
  const toks = tokenize(bodyText);
  for (let i = 0; i < toks.length; i++) {
    const s = stem(toks[i]);
    if (s.length < 3 || skillWords.has(s) || /^\d/.test(s)) continue;
    const e = freq.get(s) || { word: toks[i], n: 0 }; e.n++; freq.set(s, e);
  }
  const keywords = [...freq.entries()].filter(([, v]) => v.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 20).map(([s, v]) => ({ stem: s, word: v.word, n: v.n }));

  return { title, company: job.company || '', text, lines, skills, years, seniority: sen, degree, degreeFlexible, keywords };
}

/* ------------------------------------------------------------------ */
/* Resume facts                                                         */
/* ------------------------------------------------------------------ */

// Date tokens: "Sep 2025", "September, 2025", "Sep '25", "09/2025", "2025-09", "2025", "Present"/"Current"/"Now".
const DATE_TOKEN = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s*['’]?\s*((?:19|20)\d{2}|\d{2})(?!\d)|(\d{1,2})\s*[\/.\-]\s*((?:19|20)\d{2})(?!\d)|((?:19|20)\d{2})\s*[\/.\-]\s*(\d{1,2})(?![\d\/.\-])|((?:19|20)\d{2})(?!\d)|(present|current(?:ly)?|now|today|till\s+(?:date|now)|to\s+date|ongoing))\b/gi;
const RANGE_SEP = /^\s*(?:-|–|—|‒|~|→|to|until|till|through|thru)\s*$/i;

function tokenMonth(m) {
  const now = new Date();
  if (m[8]) return { now: true, v: now.getFullYear() * 12 + now.getMonth() };
  if (m[1]) { let y = +m[2]; if (y < 100) y += y > (now.getFullYear() % 100) + 1 ? 1900 : 2000; return { v: y * 12 + (MONTHS[m[1].toLowerCase().slice(0, 3)] ?? 0), month: true }; }
  if (m[3]) return { v: +m[4] * 12 + Math.max(0, Math.min(11, +m[3] - 1)), month: true };
  if (m[5]) return { v: +m[5] * 12 + Math.max(0, Math.min(11, +m[6] - 1)), month: true };
  return { v: +m[7] * 12, month: false };
}

/** Find employment date ranges. Returns [{start, end, label}] in months since year 0 (unmerged). */
export function experienceRanges(text) {
  const now = new Date();
  const nowM = now.getFullYear() * 12 + now.getMonth();
  const toks = [];
  DATE_TOKEN.lastIndex = 0; let m;
  while ((m = DATE_TOKEN.exec(text))) toks.push({ i: m.index, end: m.index + m[0].length, ...tokenMonth(m) });
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const a = toks[k], b = toks[k + 1];
    if (a.now) continue;
    let e = null, stop = a.end;
    if (b && RANGE_SEP.test(text.slice(a.end, b.i))) { e = b.now ? nowM : b.v + (b.month ? 1 : 0); stop = b.end; k++; }
    else if (/^\s*(?:-|–|—|to)\s*(?:\n|$)/.test(text.slice(a.end, a.end + 12)) || /\b(?:since|from)\s*$/i.test(text.slice(Math.max(0, a.i - 8), a.i))) e = nowM; // "Sep 2025 –" / "Since Sep 2025"
    if (e == null) continue;
    const s = a.v;
    if (e > s && e - s < 45 * 12 && s <= nowM) {
      const ls = text.lastIndexOf('\n', a.i) + 1, le = text.indexOf('\n', stop);
      out.push({ start: s, end: Math.min(e, nowM), label: text.slice(ls, le < 0 ? undefined : le).trim().slice(0, 140) });
    }
  }
  return out;
}

export function experienceIntervals(text) {
  const iv = experienceRanges(text).map(r => [r.start, r.end]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const x of iv) { const last = merged[merged.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else merged.push([...x]); }
  return merged;
}

/** Text of work-history sections (falls back to everything except education-like sections). */
export function workText(resumeText, sections) {
  const exp = (sections || []).filter(s => s.kind === 'experience').map(s => s.body).join('\n');
  if (exp.trim()) return exp;
  const other = (sections || []).filter(s => !['education', 'certifications', 'awards', 'projects'].includes(s.kind)).map(s => s.body).join('\n');
  return other.trim() ? other : resumeText;
}

export function candidateYears(resumeText, sections, profileYears, aiYears, importedYears) {
  if (profileYears !== undefined && profileYears !== null && profileYears !== '' && !isNaN(+profileYears)) return { years: +profileYears, source: 'your profile' };
  const months = experienceIntervals(workText(resumeText, sections)).reduce((a, [s, e]) => a + (e - s), 0);
  const computed = Math.round((months / 12) * 10) / 10;
  const claim = resumeText.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs)(?:\s+of)?\s+(?:\w+\s+){0,3}?experience/i);
  const claimed = claim ? +claim[1] : 0;
  // LinkedIn's work history is usually more complete than the resume (internships, older roles).
  if (importedYears > Math.max(computed, claimed)) return { years: importedYears, source: 'LinkedIn' };
  if (claimed && claimed > computed) return { years: claimed, source: 'stated in resume' };
  if (!computed && aiYears > 0) return { years: Math.round(aiYears * 10) / 10, source: 'AI' };
  return { years: computed, source: computed ? 'from resume dates' : 'unknown' };
}

/** Profile merged with what was auto-detected (AI layer) and imported (GitHub, LinkedIn). */
export function effectiveProfile(resume, profile = {}, data = {}) {
  const d = resume?.detected || {};
  const imported = (data?.skills || []).map(s => s.name || s);
  return { ...profile, aiSkills: [...(d.aiSkills || []), ...imported], aiYears: d.aiYears || 0, importedYears: data?.years || 0 };
}

const TITLE_SYN = [[/\bdeveloper\b|\bdev\b|\bprogrammer\b/g, 'engineer'], [/\bsr\.?\b/g, 'senior'], [/\bjr\.?\b/g, 'junior'], [/\bswe\b|\bsde\b/g, 'software engineer'],
  [/front[\s-]*end/g, 'frontend'], [/back[\s-]*end/g, 'backend'], [/full[\s-]*stack/g, 'fullstack'], [/\bml\b/g, 'machine learning'], [/\bqa\b/g, 'quality'], [/\bdevops\b/g, 'devops']];
const TITLE_NOISE = new Set(['senior', 'junior', 'lead', 'staff', 'principal', 'ii', 'iii', 'iv', 'i', 'the', 'and', 'of', 'for', 'remote', 'hybrid', 'with', 'm/f/d', 'f/m/d', 'level', 'mid', 'sde', 'engineer']);
function titleTokens(t = '') {
  let s = t.toLowerCase();
  for (const [re, r] of TITLE_SYN) s = s.replace(re, r);
  return new Set(s.replace(/[^a-z0-9+#\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !TITLE_NOISE.has(w)));
}

/* ------------------------------------------------------------------ */
/* Matching                                                             */
/* ------------------------------------------------------------------ */

const W = { skills: 0.55, experience: 0.15, keywords: 0.15, title: 0.10, education: 0.05 };

export function matchJob(jobA, resume) {
  const { text: resumeText = '', sections = [], profile = {} } = resume;
  const cand = candidateSkills(resumeText, profile);
  const candFamilies = new Map();
  for (const n of [...cand.direct.keys(), ...cand.implied.keys()]) {
    const f = SKILL_BY_NAME.get(n)?.fam; if (f && !candFamilies.has(f)) candFamilies.set(f, n);
  }

  // --- skills
  const rows = [];
  let wSum = 0, got = 0;
  for (const e of jobA.skills.values()) {
    let credit = 0, status = 'missing', via = null;
    if (cand.direct.has(e.name)) { credit = 1; status = 'matched'; }
    else if (cand.implied.has(e.name)) { credit = 0.85; status = 'implied'; via = cand.implied.get(e.name); }
    else {
      const f = SKILL_BY_NAME.get(e.name).fam;
      if (f && candFamilies.has(f)) { credit = 0.4; status = 'related'; via = candFamilies.get(f); }
    }
    wSum += e.weight; got += e.weight * credit;
    rows.push({ ...e, tiers: [...e.tiers], credit, status, via });
  }
  rows.sort((a, b) => b.weight - a.weight);
  const skillScore = wSum ? got / wSum : null;

  // --- experience
  const cy = candidateYears(resumeText, sections, profile.yearsExperience, profile.aiYears, profile.importedYears);
  let reqYears = jobA.years?.min ?? null, yearsInferred = false;
  if (reqYears == null && jobA.seniority && jobA.seniority.years > 0) { reqYears = jobA.seniority.years; yearsInferred = true; }
  let expScore = null;
  if (reqYears != null && cy.source !== 'unknown') {
    expScore = cy.years >= reqYears ? 1 : Math.max(0, cy.years / reqYears) ** 1.3;
    if (jobA.years?.max && cy.years > jobA.years.max + 4) expScore = 0.85; // likely over-qualified
  }

  // --- keywords
  const rStems = new Set(tokenize(`${resumeText} ${splitList(profile.extraSkills).join(' ')} ${splitList(profile.aiSkills).join(' ')}`).map(stem));
  const kwRows = jobA.keywords.map(k => ({ ...k, found: rStems.has(k.stem) }));
  const kwScore = kwRows.length ? kwRows.filter(k => k.found).length / kwRows.length : null;

  // --- title
  let titleScore = null;
  const jt = titleTokens(jobA.title);
  const candTitle = `${profile.targetTitle || ''} ${profile.headline || ''} ${resume.headline || ''} ${resumeText.slice(0, 400)}`;
  if (jt.size) {
    const ct = titleTokens(candTitle);
    titleScore = [...jt].filter(t => ct.has(t)).length / jt.size;
  }

  // --- education
  let eduScore = null;
  const rDeg = degreeLevel(resumeText);
  if (jobA.degree) {
    if (rDeg && rDeg.level >= jobA.degree.level) eduScore = 1;
    else if (rDeg) eduScore = jobA.degreeFlexible ? 0.8 : 0.5;
    else eduScore = jobA.degreeFlexible ? 0.6 : 0.2;
  }

  const parts = { skills: skillScore, experience: expScore, keywords: kwScore, title: titleScore, education: eduScore };
  if (yearsInferred && expScore != null) parts.experienceWeightFactor = 0.5;
  let tw = 0, ts = 0;
  for (const [k, w0] of Object.entries(W)) {
    if (parts[k] == null) continue;
    let w = w0;
    if (k === 'experience' && yearsInferred) w *= 0.5;
    if (k === 'keywords' && skillScore == null) w += W.skills; // non-tech job: lean on keywords
    tw += w; ts += w * parts[k];
  }
  let score = tw ? Math.round((ts / tw) * 100) : 0;

  // Strictness: a missing must-have caps the score.
  const mustMissing = rows.filter(r => r.importance === 'must' && !r.generic && r.status === 'missing');
  if (mustMissing.length >= 3) score = Math.min(score, 55);
  else if (mustMissing.length >= 1) score = Math.min(score, 75);

  const verdict = score >= 80 ? 'Strong match' : score >= 65 ? 'Good match' : score >= 50 ? 'Fair match' : score >= 35 ? 'Weak match' : 'Poor match';

  const extraResumeSkills = [...cand.direct.keys()].filter(n => !jobA.skills.has(n));
  const result = {
    score, verdict, parts,
    skills: rows,
    keywords: kwRows,
    years: { required: reqYears, inferred: yearsInferred, preferredOnly: !!jobA.years?.preferredOnly, max: jobA.years?.max ?? null, snippet: jobA.years?.snippet || '', candidate: cy.years, source: cy.source },
    education: { required: jobA.degree?.label || null, flexible: jobA.degreeFlexible, candidate: rDeg?.label || null },
    seniority: jobA.seniority?.level || null,
    extraResumeSkills,
    jobTitle: jobA.title,
  };
  result.suggestions = buildSuggestions(result, resume);
  return result;
}

/* ------------------------------------------------------------------ */
/* Rule-based suggestions                                               */
/* ------------------------------------------------------------------ */

const WEAK_PHRASES = /\b(responsible for|worked on|helped(?: with)?|assisted(?: in| with)?|involved in|participated in|duties included|tasked with)\b/gi;

export function resumeHealth(resume) {
  const { text = '', sections = [], profile = {} } = resume;
  const issues = [];
  const bullets = text.split('\n').filter(l => BULLET_RE.test(l) && l.trim().length > 15);
  const quantified = bullets.filter(b => /\d|%|\$|₹|€|£/.test(b));
  const words = (text.match(/\S+/g) || []).length;
  const kinds = new Set(sections.map(s => s.kind));
  if (!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text + (profile.email || ''))) issues.push({ level: 'warn', text: 'No email address found in the resume header.' });
  if (!/(\+?\d[\d\s().-]{7,}\d)/.test(text + (profile.phone || ''))) issues.push({ level: 'tip', text: 'No phone number detected — most recruiters expect one.' });
  if (!/linkedin\.com\//i.test(text + (profile.linkedin || ''))) issues.push({ level: 'tip', text: 'Add your LinkedIn URL to the header.' });
  if (!kinds.has('experience')) issues.push({ level: 'warn', text: 'Could not find an "Experience" section heading. ATS parsers rely on standard headings.' });
  if (!kinds.has('skills')) issues.push({ level: 'warn', text: 'Add a dedicated "Skills" section — ATS keyword matching looks there first.' });
  if (!kinds.has('education')) issues.push({ level: 'tip', text: 'No "Education" section detected.' });
  if (bullets.length >= 4 && quantified.length / bullets.length < 0.4) issues.push({ level: 'warn', text: `Only ${quantified.length}/${bullets.length} bullets contain numbers. Quantify impact (%, time saved, users, revenue, latency).` });
  const weak = (text.match(WEAK_PHRASES) || []).length;
  if (weak) issues.push({ level: 'tip', text: `${weak} weak phrase(s) like "responsible for / worked on". Start bullets with strong verbs: Built, Led, Reduced, Shipped, Designed.` });
  if (words > 1100) issues.push({ level: 'tip', text: `Resume is long (~${words} words). Aim for 1–2 pages (450–900 words).` });
  if (words && words < 250) issues.push({ level: 'warn', text: `Resume is short (~${words} words). Add more detail on impact and technologies.` });
  if (bullets.some(b => /\b(I|me|my)\b/.test(b.replace(BULLET_RE, '')))) issues.push({ level: 'tip', text: 'Avoid first-person pronouns (I, my) in bullets.' });
  return { issues, bullets: bullets.length, quantified: quantified.length, words };
}

function buildSuggestions(r, resume) {
  const out = [];
  const must = r.skills.filter(s => s.status === 'missing' && s.importance === 'must' && !s.generic);
  const imp = r.skills.filter(s => s.status === 'missing' && s.importance === 'important' && !s.generic);
  const related = r.skills.filter(s => s.status === 'related' && s.importance !== 'nice');
  const implied = r.skills.filter(s => s.status === 'implied' && s.importance !== 'nice');
  if (must.length) out.push({ level: 'critical', text: `Missing must-have skills: ${must.map(s => s.name).join(', ')}. If you have used them, add them explicitly to Skills and to a bullet that shows how.` });
  if (imp.length) out.push({ level: 'warn', text: `Important skills not found: ${imp.map(s => s.name).join(', ')}.` });
  for (const s of related.slice(0, 4)) out.push({ level: 'tip', text: `Job asks for ${s.name}; you list ${s.via}. Mention transferable experience, or ${s.name} itself if you have touched it.` });
  if (implied.length) out.push({ level: 'tip', text: `Name these explicitly (only implied right now): ${implied.map(s => `${s.name} (via ${s.via})`).join(', ')}. ATS systems match literal words.` });
  const y = r.years;
  if (y.required != null && y.candidate < y.required) out.push({ level: y.required - y.candidate > 2 ? 'critical' : 'warn', text: `Job ${y.inferred ? 'implies (from seniority)' : 'asks for'} ${y.required}+ years; you show ~${y.candidate} (${y.source}). Highlight internships, freelance and project work with dates, or set your years in Profile.` });
  if (r.education.required && !r.education.candidate) out.push({ level: r.education.flexible ? 'tip' : 'warn', text: `Job mentions a ${r.education.required} degree${r.education.flexible ? ' (or equivalent experience)' : ''}; no degree detected in your resume.` });
  const missingKw = r.keywords.filter(k => !k.found).slice(0, 8);
  if (missingKw.length) out.push({ level: 'tip', text: `Frequent job terms absent from your resume: ${missingKw.map(k => k.word).join(', ')}. Mirror the employer's wording where truthful.` });
  if (r.parts.title != null && r.parts.title < 0.5) out.push({ level: 'tip', text: `Your headline/title doesn't echo the job title "${r.jobTitle || ''}". Consider aligning your resume headline.`.replace(' ""', '') });
  out.push(...resumeHealth(resume).issues);
  return out;
}


/* ------------------------------------------------------------------ */
/* Guard: is this "job" actually the user's own resume or portfolio?    */
/* ------------------------------------------------------------------ */
const hostOf = u => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

export function isOwnContent(job, resumeText = '', profile = {}) {
  // 1) The user's own sites (portfolio, GitHub/LinkedIn profile pages).
  const host = hostOf(job.url || '');
  const own = [profile.portfolio].map(hostOf).filter(Boolean);
  if (host && own.includes(host)) return 'portfolio';
  const path = (() => { try { return new URL(job.url).pathname.toLowerCase(); } catch { return ''; } })();
  for (const k of ['github', 'linkedin']) {
    const p = profile[k] && (() => { try { return new URL(/^https?:/.test(profile[k]) ? profile[k] : 'https://' + profile[k]).pathname.toLowerCase().replace(/\/$/, ''); } catch { return ''; } })();
    if (p && p.length > 3 && host.endsWith(k + '.com') && path.startsWith(p)) return 'profile';
  }
  const text = (job.description || '').toLowerCase();
  // 2) Contact details that belong to the user.
  const email = (profile.email || '').toLowerCase();
  if (email && text.includes(email)) return 'resume';
  const phone = (profile.phone || '').replace(/\D/g, '');
  const digits = text.replace(/\D/g, '');
  const name = (profile.name || '').toLowerCase().trim();
  const hits = [name && name.length > 4 && text.includes(name), phone.length >= 8 && digits.includes(phone.slice(-8))].filter(Boolean).length;
  if (hits >= 2) return 'resume';
  // 3) Large verbatim overlap with the resume (5-word shingles).
  const shingles = t => { const w = t.toLowerCase().match(/[a-z0-9+#.]+/g) || []; const s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s; };
  const r = shingles(resumeText), j = shingles(text);
  if (j.size >= 20 && r.size >= 20) {
    let common = 0; for (const x of j) if (r.has(x)) common++;
    if (common / j.size > 0.3) return 'resume';
  }
  return null;
}
