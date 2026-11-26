// Cover letter generation. Template version is deterministic (no AI) and uses everything we know:
// profile, job, matched skills, the most job-relevant bullets from experience and projects.
import { findSkillOccurrences } from './matcher.js';
import { stripRich } from './resume-parser.js';
import { splitEntry } from './resume-model.js';
import { tokenize, stem } from './text.js';

const listJoin = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const lcFirst = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** First-person version of a resume bullet: "Built X" -> "I built X", "Developing X" -> "I'm developing X". */
export function firstPerson(b) {
  const t = stripRich(b).replace(/^[-•*]\s+/, '').replace(/\.$/, '').trim();
  const w = t.split(/\s+/)[0] || '';
  if (/^(I|My|We)\b/.test(t)) return t;
  if (/ing$/i.test(w)) return `I'm ${lcFirst(t)}`;
  if (/(ed|built|led|wrote|made|ran|drove|grew|won|shipped|set|cut|took|brought|taught|spoke|saw|kept|built)$/i.test(w)) return `I ${lcFirst(t)}`;
  return `I worked on ${lcFirst(t)}`;
}

/** Parse experience/project sections into entries {head, sub, tech, bullets[{text, r, skills}]} scored against the job. */
export function relevantEntries(model, jobA = { keywords: [], skills: new Map() }, kinds = ['experience']) {
  const kw = new Set(jobA.keywords.map(k => k.stem));
  const entries = [];
  let cur = null;
  for (const s of model.sections.filter(x => kinds.includes(x.kind))) {
    let after = true;
    for (const raw of s.body.split('\n')) {
      const line = raw.trim();
      if (!line) { after = true; continue; }
      if (/^[-•]\s+|^\*\s+/.test(line)) {
        if (!cur) { cur = { head: '', sub: '', tech: '', bullets: [], kind: s.kind }; entries.push(cur); }
        const plain = stripRich(line.replace(/^[-•*]\s+/, '')).replace(/[.\s]+$/, '');
        const skills = [...new Set(findSkillOccurrences(plain).map(o => o.name))];
        const r = skills.reduce((a, n) => a + (jobA.skills.get(n)?.weight || 0), 0) + tokenize(plain).map(stem).filter(x => kw.has(x)).length * 0.6 + (/\d/.test(plain) ? 0.8 : 0);
        cur.bullets.push({ text: plain, r, skills });
        after = true; continue;
      }
      const left = stripRich(splitEntry(line)[0]);
      if (after || !cur) {
        const [name, tech = ''] = left.split(/\s+\|\s+/);
        cur = { head: name.trim(), sub: '', tech: tech.trim(), bullets: [], kind: s.kind }; entries.push(cur);
      } else if (!cur.sub) cur.sub = left.trim();
      after = false;
    }
  }
  for (const e of entries) {
    e.bullets.sort((a, b) => b.r - a.r);
    e.r = e.bullets.slice(0, 2).reduce((a, b) => a + b.r, 0) + findSkillOccurrences(e.tech).reduce((a, o) => a + (jobA.skills.get(o.name)?.weight || 0), 0);
    // "Title — Company" / "Title, Company" on one line
    const split = e.head.match(/^(.*?)\s*(?:—|–| - |,| at | @ )\s*(.+)$/);
    e.company = e.kind === 'experience' ? (e.sub || (split ? split[2] : '')).replace(/\s*\(.*\)$/, '').trim() : '';
    e.role = e.kind === 'experience' ? (e.sub ? e.head : split ? split[1] : e.head) : '';
  }
  return entries;
}

const titleWords = t => t.split(/\s+/).map(w => (/^[A-Z0-9.+#/&-]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
const article = w => (/^[aeiou]/i.test(w) && !/^(uni|use|eu)/i.test(w) ? 'an' : 'a');
const sentence = t => t.replace(/[.\s]+$/, '') + '.';

export function templateLetter({ profile = {}, match, jobA, model }) {
  const name = profile.name || stripRich(model?.name || '') || '[Your Name]';
  const title = jobA.title || 'this role';
  const company = jobA.company || '';
  const me = titleWords(profile.targetTitle || stripRich(model?.headline || '').split(/[|•·,]/)[0].trim() || 'Software Engineer');
  const yrs = match.years.candidate >= 1 ? `${Math.floor(match.years.candidate)}+ years` : match.years.candidate > 0 ? 'over a year' : '';
  const must = match.skills.filter(s => (s.status === 'matched' || s.status === 'implied') && !s.generic).sort((a, b) => b.weight - a.weight).map(s => s.name);
  const exp = relevantEntries(model, jobA, ['experience']);
  const proj = relevantEntries(model, jobA, ['projects']).filter(e => e.bullets.length).sort((a, b) => b.r - a.r);
  const current = profile.currentCompany || exp[0]?.company || '';

  const p1 = `I'm applying for the ${title} position${company ? ` at ${company}` : ''}. I'm ${article(me)} ${me}${yrs ? ` with ${yrs} of experience` : ''}${must.length ? ` working with ${listJoin(must.slice(0, 4))}` : ''}${current ? `, currently at ${current}` : ''}.`;
  const best = exp.flatMap(e => e.bullets.map(b => ({ ...b, e }))).sort((a, b) => b.r - a.r).slice(0, 2);
  const p2 = best.length ? `${best[0].e.company ? `At ${best[0].e.company}, ` : ''}${lcFirst(sentence(firstPerson(best[0].text)))}${best[1] ? ' ' + sentence(firstPerson(best[1].text)) : ''}` : '';
  const pj = proj[0];
  const pjB = pj ? pj.bullets.slice().sort((a, b) => b.r - a.r)[0] : null;
  const p3 = pj && pjB ? `I also built ${pj.head.split(/\s+[–—-]\s+/)[0]}${pj.tech ? ` (${pj.tech})` : ''}, where ${lcFirst(sentence(firstPerson(pjB.text)))}` : '';
  const asked = must.slice(0, 3);
  const p4 = `${asked.length ? `Your posting asks for ${listJoin(asked)}, which is the stack I use day to day. ` : ''}I'd welcome the chance to talk about how I can contribute${company ? ` to ${company}` : ' to your team'}. Thank you for your time and consideration.`;
  return ['Dear Hiring Manager,', p1, p2, p3, p4, `Sincerely,\n${name}`].filter(Boolean).join('\n\n');
}

export function defaultLetterMeta(jobA) {
  return {
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    recipient: ['Hiring Manager', jobA?.company].filter(Boolean).join('\n'),
  };
}
