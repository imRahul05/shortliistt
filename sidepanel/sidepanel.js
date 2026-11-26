import { getState, save, addHistory, fileToDataURL } from '../lib/storage.js';
import { analyzeJob, matchJob } from '../lib/matcher.js';
import { extractResumeFile, cleanResumeText } from '../lib/resume-parser.js';
import { parseResumeModel, modelSections } from '../lib/resume-model.js';
import { aiAvailability, AI_LABEL, aiInsights, aiAnswer, aiCoverLetter, downloadModel } from '../lib/ai.js';
import { autofillPage } from '../lib/autofill.js';
import { $, $$, toast, md, download, busy, scoreClass, scoreColor, fallbackCoverLetter } from '../lib/ui.js';
import { escapeHtml, debounce } from '../lib/text.js';

let S = await getState();
let job = null, jobA = null, match = null, aiState = 'unsupported', tabId = null;

/* ---------------- Tabs ---------------- */
function showTab(name) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('main > section').forEach(s => (s.hidden = s.id !== `tab-${name}`));
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto); });
document.addEventListener('click', e => {
  const c = e.target.closest('[data-copy]'); if (!c) return;
  navigator.clipboard.writeText($('#' + c.dataset.copy).value).then(() => toast('Copied'));
});

/* ---------------- AI status ---------------- */
async function refreshAI() {
  aiState = S.settings.useAI ? await aiAvailability() : 'unsupported';
  const pill = $('#aiPill');
  pill.className = 'pill' + (aiState === 'available' ? ' on' : aiState === 'downloadable' || aiState === 'downloading' ? ' dl' : '');
  pill.textContent = !S.settings.useAI ? 'AI off · rule-based' : aiState === 'available' ? '✨ On-device AI ready' : aiState === 'downloadable' ? '⬇ Enable on-device AI' : aiState === 'downloading' ? 'AI downloading…' : 'Rule-based mode';
  pill.title = AI_LABEL[aiState] || '';
  $('#aiSetup').innerHTML = aiSetupHelp();
  $$('#aiInsightsBtn').forEach(b => (b.hidden = aiState !== 'available'));
}
function aiSetupHelp() {
  if (!S.settings.useAI) return 'AI is turned off. All matching stays rule-based.';
  if (aiState === 'available') return '✅ Gemini Nano is ready and runs fully on your device.';
  if (aiState === 'downloadable' || aiState === 'downloading') return 'Click the “Enable on-device AI” badge at the top to download Chrome’s built-in model once (needs ~22 GB free disk, 4 GB+ VRAM or 16 GB RAM).';
  return 'This browser/device does not expose Chrome’s built-in AI (needs desktop Chrome 138+ on Windows, macOS, Linux or ChromeOS with enough memory). JobFit still works fully with rule-based matching and templates.';
}
$('#aiPill').addEventListener('click', async () => {
  if (aiState !== 'downloadable') return;
  const pill = $('#aiPill');
  try {
    await downloadModel(p => (pill.textContent = `Downloading AI… ${Math.round(p * 100)}%`));
    toast('On-device AI is ready');
  } catch (e) { toast('AI download failed: ' + e.message, 4000); }
  refreshAI();
});

/* ---------------- Scanning ---------------- */
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t;
}

async function scan() {
  const t = await activeTab();
  tabId = t?.id;
  $('#needResume').hidden = !!S.resume?.text;
  if (!t || !/^https?:/.test(t.url || '')) { setNoJob(); return; }
  const btn = $('#scanBtn');
  busy(btn, true, 'Reading page…');
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/extract.js'] });
    if (!result?.ok) { setNoJob(); return; }
    setJob(result);
  } catch (e) {
    setNoJob(`Can't read this page (${e.message}).`);
  } finally { busy(btn, false); }
}

function setNoJob(msg) {
  job = jobA = match = null;
  $('#result').hidden = true; $('#jobCard').hidden = true;
  $('#noJob').hidden = false;
  if (msg) $('#noJob p').textContent = msg;
}

function setJob(j) {
  job = j;
  $('#noJob').hidden = true;
  $('#jobCard').hidden = false;
  $('#jobTitle').textContent = j.title || 'Untitled job';
  $('#jobMeta').innerHTML = [j.company, j.location].filter(Boolean).map(escapeHtml).join(' · ') + ` <span class="src">via ${escapeHtml(j.source || 'page')}</span>`;
  jobA = analyzeJob(j);
  rescore();
  save({ currentJob: j });
}

