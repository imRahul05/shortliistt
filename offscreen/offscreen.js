// Hidden extension page: runs Chrome's built-in AI (Prompt API needs a document context) for the floating card.
import { analyzeJob, matchJob, effectiveProfile } from '../lib/matcher.js';
import { aiAvailability, aiInsights } from '../lib/ai.js';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'ai-insights') return;
  (async () => {
    const state = await aiAvailability();
    if (state !== 'available') return reply({ error: state });
    const { resume, profile = {} } = await chrome.storage.local.get(['resume', 'profile']);
    if (!resume?.text) return reply({ error: 'noresume' });
    const jobA = analyzeJob(msg.job);
    const match = matchJob(jobA, { text: resume.text, sections: resume.sections, profile: effectiveProfile(resume, profile) });
    const text = await aiInsights({ jobA, resumeText: resume.text, match });
    reply({ text });
  })().catch(e => reply({ error: 'failed', message: String(e?.message || e) }));
  return true;
});
