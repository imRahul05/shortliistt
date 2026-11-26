import { getState, save, addHistory, fileToDataURL } from '../lib/storage.js';
import { analyzeJob, matchJob, effectiveProfile, findSkills, experienceRanges, experienceIntervals, workText, candidateYears } from '../lib/matcher.js';
import { SKILLS, SKILL_BY_NAME } from '../lib/skills.js';
import { extractResumeFile, cleanResumeText } from '../lib/resume-parser.js';
import { parseResumeModel, modelSections } from '../lib/resume-model.js';
import { aiAvailability, AI_LABEL, aiInsights, aiAnswer, aiCoverLetter, downloadModel, aiParseResume, aiJobRequirements } from '../lib/ai.js';
import { autofillPage } from '../lib/autofill.js';
import { $, $$, toast, md, download, busy, scoreClass, scoreColor, fallbackCoverLetter, ICON, MARK, fmtMonths, fmtMonth } from '../lib/ui.js';
import { escapeHtml as esc, debounce } from '../lib/text.js';

let S = await getState();
let job = null, jobA = null, match = null, aiState = 'unsupported', currentTabId = null;
const aiReqCache = new Map();

/* ---------------- Icons ---------------- */
$('#brandMark').outerHTML = MARK;
$$('[data-icon]').forEach(el => (el.innerHTML = ICON[el.dataset.icon] || ''));
$$('[data-icon-l]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.iconL] || ''));

/* ---------------- Tabs ---------------- */
function showTab(name) {
  $$('.seg button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('main > section').forEach(s => (s.hidden = s.id !== `tab-${name}`));
}
$$('.seg button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto);
  const c = e.target.closest('[data-copy]'); if (c) navigator.clipboard.writeText($('#' + c.dataset.copy).value).then(() => toast('Copied'));
});

const prof = () => effectiveProfile(S.resume, S.profile);
const tone = s => (s >= 75 ? ['var(--good)', 'var(--good-soft)'] : s >= 55 ? ['var(--warn)', 'var(--warn-soft)'] : ['var(--bad)', 'var(--bad-soft)']);
const aiOn = () => aiState === 'available';

/* ---------------- AI status ---------------- */
async function refreshAI() {
  aiState = S.settings.useAI ? await aiAvailability() : 'unsupported';
  const pill = $('#aiPill');
  pill.className = 'pill' + (aiOn() ? ' on' : aiState === 'downloadable' ? ' dl' : '');
  $('.t', pill).textContent = !S.settings.useAI ? 'AI off' : aiOn() ? 'Local AI' : aiState === 'downloadable' ? 'Enable local AI' : aiState === 'downloading' ? 'Downloading AI…' : 'Rule-based';
  pill.title = AI_LABEL[aiState] || '';
  $('#aiSetup').textContent = aiSetupHelp();
  $('#aiCard').hidden = !aiOn();
  if (match) runAIRequirements();
}
function aiSetupHelp() {
  if (!S.settings.useAI) return 'Off. Matching is rule-based and works fully without AI.';
  if (aiOn()) return 'Gemini Nano is ready. It adds resume parsing, a requirements read, rewrites and cover letters — all on this device.';
  if (aiState === 'downloadable' || aiState === 'downloading') return 'Click “Enable local AI” at the top to download Chrome’s built-in model once (about 22 GB free disk needed).';
  return 'Chrome’s built-in AI isn’t available here (desktop Chrome 138+ with enough memory). Everything else works without it.';
}
$('#aiPill').addEventListener('click', async () => {
  if (aiState !== 'downloadable') return;
  const t = $('#aiPill .t');
  try { await downloadModel(p => (t.textContent = `Downloading ${Math.round(p * 100)}%`)); toast('Local AI is ready'); }
  catch (e) { toast('Download failed: ' + e.message, 4000); }
  refreshAI();
});

/* ---------------- Scanning ---------------- */
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return t; }

async function scan() {
  const t = await activeTab();
  currentTabId = t?.id;
  if (!S.resume?.text) { showState('needResume'); }
  if (!t || !/^https?:/.test(t.url || '')) return setNoJob();
  const btns = [$('#scanBtn'), $('#scanBtn2')];
  btns.forEach(b => b.disabled = true);
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/extract.js'] });
    if (!result?.ok) setNoJob(); else setJob(result);
  } catch (e) { setNoJob(`This page can’t be read (${e.message}).`); }
  finally { btns.forEach(b => b.disabled = false); }
}

