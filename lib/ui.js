// Small UI helpers shared by side panel and studio.
import { escapeHtml } from './text.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function toast(msg, ms = 2200) {
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
