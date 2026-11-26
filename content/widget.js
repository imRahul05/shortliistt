// Floating match card shown on job pages. Runs in every page; does nothing unless a job posting is detected.
(() => {
  if (window.top !== window || window.__shortlistWidget) return;
  window.__shortlistWidget = true;

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
    :host{--bg:#fff;--fg:#0a0a0b;--mut:#6b6b74;--line:#e6e6ea;--soft:#f4f4f6;--good:#12804a;--goodbg:#e9f7ef;--warn:#b25e09;--warnbg:#fdf3e6;--bad:#c0322b;--badbg:#fdecea;--shadow:0 1px 2px rgba(0,0,0,.06),0 8px 28px rgba(0,0,0,.12)}
    @media (prefers-color-scheme:dark){:host{--bg:#16161a;--fg:#f2f2f4;--mut:#9b9ba6;--line:#2a2a31;--soft:#1f1f25;--good:#3ccf86;--goodbg:#12301f;--warn:#f0a542;--warnbg:#33240f;--bad:#f2706a;--badbg:#3a1614;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.5)}}
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
  </style><div class="wrap" id="w"></div>`;
  const W = root.getElementById('w');

  const ICON = {
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };
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
        <button class="btn" data-a="open">Full report ${ICON.arrow}</button>
      </div></div>`;
  }

  root.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'x') { dismissed.add(location.href); hide(); }
    if (a === 'min') { sessionStorage.setItem('shortlist-min', '1'); render(state, lastJob); }
    if (a === 'expand') { sessionStorage.removeItem('shortlist-min'); render(state, lastJob); }
    if (a === 'open') send({ type: 'open-panel' });
  });

  /* ---------- detection loop ---------- */
  let lastJob = null;
  async function run() {
    if (!alive) return;
    if (location.href !== lastUrl) { lastUrl = location.href; lastHash = ''; settleUntil = Date.now() + 15000; }
    let job;
    try { job = __shortlistExtract(); } catch { return; }
    if (!job?.ok || !job.confident) { if (lastHash) { lastHash = ''; hide(); send({ type: 'no-job' }); } return; }
    const h = hash(job.title + '|' + job.description.slice(0, 3000));
    if (h === lastHash) return;
    lastHash = h; lastJob = job;
    const r = await send({ type: 'match', job });
    if (r && h === lastHash) render(r, job);
  }
  const schedule = ms => { clearTimeout(timer); timer = setTimeout(run, ms); };

  chrome.storage.local.get('settings', ({ settings: s }) => { settings = { ...settings, ...(s || {}) }; schedule(700); });
  setInterval(() => { if (alive && location.href !== lastUrl) schedule(500); }, 700);
  new MutationObserver(() => { if (Date.now() < settleUntil) schedule(900); }).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !alive) return;
    if (ch.settings) { settings = { ...settings, ...(ch.settings.newValue || {}) }; if (!settings.widget) hide(); else place(); }
    if (ch.resume || ch.profile || ch.settings) { lastHash = ''; schedule(300); }
  });
})();
