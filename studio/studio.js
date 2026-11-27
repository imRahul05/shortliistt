import { getState, save } from '../lib/storage.js';
import { analyzeJob, matchJob, findSkillOccurrences, effectiveProfile, candidateSkills } from '../lib/matcher.js';
import { stripRich } from '../lib/resume-parser.js';
import { tokenize, stem } from '../lib/text.js';
import { parseResumeModel, modelToText, modelSections, renderResumeHTML, RESUME_CSS, RESUME_FONTS, buildHighlighter, reorderSkills, addSkills, prioritizeBullets, templateSummary, setSummary, newSection, inline, listBullets, setBullet, removeBullets, weakestBullets, sameFacts, bulletRelevance, missingFromResume, addEntry, entryForRole } from '../lib/resume-model.js';
import { modelToDocx, letterToDocx } from '../lib/docx.js';
import { templateLetter, defaultLetterMeta, relevantEntries } from '../lib/letter.js';
import { aiAvailability, aiSummary, aiBullets, aiCoverLetter, aiWeave, aiCondense, proofreadAvailable, proofreadLines, diffWords } from '../lib/ai.js';
import { $, $$, toast, download, busy, scoreClass, scoreColor, ICON, MARK } from '../lib/ui.js';
import { escapeHtml, debounce } from '../lib/text.js';

