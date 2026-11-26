// Service worker: opens the side panel and shows a match-score badge on job pages.
import { analyzeJob, matchJob } from './lib/matcher.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const pending = new Map();

async function scoreTab(tabId) {
  const { settings = {}, resume, profile = {} } = await chrome.storage.local.get(['settings', 'resume', 'profile']);
  if (settings.autoBadge === false || !resume?.text) return;
  let res;
  try {
    [{ result: res } = {}] = await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] });
  } catch { return; } // chrome:// pages, web store, etc.
  if (!res?.ok || !res.confident) { chrome.action.setBadgeText({ tabId, text: '' }); return; }
  const m = matchJob(analyzeJob(res), { text: resume.text, sections: resume.sections, profile });
  const color = m.score >= 75 ? '#16a34a' : m.score >= 55 ? '#d97706' : '#dc2626';
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text: String(m.score) });
  await chrome.action.setTitle({ tabId, title: `JobFit: ${m.score}% — ${m.verdict}\n${res.title}` });
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!/^https?:/.test(tab.url || '')) return;
  if (info.status === 'complete' || info.url) {
    clearTimeout(pending.get(tabId));
    // SPA job boards (LinkedIn, Indeed) render the description after navigation; wait a moment.
    pending.set(tabId, setTimeout(() => scoreTab(tabId).catch(() => {}), info.url ? 2200 : 900));
  }
});
chrome.tabs.onRemoved.addListener(id => { clearTimeout(pending.get(id)); pending.delete(id); });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'rescore-tab' && msg.tabId) { scoreTab(msg.tabId).finally(() => reply({ ok: true })); return true; }
});