function showState(which) {
  $('#needResume').hidden = which !== 'needResume';
  $('#noJob').hidden = which !== 'noJob';
  $('#jobHead').hidden = !(which === 'job' || which === 'needResume') || !job;
  $('#result').hidden = which !== 'job';
}

function setNoJob(msg) {
  job = jobA = match = null;
  if (msg) $('#noJobMsg').textContent = msg;
  showState(S.resume?.text ? 'noJob' : 'needResume');
}

function setJob(j) {
  job = j;
  jobA = analyzeJob(j);
  $('#jobTitle').textContent = j.title || 'Untitled role';
  $('#jobMeta').textContent = [j.company, j.location].filter(Boolean).join(' · ') || new URL(j.url, 'https://x').hostname;
  $('#jobSrc').textContent = `via ${j.source || 'page'}`;
  save({ currentJob: j });
  rescore();
}

function rescore() {
  if (!jobA) return;
  if (!S.resume?.text) { showState('needResume'); return; }
  match = matchJob(jobA, { text: S.resume.text, sections: S.resume.sections, profile: prof() });
  showState('job');
  renderMatch();
  addHistory({ url: job.url, title: job.title, company: job.company, score: match.score }).then(renderHistory);
  runAIRequirements();
}

/* ---------------- Rendering ---------------- */
const pct = v => (v == null ? '–' : Math.round(v * 100));
const STATUS = { matched: 'check', implied: 'implied', related: 'partial', missing: 'x' };

function renderMatch() {
  const m = match;
  const [fg, bg] = tone(m.score);
  $('#scoreNum').textContent = m.score;
  const v = $('#verdict'); v.textContent = m.verdict; v.style.color = fg; v.style.background = bg;
  const must = m.skills.filter(s => s.importance === 'must' && !s.generic);
  const mustHave = must.filter(s => s.status === 'matched' || s.status === 'implied').length;
  const y = m.years;
  $('#scoreSub').textContent = [must.length ? `${mustHave} of ${must.length} must-haves` : '', y.required != null ? `${y.candidate} of ${y.required}+ yrs` : ''].filter(Boolean).join(' · ') || 'Based on skills and keywords';
  const meter = $('#meter'); meter.style.background = fg; meter.style.width = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => (meter.style.width = m.score + '%')));
  $('#bars').innerHTML = [['Skills', m.parts.skills], ['Experience', m.parts.experience], ['Keywords', m.parts.keywords], ['Title', m.parts.title], ['Education', m.parts.education]]
    .map(([k, val]) => `<div class="bar ${val == null ? 'na' : ''}"><span>${k}</span><div class="track"><div class="fill" style="width:${val == null ? 0 : pct(val)}%"></div></div><b>${pct(val)}</b></div>`).join('');

  const groups = [['must', 'Must-have'], ['important', 'Important'], ['nice', 'Nice to have']];
  const technical = m.skills.filter(s => !s.generic || s.importance === 'must');
  const have = technical.filter(s => s.status === 'matched' || s.status === 'implied').length;
  $('#reqCount').textContent = technical.length ? `${have}/${technical.length}` : '';
  $('#skillGroups').innerHTML = groups.map(([imp, label]) => {
    const rows = technical.filter(s => s.importance === imp);
    if (!rows.length) return '';
    const n = rows.filter(r => r.status === 'matched' || r.status === 'implied').length;
    const limit = imp === 'nice' ? 5 : 10;
    return `<div class="group"><div class="group-title"><span>${label}</span><span>${n}/${rows.length}</span></div>${rows.map((r, i) => reqRow(r, i >= limit)).join('')}${rows.length > limit ? `<button class="more" data-more>Show ${rows.length - limit} more</button>` : ''}</div>`;
  }).join('') || '<p class="muted small" style="margin:0">No technical skills recognised in this posting — the score leans on keywords and title.</p>';

  const e = m.education, facts = [];
  if (y.required != null) {
    const cls = y.candidate >= y.required ? 'ok' : y.candidate >= y.required * 0.7 ? 'meh' : 'no';
    facts.push(fact(`Experience${y.inferred ? ' <span class="faint">· from title</span>' : ''}`, `${y.required}+ yrs asked · <span class="${cls}">you ${y.candidate}</span>`));
  } else facts.push(fact('Experience', `not stated · you ${y.candidate || 0} yrs`));
  facts.push(fact('Your years from', esc(y.source)));
  if (e.required) facts.push(fact('Degree', `${esc(e.required)}${e.flexible ? ' or equiv.' : ''} · <span class="${e.candidate ? 'ok' : 'no'}">${esc(e.candidate || 'not found')}</span>`));
  if (m.seniority) facts.push(fact('Seniority', esc(m.seniority)));
  $('#facts').innerHTML = facts.join('');

  const found = m.keywords.filter(k => k.found).length;
  $('#kwCount').textContent = m.keywords.length ? `${found}/${m.keywords.length}` : '';
  $('#keywords').innerHTML = m.keywords.length ? m.keywords.map(k => `<span class="chip ${k.found ? 'kw-found' : 'kw-missing'}" title="${k.n}× in the job">${esc(k.word)}</span>`).join('') : '<span class="muted small">No repeated keywords.</span>';
  $('#sugs').innerHTML = m.suggestions.map(s => `<li class="${s.level}">${esc(s.text)}</li>`).join('') || '<li class="tip">Nothing major to fix.</li>';
  $('#aiInsights').innerHTML = 'A short, honest read of your fit, written on your device.';
}
const fact = (k, v) => `<div class="fact"><span class="k">${k}</span><span class="v">${v}</span></div>`;

