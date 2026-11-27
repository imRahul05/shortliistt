import { getState, save, addHistory, fileToDataURL } from '../lib/storage.js';
import { analyzeJob, matchJob, effectiveProfile, isOwnContent, findSkills, experienceRanges, experienceIntervals, workText, candidateYears } from '../lib/matcher.js';
import { SKILLS, SKILL_BY_NAME } from '../lib/skills.js';
import { extractResumeFile, cleanResumeText, stripRich } from '../lib/resume-parser.js';
import { templateLetter, defaultLetterMeta, relevantEntries } from '../lib/letter.js';
import { STATUSES, STATUS_LABEL, appKey, getApps, upsertApp, removeApp, dueFollowUps, agoText, toCSV } from '../lib/tracker.js';
import { importGitHub, importLinkedIn, githubUsername, mergeList, KEYS, yearsFromWork, fmtYM, parseMonth } from '../lib/importers.js';
import { parseResumeModel, modelSections } from '../lib/resume-model.js';
import { aiAvailability, AI_LABEL, aiInsights, aiAnswer, aiCoverLetter, downloadModel, aiParseResume, aiJobRequirements, summarizeJob } from '../lib/ai.js';
import { $, $$, toast, md, download, busy, scoreClass, scoreColor, ICON, MARK, fmtMonths, fmtMonth } from '../lib/ui.js';
import { escapeHtml as esc, debounce } from '../lib/text.js';

let S = await getState();
let job = null, jobA = null, match = null, aiState = 'unsupported', currentTabId = null;
const aiReqCache = new Map();

/* ---------------- Icons ---------------- */
$('#brandMark').outerHTML = MARK;
$$('[data-icon]').forEach(el => (el.innerHTML = ICON[el.dataset.icon] || ''));
$$('[data-icon-l]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.iconL] || ''));

/* ---------------- Collapsible cards ---------------- */
let collapsed = {};
try { collapsed = JSON.parse(localStorage.getItem('sl-collapsed') || '{}'); } catch {}
$$('.card.collapsible').forEach(card => {
  const h = card.querySelector(':scope > h3');
  h.insertAdjacentHTML('beforeend', `<span class="chev">${ICON.chevron}</span>`);
  if (collapsed[card.id]) card.classList.add('collapsed');
  h.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    card.classList.toggle('collapsed');
    collapsed[card.id] = card.classList.contains('collapsed');
    try { localStorage.setItem('sl-collapsed', JSON.stringify(collapsed)); } catch {}
  });
});

/* ---------------- Tabs ---------------- */
function showTab(name) {
  $$('.seg button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('main > section').forEach(s => (s.hidden = s.id !== `tab-${name}`));
  if (name === 'apply') { autoLetter(); refreshForm(); }
  if (name === 'tracker') renderTracker();
}
$$('.seg button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto);
  const c = e.target.closest('[data-copy]'); if (c) navigator.clipboard.writeText($('#' + c.dataset.copy).value).then(() => toast('Copied'));
});

const prof = () => effectiveProfile(S.resume, S.profile, S.profileData);
const tone = s => (s >= 75 ? ['var(--good)', 'var(--good-soft)'] : s >= 55 ? ['var(--warn)', 'var(--warn-soft)'] : ['var(--bad)', 'var(--bad-soft)']);
const aiOn = () => aiState === 'available';

/* ---------------- AI status ---------------- */
async function refreshAI() {
  aiState = S.settings.useAI ? await aiAvailability() : 'unsupported';
  const pill = $('#aiPill');
  pill.className = 'pill' + (aiOn() ? ' on' : aiState === 'downloadable' ? ' dl' : '');
  $('.t', pill).textContent = !S.settings.useAI ? 'AI off' : aiOn() ? 'AI ready' : aiState === 'downloadable' ? 'Enable AI' : aiState === 'downloading' ? 'Downloading AI…' : 'No AI';
  pill.title = AI_LABEL[aiState] || '';
  $('#aiSetup').textContent = aiSetupHelp();
  const canAI = aiOn() || aiState === 'downloadable';
  $('#aiRow').hidden = !canAI;
  $('#aiInsightsBtn').lastChild.textContent = aiOn() ? ' Generate AI insights' : ' Enable AI to get insights';
  $('#clAiBtn').hidden = $('#qBtn').hidden = !aiOn();
  if (match) runBrief().finally(runAIRequirements);
}
function aiSetupHelp() {
  if (!S.settings.useAI) return 'Off. Matching is rule-based and works fully without AI.';
  if (aiOn()) return 'Chrome’s built-in AI (Gemini Nano) is ready: insights, resume parsing, job summaries, rewrites, proofreading and cover letters. It runs on this device and is free.';
  if (aiState === 'downloadable' || aiState === 'downloading') return 'Click “Enable AI” at the top to download Chrome’s built-in model once (about 22 GB free disk needed).';
  return 'Chrome’s built-in AI isn’t available here (desktop Chrome 138+ with enough memory). Everything else works without it.';
}
async function enableAI() {
  if (aiState !== 'downloadable') return false;
  const t = $('#aiPill .t');
  try { await downloadModel(p => (t.textContent = `Downloading ${Math.round(p * 100)}%`)); toast('AI is ready'); }
  catch (e) { toast('Download failed: ' + e.message, 4000); }
  await refreshAI();
  return aiOn();
}
$('#aiPill').addEventListener('click', enableAI);

/* ---------------- Scanning ---------------- */
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return t; }

