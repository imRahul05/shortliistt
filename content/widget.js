// Floating match card shown on job pages. Runs in every page; does nothing unless a job posting is detected.
(() => {
  if (window.__shortlistWidget) return;
  window.__shortlistWidget = true;
  const isTop = window.top === window;

  // Sub-frames (embedded Greenhouse/Lever/Workday boards): detect only; the card is drawn by the top frame.
  if (!isTop) {
    let lastH = '';
    const scan = () => {
      if (innerWidth < 320 || innerHeight < 240) return;
      let job; try { job = __shortlistExtract({ auto: true }); } catch { return; }
      if (!job?.ok || !job.confident) return;
      let h = 0; const k = job.title + job.description.slice(0, 2000); for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
      if (String(h) === lastH) return; lastH = String(h);
      try { chrome.runtime.sendMessage({ type: 'match', job }); } catch {}
    };
    let t; const later = ms => { clearTimeout(t); t = setTimeout(scan, ms); };
    later(900);
    const stopAt = Date.now() + 20000;
    new MutationObserver(() => { if (Date.now() < stopAt) later(1000); }).observe(document.documentElement, { childList: true, subtree: true });
    return;
  }

  let alive = true, lastUrl = '', lastHash = '', settleUntil = 0, timer = null, state = null;
  let settings = { widget: true, widgetPos: 'br' };
  const dismissed = new Set();

  const send = msg => new Promise(res => {
    try { chrome.runtime.sendMessage(msg, r => { if (chrome.runtime.lastError) res(null); else res(r); }); }
    catch { alive = false; res(null); } // extension reloaded: this script is orphaned
  });
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- font (Geist, bundled) ---------- */
  try {
    const f = document.createElement('style');
    f.textContent = `@font-face{font-family:"Shortlist Geist";src:url("${chrome.runtime.getURL('lib/fonts/Geist-Variable.woff2')}") format("woff2");font-weight:100 900;font-display:swap}`;
    document.documentElement.appendChild(f);
  } catch {}

  /* ---------- shadow host ---------- */
  const host = document.createElement('shortlist-card');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{--aibg:#eef3ff;--aifg:#16244a;--ailine:#d6e1fb;--bg:#fff;--fg:#0a0a0b;--mut:#6b6b74;--line:#e6e6ea;--soft:#f4f4f6;--good:#12804a;--goodbg:#e9f7ef;--warn:#b25e09;--warnbg:#fdf3e6;--bad:#c0322b;--badbg:#fdecea;--shadow:0 1px 2px rgba(0,0,0,.06),0 8px 28px rgba(0,0,0,.12)}
    @media (prefers-color-scheme:dark){:host(:not([data-theme=light])){--bg:#16161a;--fg:#f2f2f4;--mut:#9b9ba6;--line:#2a2a31;--soft:#1f1f25;--good:#3ccf86;--goodbg:#12301f;--warn:#f0a542;--warnbg:#33240f;--bad:#f2706a;--badbg:#3a1614;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.5);--aibg:#152342;--aifg:#dbe6ff;--ailine:#22386a}}
    :host([data-theme=dark]){--bg:#16161a;--fg:#f2f2f4;--mut:#9b9ba6;--line:#2a2a31;--soft:#1f1f25;--good:#3ccf86;--goodbg:#12301f;--warn:#f0a542;--warnbg:#33240f;--bad:#f2706a;--badbg:#3a1614;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.5);--aibg:#152342;--aifg:#dbe6ff;--ailine:#22386a}
    *{box-sizing:border-box;margin:0}
    .wrap{font:13px/1.4 "Shortlist Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased;animation:in .28s cubic-bezier(.2,.8,.2,1)}
    @keyframes in{from{opacity:0;transform:translateY(8px) scale(.98)}}
    .card{width:292px;background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
    .head{display:flex;align-items:center;gap:8px;padding:10px 10px 0 14px}
    .mark{width:18px;height:18px;border-radius:5px;background:var(--fg);display:grid;place-items:center}
    .mark svg{width:11px;height:11px;stroke:var(--bg)}
    .brand{font-weight:600;font-size:12.5px;letter-spacing:-.01em;flex:1}
    .ib{all:unset;cursor:pointer;width:24px;height:24px;display:grid;place-items:center;border-radius:6px;color:var(--mut)}
    .ib:hover{background:var(--soft);color:var(--fg)}
    .ib svg{width:14px;height:14px}
    .body{padding:10px 14px 14px}
    .score{display:flex;align-items:baseline;gap:8px}
    .num{font-size:34px;font-weight:600;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums}
    .num small{font-size:15px;color:var(--mut);font-weight:500;margin-left:1px}
    .verdict{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px}
    .bar{height:4px;border-radius:99px;background:var(--soft);margin:10px 0 10px;overflow:hidden}
    .bar i{display:block;height:100%;border-radius:99px;transition:width .6s cubic-bezier(.2,.8,.2,1)}
    .job{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sub{color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .row{display:flex;justify-content:space-between;font-size:12px;color:var(--mut);margin-top:10px}
    .row b{color:var(--fg);font-weight:600;font-variant-numeric:tabular-nums}
    .tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
    .tag{font-size:11.5px;font-weight:500;padding:2px 7px;border-radius:6px;background:var(--badbg);color:var(--bad)}
    .btn{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:12px;height:32px;border-radius:8px;background:var(--fg);color:var(--bg);font-weight:600;font-size:12.5px}
    .btn:hover{opacity:.88}
    .btn svg{width:13px;height:13px}
    .pill{all:unset;cursor:pointer;display:flex;align-items:center;gap:7px;padding:7px 12px 7px 8px;background:var(--bg);border:1px solid var(--line);border-radius:99px;box-shadow:var(--shadow);font-weight:600;font-variant-numeric:tabular-nums}
    .pill .mark{width:20px;height:20px;border-radius:99px}
    .dot{width:7px;height:7px;border-radius:99px}
    .muted{color:var(--mut)}
    .track{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;flex-wrap:wrap}
    .track .ok{color:var(--good);font-weight:600}
    .lnk{all:unset;cursor:pointer;font-weight:600;color:var(--fg);text-decoration:underline;text-underline-offset:2px}
    .toast{width:292px;margin-top:8px;padding:10px 12px;border-radius:12px;background:var(--bg);border:1px solid var(--line);box-shadow:var(--shadow);font-size:12.5px;display:flex;gap:8px;align-items:center}
    .note{margin-top:10px;font-size:12px;line-height:1.45;color:var(--fg);background:var(--soft);border-radius:8px;padding:8px 10px}
    .note b{font-weight:600;color:var(--warn)}
    .btns{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}
    .btns .btn{margin-top:0}
    .btn.ai{background:#2563eb;color:#fff;box-shadow:0 1px 2px rgba(37,99,235,.3),inset 0 1px 0 rgba(255,255,255,.15)}
    .btn.ai svg{width:12px;height:12px}
    .btn.ai{position:relative}
    .btn.ai::after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:45%;pointer-events:none;background:linear-gradient(105deg,transparent,rgba(255,255,255,.5) 50%,transparent);transform:skewX(-20deg);animation:sh 3.6s cubic-bezier(.4,0,.2,1) infinite}
    @keyframes sh{0%{left:-60%}38%,100%{left:130%}}
    @media (prefers-reduced-motion:reduce){.btn.ai::after{display:none}}
    .btn.ghost{background:var(--soft);color:var(--fg);box-shadow:inset 0 0 0 1px var(--line)}
    .btn svg{width:12px;height:12px}
    .btn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px}
    .ai-box{margin-top:12px;padding:10px 11px;border-radius:10px;background:var(--aibg);color:var(--aifg);font-size:12.3px;line-height:1.5;max-height:240px;overflow:auto;border:1px solid var(--ailine)}
    .ai-box p{margin:0 0 6px}.ai-box ul{margin:2px 0 6px;padding-left:16px}.ai-box li{margin:2px 0}.ai-box b{font-weight:600}
    .spin{width:12px;height:12px;border:1.75px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;animation:sp .7s linear infinite;vertical-align:-2px;margin-right:6px}
    @keyframes sp{to{transform:rotate(360deg)}}
  </style><div class="wrap" id="w"></div>`;
  const W = root.getElementById('w');

  const ICON = {
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };
  const STATUS = { saved: 'Saved', applied: 'Applied', interview: 'Interviewing', offer: 'Offer', rejected: 'Rejected', ghosted: 'No response' };
  const ago = t => { const d = Math.max(0, Math.floor((Date.now() - t) / 864e5)); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
  const tone = s => (s >= 75 ? ['var(--good)', 'var(--goodbg)'] : s >= 55 ? ['var(--warn)', 'var(--warnbg)'] : ['var(--bad)', 'var(--badbg)']);

  function place() {
    const p = settings.widgetPos || 'br';
    host.style.top = p[0] === 't' ? '16px' : 'auto';
    host.style.bottom = p[0] === 'b' ? '16px' : 'auto';
    host.style.left = p[1] === 'l' ? '16px' : 'auto';
    host.style.right = p[1] === 'r' ? '16px' : 'auto';
  }
  function mount() { if (!host.isConnected) document.documentElement.appendChild(host); place(); }
  function hide() { host.remove(); state = null; }

  function render(r, job) {
    if (!settings.widget || dismissed.has(location.href)) return hide();
    mount();
    const minimized = sessionStorage.getItem('shortlist-min') === '1';
    if (r.state === 'noresume') {
      state = r;
      W.innerHTML = `<div class="card"><div class="head"><span class="mark">${ICON.mark}</span><span class="brand">Shortlist</span><button class="ib" data-a="x" title="Hide">${ICON.x}</button></div>
        <div class="body"><div class="job">${esc(job.title)}</div><div class="sub">Job detected${job.company ? ' · ' + esc(job.company) : ''}</div>
        <p class="muted" style="margin-top:8px;font-size:12px">Add your resume once to see how well you match every job you open.</p>
        <button class="btn" data-a="open">Add resume ${ICON.arrow}</button></div></div>`;
      return;
    }
    state = r;
    const [fg, bg] = tone(r.score);
    if (minimized) {
      W.innerHTML = `<button class="pill" data-a="expand" title="Shortlist — ${esc(r.verdict)}"><span class="mark">${ICON.mark}</span>${r.score}%<span class="dot" style="background:${fg}"></span></button>`;
      return;
    }
    const missing = r.missing.slice(0, 4);
    W.innerHTML = `<div class="card">
      <div class="head"><span class="mark">${ICON.mark}</span><span class="brand">Shortlist</span>
        <button class="ib" data-a="min" title="Minimize">${ICON.min}</button><button class="ib" data-a="x" title="Hide on this page">${ICON.x}</button></div>
      <div class="body">
        <div class="score"><span class="num">${r.score}<small>%</small></span><span class="verdict" style="color:${fg};background:${bg}">${esc(r.verdict)}</span></div>
        <div class="bar"><i style="width:${r.score}%;background:${fg}"></i></div>
        <div class="job" title="${esc(r.title)}">${esc(r.title)}</div>
        <div class="sub">${esc([r.company, r.yearsLine].filter(Boolean).join(' · '))}</div>
        ${r.mustTotal ? `<div class="row"><span>Must-have skills</span><b>${r.mustHave}/${r.mustTotal}</b></div>` : ''}
        ${missing.length ? `<div class="tags">${missing.map(m => `<span class="tag">${esc(m)}</span>`).join('')}${r.missing.length > 4 ? `<span class="tag" style="background:var(--soft);color:var(--mut)">+${r.missing.length - 4}</span>` : ''}</div>` : `<div class="row"><span>No must-have skills missing</span></div>`}
        <div class="btns"><button class="btn ai" data-a="ai">${ICON.spark} AI insights</button><button class="btn" data-a="open">Full report ${ICON.arrow}</button></div>
        <div class="track">${r.app && r.app.status !== 'saved' ? `<span class="ok">✓ ${r.app.status === 'applied' ? `Applied ${r.app.appliedAt ? ago(r.app.appliedAt) : ''}` : esc(STATUS[r.app.status] || r.app.status)}</span><button class="lnk" data-a="open">Update</button>` : `<button class="lnk" data-a="applied">✓ Mark as applied</button><span class="muted">tracks it &amp; reminds you in a week</span>`}</div>
        ${aiHtml ? `<div class="ai-box">${aiHtml}</div>` : ''}
      </div></div>`;
  }

  root.addEventListener('click', async e => {
    const el = e.target.closest('[data-a]');
    const a = el?.dataset.a;
    if (!a) return;
    if (el.tagName === 'A') e.preventDefault();
    if (a === 'x') { dismissed.add(location.href); hide(); }
    if (a === 'min') { sessionStorage.setItem('shortlist-min', '1'); render(state, lastJob); }
    if (a === 'expand') { sessionStorage.removeItem('shortlist-min'); render(state, lastJob); }
    if (a === 'open') send({ type: 'open-panel' });
    if (a === 'ai') runAI();
    if (a === 'applied' && lastJob) {
      const app = await send({ type: 'track', job: lastJob, patch: { status: 'applied' } });
      if (app && !app.error) { state = { ...state, app: { status: app.status, appliedAt: app.appliedAt } }; render(state, lastJob); }
    }
    if (a === 'undo-applied' && lastJob) {
      await send({ type: 'track', job: lastJob, patch: { status: 'saved', appliedAt: null } });
      if (state) state = { ...state, app: null };
      confirmNote = ''; render(state, lastJob); renderConfirm();
    }
    if (a === 'fill') runAutofill();
    if (a === 'act') {
      const act = form?.actions?.find(x => x.key === el.dataset.key);
      if (!act) return;
      formNote = `Clicked “${esc(act.label)}” on the page.`;
      renderForm();
      await send({ type: 'page-action', key: act.key, frameId: act.frameId });
      setTimeout(() => { formSig = ''; scheduleForm(1200); }, 300);
    }
  });

  /* ---------- AI insights: run in the side panel, where Chrome's built-in AI works reliably ---------- */
  function runAI() {
    // Must be sent inside the click (user gesture) so Chrome lets the background open the side panel.
    send({ type: 'open-panel-with', action: 'ai-insights' });
    aiHtml = 'Opening AI insights in the Shortlist panel →';
    render(state, lastJob);
    setTimeout(() => { if (/Opening AI insights/.test(aiHtml)) { aiHtml = ''; render(state, lastJob); } }, 2500);
  }

  /* ---------- Application / sign-up form card (pages with a form but no job description) ---------- */
  // Application systems only: job boards (LinkedIn, Indeed, Naukri…) have login, messaging and settings forms that aren't applications.
  const ATS_HOST = /myworkdayjobs|workday|greenhouse|lever\.co|ashbyhq|icims|taleo|smartrecruiters|successfactors|jobvite|bamboohr|workable|recruitee|teamtailor|personio|jazzhr|applytojob|breezy|zohorecruit/i;
  const JOB_BOARD = /(^|\.)(linkedin\.com|indeed\.|naukri\.com|glassdoor\.|foundit\.in|monster\.|dice\.com|wellfound\.com|angel\.co|instahyre\.com|hirist\.|iimjobs\.com|cutshort\.io|internshala\.com|shine\.com|apna\.co)/i;
  const JOBISH_URL = /apply|application|career|jobs?\b|job[-_/]|position|opening|vacanc|candidate|requisition|recruit/i;
  let form = null, formSig = '', formNote = '', formTimer = null, lastFormScan = 0;
  const KIND_TEXT = { signup: 'Create-account form', signin: 'Sign-in form', application: 'Application form' };
  function renderForm() {
    if (!form || lastHash || !settings.widget || dismissed.has(location.href)) return;
    mount();
    const prim = form.actions.filter(x => x.primary).slice(0, 2);
    const sec = form.actions.filter(x => !x.primary && x.label.length < 22).slice(0, 1);
    const fillLabel = form.kind === 'signin' ? 'Fill login' : 'Autofill';
    const sub = form.kind === 'signup' ? (form.account ? 'Your saved login for this site will be used.' : 'Fills your name and email, plus a strong password saved in Shortlist.')
      : form.kind === 'signin' ? (form.account ? `Saved login: ${esc(form.account.email || 'available')}` : 'No saved login for this site yet.')
      : `${form.empty} empty field${form.empty === 1 ? '' : 's'}${form.files ? ' · resume upload' : ''}`;
    W.innerHTML = `<div class="card">
      <div class="head"><span class="mark">${ICON.mark}</span><span class="brand">Shortlist</span><button class="ib" data-a="x" title="Hide on this page">${ICON.x}</button></div>
      <div class="body">
        <div class="job">${KIND_TEXT[form.kind]}</div>
        <div class="sub">${esc(form.host)}</div>
        <p class="muted" style="margin-top:8px;font-size:12px">${sub}</p>
        <div class="btns"><button class="btn" data-a="fill">${ICON.bolt} ${fillLabel}</button>${prim[0] ? `<button class="btn ghost" data-a="act" data-key="${prim[0].key}" title="Clicks this button on the page">${esc(prim[0].label)}</button>` : `<button class="btn ghost" data-a="open">Open Shortlist</button>`}</div>
        ${prim[1] || sec[0] ? `<div class="btns" style="margin-top:6px">${[prim[1], sec[0]].filter(Boolean).map(x => `<button class="btn ghost" data-a="act" data-key="${x.key}">${esc(x.label)}</button>`).join('')}</div>` : ''}
        ${formNote ? `<div class="note">${formNote}</div>` : ''}
      </div></div>`;
  }
  async function runAutofill() {
    formNote = '<span class="spin"></span>Filling…'; renderForm();
    const r = await send({ type: 'autofill' });
    if (!r || r.error) { formNote = esc(r?.error || 'Couldn’t fill this page.'); return renderForm(); }
    const bits = [];
    if (r.filled) bits.push(`${r.filled} field${r.filled === 1 ? '' : 's'} filled`);
    if (r.passwordFilled) bits.push(r.generated ? 'strong password created & saved' : 'saved password filled');
    if (r.attached) bits.push('resume attached');
    if (r.photo) bits.push('photo attached');
    formNote = (bits.length ? bits.join(' · ') : 'Nothing to fill — fields already have values') + '.';
    if (r.noEmail) formNote += ' Add your email in Shortlist → Profile.';
    if (r.terms) formNote += ' <b>Tick the terms checkbox yourself.</b>';
    const prim = form?.actions?.find(x => x.primary);
    if (prim && (r.filled || r.passwordFilled)) formNote += ` Then press “${esc(prim.label)}”.`;
    renderForm();
  }
  async function runForm() {
    if (!alive || lastHash || !settings.widget) return;
    if (JOB_BOARD.test(location.hostname)) return; // search boxes, login and messaging on job boards aren't applications (use the side panel's Apply tab)
    const inputs = document.querySelectorAll('input:not([type=hidden]), textarea, select').length;
    const hasKey = document.querySelector('input[type=email], input[type=password], input[type=file], [data-automation-id*="email" i], [data-automation-id*="password" i]');
    if (!hasKey && inputs < 3) { if (form) { form = null; hide(); } return; }
    const jobContext = ATS_HOST.test(location.hostname) || JOBISH_URL.test(location.pathname + location.search);
    if (!jobContext && !document.querySelector('input[type=file]')) return; // ordinary sites: never scan
    if (Date.now() - lastFormScan < 2500) return scheduleForm(2600);
    lastFormScan = Date.now();
    const r = await send({ type: 'form-scan' });
    if (!r || r.kind === 'none' || lastHash) { if (form && !lastHash) { form = null; hide(); } return; }
    // Only show on job-related pages (avoid every login page on the web), or when a resume upload is present.
    if (!jobContext && !(r.kind === 'application' && r.files)) return;
    const sig = r.kind + '|' + r.actions.map(x => x.label).join(',') + '|' + r.empty;
    if (sig === formSig) return;
    formSig = sig; form = r;
    renderForm();
  }
  const scheduleForm = ms => { clearTimeout(formTimer); formTimer = setTimeout(runForm, ms); };

  /* ---------- "Thank you for applying" detection -> mark the job as applied ---------- */
  const CONFIRM_RE = /(thank(s| you) for (applying|your (application|interest))|your application (was|has been) (sent|submitted|received)|application (submitted|received|sent)( successfully)?|we('|’)ve received your application|you('|’)ve applied|successfully applied)/i;
  let confirmedUrl = '', confirmNote = '', lastConfirmCheck = 0;
  function renderConfirm() {
    let t = root.getElementById('confirm');
    if (!confirmNote) { t?.remove(); if (!state && !form) hide(); return; }
    mount();
    if (!t) { t = document.createElement('div'); t.id = 'confirm'; t.className = 'toast'; W.after(t); }
    t.innerHTML = confirmNote;
  }
  async function checkConfirmation() {
    if (!alive || confirmedUrl === location.href || Date.now() - lastConfirmCheck < 2500) return;
    if (!(ATS_HOST.test(location.hostname) || JOB_BOARD.test(location.hostname) || JOBISH_URL.test(location.pathname + location.search))) return;
    lastConfirmCheck = Date.now();
    // Look at headings, dialogs and short status messages only — not the whole page.
    const spots = [...document.querySelectorAll('h1,h2,h3,[role=dialog],[role=alert],[role=status],[aria-live],.artdeco-modal,[data-automation-id*="ongratulations" i],[class*="confirmation" i],[class*="success" i]')].slice(0, 60);
    const hit = spots.some(el => { const t = (el.innerText || '').slice(0, 400); return t && CONFIRM_RE.test(t); });
    if (!hit) return;
    confirmedUrl = location.href;
    const r = await send({ type: 'applied-confirmation', job: lastHash ? lastJob : null });
    if (r?.ok) {
      const a = r.app;
      confirmNote = `<span class="ok" style="color:var(--good);font-weight:600">✓ Marked as applied</span><span class="muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc([a.title, a.company].filter(Boolean).join(' · '))}</span><button class="lnk" data-a="undo-applied">Undo</button>`;
      if (lastHash && state) { state = { ...state, app: { status: 'applied', appliedAt: a.appliedAt } }; render(state, lastJob); }
      if (!lastJob) lastJob = a;
      renderConfirm();
      setTimeout(() => { if (confirmNote) { confirmNote = ''; renderConfirm(); } }, 12000);
    }
  }

  /* ---------- detection loop ---------- */
  let lastJob = null, aiHtml = '', frameCard = false; // frameCard: the card shows a job found in an embedded frame
  const mdLite = t => {
    let html = '', list = false;
    for (const l of esc(t.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n')) {
      const x = l.trim();
      if (/^[-*•]\s+/.test(x)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${x.replace(/^[-*•]\s+/, '')}</li>`; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (x) html += `<p>${x.replace(/^#+\s*/, '')}</p>`;
    }
    return html + (list ? '</ul>' : '');
  };
  async function run() {
    if (!alive) return;
    setTimeout(checkConfirmation, 800);
    if (location.href !== lastUrl) { if (lastUrl) frameCard = false; lastUrl = location.href; lastHash = ''; settleUntil = Date.now() + 15000; }
    let job;
    try { job = __shortlistExtract({ auto: true }); } catch { return; }
    // No job here (e.g. LinkedIn switched from a job to the feed): remove a job card that is still showing.
    if (!job?.ok || !job.confident) { if (lastHash || (state && !form && !frameCard)) { lastHash = ''; hide(); send({ type: 'no-job' }); } scheduleForm(400); return; }
    const h = hash(job.title + '|' + job.description.slice(0, 3000));
    if (h === lastHash) return;
    lastHash = h; lastJob = job; aiHtml = ''; form = null; formSig = '';
    const r = await send({ type: 'match', job });
    if (h !== lastHash) return;
    if (!r || r.state === 'not-job' || r.state === 'error') { hide(); scheduleForm(400); return; }
    render(r, job);
  }
  const schedule = ms => { clearTimeout(timer); timer = setTimeout(run, ms); };

  const theme = () => { if (settings.theme === 'light' || settings.theme === 'dark') host.dataset.theme = settings.theme; else delete host.dataset.theme; };
  chrome.storage.local.get('settings', ({ settings: s }) => { settings = { ...settings, ...(s || {}) }; theme(); schedule(700); });
  setInterval(() => { if (alive && location.href !== lastUrl) { formSig = ''; formNote = ''; schedule(500); } }, 700);
  new MutationObserver(() => { if (Date.now() < settleUntil) schedule(900); else if (form || !lastHash) scheduleForm(1500); setTimeout(checkConfirmation, 600); }).observe(document.documentElement, { childList: true, subtree: true });
  // A job detected inside an iframe of this page.
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type !== 'render' || !alive || lastHash) return;
    lastJob = msg.job; frameCard = true; render(msg.result, msg.job);
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !alive) return;
    if (ch.settings) { settings = { ...settings, ...(ch.settings.newValue || {}) }; theme(); if (!settings.widget) hide(); else place(); }
    if (ch.resume || ch.profile || ch.settings) { lastHash = ''; schedule(300); }
  });
})();