function reqRow(r, hidden) {
  const note = r.status === 'implied' ? `via ${r.via}` : r.status === 'related' ? `you have ${r.via}` : r.status === 'missing' ? 'not in resume' : r.count > 1 ? `${r.count}× in job` : '';
  return `<div class="req ${r.status}" ${hidden ? 'hidden data-extra' : ''} data-skill="${esc(r.name)}">
    <span class="ic">${ICON[STATUS[r.status]]}</span><span class="nm">${esc(r.name)}</span><span class="note">${esc(note)}</span>
    ${r.status === 'missing' ? '<button class="btn ghost small have" title="Add to your skills">I have this</button>' : ''}</div>`;
}

$('#skillGroups').addEventListener('click', async e => {
  if (e.target.closest('[data-more]')) {
    const g = e.target.closest('.group'); $$('[data-extra]', g).forEach(x => (x.hidden = false)); e.target.remove(); return;
  }
  const b = e.target.closest('.have'); if (!b) return;
  addSkill(b.closest('.req').dataset.skill);
  toast(`Added ${b.closest('.req').dataset.skill} — add it to your resume too`);
});

/* AI layer: independent read of the job's requirements, checked against the resume text. */
async function runAIRequirements() {
  const card = $('#aiReqCard');
  if (!aiOn() || !jobA || !S.resume?.text) { card.hidden = true; return; }
  card.hidden = false;
  const key = job.url + '|' + jobA.text.length;
  const out = $('#aiReq');
  let data = aiReqCache.get(key);
  if (!data) {
    out.innerHTML = '<span class="row"><span class="spinner"></span> Reading the requirements…</span>';
    $('#aiReqCount').textContent = '';
    try { data = await aiJobRequirements(jobA); aiReqCache.set(key, data); }
    catch (e) { out.textContent = 'Local AI could not read this job: ' + e.message; return; }
    if (job.url + '|' + jobA.text.length !== key) return;
  }
  const text = (S.resume.text + ' ' + (S.profile.extraSkills || '') + ' ' + (S.resume.detected?.aiSkills || []).join(' ')).toLowerCase();
  const inResume = phrase => {
    const sk = findSkills(phrase);
    if (sk.size) return [...sk.keys()].every(n => findSkills(text).has(n) || text.includes(n.toLowerCase()));
    const words = phrase.toLowerCase().split(/[^a-z0-9+#.]+/).filter(w => w.length > 2 && !/^(experience|knowledge|with|and|the|strong|skills?|years?)$/.test(w));
    return words.length > 0 && words.every(w => text.includes(w.replace(/s$/, '')));
  };
  const rows = [...(data.mustHave || []).map(p => ({ p, imp: 'Must-have' })), ...(data.niceToHave || []).map(p => ({ p, imp: 'Nice to have' }))].slice(0, 20);
  const ok = rows.filter(r => inResume(r.p)).length;
  $('#aiReqCount').textContent = rows.length ? `${ok}/${rows.length}` : '';
  out.classList.remove('muted', 'small');
  out.innerHTML = rows.map(r => { const has = inResume(r.p); return `<div class="req ${has ? 'matched' : 'missing'}"><span class="ic">${ICON[has ? 'check' : 'x']}</span><span class="nm">${esc(r.p)}</span><span class="note">${r.imp}</span></div>`; }).join('')
    + (data.minYears ? `<p class="muted small" style="margin:8px 0 0">AI reads a minimum of ${data.minYears} years. This list is a second opinion; it does not change the score.</p>` : '<p class="muted small" style="margin:8px 0 0">A second opinion from local AI; it does not change the score.</p>');
}

/* ---------------- Job editor ---------------- */
const openEditor = () => {
  $('#jobEditor').hidden = false;
  $('#jeTitle').value = job?.title || ''; $('#jeCompany').value = job?.company || ''; $('#jeDesc').value = job?.description || '';
  $('#jeDesc').focus();
};
$('#editJobBtn').addEventListener('click', openEditor);
$('#pasteBtn').addEventListener('click', openEditor);
$('#jeCancel').addEventListener('click', () => ($('#jobEditor').hidden = true));
$('#jeApply').addEventListener('click', async () => {
  if ($('#jeDesc').value.trim().length < 80) return toast('Paste the full job description');
  const t = await activeTab();
  setJob({ ok: true, url: job?.url || t?.url || 'manual', title: $('#jeTitle').value.trim(), company: $('#jeCompany').value.trim(), description: $('#jeDesc').value, source: 'pasted', location: job?.location || '' });
  $('#jobEditor').hidden = true;
});
$('#scanBtn').addEventListener('click', scan);
$('#scanBtn2').addEventListener('click', scan);

$('#aiInsightsBtn').addEventListener('click', async () => {
  if (!match) return;
  const btn = $('#aiInsightsBtn'), out = $('#aiInsights');
  busy(btn, true, 'Thinking…'); out.classList.remove('muted'); out.innerHTML = '';
  try { await aiInsights({ jobA, resumeText: S.resume.text, match }, { onChunk: t => (out.innerHTML = md(t)) }); }
  catch (e) { out.innerHTML = `<p class="muted">Local AI error: ${esc(e.message)}</p>`; }
  busy(btn, false);
});

$('#tailorBtn').addEventListener('click', async () => {
  await save({ currentJob: job });
  chrome.tabs.create({ url: chrome.runtime.getURL('studio/studio.html') });
});

/* ---------------- Apply tab ---------------- */
$('#autofillBtn').addEventListener('click', async () => {
  const t = await activeTab();
  if (!t || !/^https?:/.test(t.url || '')) return toast('Open an application form first');
  const btn = $('#autofillBtn'); busy(btn, true, 'Filling…');
  try {
    const file = S.resume?.fileData ? { dataURL: S.resume.fileData, name: S.resume.fileName } : null;
    const res = await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, func: autofillPage, args: [S.profile, file] });
    const tot = res.reduce((a, r) => ({ filled: a.filled + (r.result?.filled || 0), attached: a.attached + (r.result?.attached || 0) }), { filled: 0, attached: 0 });
    $('#autofillStatus').textContent = tot.filled || tot.attached ? `${tot.filled} field${tot.filled === 1 ? '' : 's'} filled${tot.attached ? ' · resume attached' : ''}` : 'No empty fields matched';
  } catch (e) { $('#autofillStatus').textContent = 'Can’t access this page'; }
  busy(btn, false);
});