// Automatic scans are as strict as the on-page card; pressing Re-scan also accepts weaker matches.
async function scan(manual = false) {
  const t = await activeTab();
  currentTabId = t?.id;
  if (!S.resume?.text) { showState('needResume'); }
  if (!t || !/^https?:/.test(t.url || '')) return setNoJob();
  const btns = [$('#scanBtn'), $('#scanBtn2')];
  btns.forEach(b => b.disabled = true);
  try {
    // Same frames the on-page card looks at: the page itself, then embedded job boards (confident only).
    const frames = await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content/extract.js'] });
    const top = frames.find(f => f.frameId === 0)?.result;
    const result = top?.ok && (top.confident || manual) ? top : frames.map(f => f.result).find(r => r?.ok && r.confident);
    if (!result?.ok) return setNoJob();
    const own = isOwnContent(result, S.resume?.text, S.profile);
    if (own) return setNoJob(own === 'portfolio' ? 'This is your own portfolio, so there is no job to score here.' : own === 'profile' ? 'This is your own profile page, so there is no job to score here.' : 'This page looks like your own resume, so there is no job to score here.');
    setJob(result);
  } catch (e) { setNoJob(`This page can’t be read (${e.message}).`); }
  finally { btns.forEach(b => b.disabled = false); }
}

function showState(which) {
  $('#needResume').hidden = which !== 'needResume';
  $('#noJob').hidden = which !== 'noJob';
  $('#jobHead').hidden = !(which === 'job' || which === 'needResume') || !job;
  $('#result').hidden = which !== 'job';
}

const NO_JOB_MSG = $('#noJobMsg').textContent;
function setNoJob(msg) {
  job = jobA = match = null;
  $('#noJobMsg').textContent = msg || NO_JOB_MSG;
  showState(S.resume?.text ? 'noJob' : 'needResume');
}

function setJob(j) {
  job = j;
  jobA = analyzeJob(j);
  $('#aiCard').hidden = true; $('#aiInsights').innerHTML = '';
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
  renderTrackRow();
  addHistory({ url: job.url, title: job.title, company: job.company, score: match.score }).then(renderHistory);
  runBrief().finally(runAIRequirements);
  if (!$('#tab-apply').hidden) autoLetter();
  maybePending();
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
const briefCache = new Map();
/** Key points of the job (Chrome Summarizer API, or the Prompt API as a fallback). Cached per job. */
async function runBrief() {
  const card = $('#cBrief');
  if (!aiOn() || !jobA) { card.hidden = true; return; }
  const key = job.url + '|' + jobA.text.length, out = $('#brief');
  card.hidden = false;
  let r = briefCache.get(key);
  if (!r) {
    out.innerHTML = '<span class="row muted"><span class="spinner"></span> Summarizing the job…</span>'; $('#briefSrc').textContent = '';
    try { r = await summarizeJob(jobA, { onChunk: t => { if (job?.url + '|' + jobA?.text.length === key) out.innerHTML = md(t); } }); briefCache.set(key, r); }
    catch (e) { out.innerHTML = `<p class="muted">Couldn’t summarize this job: ${esc(e.message)}</p>`; return; }
    if (job?.url + '|' + jobA?.text.length !== key) return;
  }
  out.innerHTML = md(r.text);
  $('#briefSrc').textContent = r.engine === 'summarizer' ? 'Summarizer' : '';
  $('#briefSrc').title = r.engine === 'summarizer' ? 'Chrome’s built-in Summarizer API' : '';
}

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
    catch (e) { out.textContent = 'AI could not read this job: ' + e.message; return; }
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
    + `<p class="muted small" style="margin:8px 0 0">${data.minYears ? `AI reads a minimum of ${data.minYears} years. ` : ''}A second opinion from AI — it does not change the score.</p>`;
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
$('#scanBtn').addEventListener('click', () => scan(true));
$('#scanBtn2').addEventListener('click', () => scan(true));

async function runInsights() {
  if (!match) return;
  if (!aiOn() && !(await enableAI())) return;
  const btn = $('#aiInsightsBtn'), out = $('#aiInsights');
  busy(btn, true, 'Thinking…'); $('#aiCard').hidden = false; out.innerHTML = '<span class="muted">Reading the job and your resume…</span>';
  try { await aiInsights({ jobA, resumeText: S.resume.text, match, profile: S.profile }, { onChunk: t => (out.innerHTML = md(t)) }); }
  catch (e) { out.innerHTML = `<p class="muted">AI error: ${esc(e.message)}</p>`; }
  busy(btn, false);
}
$('#aiInsightsBtn').addEventListener('click', runInsights);

$('#tailorBtn').addEventListener('click', async () => {
  await save({ currentJob: job });
  chrome.tabs.create({ url: chrome.runtime.getURL('studio/studio.html') });
});

/* ---------------- Apply tab ---------------- */
/* ---------------- Apply: form detection, autofill (incl. account creation), page buttons ---------------- */
let formScan = null;
const KIND = {
  signup: ['Create-account form', 'Fills your name and email and creates a strong password, saved here so you can sign in later.', 'Autofill & create password'],
  signin: ['Sign-in form', '', 'Fill saved login'],
  application: ['Application form', 'Fills your details and attaches your resume. Review before submitting.', 'Autofill this page'],
  none: ['No form on this page', 'Open a job application, sign-up or sign-in page (Workday, Greenhouse, Lever…).', 'Autofill this page'],
};
async function refreshForm() {
  if ($('#tab-apply').hidden) return;
  const t = await activeTab();
  if (!t || !/^https?:/.test(t.url || '')) { formScan = { kind: 'none', actions: [] }; return renderForm(); }
  formScan = await chrome.runtime.sendMessage({ type: 'form-scan', tabId: t.id }).catch(() => ({ kind: 'none', actions: [] }));
  formScan.tabId = t.id;
  renderForm(); renderVault();
}
function renderForm() {
  const f = formScan || { kind: 'none', actions: [] };
  const [title, hint, btn] = KIND[f.kind] || KIND.none;
  $('#formKind').className = 'form-kind ' + f.kind;
  $('#formKindText').textContent = title + (f.kind === 'application' && f.empty ? ` · ${f.empty} empty field${f.empty === 1 ? '' : 's'}` : '');
  $('#formHost').textContent = f.host || '';
  $('#formHint').textContent = f.kind === 'signin' ? (f.account ? `Uses your saved login (${f.account.email || 'email'}).` : 'No saved login for this site yet — fills your email only.') : hint;
  const b = $('#autofillBtn'); b.lastChild.textContent = ' ' + btn; b.disabled = f.kind === 'none';
  const acts = f.actions || [];
  $('#pageActionsWrap').hidden = !acts.length;
  $('#pageActions').innerHTML = acts.slice(0, 6).map((a, i) => `<button class="btn small ${a.primary && i === acts.findIndex(x => x.primary) ? 'primary' : ''}" data-key="${esc(a.key)}" data-frame="${a.frameId}">${esc(a.label)}</button>`).join('');
}
$('#autofillBtn').addEventListener('click', async () => {
  const t = await activeTab();
  if (!t || !/^https?:/.test(t.url || '')) return toast('Open an application form first');
  if (!S.profile.email) toast('Tip: add your email in Profile so it can be filled', 3000);
  const btn = $('#autofillBtn'); busy(btn, true, 'Filling…');
  const note = $('#autofillStatus');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'autofill', tabId: t.id });
    if (r?.error) throw new Error(r.error);
    const bits = [];
    if (r.filled) bits.push(`${r.filled} field${r.filled === 1 ? '' : 's'} filled`);
    if (r.passwordFilled) bits.push(r.generated ? 'strong password created and saved below' : 'saved password filled');
    if (r.attached) bits.push('resume attached');
    if (r.photo) bits.push('photo attached');
    let html = esc(bits.length ? bits.join(' · ') : 'Nothing new to fill — the fields already have values') + '.';
    if (r.terms) html += ' <b>Tick the terms/consent checkbox on the page yourself.</b>';
    const prim = r.actions?.find(a => a.primary);
    if (prim && (r.filled || r.passwordFilled)) html += ` Then press <b style="color:inherit">${esc(prim.label)}</b> below or on the page.`;
    note.innerHTML = html; note.hidden = false;
  } catch (e) { note.textContent = e.message || 'Can’t access this page'; note.hidden = false; }
  busy(btn, false);
  refreshForm();
});
$('#pageActions').addEventListener('click', async e => {
  const b = e.target.closest('button[data-key]'); if (!b || !formScan?.tabId) return;
  const r = await chrome.runtime.sendMessage({ type: 'page-action', tabId: formScan.tabId, key: b.dataset.key, frameId: +b.dataset.frame });
  if (!r?.ok) toast('That button is no longer on the page'); else toast(`Clicked “${b.textContent}”`);
  setTimeout(refreshForm, 1500);
});