function rescore() {
  if (!jobA) return;
  if (!S.resume?.text) { $('#result').hidden = true; $('#needResume').hidden = false; return; }
  match = matchJob(jobA, { text: S.resume.text, sections: S.resume.sections, profile: S.profile });
  renderMatch();
  addHistory({ url: job.url, title: job.title, company: job.company, score: match.score });
  renderHistory();
}

/* ---------------- Rendering ---------------- */
const STATUS_ICON = { matched: '✓', implied: '≈', related: '~', missing: '✗' };
const pct = v => (v == null ? '—' : Math.round(v * 100) + '%');

function renderMatch() {
  $('#result').hidden = false;
  const m = match;
  $('#scoreNum').textContent = m.score;
  const fg = $('#ringFg');
  fg.style.stroke = scoreColor(m.score);
  requestAnimationFrame(() => (fg.style.strokeDashoffset = String(326.7 * (1 - m.score / 100))));
  $('#verdict').textContent = m.verdict;
  $('#verdict').style.color = scoreColor(m.score);
  const parts = [['Skills', m.parts.skills], ['Experience', m.parts.experience], ['Keywords', m.parts.keywords], ['Title', m.parts.title], ['Education', m.parts.education]];
  $('#bars').innerHTML = parts.map(([k, v]) => `<div class="bar ${v == null ? 'na' : ''}"><span>${k}</span><div class="track"><div class="fill" style="width:${v == null ? 0 : Math.round(v * 100)}%;background:${v == null ? 'transparent' : scoreColor(v * 100)}"></div></div><span>${pct(v)}</span></div>`).join('');

  const groups = [['must', 'Must-have'], ['important', 'Important'], ['nice', 'Nice to have']];
  $('#skillGroups').innerHTML = groups.map(([imp, label]) => {
    const rows = m.skills.filter(s => s.importance === imp);
    if (!rows.length) return '';
    const have = rows.filter(r => r.status === 'matched' || r.status === 'implied').length;
    return `<div class="group"><div class="group-title">${label}<span>${have}/${rows.length}</span></div><div class="chips">${rows.map(r =>
      `<span class="chip ${r.status}" data-skill="${escapeHtml(r.name)}" title="${escapeHtml(chipTitle(r))}">${STATUS_ICON[r.status]} ${escapeHtml(r.name)}</span>`).join('')}</div></div>`;
  }).join('') || '<p class="muted small">No recognizable technical skills in this posting — scoring relies on keywords.</p>';

  const y = m.years, e = m.education;
  const facts = [];
  if (y.required != null) {
    const ok = y.candidate >= y.required;
    facts.push(`<div class="fact"><span>Experience ${y.inferred ? '<span class="muted">(inferred from title)</span>' : ''}</span><span>needs <b>${y.required}+ yrs</b> · you <span class="${ok ? 'ok' : y.candidate >= y.required * 0.7 ? 'meh' : 'no'}">${y.candidate || 0} yrs</span></span></div>`);
  } else facts.push(`<div class="fact"><span>Experience</span><span>not specified · you <b>${y.candidate || 0} yrs</b> <span class="muted small">(${y.source})</span></span></div>`);
  if (e.required) facts.push(`<div class="fact"><span>Degree</span><span>${escapeHtml(e.required)}${e.flexible ? ' or equiv.' : ''} · you <span class="${e.candidate ? 'ok' : 'no'}">${escapeHtml(e.candidate || 'not found')}</span></span></div>`);
  if (m.seniority) facts.push(`<div class="fact"><span>Seniority</span><span><b>${m.seniority}</b></span></div>`);
  $('#facts').innerHTML = facts.join('');

  $('#keywords').innerHTML = m.keywords.length ? m.keywords.map(k => `<span class="chip ${k.found ? 'kw-found' : 'kw-missing'}" title="appears ${k.n}× in job">${k.found ? '✓ ' : ''}${escapeHtml(k.word)}</span>`).join('') : '<span class="muted small">No repeated keywords.</span>';
  $('#sugs').innerHTML = m.suggestions.map(s => `<li class="${s.level}">${escapeHtml(s.text)}</li>`).join('') || '<li class="tip">Looks great — no major gaps found.</li>';
  $('#aiInsights').innerHTML = 'Get a short, honest fit review written by Chrome’s built-in model. Nothing leaves your computer.';
  $('#aiInsights').classList.add('muted');
}

function chipTitle(r) {
  const where = r.tiers.join(', ');
  if (r.status === 'matched') return `In your resume · job mentions it ${r.count}× (${where})`;
  if (r.status === 'implied') return `Implied by ${r.via} in your resume — name it explicitly`;
  if (r.status === 'related') return `Related: you have ${r.via}. Partial credit.`;
  return `Not found in your resume (${where}). Click if you have it.`;
}