$('#qBtn').addEventListener('click', async () => {
  const q = $('#qText').value.trim(); if (!q) return toast('Type the question first');
  if (!S.resume?.text) return toast('Upload your resume first');
  const btn = $('#qBtn'), out = $('#qOut');
  if (!aiOn()) { out.value = `Situation:\nWhat I did:\nResult (numbers):\nWhy it matters for ${jobA?.company || 'this role'}:`; toast('Local AI unavailable — here is a structure to fill'); return; }
  busy(btn, true, 'Drafting…');
  try { await aiAnswer({ jobA, resumeText: S.resume.text, question: q }, { onChunk: t => (out.value = t) }); }
  catch (e) { out.value = 'Local AI error: ' + e.message; }
  busy(btn, false);
});

$('#clBtn').addEventListener('click', async () => {
  if (!match) return toast('Open a job first');
  const btn = $('#clBtn'), out = $('#clOut');
  const fallback = () => fallbackCoverLetter({ jobA, match, profile: S.profile, model: parseResumeModel(S.resume.text) });
  if (!aiOn()) { out.value = fallback(); return; }
  busy(btn, true, 'Writing…');
  try { await aiCoverLetter({ jobA, resumeText: S.resume.text, profile: S.profile }, { onChunk: t => (out.value = t) }); }
  catch { out.value = fallback(); }
  busy(btn, false);
});
$('#clDl').addEventListener('click', () => download(`Cover Letter - ${(job?.company || 'job').replace(/[^\w -]/g, '')}.txt`, $('#clOut').value));

