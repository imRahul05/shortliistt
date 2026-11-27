// Optional on-device AI via Chrome's built-in Prompt API (Gemini Nano). Free, local, no API key.
// Everything in Shortlist works without it; AI only adds rewriting/insights when the browser supports it.

import { WRITING_GUIDE, candidateFacts, fillValues, cleanAI } from './ai-guide.js';

const LM = () => globalThis.LanguageModel || globalThis.ai?.languageModel || null;
const IO = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

/** 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available' */
export async function aiAvailability() {
  const lm = LM();
  if (!lm) return 'unsupported';
  try {
    if (lm.availability) return await lm.availability(IO);
    if (lm.capabilities) {
      const c = await lm.capabilities();
      return c.available === 'readily' ? 'available' : c.available === 'after-download' ? 'downloadable' : 'unavailable';
    }
  } catch {
    try { return await lm.availability(); } catch { /* fallthrough */ }
  }
  return 'unavailable';
}

export const AI_LABEL = {
  unsupported: 'Rule-based mode (this Chrome has no built-in AI)',
  unavailable: 'Rule-based mode (built-in AI not available on this device)',
  downloadable: 'AI available — one-time setup download',
  downloading: 'AI is downloading…',
  available: 'AI ready (Chrome built-in Gemini Nano)',
};

async function createSession(system, { onProgress, signal } = {}) {
  const lm = LM();
  if (!lm) throw new Error('Built-in AI is not available in this browser.');
  const opts = {
    ...IO, signal,
    initialPrompts: [{ role: 'system', content: system }],
    monitor(m) { m.addEventListener('downloadprogress', e => onProgress?.(e.loaded)); },
  };
  try { return await lm.create(opts); }
  catch (e) {
    if (e?.name === 'NotSupportedError' || /language|expected/i.test(e?.message || '')) {
      delete opts.expectedInputs; delete opts.expectedOutputs;
      return lm.create(opts);
    }
    throw e;
  }
}

export async function ask(system, prompt, { onChunk, schema, signal, onProgress, fill } = {}) {
  const s = await createSession(system, { onProgress, signal });
  const out = t => (fill ? cleanAI(t, fill) : t);
  try {
    if (schema) return await s.prompt(prompt, { responseConstraint: schema, signal });
    if (onChunk && s.promptStreaming) {
      let acc = '';
      for await (const c of s.promptStreaming(prompt, { signal })) {
        acc = acc && c.startsWith(acc) ? c : acc + c; // handles both cumulative (old) and delta (new) chunks
        onChunk(out(acc));
      }
      return out(acc);
    }
    return out(await s.prompt(prompt, { signal }));
  } finally { s.destroy?.(); }
}

export const downloadModel = onProgress => createSession('Ready.', { onProgress }).then(s => s.destroy?.());

/* ---------------- Prompts ---------------- */

const SYSTEM = WRITING_GUIDE;

const clip = (s = '', n = 3500) => (s.length > n ? s.slice(0, n) + '\n…' : s);

function jobBrief(jobA) {
  const keep = jobA.lines.filter(l => l.tier !== 'company').map(l => l.text).join('\n');
  return `JOB TITLE: ${jobA.title || 'n/a'}\nCOMPANY: ${jobA.company || 'n/a'}\nJOB DESCRIPTION:\n${clip(keep, 3200)}`;
}
const matchBrief = m => `RULE-BASED MATCH: ${m.score}/100. Matched skills: ${m.skills.filter(s => s.status === 'matched').map(s => s.name).join(', ') || 'none'}. Missing: ${m.skills.filter(s => s.status === 'missing').map(s => `${s.name} (${s.importance})`).join(', ') || 'none'}.`;

export function aiInsights({ jobA, resumeText, match, profile = {} }, opts = {}) {
  const first = (profile.name || '').trim().split(/\s+/)[0];
  return ask(SYSTEM, `${candidateFacts(profile, match)}\n\n${jobBrief(jobA)}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3000)}\n\n${matchBrief(match)}\n\nWrite to the candidate directly as "you"${first ? ` and address them as ${first} once, in the first sentence` : ''}. Give a short honest assessment in Markdown with these headings: **Fit** (2 sentences, mention the role and company by name), **Strengths** (3 bullets, each tied to a requirement of this job), **Gaps** (up to 3 bullets), **Do this before applying** (3 specific bullets). Max 170 words.`, { ...opts, fill: fillValues(profile, jobA) });
}

