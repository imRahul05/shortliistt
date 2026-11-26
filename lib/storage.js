// chrome.storage.local wrapper. All data stays on this device.
export const DEFAULT_SETTINGS = { widget: true, widgetPos: 'br', useAI: true, highlight: true };

export async function load(keys) {
  return chrome.storage.local.get(keys);
}
export async function save(obj) {
  return chrome.storage.local.set(obj);
}

export async function getState() {
  const s = await chrome.storage.local.get(['profile', 'resume', 'settings', 'history', 'currentJob', 'tailored', 'profileData']);
  return {
    profile: s.profile || {},
    resume: s.resume || null, // { text, fileName, fileType, fileData(base64 dataURL), sections, updatedAt }
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    history: s.history || [],
    currentJob: s.currentJob || null,
    tailored: s.tailored || {}, // url -> model
    profileData: s.profileData || {}, // imported structured data: { work, education, projects, certifications, skills, years, sources }
  };
}

export async function addHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  const h = history.filter(x => x.url !== entry.url);
  h.unshift({ ...entry, at: Date.now() });
  await chrome.storage.local.set({ history: h.slice(0, 60) });
}

export function fileToDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