/* Saved logins created by Shortlist (per site) */
async function renderVault() {
  const host = formScan?.host;
  const { accounts = {} } = await chrome.storage.local.get('accounts');
  const acc = host && accounts[host];
  $('#vaultCard').hidden = !acc;
  if (!acc) return;
  $('#vaultHost').textContent = host;
  $('#vEmail').textContent = acc.email || '—';
  $('#vPass').textContent = '••••••••••••'; $('#vShow').textContent = 'Show';
  $('#vWhen').textContent = acc.at ? 'on ' + new Date(acc.at).toLocaleDateString() : '';
  $('#vaultCard').dataset.host = host;
}
async function vaultAcc() { const { accounts = {} } = await chrome.storage.local.get('accounts'); return accounts[$('#vaultCard').dataset.host]; }
$('#vShow').addEventListener('click', async () => {
  const a = await vaultAcc(); if (!a) return;
  const showing = $('#vShow').textContent === 'Hide';
  $('#vPass').textContent = showing ? '••••••••••••' : a.password; $('#vShow').textContent = showing ? 'Show' : 'Hide';
});
$('#vaultCard').addEventListener('click', async e => {
  const c = e.target.closest('[data-copyv]'); if (!c) return;
  const a = await vaultAcc(); if (!a) return;
  await navigator.clipboard.writeText(a[c.dataset.copyv] || ''); toast('Copied');
});
$('#vForget').addEventListener('click', async () => {
  const host = $('#vaultCard').dataset.host;
  if (!confirm(`Forget the saved login for ${host}? Make sure you have saved the password elsewhere.`)) return;
  const { accounts = {} } = await chrome.storage.local.get('accounts'); delete accounts[host];
  await save({ accounts }); renderVault();
});

$('#qBtn').addEventListener('click', async () => {
  const q = $('#qText').value.trim(); if (!q) return toast('Type the question first');
  if (!S.resume?.text) return toast('Upload your resume first');
  const btn = $('#qBtn'), out = $('#qOut');
  if (!aiOn()) { out.value = `Situation:\nWhat I did:\nResult (numbers):\nWhy it matters for ${jobA?.company || 'this role'}:`; toast('AI unavailable — here is a structure to fill'); return; }
  busy(btn, true, 'Drafting…');
  try { await aiAnswer({ jobA, resumeText: S.resume.text, question: q, profile: S.profile, match }, { onChunk: t => (out.value = t) }); }
  catch (e) { out.value = 'AI error: ' + e.message; }
  busy(btn, false);
});