export function aiSummary({ jobA, resumeText, match, profile = {} }, opts = {}) {
  return ask(SYSTEM, `${candidateFacts(profile, match)}\n\n${jobBrief(jobA)}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3200)}\n\n${matchBrief(match)}\n\nWrite a 3-sentence professional resume summary tailored to this job. Lead with the candidate's real title and years of experience from CANDIDATE FACTS, mention the most relevant matched skills, and reflect the job's priorities. Only use facts from the resume. Output only the summary text: no quotes, no first-person pronouns, no name.`, { ...opts, fill: fillValues(profile, jobA) });
}

export async function aiBullets({ jobA, bullets }, opts = {}) {
  const schema = { type: 'object', properties: { bullets: { type: 'array', items: { type: 'string' } } }, required: ['bullets'] };
  const prompt = `${jobBrief(jobA)}\n\nRewrite each resume bullet below to better match this job: start with a strong action verb, surface relevant technologies that are ALREADY mentioned in the bullet, keep every fact and number unchanged, keep each under 30 words. Do not add new facts, numbers or placeholders.\nReturn JSON {"bullets": [...]} with exactly ${bullets.length} items in the same order.\n\nBULLETS:\n${bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;
  let raw;
  try { raw = await ask(SYSTEM, prompt, { ...opts, schema }); }
  catch { raw = await ask(SYSTEM, prompt, opts); }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
    if (Array.isArray(j.bullets)) return j.bullets.map(b => cleanAI(String(b).replace(/^[-•*\d.\s]+/, '').trim()));
  } catch { /* fall back to line parsing */ }
  return raw.split('\n').map(l => cleanAI(l.replace(/^[-•*\d.\s]+/, '').trim())).filter(Boolean).slice(0, bullets.length);
}

export function aiCoverLetter({ jobA, resumeText, profile = {}, match, highlights = [] }, opts = {}) {
  const facts = candidateFacts(profile, match) + (highlights.length ? `\nMost relevant achievements:\n${highlights.map(h => '- ' + h).join('\n')}` : '');
  return ask(SYSTEM, `${jobBrief(jobA)}\n\n${facts}\n\nFULL RESUME:\n${clip(resumeText, 3000)}\n\nWrite a tailored cover letter body (230-300 words, 4 short paragraphs):\n1. The exact role and company, who the candidate is (title, years, current company) in one or two sentences.\n2. Two concrete achievements from the resume that map to the job's main requirements; keep their numbers.\n3. One relevant project or extra strength, and why it matters for this team (use only facts from the job text about the company).\n4. A short, confident close.\nStart with "Dear Hiring Manager," and end with "Sincerely," then ${profile.name ? `"${profile.name}"` : 'the candidate\'s name'} on its own line. Plain text, no headings, no placeholders.`, { ...opts, fill: fillValues(profile, jobA) });
}

export function aiAnswer({ jobA, resumeText, question, profile = {}, match = null }, opts = {}) {
  return ask(SYSTEM, `${candidateFacts(profile, match)}\n\n${jobA ? jobBrief(jobA) : ''}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3200)}\n\nApplication form question: "${question}"\n\nWrite the candidate's answer in first person, 60-140 words, specific and grounded only in the resume and job text. If a detail is unknown, leave it out. Output only the answer.`, { ...opts, fill: fillValues(profile, jobA) });
}

/* ---------------- Structured extraction (AI layer on top of rule-based parsing) ---------------- */

async function askJSON(prompt, schema, opts = {}) {
  let raw;
  try { raw = await ask(SYSTEM, prompt, { ...opts, schema }); }
  catch { raw = await ask(SYSTEM, prompt + '\nReturn only JSON.', opts); }
  const m = String(raw).match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : raw);
}

/** Resume -> {currentTitle, totalYears, skills[], roles[]}. Used to fill gaps the rule-based parser missed. */
export function aiParseResume(resumeText, opts) {
  const schema = {
    type: 'object',
    properties: {
      currentTitle: { type: 'string' },
      totalYears: { type: 'number' },
      skills: { type: 'array', items: { type: 'string' } },
      roles: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, company: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, required: ['title', 'company', 'start', 'end'] } },
    },
    required: ['currentTitle', 'totalYears', 'skills', 'roles'],
  };
  const today = new Date().toISOString().slice(0, 7);
  return askJSON(`Today is ${today}. Extract from this resume:
- currentTitle: the most recent job title
- totalYears: total professional work experience in years (one decimal), counting "Present"/"Current" as ${today}; exclude education
- skills: every technical skill, tool, language, framework and platform mentioned (short canonical names, max 40)
- roles: each job with title, company, start and end as written (end "Present" if ongoing)
Use only what is written in the resume.

RESUME:
${clip(resumeText, 5000)}`, schema, opts);
}

