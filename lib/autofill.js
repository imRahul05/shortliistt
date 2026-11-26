// Functions injected into pages with chrome.scripting.executeScript({ func }). Each must be self-contained
// (no references to outer scope), so small helpers are repeated inside them on purpose.

/** Look at the page's form: what kind it is, how many fields we can fill, and its main buttons. */
export function scanForm() {
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = el => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim();
  const inputs = [...document.querySelectorAll('input, textarea, select')].filter(el => !el.disabled && el.type !== 'hidden' && visible(el));
  const passwords = inputs.filter(el => el.type === 'password');
  const fillable = inputs.filter(el => !['password', 'hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio', 'file'].includes(el.type));
  const emptyFillable = fillable.filter(el => !String(el.value || '').trim());
  const files = inputs.filter(el => el.type === 'file');
  const pageText = (document.body?.innerText || '').slice(0, 20000).toLowerCase();
  const ACTION = /^(create (an )?account|sign ?up|register|join now|sign ?in|log ?in|next|continue|save (and|&) continue|submit( application)?|apply( now| for this job)?|review|send application|verify)$/i;
  const candidates = [...document.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a[role=button], [data-automation-id$="Button"], [data-automation-id$="SubmitButton"]')].filter(visible);
  const actions = [];
  const seen = new Set();
  for (const el of candidates) {
    const label = text(el).replace(/\s*[→›>]$/, '');
    if (!label || label.length > 40 || !ACTION.test(label) || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const key = el.getAttribute('data-shortlist-action') || Math.random().toString(36).slice(2, 10);
    el.setAttribute('data-shortlist-action', key);
    actions.push({ key, label, primary: false });
  }
  const signupWords = /(create (an )?account|sign ?up|register|verify (new )?password|confirm password|re-?enter password)/i;
  const signinWords = /(sign ?in|log ?in|forgot (your )?password)/i;
  let kind = 'none';
  if (passwords.length >= 2 || (passwords.length === 1 && signupWords.test(pageText) && !/forgot (your )?password/i.test(pageText))) kind = 'signup';
  else if (passwords.length === 1) kind = 'signin';
  else if (emptyFillable.length >= 2 || files.length) kind = 'application';
  // The main button depends on the form: Create Account / Sign In / Next-Submit.
  const PRIMARY = { signup: /create|sign ?up|register|join/i, signin: /sign ?in|log ?in/i, application: /submit|apply|next|continue|save|review|send/i, none: /submit|apply|next|continue/i };
  for (const a of actions) a.primary = PRIMARY[kind].test(a.label);
  actions.sort((a, b) => b.primary - a.primary);
  const terms = inputs.filter(el => el.type === 'checkbox' && !el.checked).some(el => /agree|consent|terms|privacy|i have read/i.test((el.closest('label, div, li')?.innerText || '') + (el.getAttribute('aria-label') || '')));
  return { kind, host: location.hostname, fillable: fillable.length, empty: emptyFillable.length, passwords: passwords.length, files: files.length, actions, terms, title: document.title };
}

/** Click one of the page's buttons found by scanForm (Workday puts a "click_filter" overlay over its buttons). */
export function clickAction(key) {
  const el = document.querySelector(`[data-shortlist-action="${CSS.escape(key)}"]`);
  if (!el) return false;
  const target = el.querySelector('[data-automation-id="click_filter"]') || el.parentElement?.querySelector(':scope > [data-automation-id="click_filter"]') || el;
  el.scrollIntoView({ block: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  target.click();
  return true;
}

/**
 * Fill the page. `opts.password` is used for password fields:
 *  - sign-up: every password field (password + confirm) gets the new generated password
 *  - sign-in: the saved password for this site
 */
export function autofillPage(profile, file, opts = {}) {
  const p = profile || {};
  const [first, ...rest] = (p.name || '').trim().split(/\s+/);
  const loc = (p.location || '').split(',').map(s => s.trim());
  const values = {
    first: first || '', last: rest.join(' '), full: p.name || '', email: p.email || '', phone: p.phone || '',
    linkedin: p.linkedin || '', github: p.github || '', website: p.portfolio || p.github || '', location: p.location || '',
    city: loc[0] || '', country: loc[loc.length - 1] && loc.length > 1 ? loc[loc.length - 1] : '',
    title: p.targetTitle || '', company: p.currentCompany || '',
    years: p.yearsExperience != null && p.yearsExperience !== '' ? String(p.yearsExperience) : '', notice: p.noticePeriod || '',
    salary: p.expectedSalary || '', currentSalary: p.currentSalary || '',
  };
  const RULES = [
    ['email', /e-?mail|username|user name|login id/], ['phone', /phone|mobile|contact number|\btel\b/], ['linkedin', /linkedin/], ['github', /github/],
    ['website', /website|portfolio|personal (site|url)|blog|other url/],
    ['first', /first[\s_-]*name|given[\s_-]*name|fname|forename/], ['last', /last[\s_-]*name|surname|family[\s_-]*name|lname/],
    ['full', /^(full[\s_-]*)?name$|your name|full name|candidate name|legal name|^name\b/],
    ['city', /\bcity\b|town/], ['country', /\bcountry\b/], ['location', /location|address|where are you based|current location/],
    ['title', /current (job )?title|job title|designation|current role|headline/], ['company', /current (company|employer)|employer|company name/],
    ['years', /years of (total |relevant )?experience|total experience|experience \(years\)|how many years/], ['notice', /notice period/],
    ['currentSalary', /current (ctc|salary|compensation)/], ['salary', /expected (ctc|salary|compensation)|desired salary|salary expectation/],
  ];
  const labelOf = el => {
    const parts = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.getAttribute('data-automation-id'), el.getAttribute('data-qa'), el.getAttribute('data-testid')];
    if (el.id) { try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) parts.push(l.textContent); } catch {} }
    const wrap = el.closest('label'); if (wrap) parts.push(wrap.textContent);
    const lb = el.getAttribute('aria-labelledby'); if (lb) lb.split(/\s+/).forEach(id => parts.push(document.getElementById(id)?.textContent));
    const field = el.closest('[data-automation-id^="formField"], .field, .form-group, .application-question, [class*="field"], [class*="question"], li');
    if (field) { const t = field.querySelector('label, legend, .label, [class*="label"]'); if (t) parts.push(t.textContent); }
    return parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ');
  };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; };
  const setVal = (el, v) => {
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); // works with React-controlled inputs (Workday, Greenhouse…)
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const mark = el => { el.style.outline = '2px solid #22c55e'; el.style.outlineOffset = '1px'; };
  let filled = 0, attached = 0, passwordFilled = 0;
  const fields = [];
  const all = [...document.querySelectorAll('input, textarea, select')].filter(el => !el.disabled && !el.readOnly && el.type !== 'hidden' && visible(el));

  for (const el of all) {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'password') {
      if (opts.password && !el.value) { setVal(el, opts.password); mark(el); passwordFilled++; }
      continue;
    }
    if (['submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(type)) continue;
    if (el.value && String(el.value).trim()) continue;
    const label = labelOf(el);
    let key = null;
    if (type === 'email') key = 'email'; else if (type === 'tel') key = 'phone';
    else for (const [k, re] of RULES) if (re.test(label)) { key = k; break; }
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (!key && ac) key = { 'given-name': 'first', 'family-name': 'last', name: 'full', email: 'email', username: 'email', tel: 'phone', 'address-level2': 'city', 'country-name': 'country', url: 'website', 'organization-title': 'title', organization: 'company' }[ac] || null;
    if (!key || !values[key]) continue;
    if (el.tagName === 'SELECT') {
      const want = values[key].toLowerCase();
      const opt = [...el.options].find(o => o.text.trim().toLowerCase() === want) || [...el.options].find(o => o.text.toLowerCase().includes(want) && want.length > 2);
      if (!opt) continue;
      setVal(el, opt.value);
    } else setVal(el, values[key]);
    filled++; fields.push(key); mark(el);
  }

  if (file && file.dataURL) {
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter(i => !i.files?.length);
    const target = inputs.find(i => /resume|cv|curriculum/i.test(labelOf(i))) || (inputs.length === 1 ? inputs[0] : null);
    if (target) {
      try {
        const [meta, b64] = file.dataURL.split(',');
        const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const f = new File([u8], file.name || 'resume.pdf', { type: meta.match(/data:([^;]+)/)?.[1] || 'application/pdf' });
        const dt = new DataTransfer(); dt.items.add(f); target.files = dt.files;
        target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true }));
        attached++;
      } catch {}
    }
  }
  // Never tick terms/consent boxes for the user — just point them out.
  const terms = [...document.querySelectorAll('input[type=checkbox]')].filter(el => !el.checked && visible(el) && /agree|consent|terms|privacy|i have read/i.test((el.closest('label, div, li')?.innerText || '') + (el.getAttribute('aria-label') || '')));
  terms.forEach(el => { (el.closest('label, div') || el).style.outline = '2px dashed #f59e0b'; });
  return { filled, attached, fields, passwordFilled, terms: terms.length, host: location.hostname };
}

/** Strong password that satisfies common ATS rules (upper, lower, digit, symbol, 16 chars). */
export function generatePassword(len = 16) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
  const pick = s => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = sets.map(pick);
  const all = sets.join('');
  while (chars.length < len) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