/* Cover letter: drafted automatically from the resume for the current job; AI version on demand. */
let letterFor = null, letterEdited = false;
const resumeModel = () => parseResumeModel(S.resume?.rich || S.resume?.text || '', { serif: S.resume?.serif });
function letterFromResume() {
  if (!match) return;
  $('#clOut').value = templateLetter({ profile: S.profile, match, jobA, model: resumeModel() });
  letterFor = job.url; letterEdited = false; saveLetter();
}
function autoLetter() {
  $('#clFor').textContent = job ? [job.title, job.company].filter(Boolean).join(' · ') : '';
  if (match && (letterFor !== job.url) && !letterEdited) letterFromResume();
}
async function saveLetter() {
  if (!job) return;
  const { letters = {} } = await chrome.storage.local.get('letters');
  letters[job.url] = { ...(letters[job.url] || defaultLetterMeta(jobA)), body: $('#clOut').value };
  await save({ letters });
}
$('#clOut').addEventListener('input', debounce(() => { letterEdited = true; saveLetter(); }, 500));
$('#clBtn').addEventListener('click', () => { if (!match) return toast('Open a job first'); letterFromResume(); });
$('#clAiBtn').addEventListener('click', async () => {
  if (!match) return toast('Open a job first');
  const btn = $('#clAiBtn'), out = $('#clOut');
  busy(btn, true, 'Writing…');
  const highlights = relevantEntries(resumeModel(), jobA, ['experience', 'projects']).flatMap(e => e.bullets.slice(0, 2).map(b => (e.company || e.head ? `${e.company || e.head}: ` : '') + b.text)).slice(0, 5);
  try { await aiCoverLetter({ jobA, resumeText: S.resume.text, profile: S.profile, match, highlights }, { onChunk: t => (out.value = t.trim()) }); letterFor = job.url; saveLetter(); }
  catch { letterFromResume(); toast('AI failed — drafted from your resume'); }
  busy(btn, false);
});
$('#clStudio').addEventListener('click', async () => {
  if (!job) return toast('Open a job first');
  await saveLetter(); await save({ currentJob: job });
  chrome.tabs.create({ url: chrome.runtime.getURL('studio/studio.html#letter') });
});

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
    const r = await extractResumeFile(file);
    if (r.text.length < 100) throw new Error('Almost no text found. If this is a scanned PDF, export a text-based PDF or paste the text below.');
    const fileData = file.size < 6e6 ? await fileToDataURL(file) : null;
    await storeResume(r.rich, { fileName: file.name, fileType: file.type, fileData, detected: {}, pages: r.pages, pageSize: r.pageSize, serif: r.serif });
    prefillProfile(r.rich);
    setStatus('');
    toast('Resume added');
    rescore();
    enhanceWithAI();
  } catch (e) {
    setStatus(esc(e.message));
    $('#resumeTextBox').open = true;
  }
}

async function storeResume(rich, extra = {}) {
  const text = stripRich(rich);
  const model = parseResumeModel(rich);
  S.resume = { ...(S.resume || {}), ...extra, rich, text, sections: modelSections(model), updatedAt: Date.now() };
  await save({ resume: S.resume, tailored: {} });
  renderResume();
}

/** AI layer: fill what the rule-based parser could not (years when no dates, extra skills, title). */
async function enhanceWithAI() {
  if (!aiOn() || !S.resume?.text) return;
  setStatus('<span class="spinner"></span> AI is reading your resume…');
  try {
    const r = await aiParseResume(S.resume.text);
    const known = new Set([...findSkills(S.resume.text).keys()].map(n => n.toLowerCase()));
    const aiSkills = [...new Set((r.skills || []).map(s => String(s).trim()).filter(s => s && s.length < 40))]
      .map(s => { const hit = [...findSkills(s).keys()][0]; return hit || s; })
      .filter(s => !known.has(s.toLowerCase())).slice(0, 25);
    S.resume.detected = { aiSkills, aiYears: +r.totalYears || 0, aiTitle: r.currentTitle || '', aiRoles: r.roles || [] };
    await save({ resume: S.resume });
    if (!S.profile.targetTitle && r.currentTitle) { S.profile.targetTitle = r.currentTitle; await save({ profile: S.profile }); fillProfileForm(); }
    setStatus(`<span class="ok">Enhanced with AI</span> · ${aiSkills.length} more skill${aiSkills.length === 1 ? '' : 's'} found`);
    renderResume(); rescore();
  } catch (e) { setStatus(''); }
}

