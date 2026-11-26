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

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen/offscreen.html', reasons: ['DOM_PARSER'], justification: 'Runs Chrome built-in AI (Prompt API), which needs a document, to show job insights on the page.' }).catch(e => { if (!/single offscreen/i.test(e.message)) throw e; });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (msg?.target === 'offscreen') return; // handled by the offscreen document

  if (msg?.type === 'ai-insights' && msg.job) {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'ai-insights', job: msg.job }))
      .then(r => reply(r || { error: 'failed' }), e => reply({ error: 'failed', message: e.message }));
    return true;
  }

  if (msg?.type === 'open-panel-with' && tabId != null) {
    chrome.storage.session.set({ pendingAction: msg.action });
    chrome.sidePanel.open({ tabId }).then(() => reply({ ok: true }), e => reply({ ok: false, error: e.message }));
    return true;
  }

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
      if (!resume?.text) {
        await setBadge(tabId, null);
        if (sender.frameId && tabId != null) chrome.tabs.sendMessage(tabId, { type: 'render', result: { state: 'noresume' }, job: msg.job }, { frameId: 0 }).catch(() => {});
        return reply({ state: 'noresume' });
      }
      const m = matchJob(analyzeJob(msg.job), { text: resume.text, sections: resume.sections, profile: effectiveProfile(resume, profile) });
      if (tabId != null) await setBadge(tabId, m.score);
      const sum = summarize(msg.job, m);
      // Job found inside an iframe (e.g. an embedded Greenhouse board): show the card in the top frame.
      if (sender.frameId && tabId != null) chrome.tabs.sendMessage(tabId, { type: 'render', result: sum, job: msg.job }, { frameId: 0 }).catch(() => {});
      reply(sum);
    })().catch(e => reply({ state: 'error', error: String(e) }));
    return true;
  }
});