async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  $('#history').innerHTML = history.slice(0, 20).map(h => `<li><span class="sc ${scoreClass(h.score)}">${h.score}</span><div class="meta"><a href="${esc(h.url)}" target="_blank">${esc(h.title || h.url)}</a><div class="muted small">${esc(h.company || '')}${h.company ? ' · ' : ''}${new Date(h.at).toLocaleDateString()}</div></div></li>`).join('') || '<li class="muted small">Jobs you open appear here.</li>';
}

/* ---------------- Profile: resume ---------------- */
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
$('#fileIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });

const setStatus = html => ($('#parseStatus').innerHTML = html);

async function handleFile(file) {
  setStatus('<span class="spinner"></span> Reading your resume…');
  try {
    const text = await extractResumeFile(file);
    if (text.length < 100) throw new Error('Almost no text found. If this is a scanned PDF, export a text-based PDF or paste the text below.');
    const fileData = file.size < 6e6 ? await fileToDataURL(file) : null;
    await storeResume(text, { fileName: file.name, fileType: file.type, fileData, detected: {} });
    prefillProfile(text);
    setStatus('');
    toast('Resume added');
    rescore();
    enhanceWithAI();
  } catch (e) {
    setStatus(esc(e.message));
    $('#resumeTextBox').open = true;
  }
}

async function storeResume(text, extra = {}) {
  const model = parseResumeModel(text);
  S.resume = { ...(S.resume || {}), ...extra, text, sections: modelSections(model), updatedAt: Date.now() };
  await save({ resume: S.resume, tailored: {} });
  renderResume();
}

/** AI layer: fill what the rule-based parser could not (years when no dates, extra skills, title). */
async function enhanceWithAI() {
  if (!aiOn() || !S.resume?.text) return;
  setStatus('<span class="spinner"></span> Local AI is reading your resume…');
  try {
    const r = await aiParseResume(S.resume.text);
    const known = new Set([...findSkills(S.resume.text).keys()].map(n => n.toLowerCase()));
    const aiSkills = [...new Set((r.skills || []).map(s => String(s).trim()).filter(s => s && s.length < 40))]
      .map(s => { const hit = [...findSkills(s).keys()][0]; return hit || s; })
      .filter(s => !known.has(s.toLowerCase())).slice(0, 25);
    S.resume.detected = { aiSkills, aiYears: +r.totalYears || 0, aiTitle: r.currentTitle || '', aiRoles: r.roles || [] };
    await save({ resume: S.resume });
    if (!S.profile.targetTitle && r.currentTitle) { S.profile.targetTitle = r.currentTitle; await save({ profile: S.profile }); fillProfileForm(); }
    setStatus(`<span class="ok">Enhanced by local AI</span> · ${aiSkills.length} more skill${aiSkills.length === 1 ? '' : 's'} found`);
    renderResume(); rescore();
  } catch (e) { setStatus(''); }
}

function prefillProfile(text) {
  const p = S.profile, model = parseResumeModel(text);
  p.name ||= model.name;
  p.email ||= text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || '';
  p.phone ||= text.match(/\+?\d[\d\s().-]{8,}\d/)?.[0]?.trim() || '';
  p.linkedin ||= text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+/i)?.[0] || '';
  p.github ||= text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w\-]+/i)?.[0] || '';
  p.location ||= text.slice(0, 600).match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s*(?:[A-Z]{2}|[A-Z][a-zA-Z]+))\b/)?.[1] || '';
  if (!p.targetTitle && model.headline && model.headline.length < 80) p.targetTitle = model.headline.split(/[|•·,]/)[0].trim();
  if (!p.currentCompany) {
    const first = experienceRanges(workText(text, modelSections(model))).sort((a, b) => b.end - a.end)[0];
    const co = first?.label.match(/(?:—|-|@|\bat\b|,|\|)\s*([A-Z][\w&.\- ]{1,40}?)\s*(?:[,|(]|\s{2,}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}|\d{4}|$)/i)?.[1];
    if (co) p.currentCompany = co.trim();
  }
  for (const k of ['linkedin', 'github']) if (p[k] && !/^https?:/.test(p[k])) p[k] = 'https://' + p[k];
  save({ profile: p });
  fillProfileForm();
}