function prefillProfile(rich) {
  const text = stripRich(rich);
  const p = S.profile, model = parseResumeModel(rich);
  p.name ||= model.name;
  p.email ||= text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || '';
  p.phone ||= text.match(/\+?\d[\d\s().-]{8,}\d/)?.[0]?.trim() || '';
  p.linkedin ||= text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+/i)?.[0] || '';
  p.github ||= text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w\-]+/i)?.[0] || '';
  // Location: only from the header (before the first section), e.g. "Pune, India" — never from skills lists.
  const header = model.contact + ' ' + stripRich(model.headline || '');
  const loc = header.split(/\s*\|\s*/).map(x => x.trim()).find(x => /^[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s*[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?$/.test(x) && !findSkills(x).size);
  if (loc) p.location ||= loc;
  // Title and company from the most recent experience entry ("Software Engineer" / "Nuvi Technology").
  const latest = relevantEntries(model, undefined, ['experience'])[0];
  if (!p.targetTitle) p.targetTitle = stripRich(model.headline || '').split(/[|•·,]/)[0].trim().slice(0, 80) || latest?.role || '';
  if (!p.currentCompany && latest?.company) p.currentCompany = latest.company;
  // Portfolio / personal site: any other link or bare domain in the header (e.g. "imrahul.me").
  if (!p.portfolio) {
    const head = rich.split('\n').slice(0, 6).join(' ');
    const urls = [...head.matchAll(/\]\((https?:[^)\s]+)\)/g)].map(m => m[1])
      .concat([...stripRich(head).matchAll(/(?<![@\w.])((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:me|dev|io|com|in|app|net|org|co|xyz|site|tech|page|ai|design|portfolio)(?:\/[\w\-./]*)?)(?![\w@])/gi)].map(m => m[1]));
    const site = urls.find(u => !/linkedin\.com|github\.com|gitlab\.com|mailto:|gmail\.com|outlook\.com|yahoo\.com|leetcode|hackerrank|medium\.com\/@?$/i.test(u));
    if (site) p.portfolio = site.replace(/\/$/, '');
  }
  for (const k of ['linkedin', 'github', 'portfolio']) if (p[k] && !/^https?:/.test(p[k])) p[k] = 'https://' + p[k];
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
  if (document.activeElement !== $('#resumeText')) $('#resumeText').value = r.rich || r.text;

  // Experience
  const wt = workText(r.text, r.sections);
  const ranges = experienceRanges(wt).sort((a, b) => b.end - a.end || b.start - a.start);
  const nowM = new Date().getFullYear() * 12 + new Date().getMonth();
  const total = experienceIntervals(wt).reduce((a, [s, e]) => a + (e - s), 0);
  const cy = candidateYears(r.text, r.sections, S.profile.yearsExperience, r.detected?.aiYears, S.profileData?.years);
  $('#yearsTotal').textContent = S.profile.yearsExperience ? `${S.profile.yearsExperience} yrs (override)` : cy.source === 'LinkedIn' ? `${cy.years} yrs · LinkedIn` : total ? fmtMonths(total) : cy.years ? `${cy.years} yrs · ${cy.source}` : '';
  $('#roles').innerHTML = ranges.length ? ranges.slice(0, 8).map(x => `<li><span class="rl" title="${esc(x.label)}">${esc(cleanLabel(x.label) || 'Role')}</span><span class="rd">${fmtMonth(x.start)} – ${x.end >= nowM ? 'Present' : fmtMonth(x.end - 1)} · ${fmtMonths(x.end - x.start)}</span></li>`).join('')
    : `<li class="empty-roles">No date ranges found in your work history.${cy.source === 'LinkedIn' ? ` Using ${cy.years} years from your LinkedIn work history.` : cy.source === 'AI' ? ` AI estimates ${cy.years} years.` : ' Set your years below.'}</li>`;
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
  for (const s of S.profileData?.skills || []) if (!out.has(s.name)) out.set(s.name, s.source || 'import');
  for (const n of added) if (!out.has(n)) out.set(n, 'added');
  return [...out].filter(([n]) => !removed.has(n));
}
function renderSkills() {
  const items = mySkills();
  $('#skillCount').textContent = items.length || '';
  $('#mySkills').innerHTML = items.map(([n, src]) => `<span class="chip" data-skill="${esc(n)}">${esc(n)}${src === 'ai' ? ' <span class="ai">AI</span>' : src === 'github' ? ' <span class="src" title="From GitHub">GH</span>' : src === 'linkedin' ? ' <span class="src" title="From LinkedIn">in</span>' : ''}<button class="x" title="Remove">×</button></span>`).join('') || '<span class="muted small">No skills detected yet.</span>';
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
  if (S.profileData?.skills?.some(s => s.name === n)) { S.profileData.skills = S.profileData.skills.filter(s => s.name !== n); await save({ profileData: S.profileData }); }
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
  await storeResume(cleanResumeText($('#resumeText').value), { detected: S.resume?.detected || {}, fileName: S.resume?.fileName });
  toast('Saved'); rescore();
});

/* ---------------- Profile: import from GitHub / LinkedIn (no AI) ---------------- */
let pending = null; // import result waiting for the user's review
const PROFILE_FIELDS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['location', 'Location'], ['targetTitle', 'Title'], ['currentCompany', 'Current company'], ['portfolio', 'Portfolio'], ['github', 'GitHub']];
const dateRange = (s, e) => [s, e || 'Present'].filter(Boolean).join(' – ');

