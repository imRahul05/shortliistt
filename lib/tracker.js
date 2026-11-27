// Local application tracker: what you applied to, where it stands, and who hasn't replied.
// Stored in chrome.storage.local under "applications" as { [key]: Application }.

export const STATUSES = [
  ['saved', 'Saved'], ['applied', 'Applied'], ['interview', 'Interviewing'],
  ['offer', 'Offer'], ['rejected', 'Rejected'], ['ghosted', 'No response'],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES);
export const FOLLOW_UP_DAYS = 7;
const DAY = 864e5;

/** One key per job, even when the URL carries tracking params (LinkedIn currentJobId, Indeed jk…). */
export function appKey(url = '') {
  try {
    const u = new URL(url);
    const keep = ['currentJobId', 'jk', 'vjk', 'gh_jid', 'jobId', 'jobid', 'jl', 'token', 'for'];
    const id = u.hostname.endsWith('linkedin.com') && (u.searchParams.get('currentJobId') || u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1]);
    if (id) return `linkedin.com/jobs/view/${id}`;
    const q = keep.filter(k => u.searchParams.has(k)).map(k => `${k}=${u.searchParams.get(k)}`).join('&');
    return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + (q ? '?' + q : '');
  } catch { return url; }
}

export async function getApps() {
  const { applications = {} } = await chrome.storage.local.get('applications');
  return applications;
}

/** Create or update an application. `job` = {url, title, company, location}; `patch` = {status, notes, score…}. */
export async function upsertApp(job, patch = {}) {
  const apps = await getApps();
  const key = appKey(job.url);
  const now = Date.now();
  const prev = apps[key] || { key, url: job.url, title: job.title || '', company: job.company || '', location: job.location || '', status: 'saved', createdAt: now, history: [] };
  const next = { ...prev, title: prev.title || job.title || '', company: prev.company || job.company || '', ...patch, updatedAt: now };
  if (patch.status && patch.status !== prev.status) {
    next.history = [...(prev.history || []), { status: patch.status, at: now }];
    if (patch.status === 'applied' && !prev.appliedAt) next.appliedAt = now;
    if (patch.status !== 'applied') delete next.snoozeUntil;
  }
  apps[key] = next;
  await chrome.storage.local.set({ applications: apps });
  return next;
}

export async function removeApp(key) {
  const apps = await getApps();
  delete apps[key];
  await chrome.storage.local.set({ applications: apps });
}

/** Applications that have waited too long for a reply. */
export function dueFollowUps(apps, now = Date.now()) {
  return Object.values(apps).filter(a => a.status === 'applied' && a.appliedAt
    && now - a.appliedAt >= FOLLOW_UP_DAYS * DAY && (!a.snoozeUntil || now >= a.snoozeUntil))
    .sort((a, b) => a.appliedAt - b.appliedAt);
}

export const daysAgo = (t, now = Date.now()) => Math.max(0, Math.floor((now - t) / DAY));
export const agoText = t => { const d = daysAgo(t); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

/** "Thank you for applying" pages (ATS confirmation screens, LinkedIn Easy Apply). */
export const CONFIRM_RE = /(thank(s| you) for (applying|your (application|interest))|your application (was|has been) (sent|submitted|received)|application (submitted|received|sent)( successfully)?|we('|’)ve received your application|you('|’)ve applied|successfully applied)/i;

export function toCSV(apps) {
  const rows = [['Company', 'Title', 'Status', 'Applied', 'Updated', 'URL', 'Notes']];
  for (const a of Object.values(apps).sort((x, y) => (y.appliedAt || y.createdAt) - (x.appliedAt || x.createdAt))) {
    rows.push([a.company, a.title, STATUS_LABEL[a.status] || a.status, a.appliedAt ? new Date(a.appliedAt).toISOString().slice(0, 10) : '', new Date(a.updatedAt || a.createdAt).toISOString().slice(0, 10), a.url, a.notes || '']);
  }
  return rows.map(r => r.map(c => /[",\n]/.test(String(c ?? '')) ? `"${String(c).replace(/"/g, '""')}"` : String(c ?? '')).join(',')).join('\n');
}
