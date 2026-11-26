import { getState, save } from '../lib/storage.js';
import { analyzeJob, matchJob, findSkillOccurrences } from '../lib/matcher.js';
import { parseResumeModel, modelToText, modelSections, renderResumeHTML, RESUME_CSS, buildHighlighter, reorderSkills, addSkills, prioritizeBullets, templateSummary, setSummary, newSection } from '../lib/resume-model.js';
import { modelToDocx } from '../lib/docx.js';
import { aiAvailability, aiSummary, aiBullets } from '../lib/ai.js';
import { $, toast, download, busy, scoreClass, scoreColor } from '../lib/ui.js';
import { escapeHtml, debounce } from '../lib/text.js';

$('#resumeCss').textContent = RESUME_CSS;

const S = await getState();
const job = S.currentJob;
const jobKey = job?.url || '_default';
const jobA = job ? analyzeJob(job) : null;
let model = S.tailored[jobKey] || (S.resume?.text ? parseResumeModel(S.resume.text) : { name: S.profile.name || 'Your Name', headline: S.profile.targetTitle || '', contact: [S.profile.email, S.profile.phone, S.profile.linkedin].filter(Boolean).join(' | '), sections: [newSection('summary', 'Summary'), newSection('experience', 'Experience'), newSection('skills', 'Skills'), newSection('education', 'Education')], template: 'classic' });
let match = null, aiState = 'unsupported';
const baseScore = jobA && S.resume?.text ? matchJob(jobA, { text: S.resume.text, sections: S.resume.sections, profile: S.profile }).score : null;

const KINDS = ['summary', 'experience', 'skills', 'education', 'projects', 'certifications', 'awards', 'other'];