function showPreview(r) {
  pending = r;
  const box = $('#impPreview');
  const have = new Set(mySkills().map(([n]) => n.toLowerCase()));
  const pd = S.profileData || {};
  const isNew = (list, k, x) => !(pd[list] || []).some(y => KEYS[k](y) === KEYS[k](x));
  const fields = PROFILE_FIELDS.filter(([k]) => r.profile?.[k] && !S.profile[k]);
  const skills = (r.skills || []).filter(s => !have.has(s.name.toLowerCase()));
  const work = (r.work || []).filter(w => isNew('work', 'work', w));
  const edu = (r.education || []).filter(e => isNew('education', 'education', e));
  const certs = (r.certifications || []).filter(c => isNew('certifications', 'certifications', c));
  const projects = (r.projects || []).filter(p => isNew('projects', 'projects', p));
  const item = (group, i, title, sub, checked = true) => `<label class="imp-item"><input type="checkbox" data-g="${group}" data-i="${i}" ${checked ? 'checked' : ''}><div><div>${esc(title)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div></label>`;
  let html = `<div class="st-src"><b>${r.source === 'github' ? `GitHub · @${esc(r.username)}` : 'LinkedIn export'}</b>${r.stats ? ` · ${r.stats.repos} public repos` : ''}${r.years ? ` · ${r.years} yrs of work history` : ''}. Choose what to add:</div>`;
  if (fields.length) html += `<h4>Fill empty profile fields</h4>` + fields.map(([k, label]) => item('field', k, `${label}: ${r.profile[k]}`)).join('');
  if (skills.length) html += `<h4>Skills (${skills.length})</h4>` + skills.map((s, i) => item('skill', i, s.name, s.why)).join('');
  if (work.length) html += `<h4>Work history (${work.length})</h4>` + work.map((w, i) => item('work', i, `${w.title} · ${w.company}`, dateRange(w.start, w.end))).join('');
  if (edu.length) html += `<h4>Education (${edu.length})</h4>` + edu.map((e, i) => item('edu', i, e.school, [e.degree, dateRange(e.start, e.end)].filter(Boolean).join(' · '))).join('');
  if (certs.length) html += `<h4>Certifications (${certs.length})</h4>` + certs.map((c, i) => item('cert', i, c.name, c.authority)).join('');
  if (projects.length) html += `<h4>Projects (${projects.length})</h4>` + projects.map((p, i) => item('proj', i, p.name, [p.language, p.stars ? `★ ${p.stars}` : '', p.description].filter(Boolean).join(' · '), i < 6)).join('');
  if (!fields.length && !skills.length && !work.length && !edu.length && !certs.length && !projects.length) html += '<p class="muted small" style="margin:0">Nothing new — your profile already has all of this.</p>';
  else html += `<div class="row" style="margin-top:10px"><button class="btn small primary" id="impApply">Add selected</button><button class="btn small ghost" id="impCancel">Cancel</button></div>`;
  pending.view = { fields, skills, work, edu, certs, projects };
  box.innerHTML = html; box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

$('#impPreview').addEventListener('click', async e => {
  if (e.target.id === 'impCancel') { pending = null; $('#impPreview').hidden = true; return; }
  if (e.target.id !== 'impApply' || !pending) return;
  const pick = g => $$(`#impPreview input[data-g="${g}"]:checked`).map(cb => cb.dataset.i);
  const v = pending.view;
  for (const k of pick('field')) S.profile[k] = pending.profile[k];
  const pd = S.profileData = { work: [], education: [], certifications: [], projects: [], skills: [], sources: {}, ...(S.profileData || {}) };
  pd.skills = mergeList(pd.skills, pick('skill').map(i => ({ ...v.skills[i], source: pending.source })), s => KEYS.skills(s.name));
  pd.work = mergeList(pd.work, pick('work').map(i => ({ ...v.work[i], source: pending.source })), KEYS.work).sort((a, b) => (parseMonth(b.start) ?? 0) - (parseMonth(a.start) ?? 0));
  pd.education = mergeList(pd.education, pick('edu').map(i => v.edu[i]), KEYS.education);
  pd.certifications = mergeList(pd.certifications, pick('cert').map(i => v.certs[i]), KEYS.certifications);
  pd.projects = mergeList(pd.projects, pick('proj').map(i => v.projects[i]), KEYS.projects);
  pd.years = yearsFromWork(pd.work);
  pd.sources[pending.source] = { at: Date.now(), ...(pending.username ? { username: pending.username } : {}) };
  // Removing a skill earlier then importing it again: the user chose it, so un-remove.
  const added = new Set(pick('skill').map(i => v.skills[i].name));
  S.profile.removedSkills = list(S.profile.removedSkills).filter(n => !added.has(n)).join(', ');
  await save({ profile: S.profile, profileData: pd });
  pending = null; $('#impPreview').hidden = true;
  fillProfileForm(); renderResume(); renderStructured(); rescore();
  toast('Added to your profile');
});

$('#ghBtn').addEventListener('click', async () => {
  const u = githubUsername($('#ghUser').value || S.profile.github || '');
  if (!u) return toast('Enter your GitHub username or profile URL');
  const btn = $('#ghBtn'); busy(btn, true, 'Importing…');
  try { showPreview(await importGitHub(u)); }
  catch (e) { toast(e.message, 4000); }
  busy(btn, false);
});
$('#liFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  $('#liNote').textContent = 'Reading…';
  try { const r = await importLinkedIn(files); $('#liNote').textContent = `Read ${r.files.join(', ')}`; showPreview(r); }
  catch (err) { $('#liNote').textContent = ''; toast(err.message, 5000); }
});

