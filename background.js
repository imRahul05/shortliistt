// Service worker: scores jobs detected by the content script, sets the toolbar badge, opens the side panel.
import { analyzeJob, matchJob, effectiveProfile } from './lib/matcher.js';

const setup = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

let cache = null;
async function data() {
  cache ||= await chrome.storage.local.get(['resume', 'profile', 'settings']);
  return cache;
}
chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') cache = null; });

function summarize(job, m) {
  const must = m.skills.filter(s => s.importance === 'must' && !s.generic);
  const y = m.years;
  return {
    state: 'ok', score: m.score, verdict: m.verdict, title: job.title, company: job.company,
    mustHave: must.filter(s => s.status === 'matched' || s.status === 'implied').length, mustTotal: must.length,
    missing: m.skills.filter(s => s.status === 'missing' && !s.generic && s.importance !== 'nice').map(s => s.name),
    yearsLine: y.required != null ? `${y.required}+ yrs asked · you ${y.candidate}` : '',
  };
}

async function setBadge(tabId, score) {
  if (score == null) { await chrome.action.setBadgeText({ tabId, text: '' }); return; }
  const color = score >= 75 ? '#12804a' : score >= 55 ? '#b25e09' : '#c0322b';
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
  await chrome.action.setBadgeText({ tabId, text: String(score) });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;

  if (msg?.type === 'open-panel' && tabId != null) {
    // Must be called synchronously inside the user-gesture-triggered message handler.
    chrome.sidePanel.open({ tabId }).then(() => reply({ ok: true }), e => reply({ ok: false, error: e.message }));
    return true;
  }

  if (msg?.type === 'no-job' && tabId != null) { setBadge(tabId, null); return; }

  if (msg?.type === 'match' && msg.job) {
    (async () => {
      const { resume, profile = {} } = await data();
      // Let an open side panel pick up the job instantly (SPA navigations like LinkedIn).
      chrome.runtime.sendMessage({ type: 'job-detected', tabId, job: msg.job }).catch(() => {});
      if (!resume?.text) { await setBadge(tabId, null); return reply({ state: 'noresume' }); }
      const m = matchJob(analyzeJob(msg.job), { text: resume.text, sections: resume.sections, profile: effectiveProfile(resume, profile) });
      if (tabId != null) await setBadge(tabId, m.score);
      reply(summarize(msg.job, m));
    })().catch(e => reply({ state: 'error', error: String(e) }));
    return true;
  }
});