$('#skillGroups').addEventListener('click', async e => {
  const chip = e.target.closest('.chip.missing'); if (!chip) return;
  const name = chip.dataset.skill;
  if (!confirm(`Add "${name}" to your profile skills? Only do this if you genuinely have it.`)) return;
  const cur = (S.profile.extraSkills || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!cur.includes(name)) cur.push(name);
  S.profile.extraSkills = cur.join(', ');
  await save({ profile: S.profile });
  fillProfileForm();
  rescore();
  toast(`Added ${name}. Remember to add it to your resume too.`);
});

/* ---------------- Job editor ---------------- */
$('#editJobBtn').addEventListener('click', () => {
  $('#jobEditor').hidden = false;
  $('#jeTitle').value = job?.title || ''; $('#jeCompany').value = job?.company || ''; $('#jeDesc').value = job?.description || '';
  $('#jeDesc').focus();
});
$('#jeCancel').addEventListener('click', () => ($('#jobEditor').hidden = true));
$('#jeApply').addEventListener('click', async () => {
  const t = await activeTab();
  setJob({ ok: true, url: job?.url || t?.url || 'manual', title: $('#jeTitle').value, company: $('#jeCompany').value, description: $('#jeDesc').value, source: 'edited by you', location: job?.location || '' });
  $('#jobEditor').hidden = true;
});
$('#scanBtn').addEventListener('click', scan);

/* ---------------- AI review ---------------- */
$('#aiInsightsBtn').addEventListener('click', async () => {
  if (!match) return;
  const btn = $('#aiInsightsBtn'), out = $('#aiInsights');
  busy(btn, true, 'Thinking on-device…');
  out.classList.remove('muted'); out.innerHTML = '';
  try {
    await aiInsights({ jobA, resumeText: S.resume.text, match }, { onChunk: t => (out.innerHTML = md(t)) });
  } catch (e) { out.innerHTML = `<p class="muted">AI error: ${escapeHtml(e.message)}</p>`; }
  busy(btn, false);
});

/* ---------------- Tailor ---------------- */
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
    $('#autofillStatus').textContent = `Filled ${tot.filled} field(s)${tot.attached ? ', attached resume' : ''}. Please review.`;
    if (!tot.filled && !tot.attached) toast('No matching empty fields found. Fill your Profile tab first.', 3500);
  } catch (e) { $('#autofillStatus').textContent = 'Could not access this page: ' + e.message; }
  busy(btn, false);
});

$('#qBtn').addEventListener('click', async () => {
  const q = $('#qText').value.trim(); if (!q) return toast('Type the question first');
  if (!S.resume?.text) return toast('Upload your resume first');
  const btn = $('#qBtn'), out = $('#qOut');
  if (aiState !== 'available') {
    out.value = `[On-device AI isn't available, so here is a structure to fill in]\n\nSituation: ...\nWhat I did: ...\nResult (with numbers): ...\nWhy it matters for ${jobA?.company || 'this role'}: ...`;
    return;
  }
  busy(btn, true, 'Drafting…');
  try { await aiAnswer({ jobA, resumeText: S.resume.text, question: q }, { onChunk: t => (out.value = t) }); }
  catch (e) { out.value = 'AI error: ' + e.message; }
  busy(btn, false);
});

$('#clBtn').addEventListener('click', async () => {
  if (!match) return toast('Analyze a job first (Match tab)');
  const btn = $('#clBtn'), out = $('#clOut');
  if (aiState !== 'available') { out.value = fallbackCoverLetter({ jobA, match, profile: S.profile, model: parseResumeModel(S.resume.text) }); return; }
  busy(btn, true, 'Writing…');
  try { await aiCoverLetter({ jobA, resumeText: S.resume.text, profile: S.profile }, { onChunk: t => (out.value = t) }); }
  catch (e) { out.value = fallbackCoverLetter({ jobA, match, profile: S.profile, model: parseResumeModel(S.resume.text) }); toast('AI failed, used template'); }
  busy(btn, false);
});
$('#clDl').addEventListener('click', () => download(`Cover Letter - ${(job?.company || 'job').replace(/[^\w -]/g, '')}.txt`, $('#clOut').value));

async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  $('#history').innerHTML = history.slice(0, 25).map(h => `<li><span class="sc ${scoreClass(h.score)}">${h.score}</span><div class="meta"><a href="${escapeHtml(h.url)}" target="_blank">${escapeHtml(h.title || h.url)}</a><div class="muted small">${escapeHtml(h.company || '')} · ${new Date(h.at).toLocaleDateString()}</div></div></li>`).join('') || '<li class="muted small">Jobs you analyze appear here.</li>';
}