function renderStructured() {
  const pd = S.profileData || {};
  const n = (pd.work?.length || 0) + (pd.education?.length || 0) + (pd.projects?.length || 0) + (pd.certifications?.length || 0);
  $('#structCard').hidden = !n && !(pd.skills?.length);
  $('#structCount').textContent = n ? `${n} item${n === 1 ? '' : 's'}` : '';
  if (!$('#ghUser').value) $('#ghUser').value = pd.sources?.github?.username || githubUsername(S.profile.github || '') || '';
  const src = Object.entries(pd.sources || {}).map(([k, v]) => `${k === 'github' ? 'GitHub' + (v.username ? ' @' + esc(v.username) : '') : 'LinkedIn'} · ${new Date(v.at).toLocaleDateString()}`).join(' &nbsp;·&nbsp; ');
  const row = (list, i, t, sub, href) => `<div class="st-item"><div class="main"><div class="t">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="color:inherit">${esc(t)}</a>` : esc(t)}</div>${sub ? `<div class="sub" title="${esc(sub)}">${esc(sub)}</div>` : ''}</div><button class="x" data-l="${list}" data-i="${i}" title="Remove">×</button></div>`;
  const group = (title, list, items) => items?.length ? `<div class="st-group"><div class="group-title"><span>${title}</span><span>${items.length}</span></div>${items.map((x, i) => row(list, i, ...x)).join('')}</div>` : '';
  $('#structBody').innerHTML = (src ? `<div class="st-src">Imported from ${src}${pd.years ? ` · ${pd.years} yrs of work history` : ''}</div>` : '')
    + group('Work history', 'work', (pd.work || []).map(w => [`${w.title} · ${w.company}`, [dateRange(w.start, w.end), w.location].filter(Boolean).join(' · ')]))
    + group('Education', 'education', (pd.education || []).map(e => [e.school, [e.degree, dateRange(e.start, e.end)].filter(Boolean).join(' · ')]))
    + group('Projects', 'projects', (pd.projects || []).map(p => [p.name, [p.language, p.stars ? `★ ${p.stars}` : '', p.description].filter(Boolean).join(' · '), p.url]))
    + group('Certifications', 'certifications', (pd.certifications || []).map(c => [c.name, [c.authority, c.date].filter(Boolean).join(' · '), c.url]));
}
$('#structBody').addEventListener('click', async e => {
  const x = e.target.closest('.x[data-l]'); if (!x) return;
  const pd = S.profileData; pd[x.dataset.l].splice(+x.dataset.i, 1);
  if (x.dataset.l === 'work') pd.years = yearsFromWork(pd.work);
  await save({ profileData: pd }); renderStructured(); renderResume(); rescore();
});

/* ---------------- Profile: details & settings ---------------- */
function fillProfileForm() {
  for (const el of $('#profileForm').elements) if (el.name && document.activeElement !== el) el.value = S.profile[el.name] ?? '';
  if (!$('#ghUser').value && S.profile.github) $('#ghUser').value = githubUsername(S.profile.github);
}
$('#profileForm').addEventListener('input', debounce(async () => {
  for (const el of $('#profileForm').elements) if (el.name) S.profile[el.name] = el.value.trim();
  await save({ profile: S.profile });
  $('#profileSaved').textContent = 'Saved';
  setTimeout(() => ($('#profileSaved').textContent = ''), 1200);
  rescore();
}, 500));

$('#setWidget').addEventListener('change', e => { S.settings.widget = e.target.checked; save({ settings: S.settings }); });
$('#setPos').addEventListener('change', e => { S.settings.widgetPos = e.target.value; save({ settings: S.settings }); });
$('#setTheme').addEventListener('change', e => { S.settings.theme = e.target.value; save({ settings: S.settings }); });
$('#setAI').addEventListener('change', e => { S.settings.useAI = e.target.checked; save({ settings: S.settings }); refreshAI(); });
$('#wipe').addEventListener('click', async () => {
  if (!confirm('Delete your resume, profile, history and tailored resumes from this browser?')) return;
  await chrome.storage.local.clear(); location.reload();
});

/* ---------------- Live updates ---------------- */
const autoScan = debounce(() => { scan(); refreshForm(); }, 900);
chrome.tabs.onActivated.addListener(() => autoScan());
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && (info.status === 'complete' || info.url)) autoScan(); });
chrome.runtime.onMessage.addListener(msg => {
  // The content script detected a (new) job — e.g. LinkedIn switched jobs without a page load.
  if (msg?.type === 'job-detected' && msg.tabId === currentTabId && msg.job?.ok) {
    if (!job || job.url !== msg.job.url || job.description !== msg.job.description) setJob(msg.job);
  }
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'session' && ch.pendingAction?.newValue) { maybePending(); return; }
  if (area === 'local' && ch.applications) { renderTracker(); renderTrackRow(); }
  if (area !== 'local') return;
  if (ch.profile && JSON.stringify(ch.profile.newValue) !== JSON.stringify(S.profile)) { S.profile = ch.profile.newValue || {}; fillProfileForm(); renderResume(); }
});

/* An action requested from the floating card (e.g. "Generate AI insights") */
async function maybePending() {
  const { pendingAction } = await chrome.storage.session.get('pendingAction').catch(() => ({}));
  if (!pendingAction || !match) return;
  await chrome.storage.session.remove('pendingAction');
  if (pendingAction === 'ai-insights') runInsights();
  if (pendingAction === 'cover-letter') { showTab('apply'); }
}

/* ---------------- Tracker ---------------- */
async function renderTrackRow() {
  if (!job) return;
  const app = (await getApps())[appKey(job.url)];
  $('#trackStatus').value = app?.status || '';
  $('#trackApplied').hidden = !!app && app.status !== 'saved';
  $('#trackWhen').textContent = app?.appliedAt ? `applied ${agoText(app.appliedAt)}` : '';
}
$('#trackStatus').addEventListener('change', async e => {
  if (!job) return;
  if (!e.target.value) await removeApp(appKey(job.url)); else await upsertApp(job, { status: e.target.value, score: match?.score });
  renderTrackRow();
});
$('#trackApplied').addEventListener('click', async () => {
  if (!job) return;
  await upsertApp(job, { status: 'applied', score: match?.score });
  renderTrackRow(); toast('Tracked — we’ll remind you if there’s no reply in a week');
});

async function renderTracker() {
  const apps = await getApps();
  const list = Object.values(apps);
  const due = dueFollowUps(apps);
  $('#trackDot').hidden = !due.length;
  const count = s => list.filter(a => a.status === s).length;
  $('#trackStats').innerHTML = [['Applied', list.filter(a => a.appliedAt).length], ['Interviewing', count('interview')], ['Offers', count('offer')], ['Waiting 7d+', due.length]]
    .map(([l, n]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
  $('#followCard').hidden = !due.length;
  $('#followCount').textContent = due.length || '';
  $('#followList').innerHTML = due.map(a => `<div class="app" data-k="${esc(a.key)}"><div class="app-top"><div class="app-main"><div class="app-title"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title || a.url)}</a></div><div class="app-sub">${esc(a.company || '')}${a.company ? ' · ' : ''}applied ${agoText(a.appliedAt)}</div></div></div>
    <div class="fu-btns"><button class="btn small" data-fu="interview">Got an interview</button><button class="btn small" data-fu="rejected">Rejected</button><button class="btn small" data-fu="ghosted">No response</button><button class="btn small ghost" data-fu="snooze">Remind me in a week</button></div></div>`).join('');
  const f = $('#appFilter').value;
  const rows = list.filter(a => !f || a.status === f).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  $('#appCount').textContent = list.length || '';
  $('#appList').innerHTML = rows.map(a => `<div class="app" data-k="${esc(a.key)}"><div class="app-top"><div class="app-main">
      <div class="app-title"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title || a.url)}</a></div>
      <div class="app-sub"><span class="pill-s ${a.status}">${esc(STATUS_LABEL[a.status] || a.status)}</span> ${esc(a.company || '')}${a.appliedAt ? ` · applied ${agoText(a.appliedAt)}` : ''}${a.auto ? ' · auto-detected' : ''}${a.score != null ? ` · ${a.score}% match` : ''}</div></div>
      <select data-st>${STATUSES.map(([v, l]) => `<option value="${v}" ${v === a.status ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="x" data-del title="Remove">×</button></div></div>`).join('')
    || '<p class="muted small" style="margin:0">No applications yet. Open a job and click “Mark as applied”.</p>';
}
$('#appFilter').addEventListener('change', renderTracker);
$('#tab-tracker').addEventListener('change', async e => {
  const sel = e.target.closest('select[data-st]'); if (!sel) return;
  const a = (await getApps())[sel.closest('.app').dataset.k]; if (!a) return;
  await upsertApp(a, { status: sel.value }); renderTracker(); renderTrackRow();
});
$('#tab-tracker').addEventListener('click', async e => {
  const row = e.target.closest('.app'); if (!row) return;
  const a = (await getApps())[row.dataset.k]; if (!a) return;
  if (e.target.closest('[data-del]')) { if (confirm(`Remove “${a.title || a.url}” from the tracker?`)) { await removeApp(a.key); renderTracker(); renderTrackRow(); } return; }
  const fu = e.target.closest('[data-fu]')?.dataset.fu; if (!fu) return;
  if (fu === 'snooze') await upsertApp(a, { snoozeUntil: Date.now() + 7 * 864e5 });
  else await upsertApp(a, { status: fu });
  renderTracker(); renderTrackRow();
});
$('#appCsv').addEventListener('click', async () => download(`shortlist-applications-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(await getApps()), 'text/csv'));

/* ---------------- Photo (for forms that ask for one) ---------------- */
async function renderPhoto() {
  const { photo } = await chrome.storage.local.get('photo');
  $('#photoPrev').style.backgroundImage = photo?.dataURL ? `url("${photo.dataURL}")` : '';
  $('#photoPrev').textContent = photo?.dataURL ? '' : '👤';
  $('#photoDel').hidden = !photo?.dataURL;
}
$('#photoIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 800 / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    await save({ photo: { dataURL: c.toDataURL('image/jpeg', 0.9), name: (f.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg' } });
    renderPhoto(); toast('Photo saved');
  } catch { toast('Could not read that image'); }
});
$('#photoDel').addEventListener('click', async () => { await chrome.storage.local.remove('photo'); renderPhoto(); });

/* ---------------- Backup & restore ---------------- */
$('#bkExport').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  download(`shortlist-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'shortlist', version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), data }), 'application/json');
  toast('Backup downloaded — it includes saved logins, keep it private');
});
$('#bkImport').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j?.app !== 'shortlist' || typeof j.data !== 'object') throw new Error('Not a Shortlist backup file');
    if (!confirm(`Restore the backup from ${new Date(j.exportedAt).toLocaleString()}? This replaces the data in this browser.`)) return;
    await chrome.storage.local.clear(); await chrome.storage.local.set(j.data);
    location.reload();
  } catch (err) { toast(err.message || 'Could not read that file', 4000); }
});