function renderResume() {
  const r = S.resume;
  $('#drop').hidden = !!r?.text;
  $('#fileRow').hidden = !r?.text;
  $('#detectCard').hidden = $('#skillsCard').hidden = !r?.text;
  if (!r?.text) return;
  $('#fileName').textContent = r.fileName || 'Pasted resume';
  const kinds = (r.sections || []).map(s => s.title);
  $('#fileSub').textContent = `${r.text.split(/\s+/).length} words · ${kinds.length ? kinds.join(', ') : 'no sections found'}`;
  if (document.activeElement !== $('#resumeText')) $('#resumeText').value = r.text;

  // Experience
  const wt = workText(r.text, r.sections);
  const ranges = experienceRanges(wt).sort((a, b) => b.end - a.end || b.start - a.start);
  const nowM = new Date().getFullYear() * 12 + new Date().getMonth();
  const total = experienceIntervals(wt).reduce((a, [s, e]) => a + (e - s), 0);
  const cy = candidateYears(r.text, r.sections, S.profile.yearsExperience, r.detected?.aiYears);
  $('#yearsTotal').textContent = S.profile.yearsExperience ? `${S.profile.yearsExperience} yrs (override)` : total ? fmtMonths(total) : cy.years ? `${cy.years} yrs · ${cy.source}` : '';
  $('#roles').innerHTML = ranges.length ? ranges.slice(0, 8).map(x => `<li><span class="rl" title="${esc(x.label)}">${esc(cleanLabel(x.label) || 'Role')}</span><span class="rd">${fmtMonth(x.start)} – ${x.end >= nowM ? 'Present' : fmtMonth(x.end - 1)} · ${fmtMonths(x.end - x.start)}</span></li>`).join('')
    : `<li class="empty-roles">No date ranges found in your work history.${cy.source === 'local AI' ? ` Local AI estimates ${cy.years} years.` : ' Set your years below.'}</li>`;
  $('#yearsOverride').placeholder = total ? `${Math.round(total / 1.2) / 10} detected` : 'e.g. 3';
  $('#yearsOverride').value = S.profile.yearsExperience ?? '';
  renderSkills();
}
const cleanLabel = l => l.replace(/\(?\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s*['’]?\d{2,4}|\d{1,2}[\/.-]\d{4}|\d{4}(?:[\/.-]\d{1,2})?)\s*(?:-|–|—|to|until|till)?\s*(?:present|current|now|ongoing|till date)?\)?/gi, '').replace(/[|·•,–—-]\s*$/g, '').replace(/\s{2,}/g, ' ').trim();

/* ---------------- Profile: skills ---------------- */
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
function mySkills() {
  const removed = new Set(list(S.profile.removedSkills));
  const det = [...findSkills(S.resume?.text || '').keys()].filter(n => !SKILL_BY_NAME.get(n)?.generic);
  const ai = (S.resume?.detected?.aiSkills || []);
  const added = list(S.profile.extraSkills);
  const out = new Map();
  for (const n of det) out.set(n, 'resume');
  for (const n of ai) if (!out.has(n)) out.set(n, 'ai');
  for (const n of added) if (!out.has(n)) out.set(n, 'added');
  return [...out].filter(([n]) => !removed.has(n));
}
function renderSkills() {
  const items = mySkills();
  $('#skillCount').textContent = items.length || '';
  $('#mySkills').innerHTML = items.map(([n, src]) => `<span class="chip" data-skill="${esc(n)}">${esc(n)}${src === 'ai' ? ' <span class="ai">AI</span>' : ''}<button class="x" title="Remove">×</button></span>`).join('') || '<span class="muted small">No skills detected yet.</span>';
}
async function addSkill(name) {
  name = name.trim(); if (!name) return;
  const canon = SKILLS.find(s => s.name.toLowerCase() === name.toLowerCase())?.name || [...findSkills(name).keys()][0] || name;
  S.profile.removedSkills = list(S.profile.removedSkills).filter(n => n !== canon).join(', ');
  const added = list(S.profile.extraSkills); if (!added.includes(canon)) added.push(canon);
  S.profile.extraSkills = added.join(', ');
  await save({ profile: S.profile });
  renderSkills(); rescore();
}
$('#mySkills').addEventListener('click', async e => {
  const x = e.target.closest('.x'); if (!x) return;
  const n = x.closest('.chip').dataset.skill;
  S.profile.extraSkills = list(S.profile.extraSkills).filter(s => s !== n).join(', ');
  const rem = list(S.profile.removedSkills); if (!rem.includes(n)) rem.push(n);
  S.profile.removedSkills = rem.join(', ');
  await save({ profile: S.profile });
  renderSkills(); rescore();
});
$('#addSkill').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(e.target.value); e.target.value = ''; } });
$('#skillList').innerHTML = SKILLS.filter(s => !s.generic).map(s => `<option value="${esc(s.name)}">`).join('');
$('#yearsOverride').addEventListener('input', debounce(async e => {
  S.profile.yearsExperience = e.target.value.trim();
  await save({ profile: S.profile }); renderResume(); rescore();
}, 500));

