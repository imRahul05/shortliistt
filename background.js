// Service worker: scores jobs detected by the content script, sets the toolbar badge, opens the side panel.
import { analyzeJob, matchJob, effectiveProfile, isOwnContent } from './lib/matcher.js';
import { scanForm, autofillPage, clickAction, generatePassword } from './lib/autofill.js';

const setup = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

let cache = null;
async function data() {
  cache ||= await chrome.storage.local.get(['resume', 'profile', 'settings', 'profileData']);
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
  if (!(await chrome.offscreen.hasDocument?.())) {
    await chrome.offscreen.createDocument({ url: 'offscreen/offscreen.html', reasons: ['DOM_PARSER'], justification: 'Runs Chrome built-in AI (Prompt API), which needs a document, to show job insights on the page.' }).catch(e => { if (!/single offscreen/i.test(e.message)) throw e; });
  }
  // The document's module script may not have registered its listeners yet: wait for a pong.
  for (let i = 0; i < 40; i++) {
    const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' }).catch(() => null);
    if (r?.pong) return true;
    await new Promise(res => setTimeout(res, 75));
  }
  throw new Error('AI worker did not start');
}

/* ---------------- Forms: scan, autofill (with account creation), click page buttons ---------------- */
const RANK = { signup: 3, signin: 2, application: 1, none: 0 };
async function scanTab(tabId) {
  const res = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanForm }).catch(() => []);
  const frames = res.filter(r => r.result).map(r => ({ ...r.result, frameId: r.frameId }));
  frames.sort((a, b) => RANK[b.kind] - RANK[a.kind] || b.empty - a.empty);
  const best = frames[0] || { kind: 'none', actions: [], host: '' };
  const actions = frames.flatMap(f => f.actions.map(a => ({ ...a, frameId: f.frameId })));
  const { accounts = {} } = await chrome.storage.local.get('accounts');
  const acc = accounts[best.host];
  return { ...best, actions, terms: frames.some(f => f.terms), account: acc ? { email: acc.email, at: acc.at } : null };
}

async function autofillTab(tabId) {
  const scan = await scanTab(tabId);
  const { profile: base = {}, resume, accounts = {}, profileData = {} } = await chrome.storage.local.get(['profile', 'resume', 'accounts', 'profileData']);
  // Imported structured data (LinkedIn/GitHub) fills in education and current role for application forms.
  const edu = [...(profileData.education || [])].sort((a, b) => String(b.end || '9999').localeCompare(String(a.end || '9999')))[0] || {};
  const cur = (profileData.work || []).find(w => !w.end) || {};
  const profile = { currentCompany: cur.company, targetTitle: cur.title, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v)), school: edu.school || '', degree: edu.degree || '', field: edu.field || '', gradYear: (String(edu.end || '').match(/\d{4}/) || [''])[0] };
  let password = null, generated = false;
  if (scan.kind === 'signup' && scan.host) {
    const existing = accounts[scan.host];
    password = existing?.password || generatePassword();
    generated = !existing;
    accounts[scan.host] = { email: profile.email || existing?.email || '', password, at: existing?.at || Date.now() };
    await chrome.storage.local.set({ accounts });
  } else if (scan.kind === 'signin') password = accounts[scan.host]?.password || null;
  const file = resume?.fileData ? { dataURL: resume.fileData, name: resume.fileName } : null;
  const res = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: autofillPage, args: [profile, file, { password }] }).catch(e => { throw new Error('Can’t access this page: ' + e.message); });
  const t = res.reduce((a, r) => ({ filled: a.filled + (r.result?.filled || 0), attached: a.attached + (r.result?.attached || 0), passwordFilled: a.passwordFilled + (r.result?.passwordFilled || 0), terms: a.terms + (r.result?.terms || 0) }), { filled: 0, attached: 0, passwordFilled: 0, terms: 0 });
  return { ...t, kind: scan.kind, host: scan.host, generated, usedSaved: scan.kind === 'signin' && !!password, noEmail: !profile.email, actions: scan.actions };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (msg?.target === 'offscreen') return; // handled by the offscreen document

  if (msg?.type === 'ensure-offscreen') { ensureOffscreen().then(() => reply({ ok: true }), e => reply({ ok: false, error: e.message })); return true; }

  const formTab = msg?.tabId ?? tabId;
  if (msg?.type === 'form-scan' && formTab != null) { scanTab(formTab).then(reply, e => reply({ kind: 'none', error: e.message })); return true; }
  if (msg?.type === 'autofill' && formTab != null) { autofillTab(formTab).then(reply, e => reply({ error: e.message })); return true; }
  if (msg?.type === 'page-action' && formTab != null) {
    chrome.scripting.executeScript({ target: { tabId: formTab, frameIds: [msg.frameId ?? 0] }, func: clickAction, args: [msg.key] })
      .then(r => reply({ ok: !!r?.[0]?.result }), e => reply({ ok: false, error: e.message }));
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
      const { resume, profile = {}, profileData = {} } = await data();
      // Never score the user's own resume, portfolio or profile pages as a job.
      const own = isOwnContent(msg.job, resume?.text, profile);
      if (own) { if (tabId != null) await setBadge(tabId, null); return reply({ state: 'not-job', reason: own }); }
      // Let an open side panel pick up the job instantly (SPA navigations like LinkedIn).
      chrome.runtime.sendMessage({ type: 'job-detected', tabId, job: msg.job }).catch(() => {});
      if (!resume?.text) {
        await setBadge(tabId, null);
        if (sender.frameId && tabId != null) chrome.tabs.sendMessage(tabId, { type: 'render', result: { state: 'noresume' }, job: msg.job }, { frameId: 0 }).catch(() => {});
        return reply({ state: 'noresume' });
      }
      const m = matchJob(analyzeJob(msg.job), { text: resume.text, sections: resume.sections, profile: effectiveProfile(resume, profile, profileData) });
      if (tabId != null) await setBadge(tabId, m.score);
      const sum = summarize(msg.job, m);
      // Job found inside an iframe (e.g. an embedded Greenhouse board): show the card in the top frame.
      if (sender.frameId && tabId != null) chrome.tabs.sendMessage(tabId, { type: 'render', result: sum, job: msg.job }, { frameId: 0 }).catch(() => {});
      reply(sum);
    })().catch(e => reply({ state: 'error', error: String(e) }));
    return true;
  }
});
