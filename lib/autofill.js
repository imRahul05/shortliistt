// Self-contained function injected into job application forms (all frames). Must not reference outer scope.
export function autofillPage(profile, file) {
  const p = profile || {};
  const [first, ...rest] = (p.name || '').trim().split(/\s+/);
  const values = {
    first: first || '', last: rest.join(' '), full: p.name || '', email: p.email || '', phone: p.phone || '',
    linkedin: p.linkedin || '', github: p.github || '', website: p.portfolio || p.github || '', location: p.location || '',
    city: (p.location || '').split(',')[0].trim(), title: p.targetTitle || '', company: p.currentCompany || '',
    years: p.yearsExperience != null && p.yearsExperience !== '' ? String(p.yearsExperience) : '', notice: p.noticePeriod || '',
    salary: p.expectedSalary || '', currentSalary: p.currentSalary || '',
  };
  const RULES = [
    ['email', /e-?mail/], ['phone', /phone|mobile|contact number|tel\b/], ['linkedin', /linkedin/], ['github', /github/],
    ['website', /website|portfolio|personal (site|url)|blog/], ['first', /first[\s_-]*name|given[\s_-]*name|fname/], ['last', /last[\s_-]*name|surname|family[\s_-]*name|lname/],
    ['full', /^(full[\s_-]*)?name$|your name|full name|candidate name|legal name/], ['city', /\bcity\b/], ['location', /location|address|where are you based|current location/],
    ['title', /current (job )?title|job title|designation|current role|headline/], ['company', /current (company|employer)|employer/],
    ['years', /years of (total |relevant )?experience|total experience|experience \(years\)|how many years/], ['notice', /notice period/],
    ['currentSalary', /current (ctc|salary|compensation)/], ['salary', /expected (ctc|salary|compensation)|desired salary|salary expectation/],
  ];
  const labelOf = el => {
    const parts = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.getAttribute('data-automation-id'), el.getAttribute('data-qa')];
    if (el.id) { try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) parts.push(l.textContent); } catch {} }
    const wrap = el.closest('label'); if (wrap) parts.push(wrap.textContent);
    const lb = el.getAttribute('aria-labelledby'); if (lb) lb.split(/\s+/).forEach(id => parts.push(document.getElementById(id)?.textContent));
    const field = el.closest('.field, .form-group, .application-question, [class*="field"], [class*="question"], li, div');
    if (field) { const t = field.querySelector('label, legend, .label, [class*="label"]'); if (t) parts.push(t.textContent); }
    return parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ');
  };
  const setVal = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); // works with React-controlled inputs
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  let filled = 0, attached = 0;
  const fields = [];
  for (const el of document.querySelectorAll('input, textarea')) {
    const type = (el.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'password', 'file', 'image', 'reset'].includes(type) || el.disabled || el.readOnly) continue;
    if (el.offsetParent === null && type !== 'email') continue;
    if (el.value && el.value.trim()) continue;
    const label = labelOf(el);
    let key = null;
    if (type === 'email') key = 'email'; else if (type === 'tel') key = 'phone';
    else for (const [k, re] of RULES) if (re.test(label)) { key = k; break; }
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (!key && ac) key = { 'given-name': 'first', 'family-name': 'last', name: 'full', email: 'email', tel: 'phone', 'address-level2': 'city', url: 'website', 'organization-title': 'title', organization: 'company' }[ac] || null;
    if (key && values[key]) {
      setVal(el, values[key]); filled++; fields.push(key);
      el.style.outline = '2px solid #22c55e'; el.style.outlineOffset = '1px';
    }
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
  return { filled, attached, fields };
}