/* ---------------- Editor ---------------- */
function renderEditor() {
  $('#fName').value = model.name || '';
  $('#fHeadline').value = model.headline || '';
  $('#fContact').value = model.contact || '';
  $('#tpl').value = model.template || 'classic';
  $('#sections').innerHTML = model.sections.map((s, i) => `
    <div class="sec" data-i="${i}">
      <div class="sec-head">
        <input type="text" class="sec-title" value="${escapeHtml(s.title)}">
        <select class="sec-kind" title="Section type (controls formatting)">${KINDS.map(k => `<option ${k === s.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <button class="btn ghost" data-act="up" title="Move up">↑</button>
        <button class="btn ghost" data-act="down" title="Move down">↓</button>
        <button class="btn ghost" data-act="del" title="Delete section">✕</button>
      </div>
      <textarea class="sec-body" rows="4" spellcheck="true">${escapeHtml(s.body)}</textarea>
    </div>`).join('');
  document.querySelectorAll('.sec-body').forEach(autosize);
  fillSecSelect();
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 4, 900) + 'px'; }

$('#sections').addEventListener('input', e => {
  const box = e.target.closest('.sec'); if (!box) return;
  const s = model.sections[+box.dataset.i];
  if (e.target.classList.contains('sec-title')) s.title = e.target.value;
  if (e.target.classList.contains('sec-body')) { s.body = e.target.value; autosize(e.target); }
  changed();
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
$('#hl').addEventListener('change', renderPreview);

const persist = debounce(() => { S.tailored[jobKey] = model; save({ tailored: S.tailored }); }, 600);
function changed() { renderPreview(); rescore(); persist(); }

/* ---------------- Preview + scoring ---------------- */
function renderPreview() {
  let hl = null;
  if ($('#hl').checked && jobA) {
    const text = modelToText(model);
    const wanted = new Set(jobA.skills.keys());
    hl = buildHighlighter(findSkillOccurrences(text).filter(o => wanted.has(o.name)).map(o => o.text));
  }
  $('#page').innerHTML = renderResumeHTML(model, { highlight: hl });
}

const rescore = debounce(() => {
  if (!jobA) return;
  match = matchJob(jobA, { text: modelToText(model), sections: modelSections(model), profile: S.profile });
  $('#scoreNow').textContent = match.score;
  $('#scoreNow').style.color = scoreColor(match.score);
  $('#verdictNow').textContent = match.verdict;
  $('#verdictNow').style.color = scoreColor(match.score);
  const live = $('#scoreLive');
  live.textContent = `${match.score}% match`;
  live.className = 'score-live ' + scoreClass(match.score);
  const miss = match.skills.filter(s => s.status !== 'matched' && !s.generic);
  $('#missChips').innerHTML = miss.length ? miss.map(s => `<span class="chip add ${s.status}" data-skill="${escapeHtml(s.name)}" title="${s.status === 'implied' ? 'Implied by ' + escapeHtml(s.via) + ' — add explicitly' : s.status === 'related' ? 'You have ' + escapeHtml(s.via) : s.importance + ' skill'}">+ ${escapeHtml(s.name)}</span>`).join('') : '<span class="muted small">All job skills are covered 🎉</span>';
  const kws = match.keywords.filter(k => !k.found);
  $('#kwChips').innerHTML = kws.length ? kws.map(k => `<span class="chip kw-missing" title="Appears ${k.n}× in job">${escapeHtml(k.word)}</span>`).join('') : '<span class="muted small">All frequent job keywords present.</span>';
}, 150);

$('#missChips').addEventListener('click', e => {
  const c = e.target.closest('.chip.add'); if (!c) return;
  const name = c.dataset.skill;
  if (!confirm(`Add "${name}" to your Skills section?\nOnly add skills you genuinely have — interviews will test them.`)) return;
  addSkills(model, [name]); renderEditor(); changed();
  toast(`Added ${name} to Skills`);
});

/* ---------------- Rule-based tailoring ---------------- */
$('#reorderBtn').addEventListener('click', () => {
  reorderSkills(model, match ? match.skills.filter(s => s.status === 'matched' || s.status === 'implied').sort((a, b) => b.weight - a.weight).map(s => s.name) : []);
  renderEditor(); changed(); toast('Job-relevant skills moved first');
});
$('#bulletsBtn').addEventListener('click', () => { prioritizeBullets(model, jobA); renderEditor(); changed(); toast('Most relevant bullets moved to the top of each role'); });
$('#sumBtn').addEventListener('click', () => {
  const text = templateSummary({ profile: S.profile, match, jobA, model });
  const cur = model.sections.find(s => s.kind === 'summary')?.body;
  if (cur && !confirm('Replace your current summary with a generated one?\n\n' + text)) return;
  setSummary(model, text); renderEditor(); changed();
});

/* ---------------- AI tailoring ---------------- */
function fillSecSelect() {
  const opts = model.sections.map((s, i) => ({ s, i })).filter(({ s }) => /^\s*[-•*]\s+/m.test(s.body));
  $('#aiSec').innerHTML = opts.map(({ s, i }) => `<option value="${i}">${escapeHtml(s.title)}${entryLabel(s)}</option>`).join('') || '<option value="">(no bullet sections)</option>';
}
const entryLabel = s => { const n = s.body.split('\n').filter(l => /^\s*[-•*]\s+/.test(l)).length; return ` (${n} bullets)`; };

async function initAI() {
  aiState = S.settings.useAI ? await aiAvailability() : 'unsupported';
  const ok = aiState === 'available';
  $('#aiState').textContent = ok ? '· Gemini Nano, runs locally' : aiState === 'downloadable' ? '· enable it from the side panel badge (one-time download)' : '· not available in this browser — rule-based tools above still work';
  ['#aiSumBtn', '#aiBulBtn', '#aiSec'].forEach(s => ($(s).disabled = !ok || !jobA));
}

$('#aiSumBtn').addEventListener('click', async () => {
  const btn = $('#aiSumBtn'), out = $('#aiOut');
  busy(btn, true, 'Writing…'); out.hidden = false;
  out.innerHTML = '<div class="label">Proposed summary</div><textarea id="aiSumTxt" rows="5"></textarea><div class="row"><button class="btn small primary" id="aiSumOk">Use this</button><button class="btn small ghost" id="aiCancel">Discard</button></div>';
  try {
    await aiSummary({ jobA, resumeText: modelToText(model), match }, { onChunk: t => ($('#aiSumTxt').value = t.trim()) });
  } catch (e) { $('#aiSumTxt').value = 'AI error: ' + e.message; }
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
  out.innerHTML = '<div class="muted small"><span class="spinner"></span> Working through bullets on-device…</div>';
  const proposals = [];
  try {
    for (let k = 0; k < bullets.length; k += 5) {
      const chunk = bullets.slice(k, k + 5);
      const res = await aiBullets({ jobA, bullets: chunk });
      chunk.forEach((b, j) => proposals.push({ old: b, neu: res[j] || b }));
      out.innerHTML = `<div class="muted small"><span class="spinner"></span> ${proposals.length}/${bullets.length} done…</div>`;
    }
  } catch (e) { out.innerHTML = `<div class="muted small">AI error: ${escapeHtml(e.message)}</div>`; busy(btn, false); return; }
  busy(btn, false);
  out.innerHTML = `<div class="label">Review rewrites for “${escapeHtml(sec.title)}” <span class="muted">— uncheck any you don't want; verify every fact</span></div>` +
    proposals.map((p, i) => `<label class="prop"><input type="checkbox" data-i="${i}" ${p.neu !== p.old ? 'checked' : ''}><div><div>${escapeHtml(p.neu)}</div><div class="old">${escapeHtml(p.old)}</div></div></label>`).join('') +
    '<div class="row" style="margin-top:8px"><button class="btn small primary" id="aiBulOk">Apply selected</button><button class="btn small ghost" id="aiCancel">Discard</button></div>';
  $('#aiBulOk').onclick = () => {
    out.querySelectorAll('input[type=checkbox]').forEach(cb => { if (cb.checked) { const i = +cb.dataset.i; lines[bIdx[i]] = '- ' + proposals[i].neu; } });
    sec.body = lines.join('\n'); renderEditor(); changed(); out.hidden = true; toast('Bullets updated');
  };
  $('#aiCancel').onclick = () => (out.hidden = true);
});

/* ---------------- Export ---------------- */
const fileBase = () => `${(model.name || 'Resume').replace(/[^\w ]/g, '').trim().replace(/\s+/g, '_')}${job?.company ? '_' + job.company.replace(/[^\w ]/g, '').trim().replace(/\s+/g, '_') : ''}`;
$('#pdfBtn').addEventListener('click', () => {
  const prev = document.title; document.title = fileBase();
  const hl = $('#hl').checked; if (hl) { $('#hl').checked = false; renderPreview(); }
  toast('Choose “Save as PDF” as the destination', 2500);
  setTimeout(() => { window.print(); document.title = prev; if (hl) { $('#hl').checked = true; renderPreview(); } }, 300);
});
$('#docxBtn').addEventListener('click', () => download(fileBase() + '.docx', modelToDocx(model)));
$('#txtBtn').addEventListener('click', () => download(fileBase() + '.txt', modelToText(model)));
$('#resetBtn').addEventListener('click', () => {
  if (!S.resume?.text || !confirm('Discard all edits for this job and reload your uploaded resume?')) return;
  model = parseResumeModel(S.resume.text); renderEditor(); changed();
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
renderPreview();
rescore();
initAI();