$('#saveResumeText').addEventListener('click', async () => {
  await storeResume(cleanResumeText($('#resumeText').value), { detected: S.resume?.detected || {} });
  toast('Saved'); rescore();
});

/* ---------------- Profile: details & settings ---------------- */
function fillProfileForm() { for (const el of $('#profileForm').elements) if (el.name && document.activeElement !== el) el.value = S.profile[el.name] ?? ''; }
$('#profileForm').addEventListener('input', debounce(async () => {
  for (const el of $('#profileForm').elements) if (el.name) S.profile[el.name] = el.value.trim();
  await save({ profile: S.profile });
  $('#profileSaved').textContent = 'Saved';
  setTimeout(() => ($('#profileSaved').textContent = ''), 1200);
  rescore();
}, 500));

$('#setWidget').addEventListener('change', e => { S.settings.widget = e.target.checked; save({ settings: S.settings }); });
$('#setPos').addEventListener('change', e => { S.settings.widgetPos = e.target.value; save({ settings: S.settings }); });
$('#setAI').addEventListener('change', e => { S.settings.useAI = e.target.checked; save({ settings: S.settings }); refreshAI(); });
$('#wipe').addEventListener('click', async () => {
  if (!confirm('Delete your resume, profile, history and tailored resumes from this browser?')) return;
  await chrome.storage.local.clear(); location.reload();
});

/* ---------------- Live updates ---------------- */
const autoScan = debounce(scan, 900);
chrome.tabs.onActivated.addListener(() => autoScan());
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && (info.status === 'complete' || info.url)) autoScan(); });
chrome.runtime.onMessage.addListener(msg => {
  // The content script detected a (new) job — e.g. LinkedIn switched jobs without a page load.
  if (msg?.type === 'job-detected' && msg.tabId === currentTabId && msg.job?.ok) {
    if (!job || job.url !== msg.job.url || job.description !== msg.job.description) setJob(msg.job);
  }
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.profile && JSON.stringify(ch.profile.newValue) !== JSON.stringify(S.profile)) { S.profile = ch.profile.newValue || {}; fillProfileForm(); renderResume(); }
});

/* ---------------- Init ---------------- */
fillProfileForm();
renderResume();
$('#setWidget').checked = S.settings.widget !== false;
$('#setPos').value = S.settings.widgetPos || 'br';
$('#setAI').checked = S.settings.useAI;
renderHistory();
await refreshAI();
if (S.resume?.text && !S.resume.detected?.aiSkills && aiOn()) enhanceWithAI();
scan();