/* ---------------- Profile tab ---------------- */
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
$('#fileIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); });

async function handleFile(file) {
  $('#fileInfo').innerHTML = '<span class="spinner"></span> Parsing locally…';
  try {
    const text = await extractResumeFile(file);
    if (text.length < 100) throw new Error('Very little text found. If this is a scanned/image PDF, export a text PDF or paste the text below.');
    const fileData = file.size < 6e6 ? await fileToDataURL(file) : null;
    await storeResume(text, { fileName: file.name, fileType: file.type, fileData });
    prefillProfileFromResume(text);
    toast('Resume parsed ✓');
    rescore();
  } catch (e) {
    $('#fileInfo').textContent = '⚠️ ' + e.message;
    $('#resumeTextBox').open = true;
  }
}

async function storeResume(text, extra = {}) {
  const model = parseResumeModel(text);
  S.resume = { ...(S.resume || {}), ...extra, text, sections: modelSections(model), updatedAt: Date.now() };
  await save({ resume: S.resume, tailored: {} });
  renderResumeInfo();
}

function prefillProfileFromResume(text) {
  const p = S.profile;
  const model = parseResumeModel(text);
  p.name ||= model.name;
  p.email ||= text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || '';
  p.phone ||= text.match(/\+?\d[\d\s().-]{8,}\d/)?.[0]?.trim() || '';
  p.linkedin ||= (text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w\-%]+/i)?.[0] || '');
  p.github ||= (text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w\-]+/i)?.[0] || '');
  if (!p.targetTitle && model.headline && model.headline.length < 60) p.targetTitle = model.headline.split(/[|•,]/)[0].trim();
  for (const k of ['linkedin', 'github']) if (p[k] && !/^https?:/.test(p[k])) p[k] = 'https://' + p[k];
  save({ profile: p });
  fillProfileForm();
}

function renderResumeInfo() {
  const r = S.resume;
  if (!r?.text) { $('#fileInfo').textContent = 'No resume yet.'; return; }
  const kinds = (r.sections || []).map(s => s.title).join(' · ');
  $('#fileInfo').innerHTML = `✅ <b>${escapeHtml(r.fileName || 'Resume text')}</b> · ${r.text.split(/\s+/).length} words<br><span class="muted">Sections: ${escapeHtml(kinds || 'none detected')}</span>`;
  $('#resumeText').value = r.text;
  $('#needResume').hidden = true;
}
$('#saveResumeText').addEventListener('click', async () => {
  await storeResume(cleanResumeText($('#resumeText').value));
  toast('Saved'); rescore();
});

function fillProfileForm() {
  const f = $('#profileForm');
  for (const el of f.elements) if (el.name) el.value = S.profile[el.name] ?? '';
}
$('#profileForm').addEventListener('input', debounce(async () => {
  for (const el of $('#profileForm').elements) if (el.name) S.profile[el.name] = el.value.trim();
  await save({ profile: S.profile });
  $('#profileSaved').textContent = 'Saved ✓';
  setTimeout(() => ($('#profileSaved').textContent = ''), 1200);
  rescore();
}, 500));

$('#setBadge').addEventListener('change', e => { S.settings.autoBadge = e.target.checked; save({ settings: S.settings }); });
$('#setAI').addEventListener('change', e => { S.settings.useAI = e.target.checked; save({ settings: S.settings }); refreshAI(); });
$('#wipe').addEventListener('click', async () => {
  if (!confirm('Delete your resume, profile, history and tailored resumes from this browser?')) return;
  await chrome.storage.local.clear();
  location.reload();
});

/* ---------------- Live tab tracking ---------------- */
const autoScan = debounce(scan, 1200);
chrome.tabs.onActivated.addListener(() => autoScan());
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && (info.status === 'complete' || info.url)) autoScan(); });
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.resume) { S.resume = ch.resume.newValue || null; renderResumeInfo(); }
  if (ch.profile && JSON.stringify(ch.profile.newValue) !== JSON.stringify(S.profile)) { S.profile = ch.profile.newValue || {}; fillProfileForm(); }
});

/* ---------------- Init ---------------- */
fillProfileForm();
renderResumeInfo();
$('#setBadge').checked = S.settings.autoBadge;
$('#setAI').checked = S.settings.useAI;
renderHistory();
refreshAI();
if (!S.resume?.text) { $('#needResume').hidden = false; }
scan();
