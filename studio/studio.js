import { getState, save } from '../lib/storage.js';
import { analyzeJob, matchJob, findSkillOccurrences, effectiveProfile } from '../lib/matcher.js';
import { parseResumeModel, modelToText, modelSections, renderResumeHTML, RESUME_CSS, RESUME_FONTS, buildHighlighter, reorderSkills, addSkills, prioritizeBullets, templateSummary, setSummary, newSection, inline } from '../lib/resume-model.js';
import { modelToDocx, letterToDocx } from '../lib/docx.js';
import { templateLetter, defaultLetterMeta, relevantEntries } from '../lib/letter.js';
import { aiAvailability, aiSummary, aiBullets, aiCoverLetter } from '../lib/ai.js';
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
const baseScore = jobA && S.resume?.text ? matchJob(jobA, { text: S.resume.text, sections: S.resume.sections, profile: prof() }).score : null;

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
  $('#pageInfo').innerHTML = `<span>${pages} page${pages > 1 ? 's' : ''} · ${model.pageSize}</span>${s < 1 ? `<span>text ${Math.round(s * 100)}%</span>` : ''}${over ? `<span class="warn">Doesn’t fit on ${maxPages} page${maxPages > 1 ? 's' : ''} even at the smallest size — trim content${maxPages === 1 && doc === 'resume' ? ' or allow 2 pages' : ''}.</span>` : ''}`;
}

/* ---------------- Live score ---------------- */
const rescore = debounce(() => {
  if (!jobA) return;
  match = matchJob(jobA, { text: modelToText(model), sections: modelSections(model), profile: prof() });
  $('#scoreNow').textContent = match.score;
  $('#scoreNow').style.color = scoreColor(match.score);
  $('#verdictNow').textContent = match.verdict;
  $('#verdictNow').style.color = scoreColor(match.score);
  const live = $('#scoreLive');
  live.textContent = `${match.score}% match`;
  live.className = 'score-live ' + scoreClass(match.score);
  const miss = match.skills.filter(s => s.status !== 'matched' && !s.generic);
  $('#missChips').innerHTML = miss.length ? miss.map(s => `<span class="chip add ${s.status}" data-skill="${escapeHtml(s.name)}" title="${s.status === 'implied' ? 'Implied by ' + escapeHtml(s.via) + ' — add explicitly' : s.status === 'related' ? 'You have ' + escapeHtml(s.via) : s.importance + ' skill'}">+ ${escapeHtml(s.name)}</span>`).join('') : '<span class="muted small">All job skills are covered.</span>';
  const kws = match.keywords.filter(k => !k.found);
  $('#kwChips').innerHTML = kws.length ? kws.map(k => `<span class="chip kw-missing" title="Appears ${k.n}× in job">${escapeHtml(k.word)}</span>`).join('') : '<span class="muted small">All frequent job keywords present.</span>';
}, 150);

$('#missChips').addEventListener('click', e => {
  const c = e.target.closest('.chip.add'); if (!c) return;
  const name = c.dataset.skill;
  if (!confirm(`Add "${name}" to your Skills section?\nOnly add skills you genuinely have.`)) return;
  addSkills(model, [name]); renderEditor(); changed(); toast(`Added ${name}`);
});

$('#reorderBtn').addEventListener('click', () => {
  reorderSkills(model, match ? match.skills.filter(s => s.status === 'matched' || s.status === 'implied').sort((a, b) => b.weight - a.weight).map(s => s.name) : []);
  renderEditor(); changed(); toast('Job-relevant skills moved first');
});
$('#bulletsBtn').addEventListener('click', () => { prioritizeBullets(model, jobA); renderEditor(); changed(); toast('Most relevant bullets moved up'); });
$('#sumBtn').addEventListener('click', () => {
  const text = templateSummary({ profile: S.profile, match, jobA, model });
  if (model.sections.find(s => s.kind === 'summary')?.body && !confirm('Replace your summary with this?\n\n' + text)) return;
  setSummary(model, text); renderEditor(); changed();
});

/* ---------------- AI ---------------- */
function fillSecSelect() {
  const opts = model.sections.map((s, i) => ({ s, i })).filter(({ s }) => /^\s*[-•*]\s+/m.test(s.body));
  $('#aiSec').innerHTML = opts.map(({ s, i }) => `<option value="${i}">${escapeHtml(s.title)}</option>`).join('') || '<option value="">(no bullets)</option>';
}