/* ---------------- Migrations for data saved by older versions ---------------- */
async function migrate() {
  // v1 could mistake a skills line ("React, Next.js") for the location.
  if (S.profile.location && findSkills(S.profile.location).size) { S.profile.location = ''; await save({ profile: S.profile }); }
  // v1 stored plain text only: re-read the saved original file to recover formatting and links.
  if (S.resume?.fileData && !S.resume.rich) {
    try {
      const blob = await (await fetch(S.resume.fileData)).blob();
      const r = await extractResumeFile(new File([blob], S.resume.fileName || 'resume.pdf', { type: blob.type }));
      if (r.text.length > 100) await storeResume(r.rich, { pages: r.pages, pageSize: r.pageSize, serif: r.serif, tailored: undefined });
      prefillProfile(r.rich);
    } catch { /* keep plain text */ }
  }
}

/* ---------------- Init ---------------- */
await migrate();
fillProfileForm();
renderResume();
renderStructured();
renderPhoto();
renderTracker();
if (location.hash === '#tracker') showTab('tracker');
$('#setWidget').checked = S.settings.widget !== false;
$('#setPos').value = S.settings.widgetPos || 'br';
$('#setTheme').value = S.settings.theme || 'system';
$('#setAI').checked = S.settings.useAI;
renderHistory();
await refreshAI();
if (S.resume?.text && !S.resume.detected?.aiSkills && aiOn()) enhanceWithAI();
scan();