/** Job description -> {mustHave[], niceToHave[], minYears}. Shown next to the deterministic score, never changes it. */
export function aiJobRequirements(jobA, opts) {
  const schema = {
    type: 'object',
    properties: {
      mustHave: { type: 'array', items: { type: 'string' } },
      niceToHave: { type: 'array', items: { type: 'string' } },
      minYears: { type: 'number' },
    },
    required: ['mustHave', 'niceToHave', 'minYears'],
  };
  return askJSON(`${jobBrief(jobA)}

List the concrete requirements of this job as short phrases (2-5 words each, e.g. "Kubernetes", "Payments domain experience", "On-call rotation"):
- mustHave: required skills, technologies, domain knowledge or certifications (max 12)
- niceToHave: preferred / bonus items (max 8)
- minYears: minimum years of experience required (0 if not stated)`, schema, opts);
}

/* ---------------- Tailoring: weave job keywords into real bullets, condense to fit ---------------- */

const BULLETS_SCHEMA = { type: 'object', properties: { edits: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, text: { type: 'string' } }, required: ['index', 'text'] } } }, required: ['edits'] };

function parseEdits(raw) {
  try { const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || raw); if (Array.isArray(j.edits)) return j.edits; } catch { /* below */ }
  return [];
}

/**
 * Rewrite a few existing bullets so they naturally mention job keywords the work genuinely involved.
 * bullets: [{i, text}] (i = caller's id). Returns [{i, text}] proposals; the caller verifies and shows them for review.
 */
export async function aiWeave({ jobA, bullets, terms, profile = {} }, opts = {}) {
  const list = bullets.map((b, k) => `${k + 1}. ${b.text}`).join('\n');
  const prompt = `${jobBrief(jobA)}

JOB KEYWORDS MISSING FROM THE RESUME: ${terms.join(', ')}

RESUME BULLETS:
${list}

Task: rewrite some of these bullets so they naturally include the missing keywords, to help the resume pass keyword screening for this job.
Rules:
- Only add a keyword to a bullet whose work clearly relates to it (e.g. "scalable" fits a bullet about handling growth; "Kubernetes" only fits a bullet about deployment or containers). Skip keywords that fit nowhere.
- Keep every fact, number, technology and company in the original bullet. Do not invent results.
- Keep the same meaning and roughly the same length (max 32 words). Start with an action verb.
- Each keyword at most once across all bullets. Change at most ${Math.min(bullets.length, Math.max(3, terms.length))} bullets.
Return JSON {"edits":[{"index": <bullet number>, "text": "<rewritten bullet>"}]}.`;
  let raw;
  try { raw = await ask(SYSTEM, prompt, { ...opts, schema: BULLETS_SCHEMA }); }
  catch { raw = await ask(SYSTEM, prompt + '\nReturn only JSON.', opts); }
  return parseEdits(raw).map(e => ({ i: bullets[(e.index | 0) - 1]?.i, text: cleanAI(String(e.text || '').replace(/^[-•*\d.\s]+/, '').trim(), fillValues(profile, jobA)) })).filter(e => e.i != null && e.text);
}

/** Shorten bullets (keep facts and numbers) so the resume fits on fewer pages. */
export async function aiCondense({ jobA, bullets }, opts = {}) {
  const prompt = `${jobA ? jobBrief(jobA) + '\n\n' : ''}Shorten each resume bullet below to at most 18 words. Keep every number, technology and result, keep the action verb, drop filler words. Keep words that match the job.
Return JSON {"edits":[{"index": <bullet number>, "text": "<shorter bullet>"}]} with one item per bullet.

BULLETS:
${bullets.map((b, k) => `${k + 1}. ${b.text}`).join('\n')}`;
  let raw;
  try { raw = await ask(SYSTEM, prompt, { ...opts, schema: BULLETS_SCHEMA }); }
  catch { raw = await ask(SYSTEM, prompt + '\nReturn only JSON.', opts); }
  return parseEdits(raw).map(e => ({ i: bullets[(e.index | 0) - 1]?.i, text: cleanAI(String(e.text || '').replace(/^[-•*\d.\s]+/, '').trim()) })).filter(e => e.i != null && e.text);
}
