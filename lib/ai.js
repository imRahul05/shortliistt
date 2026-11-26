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

export function aiCoverLetter({ jobA, resumeText, profile }, opts) {
  return ask(SYSTEM, `${jobBrief(jobA)}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3200)}\n\nCandidate name: ${profile.name || '[Your Name]'}\n\nWrite a concise cover letter (max 230 words, 3 short paragraphs) for this job. Paragraph 1: role + why this company (use only facts from the job text). Paragraph 2: 2-3 most relevant achievements from the resume, mapped to the job's requirements. Paragraph 3: short close. Start with "Dear Hiring Manager," and end with "Sincerely," and the candidate name.`, opts);
}

export function aiAnswer({ jobA, resumeText, question }, opts) {
  return ask(SYSTEM, `${jobA ? jobBrief(jobA) : ''}\n\nCANDIDATE RESUME:\n${clip(resumeText, 3200)}\n\nApplication form question: "${question}"\n\nWrite the candidate's answer in first person, 60-140 words, specific and grounded only in the resume and job text. Use [placeholders] for facts you don't know. Output only the answer.`, opts);
}