$('#resumeCss').textContent = RESUME_FONTS('../lib/fonts/') + RESUME_CSS;
$('#brandMark').outerHTML = MARK;
$$('[data-icon-l]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.iconL] || ''));

const S = await getState();
const { letters = {} } = await chrome.storage.local.get('letters');
const job = S.currentJob;
const jobKey = job?.url || '_default';
const jobA = job ? analyzeJob(job) : null;
const source = () => S.resume?.rich || S.resume?.text || '';
const fresh = () => parseResumeModel(source(), { serif: S.resume?.serif, pages: S.resume?.pages, pageSize: S.resume?.pageSize?.name });
const blank = () => ({ name: S.profile.name || 'Your Name', headline: S.profile.targetTitle || '', contact: [S.profile.email, S.profile.phone, S.profile.linkedin].filter(Boolean).join(' | '), sections: [newSection('summary', 'Summary'), newSection('experience', 'Experience'), newSection('skills', 'Skills'), newSection('education', 'Education')], template: 'classic', pages: 1, pageSize: 'Letter' });

let model = S.tailored[jobKey] || (source() ? fresh() : blank());
model.pages ||= 1; model.pageSize ||= 'Letter'; model.template ||= 'classic';
let letter = letters[jobKey] || { ...defaultLetterMeta(jobA), body: '' };
let doc = location.hash === '#letter' ? 'letter' : 'resume';
let match = null, aiState = 'unsupported', scale = 1;
const prof = () => effectiveProfile(S.resume, S.profile, S.profileData);
const docProfile = () => ({ ...prof(), extraSkills: '', aiSkills: [] });
const baseScore = jobA && S.resume?.text ? matchJob(jobA, { text: S.resume.text, sections: S.resume.sections, profile: docProfile() }).score : null;

const KINDS = ['summary', 'experience', 'skills', 'education', 'projects', 'certifications', 'awards', 'other'];

/* ---------------- Resume editor ---------------- */
function renderEditor() {
  $('#fName').value = model.name || '';
  $('#fHeadline').value = model.headline || '';
  $('#fContact').value = model.contact || '';
  $('#tpl').value = model.template;
  $('#pages').value = String(model.pages);
  $('#psize').value = model.pageSize;
  $('#sections').innerHTML = model.sections.map((s, i) => `
    <div class="sec" data-i="${i}">
      <div class="sec-head">
        <input type="text" class="sec-title" value="${escapeHtml(s.title)}">
        <select class="sec-kind" title="Section type (controls formatting)">${KINDS.map(k => `<option ${k === s.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <button class="btn ghost small" data-act="up" title="Move up">↑</button>
        <button class="btn ghost small" data-act="down" title="Move down">↓</button>
        <button class="btn ghost small" data-act="del" title="Delete section">✕</button>
      </div>
      <textarea class="sec-body" rows="4" spellcheck="true">${escapeHtml(s.body)}</textarea>
    </div>`).join('');
  $$('.sec-body').forEach(autosize);
  fillSecSelect();
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 4, 1200) + 'px'; }

$('#sections').addEventListener('input', e => {
  const box = e.target.closest('.sec'); if (!box) return;
  const s = model.sections[+box.dataset.i];
  if (e.target.classList.contains('sec-title')) s.title = e.target.value;
  if (e.target.classList.contains('sec-body')) { s.body = e.target.value; autosize(e.target); }
  changed();
});
$('#sections').addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !e.target.classList.contains('sec-body')) return;
  e.preventDefault(); document.execCommand('insertText', false, '\t'); // Tab = right-aligned column
});
$('#sections').addEventListener('change', e => {
  if (!e.target.classList.contains('sec-kind')) return;
  model.sections[+e.target.closest('.sec').dataset.i].kind = e.target.value; changed();
});
$('#sections').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const i = +b.closest('.sec').dataset.i, secs = model.sections;
  if (b.dataset.act === 'up' && i > 0) [secs[i - 1], secs[i]] = [secs[i], secs[i - 1]];
  if (b.dataset.act === 'down' && i < secs.length - 1) [secs[i + 1], secs[i]] = [secs[i], secs[i + 1]];
  if (b.dataset.act === 'del' && confirm(`Delete section "${secs[i].title}"?`)) secs.splice(i, 1);
  renderEditor(); changed();
});
$('#addSec').addEventListener('click', () => { model.sections.push(newSection('other', 'New Section')); renderEditor(); changed(); });
for (const [id, key] of [['#fName', 'name'], ['#fHeadline', 'headline'], ['#fContact', 'contact']]) $(id).addEventListener('input', e => { model[key] = e.target.value; changed(); });
$('#tpl').addEventListener('change', e => { model.template = e.target.value; changed(); });
$('#pages').addEventListener('change', e => { model.pages = +e.target.value; model.pagesChosen = true; changed(); });
$('#psize').addEventListener('change', e => { model.pageSize = e.target.value; changed(); });
$('#hl').checked = !!S.settings.highlight;
$('#hl').addEventListener('change', e => { S.settings.highlight = e.target.checked; save({ settings: S.settings }); renderPreview(); });

const persist = debounce(() => { S.tailored[jobKey] = model; letters[jobKey] = letter; save({ tailored: S.tailored, letters }); }, 500);
function changed() { renderPreview(); rescore(); persist(); }

/* ---------------- Preview, fit-to-page ---------------- */
const DIM = { Letter: [8.5, 11], A4: [8.27, 11.69] };
const MARGIN = { tb: 0.45, lr: 0.55 };
const PX = 96;

function letterHTML(s) {
  const head = renderResumeHTML({ ...model, sections: [] }, { scale: s }).replace('class="resume ', 'class="resume letter ').replace(/<\/div>$/, '');
  const paras = (letter.body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const body = paras.map((p, i) => `<p class="${i === paras.length - 1 && /^(sincerely|regards|best|thank you|warm regards|yours)/i.test(p) ? 'sig' : ''}">${p.split('\n').map(l => inline(l, null)).join('<br>')}</p>`).join('');
  return `${head}<div class="lt-date">${escapeHtml(letter.date || '')}</div><div class="lt-to">${escapeHtml(letter.recipient || '')}</div><div class="lt-body">${body || '<p style="color:#999">Generate or write your letter on the left.</p>'}</div></div>`;
}

function measure(s, hl) {
  $('#page').innerHTML = doc === 'resume' ? renderResumeHTML(model, { highlight: hl, scale: s }) : letterHTML(s);
  return $('#page .resume').offsetHeight;
}

function renderPreview() {
  const [w, h] = DIM[model.pageSize] || DIM.Letter;
  const page = $('#page');
  page.style.width = w + 'in';
  page.style.padding = `${MARGIN.tb}in ${MARGIN.lr}in`;
  $('#pageCss').textContent = `@page{size:${model.pageSize === 'A4' ? 'A4' : 'letter'};margin:${MARGIN.tb}in ${MARGIN.lr}in}`;
  const avail = (h - 2 * MARGIN.tb) * PX;
  let hl = null;
  if (doc === 'resume' && $('#hl').checked && jobA) {
    const wanted = new Set(jobA.skills.keys());
    hl = buildHighlighter(findSkillOccurrences(modelToText(model)).filter(o => wanted.has(o.name)).map(o => o.text));
  }
  const maxPages = doc === 'resume' ? model.pages : 1;
  const natural = measure(1, hl);
  let s = 1, height = natural;
  while (height > maxPages * avail + 1 && s > 0.8) { s = Math.round((s - 0.02) * 100) / 100; height = measure(s, hl); }
  scale = s;
  const pages = Math.max(1, Math.ceil((height - 1) / avail));
  page.style.minHeight = `${h * pages}in`;
  page.querySelectorAll('.guide').forEach(g => g.remove());
  for (let k = 1; k < pages; k++) page.insertAdjacentHTML('beforeend', `<div class="guide" style="top:${MARGIN.tb * PX + k * avail}px"><span>Page ${k + 1}</span></div>`);
  model._naturalPages = Math.ceil((natural - 1) / avail);
  const over = pages > maxPages;
  lastFit = doc === 'resume' ? { pages, max: maxPages, natural: model._naturalPages, scale: s, over } : null;
  $('#pageInfo').innerHTML = `<span>${pages} page${pages > 1 ? 's' : ''} · ${model.pageSize}</span>${s < 1 ? `<span>text ${Math.round(s * 100)}%</span>` : ''}${over ? `<span class="warn">Doesn’t fit on ${maxPages} page${maxPages > 1 ? 's' : ''} even at the smallest size — trim content${maxPages === 1 && doc === 'resume' ? ' or allow 2 pages' : ''}.</span>` : ''}`;
}

/* ---------------- Live score ---------------- */
// The Studio scores the document itself: skills saved only in your profile count once they are on the page.
const matchOf = m => matchJob(jobA, { text: modelToText(m), sections: modelSections(m), profile: docProfile() });
const scoreOf = m => (jobA ? matchOf(m).score : 0);
const clone = m => JSON.parse(JSON.stringify(m));
const gainOf = fn => { if (!jobA) return 0; const c = clone(model); fn(c); return scoreOf(c) - (match?.score ?? scoreOf(model)); };
const plus = n => (n > 0 ? `+${n}` : '');

const rescore = debounce(() => {
  if (!jobA) return;
  match = matchOf(model);
  $('#scoreNow').textContent = match.score;
  $('#scoreNow').style.color = scoreColor(match.score);
  $('#verdictNow').textContent = match.verdict;
  $('#verdictNow').style.color = scoreColor(match.score);
  const live = $('#scoreLive');
  live.textContent = `${match.score}% match`;
  live.className = 'score-live ' + scoreClass(match.score);
  const d = baseScore == null ? 0 : match.score - baseScore;
  const dl = $('#scoreDelta'); dl.hidden = !d; dl.textContent = (d > 0 ? '+' : '') + d; dl.className = 'delta ' + (d > 0 ? 'up' : 'down');
  renderSteps();
}, 150);

/* ---------------- Undo ---------------- */
const undoStack = [];
function pushUndo(label) { undoStack.push({ label, m: JSON.stringify(model) }); if (undoStack.length > 40) undoStack.shift(); $('#undoBtn').disabled = false; }
function undo() {
  const u = undoStack.pop(); if (!u) return;
  model = JSON.parse(u.m); renderEditor(); changed();
  $('#undoBtn').disabled = !undoStack.length; toast(`Undone: ${u.label}`);
}
$('#undoBtn').addEventListener('click', undo);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.closest('input,textarea,select')) { e.preventDefault(); undo(); }
});
/** Apply a change with undo, and tell the user what it did to the score. */
function act(label, fn) {
  const before = scoreOf(model);
  pushUndo(label); fn(model); renderEditor(); changed();
  const d = jobA ? scoreOf(model) - before : 0;
  toast(d ? `${label} · ${d > 0 ? '+' : ''}${d} points` : label);
}

/* ---------------- Steps: everything that can raise the score, one click each ---------------- */
const picked = new Set();   // missing skills the user says they have
const kwOff = new Set();    // keywords the user unticked
const doneSteps = new Set();
const rf = { title: '', company: '', start: '', end: '', bullets: '' }; // "add a role" form
let roleForm = false, lastFit = null;

function plan() {
  const nonGeneric = match.skills.filter(s => !s.generic);
  const profDirect = candidateSkills('', prof()).direct;
  const fromProfile = nonGeneric.filter(s => s.status !== 'matched' && profDirect.has(s.name)).map(s => s.name);
  const implied = nonGeneric.filter(s => s.status === 'implied' && !fromProfile.includes(s.name));
  const missing = nonGeneric.filter(s => (s.status === 'missing' || s.status === 'related') && !fromProfile.includes(s.name));
  const kws = match.keywords.filter(k => !k.found);
  const extra = missingFromResume(model, S.profileData || {}, jobA);
  return { fromProfile, implied, missing, kws, ...extra };
}
const selectedKws = p => p.kws.filter(k => !kwOff.has(k.word));

const step = (key, title, gain, body, { done = false, tone = '' } = {}) =>
  `<div class="step ${tone}${done ? ' done' : ''}" data-step="${key}"><div class="st-head"><span class="st-title">${done ? ICON.check : ''}${title}</span>${gain ? `<span class="gain">${gain}</span>` : ''}</div>${done ? '' : body}</div>`;
const btn = (doIt, label, cls = '', extra = '') => `<button class="btn small ${cls}" data-do="${doIt}" ${extra}>${cls.includes('ai') ? ICON.spark : ''}${label}</button>`;
const chipList = (items, kind, isOn, title = () => '') => `<div class="chips">${items.map(v => `<button class="chip pick${isOn(v) ? ' on' : ''}" data-pick="${kind}" data-v="${escapeHtml(v)}" title="${escapeHtml(title(v))}">${escapeHtml(v)}</button>`).join('')}</div>`;

function renderSteps() {
  if (!jobA || !match || doc !== 'resume') return;
  const p = plan(), out = [], aiOK = aiState === 'available';

  if (p.fromProfile.length) out.push(step('profile', 'Skills from your profile that this resume doesn’t show', plus(gainOf(c => addSkills(c, p.fromProfile))),
    `<p class="st-sub">You saved these in your profile, so they’re yours. Put them on the page so recruiters and ATS see them.</p>${chipList(p.fromProfile, 'none', () => true)}<div class="row">${btn('profile-add', `Add ${p.fromProfile.length} to Skills`, 'primary')}</div>`, { tone: 'hot' }));

  if (p.implied.length) out.push(step('implied', 'Name the skills your experience already shows', plus(gainOf(c => addSkills(c, p.implied.map(s => s.name)))),
    `<p class="st-sub">${p.implied.slice(0, 3).map(s => `${escapeHtml(s.via)} → ${escapeHtml(s.name)}`).join(' · ')}${p.implied.length > 3 ? ' …' : ''}</p><div class="row">${btn('implied-add', `Add ${p.implied.length} to Skills`, 'primary')}</div>`));

  if (p.missing.length) {
    const sel = p.missing.filter(s => picked.has(s.name)).map(s => s.name);
    const g = sel.length ? plus(gainOf(c => addSkills(c, sel))) : (n => (n > 0 ? `up to +${n}` : ''))(gainOf(c => addSkills(c, p.missing.map(s => s.name))));
    const must = match.skills.filter(s => s.importance === 'must' && !s.generic && s.status === 'missing').map(s => s.name);
    const cap = must.length >= 3 ? 55 : must.length ? 75 : null;
    out.push(step('missing', 'Missing skills: tick the ones you really have', g,
      `${cap ? `<p class="st-sub cap">Your score can’t go above ${cap} while the job’s must-haves are missing: <b>${must.map(escapeHtml).join(', ')}</b>. If you have them, tick and add them.</p>` : ''}${chipList(p.missing.map(s => s.name), 'miss', v => picked.has(v), v => { const s = p.missing.find(x => x.name === v); return s.status === 'related' ? `You have ${s.via}` : `${s.importance} skill`; })}<div class="row">${btn('miss-add', sel.length ? `Add ${sel.length} to Skills` : 'Add to Skills', 'primary', sel.length ? '' : 'disabled')}</div>`));
  }

  if (p.kws.length) {
    const kw = selectedKws(p);
    const g = gainOf(c => c.sections.push({ kind: 'other', title: '_', body: p.kws.map(k => k.word).join(' ') }));
    out.push(step('kw', 'Work the job’s keywords into your bullets', g > 0 ? `up to +${g}` : '',
      `<p class="st-sub">${aiOK ? 'AI rewrites a few bullets where the word honestly fits. You review each one.' : 'Turn on AI in Shortlist settings to work these in automatically, or edit a bullet below.'}</p>${chipList(p.kws.map(k => k.word), 'kw', v => !kwOff.has(v), v => `Appears ${p.kws.find(k => k.word === v).n}× in the job`)}${aiOK ? `<div class="row">${btn('kw-ai', `Work in ${kw.length} keyword${kw.length === 1 ? '' : 's'}`, 'ai', kw.length ? '' : 'disabled')}</div>` : ''}`));
  }

  const y = match.years, gap = y.required != null && y.candidate < y.required;
  if (gap || p.roles.length) {
    const roles = p.roles.map((r, i) => `<div class="add-item"><div><b>${escapeHtml(r.label)}</b><div class="muted small">${escapeHtml(r.sub)}</div></div>${btn('role-add', 'Add', '', `data-i="${i}"`)}</div>`).join('');
    const form = roleForm ? `<div class="role-form">
      <div class="grid2"><label class="field">Title<input type="text" data-rf="title" value="${escapeHtml(rf.title)}" placeholder="Software Engineer Intern"></label><label class="field">Company<input type="text" data-rf="company" value="${escapeHtml(rf.company)}"></label></div>
      <div class="grid2"><label class="field">Start<input type="text" data-rf="start" value="${escapeHtml(rf.start)}" placeholder="Jun 2022"></label><label class="field">End<input type="text" data-rf="end" value="${escapeHtml(rf.end)}" placeholder="Present"></label></div>
      <label class="field">What you did (one line per bullet)<textarea data-rf="bullets" rows="3">${escapeHtml(rf.bullets)}</textarea></label>
      <div class="row">${btn('role-save', 'Add to Experience', 'primary')}${btn('role-cancel', 'Cancel', 'ghost')}</div></div>` : '';
    out.push(step('exp', gap ? `Job asks for ${y.required}+ years · this resume shows ${y.candidate}` : 'Roles from your LinkedIn that aren’t on this resume', p.roles.length ? plus(gainOf(c => p.roles.forEach(r => addEntry(c, 'experience', r.text, { top: r.current })))) : '',
      `${roles}<p class="st-sub">${gap ? 'Internships, freelance, contract or open-source work all count. ' : ''}${!(S.profileData?.work || []).length ? 'Import your LinkedIn data in Profile to add past roles in one click. ' : ''}</p>${form || `<div class="row">${btn('role-new', '+ Add a role')}</div>`}`, { tone: gap ? 'warn' : '' }));
  }

  if (p.projects.length) out.push(step('proj', 'GitHub projects that fit this job', plus(gainOf(c => p.projects.forEach(r => addEntry(c, 'projects', r.text)))),
    p.projects.map((r, i) => `<div class="add-item"><div><b>${escapeHtml(r.label)}</b><div class="muted small">${escapeHtml(r.sub)}</div></div>${btn('proj-add', 'Add', '', `data-i="${i}"`)}</div>`).join('')));

  const hasSum = !!model.sections.find(s => s.kind === 'summary')?.body.trim();
  out.push(step('sum', hasSum ? 'Rewrite the summary for this job' : 'Add a summary for this job', plus(gainOf(c => setSummary(c, templateSummary({ profile: S.profile, match, jobA, model: c })))),
    `<div class="row">${aiOK ? btn('sum-ai', 'Write with AI', 'ai') : ''}${btn('sum-tpl', aiOK ? 'Quick template' : 'Write summary', aiOK ? '' : 'primary')}</div>`, { done: doneSteps.has('sum') }));

  out.push(step('order', 'Lead with what this job asks for', '', `<p class="st-sub">Moves matching skills and bullets to the top of each list.</p><div class="row">${btn('order', 'Order skills & bullets')}</div>`, { done: doneSteps.has('order') }));

  if (lastFit && lastFit.natural > lastFit.max && (lastFit.over || lastFit.scale < 0.95)) {
    const msg = lastFit.over ? `Doesn’t fit on ${lastFit.max} page${lastFit.max > 1 ? 's' : ''}, even with smaller text` : `Fits ${lastFit.max} page${lastFit.max > 1 ? 's' : ''} only with text at ${Math.round(lastFit.scale * 100)}%`;
    out.push(step('len', msg, '', `<p class="st-sub">Shorter bullets read better than small text. Condensing keeps every number; trimming drops your least relevant bullets (undo anytime).</p><div class="row">${aiOK ? btn('condense', 'Condense bullets', 'ai') : ''}${btn('trim', 'Trim weakest bullets', aiOK ? '' : 'primary')}${lastFit.max === 1 ? btn('keep2', 'Use 2 pages', 'ghost') : ''}</div>`, { tone: lastFit.over ? 'warn' : '' }));
  }

  $('#steps').innerHTML = out.join('');
}

$('#steps').addEventListener('input', e => { const k = e.target.dataset.rf; if (k) rf[k] = e.target.value; });
$('#steps').addEventListener('click', async e => {
  const pk = e.target.closest('[data-pick]');
  if (pk) {
    const v = pk.dataset.v;
    if (pk.dataset.pick === 'miss') picked.has(v) ? picked.delete(v) : picked.add(v);
    if (pk.dataset.pick === 'kw') kwOff.has(v) ? kwOff.delete(v) : kwOff.add(v);
    return renderSteps();
  }
  const b = e.target.closest('[data-do]'); if (!b || b.disabled) return;
  const p = plan(), d = b.dataset.do;
  if (d === 'profile-add') act(`Added ${p.fromProfile.length} skills from your profile`, c => addSkills(c, p.fromProfile));
  if (d === 'implied-add') act(`Added ${p.implied.length} skills`, c => addSkills(c, p.implied.map(s => s.name)));
  if (d === 'miss-add') { const sel = p.missing.filter(s => picked.has(s.name)).map(s => s.name); picked.clear(); act(`Added ${sel.join(', ')}`, c => addSkills(c, sel)); }
  if (d === 'kw-ai') weave(selectedKws(p), b);
  if (d === 'role-add') { const r = p.roles[+b.dataset.i]; act(`Added ${r.label}`, c => addEntry(c, 'experience', r.text, { top: r.current })); }
  if (d === 'proj-add') { const r = p.projects[+b.dataset.i]; act(`Added ${r.label}`, c => addEntry(c, 'projects', r.text)); }
  if (d === 'role-new') { roleForm = true; renderSteps(); $('[data-rf=title]')?.focus(); }
  if (d === 'role-cancel') { roleForm = false; renderSteps(); }
  if (d === 'role-save') {
    if (!rf.title.trim() && !rf.company.trim()) return toast('Add a title or company');
    const text = entryForRole({ title: rf.title.trim(), company: rf.company.trim(), start: rf.start.trim(), end: /^(present|current|now)?$/i.test(rf.end.trim()) ? '' : rf.end.trim(), description: rf.bullets }, model.sections.some(s => s.kind === 'experience' && /^\*\*/m.test(s.body)));
    roleForm = false; act(`Added ${rf.title || rf.company}`, c => addEntry(c, 'experience', text, { top: !rf.end.trim() || /present|current/i.test(rf.end) }));
    Object.keys(rf).forEach(k => (rf[k] = ''));
  }
  if (d === 'sum-tpl') { doneSteps.add('sum'); act('Summary written for this job', c => setSummary(c, templateSummary({ profile: S.profile, match, jobA, model: c }))); }
  if (d === 'sum-ai') aiSummaryFlow(b);
  if (d === 'order') { doneSteps.add('order'); act('Most relevant skills and bullets first', c => orderAll(c)); }
  if (d === 'keep2') act('Allowed 2 pages', c => { c.pages = 2; c.pagesChosen = true; });
  if (d === 'trim') trimToFit();
  if (d === 'condense') condense(b);
});

function orderAll(c) {
  reorderSkills(c, match ? match.skills.filter(s => s.status === 'matched' || s.status === 'implied').sort((a, b) => b.weight - a.weight).map(s => s.name) : []);
  prioritizeBullets(c, jobA);
}

/* ---------------- One click: tailor automatically ---------------- */
$('#autoBtn').addEventListener('click', async () => {
  if (!jobA) return;
  const btnEl = $('#autoBtn'), aiOK = aiState === 'available';
  const before = scoreOf(model), p = plan();
  pushUndo('Tailor automatically');
  addSkills(model, [...p.fromProfile, ...p.implied.map(s => s.name)]);
  match = matchOf(model); orderAll(model);
  doneSteps.add('order'); doneSteps.add('sum');
  renderEditor(); changed();
  busy(btnEl, true, aiOK ? 'Writing summary…' : 'Tailoring…');
  let sum = '';
  if (aiOK) { try { sum = (await aiSummary({ jobA, resumeText: modelToText(model), match: matchOf(model), profile: { ...S.profile, name: S.profile.name || model.name } })).trim(); } catch { /* template below */ } }
  setSummary(model, sum || templateSummary({ profile: S.profile, match: matchOf(model), jobA, model }));
  renderEditor(); changed();
  busy(btnEl, false);
  const d = scoreOf(model) - before;
  toast(d > 0 ? `Tailored · +${d} points. Undo anytime.` : 'Tailored. Undo anytime.', 3200);
  const kws = selectedKws(plan());
  if (aiOK && kws.length) weave(kws, btnEl);
});

/* ---------------- AI review flows ---------------- */
const plainText = t => escapeHtml(stripRich(t));
function markAdded(t, words = []) {
  let h = plainText(t);
  for (const w of words) h = h.replace(new RegExp(`\\b(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'i'), '<mark>$1</mark>');
  return h;
}
function review(title, props, note, onApply, sel = '#aiOut') {
  const out = $(sel); out.hidden = false;
  out.innerHTML = `<div class="label">${escapeHtml(title)} <span class="muted">· check every line is true</span></div>` +
    props.map((p, i) => `<label class="prop"><input type="checkbox" data-i="${i}" checked><div><div>${p.html || markAdded(p.neu, p.added)}</div><div class="old">${plainText(p.old)}</div>${note ? `<div class="why">${escapeHtml(note(p))}</div>` : ''}</div></label>`).join('') +
    '<div class="row" style="margin-top:8px"><button class="btn small primary" id="revOk">Apply selected</button><button class="btn small ghost" id="revNo">Discard</button></div>';
  $('#revOk', out).onclick = () => { const sel = [...out.querySelectorAll('input:checked')].map(cb => props[+cb.dataset.i]); out.hidden = true; if (sel.length) onApply(sel); };
  $('#revNo', out).onclick = () => (out.hidden = true);
  out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function working(msg, sel = '#aiOut') { const out = $(sel); out.hidden = false; out.innerHTML = `<div class="muted small row"><span class="spinner"></span> ${escapeHtml(msg)}</div>`; out.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
function failed(msg, sel = '#aiOut') { const out = $(sel); out.hidden = false; out.innerHTML = `<div class="muted small">${escapeHtml(msg)}</div><div class="row" style="margin-top:6px"><button class="btn small ghost" data-close>Close</button></div>`; }
// Extension pages block inline handlers, so close buttons are delegated.
document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('.ai-out').hidden = true; });

async function weave(kws, btnEl) {
  const pool = listBullets(model).map(b => ({ ...b, r: bulletRelevance(b.text, jobA) })).sort((a, b) => b.r - a.r).slice(0, 12);
  if (!pool.length) return toast('Add some bullets to Experience or Projects first');
  busy(btnEl, true, 'Placing keywords…'); working(`Finding bullets where ${kws.slice(0, 4).map(k => k.word).join(', ')}${kws.length > 4 ? '…' : ''} honestly fit…`);
  let props = [];
  try { props = await aiWeave({ jobA, bullets: pool.map(b => ({ i: b.id, text: b.text })), terms: kws.slice(0, 10).map(k => k.word), profile: S.profile }); }
  catch (e) { busy(btnEl, false); return failed('AI error: ' + e.message); }
  busy(btnEl, false);
  const byId = new Map(pool.map(b => [b.id, b])), seen = new Set();
  const stems = t => new Set(tokenize(stripRich(t)).map(stem));
  const good = props.map(p => {
    const b = byId.get(p.i); if (!b || seen.has(p.i) || p.text === b.text || !sameFacts(b.text, p.text)) return null;
    const s0 = stems(b.text), s1 = stems(p.text);
    const added = kws.filter(k => s1.has(k.stem) && !s0.has(k.stem)).map(k => k.word);
    if (!added.length) return null;
    seen.add(p.i); return { id: p.i, old: b.text, neu: p.text, added };
  }).filter(Boolean);
  if (!good.length) return failed('These keywords didn’t fit any bullet without changing its facts. Untick a few and try again, or add them by hand where they’re true.');
  review('Keyword rewrites', good, p => `adds ${p.added.join(', ')}`, sel => act(`Worked in ${sel.flatMap(p => p.added).length} keywords`, c => sel.forEach(p => setBullet(c, p.id, p.neu))));
}

async function aiSummaryFlow(btnEl) {
  busy(btnEl, true, 'Writing…'); const out = $('#aiOut'); out.hidden = false;
  out.innerHTML = '<div class="label">Proposed summary</div><textarea id="aiSumTxt" rows="5"></textarea><div class="row" style="margin-top:6px"><button class="btn small primary" id="aiSumOk">Use this</button><button class="btn small ghost" id="aiCancel">Discard</button></div>';
  out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  try { await aiSummary({ jobA, resumeText: modelToText(model), match, profile: { ...S.profile, name: S.profile.name || model.name } }, { onChunk: t => ($('#aiSumTxt').value = t.trim()) }); }
  catch (e) { $('#aiSumTxt').value = 'AI error: ' + e.message; }
  busy(btnEl, false);
  $('#aiSumOk').onclick = () => { const t = $('#aiSumTxt').value.trim(); out.hidden = true; doneSteps.add('sum'); act('Summary updated', c => setSummary(c, t)); };
  $('#aiCancel').onclick = () => (out.hidden = true);
}

async function condense(btnEl) {
  const long = listBullets(model).filter(b => b.words > 18).sort((a, b) => b.words - a.words).slice(0, 10);
  if (!long.length) return toast('Bullets are already short. Try “Trim weakest bullets”.');
  busy(btnEl, true, 'Condensing…'); working(`Shortening ${long.length} long bullets…`);
  let props = [];
  try { props = await aiCondense({ jobA, bullets: long.map(b => ({ i: b.id, text: b.text })) }); }
  catch (e) { busy(btnEl, false); return failed('AI error: ' + e.message); }
  busy(btnEl, false);
  const byId = new Map(long.map(b => [b.id, b])), wc = t => stripRich(t).split(/\s+/).filter(Boolean).length;
  const good = props.map(p => { const b = byId.get(p.i); return b && wc(p.text) < b.words && sameFacts(b.text, p.text, { maxGrow: 1 }) ? { id: p.i, old: b.text, neu: p.text, added: [] } : null; }).filter(Boolean);
  if (!good.length) return failed('Couldn’t shorten these without losing facts. Try “Trim weakest bullets”.');
  review('Shorter bullets', good, p => `${wc(p.old)} → ${wc(p.neu)} words`, sel => act(`Condensed ${sel.length} bullets`, c => sel.forEach(p => setBullet(c, p.id, p.neu))));
}

function trimToFit() {
  pushUndo('Trim weakest bullets');
  const removed = [];
  for (let k = 0; k < 12 && lastFit && (lastFit.over || lastFit.natural > lastFit.max && lastFit.scale < 0.95); k++) {
    const w = weakestBullets(model, jobA, 1)[0]; if (!w) break;
    removed.push(stripRich(w.text)); removeBullets(model, [w.id]); renderPreview();
  }
  if (!removed.length) { undoStack.pop(); $('#undoBtn').disabled = !undoStack.length; return toast(lastFit && !lastFit.over && lastFit.scale >= 0.95 ? 'Already fits at a readable size' : 'Nothing left to trim safely: each entry keeps its best bullet'); }
  renderEditor(); changed();
  toast(`Removed ${removed.length} least relevant bullet${removed.length > 1 ? 's' : ''}. Undo to bring them back.`, 3200);
}

/* ---------------- AI: rewrite a whole section ---------------- */
function fillSecSelect() {
  const opts = model.sections.map((s, i) => ({ s, i })).filter(({ s }) => /^\s*[-•*]\s+/m.test(s.body));
  $('#aiSec').innerHTML = opts.map(({ s, i }) => `<option value="${i}">${escapeHtml(s.title)}</option>`).join('') || '<option value="">(no bullets)</option>';
}

async function initAI() {
  aiState = S.settings.useAI ? await aiAvailability() : 'unsupported';
  const ok = aiState === 'available';
  $('#aiState').textContent = ok ? '' : aiState === 'downloadable' ? '· enable AI from the Shortlist panel first' : '· not available in this browser';
  ['#aiBulBtn', '#aiSec'].forEach(s => ($(s).disabled = !ok || !jobA));
  $('#genLetterAI').disabled = !ok || !jobA;
  $('#autoBtn').classList.toggle('ai', ok); $('#autoBtn').classList.toggle('primary', !ok);
  $('#autoHint').textContent = ok
    ? 'Adds skills you already have, orders skills and bullets for this job, writes a new summary, then suggests keyword rewrites for you to review. Undo anytime.'
    : 'Adds skills you already have, orders skills and bullets for this job and writes a summary. Undo anytime.';
  $('#letterHint').textContent = !jobA ? 'Open a job first so the letter can be tailored to it.' : ok ? 'AI writes from your resume, profile and this job. Review every sentence before sending.' : 'AI isn’t available in this browser. “Generate from resume” builds the letter from your best-matching experience.';
  renderSteps();
}

$('#aiBulBtn').addEventListener('click', async () => {
  const idx = $('#aiSec').value; if (idx === '') return;
  const sec = model.sections[+idx];
  const bullets = listBullets(model, [sec.kind]).filter(b => b.si === +idx);
  const btnEl = $('#aiBulBtn');
  busy(btnEl, true, `Rewriting ${bullets.length}…`); working('Working through bullets…');
  const props = [];
  try {
    for (let k = 0; k < bullets.length; k += 5) {
      const chunk = bullets.slice(k, k + 5);
      const res = await aiBullets({ jobA, bullets: chunk.map(b => b.text) });
      chunk.forEach((b, j) => { const neu = res[j]; if (neu && neu !== b.text && sameFacts(b.text, neu)) props.push({ id: b.id, old: b.text, neu, added: [] }); });
      working(`${Math.min(k + 5, bullets.length)}/${bullets.length} done…`);
    }
  } catch (e) { busy(btnEl, false); return failed('AI error: ' + e.message); }
  busy(btnEl, false);
  if (!props.length) return failed('No safe rewrites: the AI changed facts or numbers, so nothing was suggested.');
  review(`Rewrites for “${sec.title}”`, props, null, sel => act(`Rewrote ${sel.length} bullets`, c => sel.forEach(p => setBullet(c, p.id, p.neu))));
});
$('#rewriteCard > h3').addEventListener('click', () => $('#rewriteCard').classList.toggle('collapsed'));

/* ---------------- Proofread (Chrome Proofreader API, or the Prompt API as a fallback) ---------------- */
const BUL_LINE = /^(\s*[-•*]\s+)(.+)$/;
function proofTargets() {
  if (doc === 'letter') return (letter.body || '').split('\n').map((l, li) => ({ li, prefix: '', text: l })).filter(t => t.text.trim().length > 3);
  const out = [];
  model.sections.forEach((sec, si) => {
    if (sec.kind === 'skills') return;
    sec.body.split('\n').forEach((l, li) => {
      const b = l.match(BUL_LINE);
      if (b) out.push({ si, li, prefix: b[1], text: b[2] });
      else if (sec.kind === 'summary' && l.trim()) out.push({ si, li, prefix: '', text: l });
    });
  });
  return out;
}
$('#proofBtn').addEventListener('click', async () => {
  const items = proofTargets(), btnEl = $('#proofBtn');
  if (!items.length) return toast(doc === 'letter' ? 'Write the letter first' : 'Nothing to proofread yet');
  busy(btnEl, true, 'Checking…'); working(`Checking spelling and grammar in ${items.length} line${items.length > 1 ? 's' : ''}…`, '#proofOut');
  let res;
  try { res = await proofreadLines(items.map(t => t.text)); }
  catch (e) { busy(btnEl, false); return failed('Proofreading failed: ' + e.message, '#proofOut'); }
  busy(btnEl, false);
  if (!res.fixes.length) { failed('No spelling or grammar issues found.', '#proofOut'); return; }
  const props = res.fixes.map(f => ({ t: items[f.i], old: f.before, neu: f.after, html: diffWords(stripRich(f.before), stripRich(f.after), escapeHtml).html }));
  review(`${props.length} fix${props.length > 1 ? 'es' : ''} found${res.engine === 'proofreader' ? ' · Chrome Proofreader' : ''}`, props, null, sel => {
    if (doc === 'letter') {
      const lines = letter.body.split('\n'); sel.forEach(p => (lines[p.t.li] = p.neu)); letter.body = lines.join('\n');
      renderLetterEditor(); renderPreview(); persist(); toast(`Applied ${sel.length} fix${sel.length > 1 ? 'es' : ''}`);
    } else act(`Applied ${sel.length} spelling/grammar fix${sel.length > 1 ? 'es' : ''}`, c => sel.forEach(p => {
      const lines = c.sections[p.t.si].body.split('\n'); lines[p.t.li] = p.t.prefix + p.neu; c.sections[p.t.si].body = lines.join('\n');
    }));
  }, '#proofOut');
});
proofreadAvailable().then(ok => { const b = $('#proofBtn'); b.disabled = !ok || !S.settings.useAI; b.title = b.disabled ? 'Needs Chrome’s built-in AI (enable it in the Shortlist panel)' : 'Check spelling, grammar and punctuation'; });

/* ---------------- Theme ---------------- */
const THEMES = ['system', 'light', 'dark'];
function paintTheme() { const t = S.settings.theme || 'system'; $('#themeBtn').innerHTML = ICON[{ system: 'monitor', light: 'sun', dark: 'moon' }[t]]; $('#themeBtn').title = `Theme: ${t === 'system' ? 'match browser' : t} (click to change)`; }
$('#themeBtn').addEventListener('click', () => { S.settings.theme = THEMES[(THEMES.indexOf(S.settings.theme || 'system') + 1) % 3]; save({ settings: S.settings }); paintTheme(); });
paintTheme();

/* ---------------- Cover letter ---------------- */
function renderLetterEditor() {
  $('#lDate').value = letter.date || '';
  $('#lTo').value = letter.recipient || '';
  $('#lBody').value = letter.body || '';
  $('#letterFor').textContent = jobA ? `· ${job.title}${job.company ? ' @ ' + job.company : ''}` : '';
}
for (const [id, key] of [['#lDate', 'date'], ['#lTo', 'recipient'], ['#lBody', 'body']]) $(id).addEventListener('input', e => { letter[key] = e.target.value; renderPreview(); persist(); });

function letterFromResume() {
  if (!jobA) return toast('Open a job first');
  match ||= matchJob(jobA, { text: modelToText(model), sections: modelSections(model), profile: prof() });
  letter.body = templateLetter({ profile: { ...S.profile, name: S.profile.name || model.name }, match, jobA, model });
  renderLetterEditor(); renderPreview(); persist();
}
$('#genLetter').addEventListener('click', () => {
  if (letter.body && !confirm('Replace the current letter?')) return;
  letterFromResume();
});
$('#genLetterAI').addEventListener('click', async () => {
  if (letter.body && !confirm('Replace the current letter?')) return;
  const btn = $('#genLetterAI'); busy(btn, true, 'Writing…');
  match ||= matchJob(jobA, { text: modelToText(model), sections: modelSections(model), profile: prof() });
  const highlights = relevantEntries(model, jobA, ['experience', 'projects']).flatMap(e => e.bullets.slice(0, 2).map(b => (e.company ? `${e.company}: ` : e.head ? `${e.head}: ` : '') + b.text)).slice(0, 5);
  try {
    await aiCoverLetter({ jobA, resumeText: modelToText(model), profile: { ...S.profile, name: S.profile.name || model.name }, match, highlights }, {
      onChunk: t => { letter.body = t.trim(); $('#lBody').value = letter.body; renderPreview(); },
    });
    persist();
  } catch (e) { toast('AI failed — used your resume instead'); letterFromResume(); }
  busy(btn, false);
});
$('#copyLetter').addEventListener('click', () => navigator.clipboard.writeText([letter.date, letter.recipient, letter.body].filter(Boolean).join('\n\n')).then(() => toast('Copied')));

/* ---------------- Doc switch ---------------- */
function setDoc(d) {
  doc = d;
  $$('.doc-seg button').forEach(b => b.classList.toggle('active', b.dataset.doc === d));
  $('#resumeSide').hidden = d !== 'resume';
  $('#letterSide').hidden = d !== 'letter';
  $('#pages').disabled = d !== 'resume';
  $('#hl').closest('label').hidden = d !== 'resume';
  $('#resetBtn').hidden = d !== 'resume';
  $('#proofOut').hidden = true;
  if (d === 'letter') { renderLetterEditor(); if (!letter.body && jobA) letterFromResume(); }
  renderPreview();
}
$$('.doc-seg button').forEach(b => b.addEventListener('click', () => setDoc(b.dataset.doc)));

/* ---------------- Export ---------------- */
const slug = s => (s || '').replace(/[^\w ]/g, '').trim().replace(/\s+/g, '_');
const fileBase = () => `${slug(model.name) || 'Resume'}${doc === 'letter' ? '_Cover_Letter' : ''}${job?.company ? '_' + slug(job.company) : ''}`;

async function askPages() {
  if (doc !== 'resume' || model.pagesChosen || (model._naturalPages || 1) <= 1) return true;
  $('#pagesDlgMsg').textContent = `At normal size it runs to ${model._naturalPages} pages. Fit it on one page (text is scaled down slightly, down to 80%), or keep two pages?`;
  const dlg = $('#pagesDlg');
  dlg.showModal();
  const v = await new Promise(r => dlg.addEventListener('close', () => r(dlg.returnValue), { once: true }));
  if (!v) return false;
  model.pages = +v; model.pagesChosen = true; $('#pages').value = v; changed();
  return true;
}

$('#pdfBtn').addEventListener('click', async () => {
  if (!(await askPages())) return;
  const prev = document.title; document.title = fileBase();
  const hl = $('#hl').checked; if (hl) { $('#hl').checked = false; renderPreview(); }
  setTimeout(() => { window.print(); document.title = prev; if (hl) { $('#hl').checked = true; renderPreview(); } }, 150);
});
$('#docxBtn').addEventListener('click', () => download(fileBase() + '.docx', doc === 'resume' ? modelToDocx(model) : letterToDocx(model, letter)));
$('#txtBtn').addEventListener('click', () => download(fileBase() + '.txt', doc === 'resume' ? modelToText(model) : [letter.date, letter.recipient, letter.body].filter(Boolean).join('\n\n')));
$('#resetBtn').addEventListener('click', () => {
  if (!source() || !confirm('Discard all edits for this job and reload your uploaded resume?')) return;
  model = fresh(); renderEditor(); changed();
});

/* ---------------- Init ---------------- */
if (jobA) {
  $('#jobChip').textContent = `${job.title}${job.company ? ' @ ' + job.company : ''}`;
  $('#jobChip').title = job.url;
  $('#tailorTitle').textContent = `Tailor for: ${job.title}`;
  $('#scoreBase').textContent = baseScore ?? '–';
} else {
  $('#noJobMsg').hidden = false; $('#tailorBody').hidden = true; $('#scoreLive').hidden = true;
}
renderEditor();
document.fonts.ready.then(() => renderPreview());
setDoc(doc);
rescore();
initAI();
