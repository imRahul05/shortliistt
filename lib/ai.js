// Optional on-device AI via Chrome's built-in Prompt API (Gemini Nano). Free, local, no API key.
// Everything in Shortlist works without it; AI only adds rewriting/insights when the browser supports it.

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
  downloadable: 'On-device AI available — one-time model download',
  downloading: 'On-device AI model downloading…',
  available: 'On-device AI ready (Gemini Nano, runs locally)',
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

export async function ask(system, prompt, { onChunk, schema, signal, onProgress } = {}) {
  const s = await createSession(system, { onProgress, signal });
  try {
    if (schema) return await s.prompt(prompt, { responseConstraint: schema, signal });
    if (onChunk && s.promptStreaming) {
      let acc = '';
      for await (const c of s.promptStreaming(prompt, { signal })) {
        acc = acc && c.startsWith(acc) ? c : acc + c; // handles both cumulative (old) and delta (new) chunks
        onChunk(acc);
      }
      return acc;
    }
    return await s.prompt(prompt, { signal });
  } finally { s.destroy?.(); }
}

export const downloadModel = onProgress => createSession('Ready.', { onProgress }).then(s => s.destroy?.());

/* ---------------- Prompts ---------------- */

const SYSTEM = `You are Shortlist, a precise career coach and resume writer for software and tech roles.
Hard rules:
- Never invent employers, job titles, dates, degrees, certifications, metrics or skills that are not in the candidate's resume.
- If something is missing, say so or leave a [placeholder] for the candidate to fill in.
- Be concise, concrete and professional. No preamble, no closing remarks.`;

const clip = (s = '', n = 3500) => (s.length > n ? s.slice(0, n) + '\n…' : s);

function jobBrief(jobA) {
  const keep = jobA.lines.filter(l => l.tier !== 'company').map(l => l.text).join('\n');
  return `JOB TITLE: ${jobA.title || 'n/a'}\nCOMPANY: ${jobA.company || 'n/a'}\nJOB DESCRIPTION:\n${clip(keep, 3200)}`;
}
const matchBrief = m => `RULE-BASED MATCH: ${m.score}/100. Matched skills: ${m.skills.filter(s => s.status === 'matched').map(s => s.name).join(', ') || 'none'}. Missing: ${m.skills.filter(s => s.status === 'missing').map(s => `${s.name} (${s.importance})`).join(', ') || 'none'}.`;

export function aiInsights({ jobA, resumeText, match }, opts) {
  return ask(SYSTEM, `${jobBrief(jobA)}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3000)}\n\n${matchBrief(match)}\n\nGive a short honest assessment in Markdown with these headings: **Fit** (2 sentences), **Strengths** (3 bullets), **Gaps** (up to 3 bullets), **Do this before applying** (3 specific bullets). Max 170 words.`, opts);
}

export function aiSummary({ jobA, resumeText, match }, opts) {
  return ask(SYSTEM, `${jobBrief(jobA)}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3200)}\n\n${matchBrief(match)}\n\nWrite a 3-sentence professional resume summary tailored to this job. Lead with the candidate's real title and years of experience, mention the most relevant matched skills, and reflect the job's priorities. Only use facts from the resume. Output only the summary text, no quotes, no first-person pronouns.`, opts);
}

export async function aiBullets({ jobA, bullets }, opts = {}) {
  const schema = { type: 'object', properties: { bullets: { type: 'array', items: { type: 'string' } } }, required: ['bullets'] };
  const prompt = `${jobBrief(jobA)}\n\nRewrite each resume bullet below to better match this job: start with a strong action verb, surface relevant technologies that are ALREADY mentioned in the bullet, keep every fact and number unchanged, keep each under 30 words. Do not add new facts. If a bullet lacks a metric, append a short [add metric] placeholder.\nReturn JSON {"bullets": [...]} with exactly ${bullets.length} items in the same order.\n\nBULLETS:\n${bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;
  let raw;
  try { raw = await ask(SYSTEM, prompt, { ...opts, schema }); }
  catch { raw = await ask(SYSTEM, prompt, opts); }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
    if (Array.isArray(j.bullets)) return j.bullets.map(b => String(b).replace(/^[-•*\d.\s]+/, '').trim());
  } catch { /* fall back to line parsing */ }
  return raw.split('\n').map(l => l.replace(/^[-•*\d.\s]+/, '').trim()).filter(Boolean).slice(0, bullets.length);
}

export function aiCoverLetter({ jobA, resumeText, profile = {}, match, highlights = [] }, opts) {
  const facts = [
    `Name: ${profile.name || '[Your Name]'}`,
    profile.targetTitle && `Current title: ${profile.targetTitle}`,
    profile.currentCompany && `Current company: ${profile.currentCompany}`,
    match?.years?.candidate ? `Years of experience: ${match.years.candidate}` : '',
    profile.location && `Location: ${profile.location}`,
    match ? `Skills that match the job: ${match.skills.filter(s => s.status === 'matched' || s.status === 'implied').map(s => s.name).join(', ') || 'none'}` : '',
    match ? `Job skills the candidate does NOT have (do not claim them): ${match.skills.filter(s => s.status === 'missing').map(s => s.name).join(', ') || 'none'}` : '',
    highlights.length ? `Most relevant achievements:\n${highlights.map(h => '- ' + h).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return ask(SYSTEM, `${jobBrief(jobA)}\n\nCANDIDATE FACTS:\n${facts}\n\nFULL RESUME:\n${clip(resumeText, 3000)}\n\nWrite a tailored cover letter body (230-300 words, 4 short paragraphs):\n1. The exact role and company, who the candidate is (title, years, current company) in one or two sentences.\n2. Two concrete achievements from the resume that map to the job's main requirements; keep their numbers.\n3. One relevant project or extra strength, and why it matters for this team (use only facts from the job text about the company).\n4. A short, confident close.\nStart with "Dear Hiring Manager," and end with "Sincerely," then the name on its own line. Plain text, no placeholders unless a fact is truly unknown, no headings.`, opts);
}

export function aiAnswer({ jobA, resumeText, question }, opts) {
  return ask(SYSTEM, `${jobA ? jobBrief(jobA) : ''}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3200)}\n\nApplication form question: "${question}"\n\nWrite the candidate's answer in first person, 60-140 words, specific and grounded only in the resume and job text. Use [placeholders] for facts you don't know. Output only the answer.`, opts);
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
