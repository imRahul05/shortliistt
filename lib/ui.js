// Small UI helpers shared by side panel and studio.
import { escapeHtml } from './text.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function md(s = '') {
  const lines = escapeHtml(s.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '', list = false;
  for (const l of lines) {
    const t = l.trim();
    if (/^[-*•]\s+/.test(t)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${t.replace(/^[-*•]\s+/, '')}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (!t) continue;
    html += /^#{1,4}\s/.test(t) ? `<p><b>${t.replace(/^#+\s/, '')}</b></p>` : `<p>${t}</p>`;
  }
  return html + (list ? '</ul>' : '');
}

export function download(name, blobOrText, type = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="spinner"></span> ${label || 'Working…'}`; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
}

export const scoreClass = s => (s >= 75 ? 'hi' : s >= 55 ? 'mid' : 'lo');
export const scoreColor = s => (s >= 75 ? 'var(--good)' : s >= 55 ? 'var(--warn)' : 'var(--bad)');

export function fallbackCoverLetter({ jobA, match, profile, model }) {
  const matched = match.skills.filter(s => s.status === 'matched' && !s.generic).map(s => s.name).slice(0, 5);
  const yrs = match.years.candidate ? `${Math.floor(match.years.candidate)}+ years` : 'hands-on experience';
  const title = jobA.title || 'this role', company = jobA.company || 'your company';
  const bullets = (model?.sections || []).filter(s => s.kind === 'experience').flatMap(s => s.body.split('\n').filter(l => /^\s*[-•*]\s+/.test(l)))
    .map(b => b.replace(/^\s*[-•*]\s+/, '')).filter(b => matched.some(m => b.toLowerCase().includes(m.toLowerCase().split(/[ .]/)[0]))).slice(0, 2);
  return `Dear Hiring Manager,

I am excited to apply for the ${title} position at ${company}. With ${yrs} working with ${matched.length ? matched.join(', ') : 'modern software tools'}, I believe I can contribute quickly to your team.

${bullets.length ? 'A few highlights from my recent work:\n' + bullets.map(b => '• ' + b).join('\n') + '\n\n' : ''}What draws me to ${company} is [specific reason — product, mission, tech challenge]. I would welcome the chance to discuss how my background fits the needs of the team.

Thank you for your time and consideration.

Sincerely,
${profile.name || '[Your Name]'}`;
}

const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4),
  x: svg('<path d="M7 7l10 10M17 7L7 17"/>', 2.2),
  partial: svg('<path d="M6 12h12"/>', 2.4),
  implied: svg('<path d="M5 9h14M5 15h14"/>', 2.2),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>'),
  bolt: svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  download: svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
  chip: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
  chevron: svg('<path d="M6 9l6 6 6-6"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  monitor: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
};
export const MARK = '<span class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';

export function fmtMonths(m) {
  const y = Math.floor(m / 12), mo = m % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', mo ? `${mo} mo` : ''].filter(Boolean).join(' ') || '< 1 mo';
}
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtMonth = v => `${MN[v % 12]} ${Math.floor(v / 12)}`;
