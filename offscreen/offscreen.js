// Hidden extension page: runs Chrome's built-in AI (the Prompt API needs a document context) for the floating card.
// The card connects to it directly with a port and receives the answer as it streams.
import { analyzeJob, matchJob, effectiveProfile } from '../lib/matcher.js';
import { aiAvailability, aiInsights } from '../lib/ai.js';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target === 'offscreen' && msg.type === 'ping') { reply({ pong: true }); return false; }
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'shortlist-ai') return;
  port.onMessage.addListener(async msg => {
    if (msg?.type !== 'insights') return;
    const send = m => { try { port.postMessage(m); } catch { /* card closed */ } };
    try {
      const state = await aiAvailability();
      if (state !== 'available') return send({ error: state });
      const { resume, profile = {} } = await chrome.storage.local.get(['resume', 'profile']);
      if (!resume?.text) return send({ error: 'noresume' });
      const jobA = analyzeJob(msg.job);
      const match = matchJob(jobA, { text: resume.text, sections: resume.sections, profile: effectiveProfile(resume, profile) });
      const text = await aiInsights({ jobA, resumeText: resume.text, match }, { onChunk: t => send({ chunk: t }) });
      send({ done: true, text });
    } catch (e) {
      send({ error: 'failed', message: String(e?.message || e) });
    }
  });
});
