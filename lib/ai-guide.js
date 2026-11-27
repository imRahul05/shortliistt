// Shortlist's AI "skill file": one writing guide shared by every prompt sent to Chrome's built-in model,
// plus the candidate's real facts, so answers are personal and never contain [placeholders].

export const WRITING_GUIDE = `You are Shortlist, a precise career coach and resume writer for software and tech roles.

FACTS
- Use only facts from the CANDIDATE FACTS, the resume and the job text. Never invent employers, titles, dates, degrees, certifications, metrics or skills.
- Use the candidate's real name, title, company and years from CANDIDATE FACTS wherever they are needed.

NO PLACEHOLDERS
- Never write square brackets or template placeholders such as [Your Name], [Company], [X years] or [add metric].
- If a detail is unknown, write the sentence without it. Do not ask the reader to fill anything in.

VOICE
- Plain, specific, confident English. Short sentences. No buzzwords ("synergy", "passionate", "rockstar", "leverage").
- No preamble ("Sure!", "Here is…") and no closing remarks. Output only what was asked.`;

/** The candidate facts block that goes into every prompt. */
export function candidateFacts(profile = {}, match = null) {
  const first = (profile.name || '').trim().split(/\s+/)[0] || '';
  const lines = [
    profile.name && `Name: ${profile.name}` + (first && first !== profile.name ? ` (first name: ${first})` : ''),
    profile.targetTitle && `Current title: ${profile.targetTitle}`,
    profile.currentCompany && `Current company: ${profile.currentCompany}`,
    match?.years?.candidate ? `Years of experience: ${match.years.candidate}` : profile.yearsExperience ? `Years of experience: ${profile.yearsExperience}` : '',
    profile.location && `Location: ${profile.location}`,
    profile.email && `Email: ${profile.email}`,
    match && `Skills that match this job: ${match.skills.filter(s => s.status === 'matched' || s.status === 'implied').map(s => s.name).join(', ') || 'none'}`,
    match && `Job skills the candidate does NOT have (never claim them): ${match.skills.filter(s => s.status === 'missing').map(s => s.name).join(', ') || 'none'}`,
  ].filter(Boolean);
  return lines.length ? `CANDIDATE FACTS:\n${lines.join('\n')}` : '';
}

/** Values used to fill any placeholder the model still writes. */
export function fillValues(profile = {}, jobA = null) {
  return {
    name: profile.name || '', first: (profile.name || '').trim().split(/\s+/)[0] || '',
    title: profile.targetTitle || '', company: jobA?.company || '', role: jobA?.title || '',
    current: profile.currentCompany || '', email: profile.email || '', phone: profile.phone || '', location: profile.location || '',
  };
}

const MAP = [
  [/^(your|candidate'?s?|applicant'?s?)?\s*(full\s*)?name$/i, 'name'],
  [/^(your\s*)?first\s*name$/i, 'first'],
  [/^(company|company name|hiring company|organization|employer)$/i, 'company'],
  [/^(job title|role|position|role title|position title)$/i, 'role'],
  [/^(your\s*)?(current\s*)?(job\s*)?title$/i, 'title'],
  [/^(your\s*)?current (company|employer)$/i, 'current'],
  [/^(your\s*)?email( address)?$/i, 'email'],
  [/^(your\s*)?phone( number)?$/i, 'phone'],
  [/^(your\s*)?(city|location)$/i, 'location'],
];

/** Replace known placeholders with real values; drop the rest cleanly. */
export function cleanAI(text = '', fill = {}) {
  let t = String(text).replace(/\[([^\]\n]{1,40})\](?!\()/g, (m, inner) => {
    if (/^https?:|^\d+$/.test(inner)) return m; // markdown links / citations are fine
    for (const [re, k] of MAP) if (re.test(inner.trim()) && fill[k]) return fill[k];
    return '\u0000';
  });
  // Tidy the gaps left by removed placeholders.
  t = t.replace(/\s*\(\s*(?:see|e\.g\.|eg|like|via)?\s*\u0000\s*\)/gi, '').replace(/[ \t]*\u0000[ \t]*([.,;:!?])/g, '$1').replace(/[ \t]*\u0000[ \t]*/g, ' ');
  t = t.split('\n').filter(l => !/^\s*([-*•]|\d+\.)\s*$/.test(l)).join('\n'); // bullets left empty
  return t.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\(\s*\)/g, '');
}