async function initAI() {
  aiState = S.settings.useAI ? await aiAvailability() : 'unsupported';
  const ok = aiState === 'available';
  $('#aiState').textContent = ok ? '' : aiState === 'downloadable' ? '— enable AI from the Shortlist panel first' : '— not available in this browser';
  ['#aiSumBtn', '#aiBulBtn', '#aiSec'].forEach(s => ($(s).disabled = !ok || !jobA));
  $('#genLetterAI').disabled = !ok || !jobA;
  $('#letterHint').textContent = !jobA ? 'Open a job first so the letter can be tailored to it.' : ok ? 'AI writes from your resume, profile and this job. Review every sentence before sending.' : 'AI isn’t available in this browser — “Generate from resume” builds the letter from your best-matching experience.';
}

$('#aiSumBtn').addEventListener('click', async () => {
  const btn = $('#aiSumBtn'), out = $('#aiOut');
  busy(btn, true, 'Writing…'); out.hidden = false;
  out.innerHTML = '<div class="label">Proposed summary</div><textarea id="aiSumTxt" rows="5"></textarea><div class="row" style="margin-top:6px"><button class="btn small primary" id="aiSumOk">Use this</button><button class="btn small ghost" id="aiCancel">Discard</button></div>';
  try { await aiSummary({ jobA, resumeText: modelToText(model), match }, { onChunk: t => ($('#aiSumTxt').value = t.trim()) }); }
  catch (e) { $('#aiSumTxt').value = 'AI error: ' + e.message; }
  busy(btn, false);
  $('#aiSumOk').onclick = () => { setSummary(model, $('#aiSumTxt').value.trim()); renderEditor(); changed(); out.hidden = true; };
  $('#aiCancel').onclick = () => (out.hidden = true);
});

$('#aiBulBtn').addEventListener('click', async () => {
  const idx = $('#aiSec').value; if (idx === '') return;
  const sec = model.sections[+idx];
  const lines = sec.body.split('\n');
  const bIdx = lines.map((l, i) => (/^\s*[-•*]\s+/.test(l) ? i : -1)).filter(i => i >= 0);
  const bullets = bIdx.map(i => lines[i].replace(/^\s*[-•*]\s+/, ''));
  const btn = $('#aiBulBtn'), out = $('#aiOut');
  busy(btn, true, `Rewriting ${bullets.length}…`); out.hidden = false;
  out.innerHTML = '<div class="muted small row"><span class="spinner"></span> Working through bullets…</div>';
  const proposals = [];
  try {
    for (let k = 0; k < bullets.length; k += 5) {
      const chunk = bullets.slice(k, k + 5);
      const res = await aiBullets({ jobA, bullets: chunk });
      chunk.forEach((b, j) => proposals.push({ old: b, neu: res[j] || b }));
      out.innerHTML = `<div class="muted small row"><span class="spinner"></span> ${proposals.length}/${bullets.length} done…</div>`;
    }
  } catch (e) { out.innerHTML = `<div class="muted small">AI error: ${escapeHtml(e.message)}</div>`; busy(btn, false); return; }
  busy(btn, false);
  out.innerHTML = `<div class="label">Review rewrites for “${escapeHtml(sec.title)}” <span class="muted">— verify every fact</span></div>` +
    proposals.map((p, i) => `<label class="prop"><input type="checkbox" data-i="${i}" ${p.neu !== p.old ? 'checked' : ''}><div><div>${escapeHtml(p.neu)}</div><div class="old">${escapeHtml(p.old)}</div></div></label>`).join('') +
    '<div class="row" style="margin-top:8px"><button class="btn small primary" id="aiBulOk">Apply selected</button><button class="btn small ghost" id="aiCancel">Discard</button></div>';
  $('#aiBulOk').onclick = () => {
    out.querySelectorAll('input[type=checkbox]').forEach(cb => { if (cb.checked) { const i = +cb.dataset.i; lines[bIdx[i]] = '- ' + proposals[i].neu; } });
    sec.body = lines.join('\n'); renderEditor(); changed(); out.hidden = true; toast('Bullets updated');
  };
  $('#aiCancel').onclick = () => (out.hidden = true);
});

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
